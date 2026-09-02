import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/audit";
import type { Actor } from "@/lib/crm/mutations";
import { vertaalFout } from "@/lib/crm/mutations";
import { formatEuroCents, formatDate } from "@/lib/format";
import {
  isGeldigeSneltoets,
  maakSneltoets,
  splitsNaam,
  tokensIn,
  type KiesbaarFragment,
  type TokenContext,
} from "@/lib/crm/fragment-tekst";
import { isMerk, type Merk } from "@/lib/crm/merk";

/**
 * Fragmenten: opslaan, opzoeken en van echte gegevens voorzien.
 *
 * De tekstbewerking zelf staat in fragment-tekst.ts en is puur. Hier staat
 * alleen wat de database nodig heeft, plus het bouwen van de tokencontext uit
 * een echte deal, een echt contact of een echte organisatie.
 *
 * WAT HIER BEWUST NIET GEBEURT
 *
 *   Er wordt niets verstuurd. Een fragment gebruiken betekent tekst invoegen
 *   in een veld dat jij daarna zelf nog ziet. Het versturen van e-mail loopt
 *   via het bestaande berichtencentrum en verandert door dit bestand niet.
 */

export interface Fragment {
  id: string;
  brand: Merk | null;
  shortcut: string;
  name: string;
  body: string;
  category: string | null;
  isArchived: boolean;
  createdAt: string;
  /** Geteld uit crm_snippet_uses, nooit als los getal opgeslagen. */
  aantalKeerGebruikt: number;
  laatstGebruikt: string | null;
  /** Tokens die in de tekst staan, zodat het scherm ze kan tonen. */
  tokens: string[];
  /** Tokens die niet bestaan. Vrijwel altijd een typefout in het fragment. */
  onbekendeTokens: string[];
}

interface FragmentRij {
  id: string;
  brand: string | null;
  shortcut: string;
  name: string;
  body: string;
  category: string | null;
  is_archived: boolean;
  created_at: string;
}

function naarFragment(rij: FragmentRij, gebruik: { aantal: number; laatst: string | null }): Fragment {
  const { gebruikt, onbekend } = tokensIn(rij.body);
  return {
    id: rij.id,
    brand: isMerk(rij.brand) ? rij.brand : null,
    shortcut: rij.shortcut,
    name: rij.name,
    body: rij.body,
    category: rij.category,
    isArchived: rij.is_archived,
    createdAt: rij.created_at,
    aantalKeerGebruikt: gebruik.aantal,
    laatstGebruikt: gebruik.laatst,
    tokens: gebruikt,
    onbekendeTokens: onbekend,
  };
}

export interface FragmentFilter {
  /** Welke fragmenten passen bij dit merk. Fragmenten zonder merk passen altijd. */
  merk?: Merk | "alles";
  categorie?: string | null;
  zoek?: string;
  metGearchiveerde?: boolean;
}

/**
 * Filteren gebeurt hier en niet in de database.
 *
 * Het gaat om tientallen fragmenten, en een scherm dat op merk, groep, zoekterm
 * en archief tegelijk filtert zou anders vier verschillende selecties nodig
 * hebben. Bovendien is dit los te testen.
 */
export function filterFragmenten(fragmenten: Fragment[], filter: FragmentFilter): Fragment[] {
  const zoek = filter.zoek?.trim().toLowerCase();

  return fragmenten.filter((fragment) => {
    if (!filter.metGearchiveerde && fragment.isArchived) return false;

    // Een fragment zonder merk hoort overal thuis. Dat is geen uitzondering
    // maar het normale geval voor alles wat over betalen of plannen gaat.
    if (filter.merk && filter.merk !== "alles") {
      if (fragment.brand !== null && fragment.brand !== filter.merk) return false;
    }

    if (filter.categorie !== undefined && filter.categorie !== null) {
      if (fragment.category !== filter.categorie) return false;
    }

    if (zoek) {
      const hooiberg =
        `${fragment.name} ${fragment.shortcut} ${fragment.body} ${fragment.category ?? ""}`.toLowerCase();
      if (!hooiberg.includes(zoek)) return false;
    }

    return true;
  });
}

/**
 * Alle fragmenten, met hun gebruikscijfers erbij.
 *
 * Twee selecties en verder tellen in Node. Het gaat om tientallen fragmenten,
 * niet om miljoenen, en zo blijft de telling op een plek staan. Het filteren
 * doet de aanroeper met filterFragmenten, zodat een scherm met vier filters
 * niet vier keer de database hoeft te bevragen.
 */
