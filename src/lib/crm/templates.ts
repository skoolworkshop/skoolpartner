import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/audit";
import { vertaalFout, type Actor } from "@/lib/crm/mutations";
import { tokensIn, vulFragment, type TokenContext } from "@/lib/crm/fragment-tekst";
import { isMerk, type Merk } from "@/lib/crm/merk";

/**
 * E-mailtemplates: opslaan, opzoeken en invullen.
 *
 * ============================================================================
 * EEN TEMPLATE IS EEN HEEL BERICHT, EEN FRAGMENT IS EEN STUK TEKST
 * ============================================================================
 *
 * Dat verschil bepaalt alles hier. Een fragment plak je halverwege een notitie;
 * een template heeft een onderwerpregel en is op zichzelf te versturen. Ze
 * delen wel de personalisatie: precies dezelfde tokens, en dezelfde regel dat
 * een ontbrekende waarde zichtbaar blijft staan als {{voornaam}} in plaats van
 * stilletjes te verdwijnen.
 *
 * WAT HIER NIET GEBEURT
 *
 *   Er wordt niets verstuurd. Een template invullen levert een onderwerp en een
 *   tekst op, die je daarna zelf ziet en zelf verstuurt. Het versturen loopt via
 *   het bestaande berichtencentrum en verandert hier niet.
 */

export interface Template {
  id: string;
  brand: Merk | null;
  name: string;
  subject: string;
  body: string;
  category: string | null;
  isArchived: boolean;
  createdAt: string;
  /** Tokens die in onderwerp en tekst staan, zodat het scherm ze kan tonen. */
  tokens: string[];
  /** Tokens die niet bestaan. Vrijwel altijd een typefout. */
  onbekendeTokens: string[];
}

interface TemplateRij {
  id: string;
  brand: string | null;
  name: string;
  subject: string;
  body: string;
  category: string | null;
  is_archived: boolean;
  created_at: string;
}

function naarTemplate(rij: TemplateRij): Template {
  // Onderwerp en tekst samen, want een token in de onderwerpregel telt net zo
  // hard mee. Wie {{organisatie}} in het onderwerp zet en het daar fout spelt,
  // ziet dat anders pas bij de ontvanger.
  const { gebruikt, onbekend } = tokensIn(`${rij.subject}\n${rij.body}`);
  return {
    id: rij.id,
    brand: isMerk(rij.brand) ? rij.brand : null,
    name: rij.name,
    subject: rij.subject,
    body: rij.body,
    category: rij.category,
    isArchived: rij.is_archived,
    createdAt: rij.created_at,
    tokens: gebruikt,
    onbekendeTokens: onbekend,
  };
}

export interface TemplateFilter {
  /** Alleen templates voor dit merk, plus die voor beide merken. */
  merk?: Merk;
  /** Vrij zoeken op naam, onderwerp en tekst. */
  zoek?: string;
  /** Standaard staan gearchiveerde templates er niet bij. */
  metGearchiveerde?: boolean;
}

export async function getTemplates(filter: TemplateFilter = {}): Promise<Template[]> {
  const supabase = createServiceSupabase();

  let vraag = supabase.from("crm_templates").select("*").order("name");
  if (!filter.metGearchiveerde) vraag = vraag.eq("is_archived", false);
  if (filter.merk) vraag = vraag.or(`brand.eq.${filter.merk},brand.is.null`);

  const { data } = await vraag;
  const templates = ((data ?? []) as TemplateRij[]).map(naarTemplate);

  const zoek = filter.zoek?.trim().toLowerCase();
  if (!zoek) return templates;

  return templates.filter((t) =>
    `${t.name} ${t.subject} ${t.body} ${t.category ?? ""}`.toLowerCase().includes(zoek)
  );
}

export async function getTemplate(id: string): Promise<Template | null> {
  const supabase = createServiceSupabase();
  const { data } = await supabase.from("crm_templates").select("*").eq("id", id).maybeSingle();
  return data ? naarTemplate(data as TemplateRij) : null;
}

export interface TemplateInvoer {
  id?: string | null;
  brand: Merk | null;
  name: string;
  subject: string;
  body: string;
  category: string | null;
}

export async function bewaarTemplate(invoer: TemplateInvoer, actor: Actor): Promise<Template> {
  const supabase = createServiceSupabase();

  const naam = invoer.name.trim();
  const onderwerp = invoer.subject.trim();
  const tekst = invoer.body.trim();

  if (naam.length < 2) throw new Error("Geef het template een naam.");
  if (onderwerp.length < 2) throw new Error("Een template zonder onderwerpregel kun je niet versturen.");
  if (tekst.length < 2) throw new Error("Geef het template een tekst.");

  const velden = {
    brand: invoer.brand,
    name: naam,
    subject: onderwerp,
    body: tekst,
    category: invoer.category?.trim() || null,
  };

  const { data, error } = invoer.id
    ? await supabase.from("crm_templates").update(velden).eq("id", invoer.id).select("*").single()
    : await supabase
        .from("crm_templates")
        .insert({ ...velden, created_by: actor.userId })
        .select("*")
        .single();

  if (error) throw new Error(vertaalFout(error));

  await recordAudit({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: invoer.id ? "crm.template.bijgewerkt" : "crm.template.aangemaakt",
    entityType: "crm_template",
    entityId: data.id,
    after: { name: naam, subject: onderwerp, brand: invoer.brand },
  });

  return naarTemplate(data as TemplateRij);
}

/**
 * Archiveren, niet verwijderen.
 *
 * Een template dat ooit is gebruikt, staat in een verstuurd bericht en kan in
 * een sequence hangen. Weggooien zou die verwijzing breken; de database weigert
 * dat trouwens ook zodra er een stap naar wijst. Archiveren haalt hem uit de
 * lijst en laat de rest heel.
 */
export async function archiveerTemplate(
  id: string,
  archiveren: boolean,
  actor: Actor
): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("crm_templates")
    .update({ is_archived: archiveren })
    .eq("id", id);
  if (error) throw new Error(vertaalFout(error));

  await recordAudit({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: archiveren ? "crm.template.gearchiveerd" : "crm.template.teruggehaald",
    entityType: "crm_template",
    entityId: id,
  });
}

/** Onderwerp en tekst met echte gegevens erin, klaar om te lezen en te versturen. */
export function vulTemplate(
  template: Template,
  context: TokenContext
): { onderwerp: string; tekst: string; ontbrekend: string[] } {
  const onderwerp = vulFragment(template.subject, context);
  const tekst = vulFragment(template.body, context);
  return {
    onderwerp: onderwerp.tekst,
    tekst: tekst.tekst,
    // Wat er in beide ontbreekt, maar elk token maar een keer.
    ontbrekend: [...new Set([...onderwerp.ontbrekend, ...tekst.ontbrekend])],
  };
}