export async function getFragmenten(): Promise<Fragment[]> {
  const supabase = createServiceSupabase();

  const [{ data: rijen }, { data: gebruiken }] = await Promise.all([
    supabase
      .from("crm_snippets")
      .select("id, brand, shortcut, name, body, category, is_archived, created_at")
      .order("category", { ascending: true, nullsFirst: false })
      .order("name", { ascending: true }),
    supabase.from("crm_snippet_uses").select("snippet_id, used_at"),
  ]);

  const perFragment = new Map<string, { aantal: number; laatst: string | null }>();
  for (const gebruik of gebruiken ?? []) {
    const huidig = perFragment.get(gebruik.snippet_id) ?? { aantal: 0, laatst: null };
    perFragment.set(gebruik.snippet_id, {
      aantal: huidig.aantal + 1,
      laatst:
        huidig.laatst === null || gebruik.used_at > huidig.laatst ? gebruik.used_at : huidig.laatst,
    });
  }

  return (rijen ?? []).map((rij) =>
    naarFragment(rij as FragmentRij, perFragment.get(rij.id) ?? { aantal: 0, laatst: null })
  );
}

/** De categorieen die daadwerkelijk in gebruik zijn. */
export function categorieenUit(fragmenten: Fragment[]): string[] {
  return [
    ...new Set(fragmenten.map((f) => f.category).filter((c): c is string => Boolean(c))),
  ].sort((a, b) => a.localeCompare(b));
}

// -----------------------------------------------------------------------------
// Opslaan
// -----------------------------------------------------------------------------

export interface FragmentInvoer {
  id?: string | null;
  brand?: string | null;
  shortcut?: string | null;
  name: string;
  body: string;
  category?: string | null;
}

export async function bewaarFragment(invoer: FragmentInvoer, wie: Actor): Promise<string> {
  const supabase = createServiceSupabase();

  const naam = invoer.name.trim();
  const inhoud = invoer.body.trim();
  if (naam.length < 2) throw new Error("Geef het fragment een naam.");
  if (inhoud.length < 2) throw new Error("Een fragment zonder tekst heeft geen nut.");

  // Geen sneltoets ingevuld? Dan maken we er zelf een van de naam. Dat is
  // vriendelijker dan een foutmelding over een veld waar niemand aan denkt.
  const sneltoets = maakSneltoets(invoer.shortcut?.trim() || naam);
  if (!isGeldigeSneltoets(sneltoets)) {
    throw new Error("De sneltoets moet minstens twee letters of cijfers bevatten.");
  }

  const velden = {
    brand: isMerk(invoer.brand) ? invoer.brand : null,
    shortcut: sneltoets,
    name: naam,
    body: inhoud,
    category: invoer.category?.trim() || null,
  };

  if (invoer.id) {
    const { error } = await supabase.from("crm_snippets").update(velden).eq("id", invoer.id);
    if (error) throw new Error(vertaalFout(error));
    await recordAudit({
      actorId: wie.userId,
      actorEmail: wie.email,
      action: "crm.fragment.bijgewerkt",
      entityType: "crm_snippet",
      entityId: invoer.id,
      after: { sneltoets: velden.shortcut, naam: velden.name },
    });
    return invoer.id;
  }

  const { data, error } = await supabase
    .from("crm_snippets")
    .insert({ ...velden, created_by: wie.userId })
    .select("id")
    .single();

  if (error) throw new Error(vertaalFout(error));

  await recordAudit({
    actorId: wie.userId,
    actorEmail: wie.email,
    action: "crm.fragment.aangemaakt",
    entityType: "crm_snippet",
    entityId: data.id,
    after: { sneltoets: velden.shortcut, naam: velden.name },
  });

  return data.id;
}

/**
 * Archiveren in plaats van verwijderen.
 *
 * Een fragment dat is gebruikt, hoort te blijven bestaan: anders verdwijnt ook
 * de geschiedenis van waar het is gebruikt. Archiveren haalt hem uit de
 * keuzelijst en laat de rest staan.
 */
export async function archiveerFragment(id: string, archiveren: boolean, wie: Actor): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("crm_snippets")
    .update({ is_archived: archiveren })
    .eq("id", id);
  if (error) throw new Error(vertaalFout(error));

  await recordAudit({
    actorId: wie.userId,
    actorEmail: wie.email,
    action: archiveren ? "crm.fragment.gearchiveerd" : "crm.fragment.teruggehaald",
    entityType: "crm_snippet",
    entityId: id,
  });
}

export interface GebruikOnderwerp {
  organizationId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
}

/** Vastleggen dat een fragment is gebruikt. Faalt nooit hard: dit is een telling, geen handeling. */
export async function legGebruikVast(
  snippetId: string,
  onderwerp: GebruikOnderwerp,
  wie: Actor
): Promise<void> {
  const supabase = createServiceSupabase();
  await supabase.from("crm_snippet_uses").insert({
    snippet_id: snippetId,
    organization_id: onderwerp.organizationId ?? null,
    contact_id: onderwerp.contactId ?? null,
    deal_id: onderwerp.dealId ?? null,
    actor_id: wie.userId,
  });
}

// -----------------------------------------------------------------------------
// De tokencontext uit echte gegevens
// -----------------------------------------------------------------------------

export interface ContextBron {
  dealId?: string | null;
  contactId?: string | null;
  organizationId?: string | null;
}

/**
 * Bouwt de waarden waarmee een fragment wordt ingevuld.
 *
 * Wat hier gebeurt en waarom het zo hoort: als er een deal is, dan bepaalt die
 * het contact en de organisatie. Dat is de meest specifieke bron, en het
 * voorkomt dat de naam van de ene school in een mail over de deal van een
 * andere terechtkomt.
 *
 * Wat hier NIET gebeurt: er wordt nergens een SkoolPartner-account, een profiel
 * of een portaalgebruiker bij gezocht. Een contact in het CRM is geen gebruiker,
 * en een fragment heeft die informatie ook helemaal niet nodig.
 */
export async function bouwTokenContext(
  bron: ContextBron,
  wie: { naam: string | null; email: string | null }
): Promise<TokenContext> {
  const supabase = createServiceSupabase();

  let contactId = bron.contactId ?? null;
  let organizationId = bron.organizationId ?? null;
  let dealTitel: string | null = null;
  let dealBedrag: string | null = null;
  let dealDatum: string | null = null;

  if (bron.dealId) {
    const { data: deal } = await supabase
      .from("crm_deals")
      .select("title, value_cents, expected_date, contact_id, organization_id")
      .eq("id", bron.dealId)
      .maybeSingle();

    if (deal) {
      dealTitel = deal.title;
      dealBedrag = deal.value_cents > 0 ? formatEuroCents(deal.value_cents) : null;
      dealDatum = deal.expected_date ? formatDate(deal.expected_date) : null;
      contactId = contactId ?? deal.contact_id;
      organizationId = organizationId ?? deal.organization_id;
    }
  }

  const [{ data: contact }, { data: organisatie }] = await Promise.all([
    contactId
      ? supabase
          .from("crm_contacts")
          .select("full_name, job_title, city, organization_id")
          .eq("id", contactId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    organizationId
      ? supabase.from("organizations").select("name, city").eq("id", organizationId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Staat de organisatie niet vast maar hangt het contact wel aan een school,
  // dan die alsnog erbij halen.
  let organisatieNaam = organisatie?.name ?? null;
  let organisatiePlaats = organisatie?.city ?? null;
  if (!organisatieNaam && contact?.organization_id) {
    const { data: viaContact } = await supabase
      .from("organizations")
      .select("name, city")
      .eq("id", contact.organization_id)
      .maybeSingle();
    organisatieNaam = viaContact?.name ?? null;
    organisatiePlaats = viaContact?.city ?? null;
  }

  const { voornaam, achternaam } = splitsNaam(contact?.full_name ?? null);

  return {
    voornaam,
    achternaam,
    volledige_naam: contact?.full_name ?? null,
    functie: contact?.job_title ?? null,
    organisatie: organisatieNaam,
    plaats: organisatiePlaats ?? contact?.city ?? null,
    deal: dealTitel,
    bedrag: dealBedrag,
    datum: dealDatum,
    mijn_naam: wie.naam,
    mijn_email: wie.email,
    vandaag: formatDate(new Date()),
  };
}

// -----------------------------------------------------------------------------
// Alles wat een scherm nodig heeft om een fragment te kunnen invoegen
// -----------------------------------------------------------------------------

export interface FragmentHulp {
  fragmenten: KiesbaarFragment[];
  context: TokenContext;
}

/**
 * De fragmentkiezer klaarzetten voor een scherm.
 *
 * Een aanroep in plaats van drie, zodat een detailpagina er twee regels aan
 * kwijt is. Faalt bewust zacht: gaat er iets mis met de fragmenten, dan hoort
 * de tijdlijn van een deal daar niet door om te vallen.
 */
export async function getFragmentHulp(
  bron: ContextBron & { merk?: Merk | null },
  wie: { naam: string | null; email: string | null }
): Promise<FragmentHulp> {
  try {
    const [alle, context] = await Promise.all([getFragmenten(), bouwTokenContext(bron, wie)]);

    return {
      fragmenten: filterFragmenten(alle, { merk: bron.merk ?? "alles" }).map((f) => ({
        id: f.id,
        naam: f.name,
        sneltoets: f.shortcut,
        categorie: f.category,
        tekst: f.body,
      })),
      context,
    };
  } catch {
    return { fragmenten: [], context: {} };
  }
}
