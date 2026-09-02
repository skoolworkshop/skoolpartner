import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/audit";
import { vertaalFout, type Actor } from "@/lib/crm/mutations";
import { isMerk, type Merk } from "@/lib/crm/merk";

/**
 * Sequences: een reeks opvolgstappen die klaarzet wat er moet gebeuren.
 *
 * ============================================================================
 * DIT VERSTUURT NOOIT UIT ZICHZELF
 * ============================================================================
 *
 * Er staat in dit bestand geen enkele aanroep naar het versturen van e-mail, en
 * dat is geen omissie. Een reeks berekent wanneer de volgende stap klaarstaat
 * en zet hem op de lijst; een mens leest hem, kijkt of hij nog klopt en drukt
 * op verzenden.
 *
 * In HubSpot mailt een sequence zelf, en dat is precies waar het bij een klein
 * bedrijf misgaat: iemand komt in een reeks, niemand kijkt er meer naar, en drie
 * weken later krijgt een school die al nee heeft gezegd nog een herinnering.
 *
 * ============================================================================
 * WAT ER AL WEL IN DE DATABASE IS AFGEDWONGEN
 * ============================================================================
 *
 *   Een e-mailstap heeft een template, een taakstap heeft een omschrijving.
 *   Twee stappen kunnen niet op dezelfde plek in de reeks staan.
 *   Iemand zit maar een keer tegelijk in dezelfde reeks.
 *   Stoppen kan niet zonder reden.
 *
 * Wat hier bovenop komt is de rekenkant: wanneer staat welke stap klaar, en wat
 * gebeurt er als je iemand toevoegt of eruit haalt.
 */

export const STAP_SOORTEN = {
  email: "E-mail",
  taak: "Taak",
  bellen: "Bellen",
} as const;

export type StapSoort = keyof typeof STAP_SOORTEN;

export function isStapSoort(waarde: unknown): waarde is StapSoort {
  return typeof waarde === "string" && waarde in STAP_SOORTEN;
}

export const DEELNAME_STANDEN = {
  actief: "Loopt",
  gepauzeerd: "Gepauzeerd",
  afgerond: "Afgerond",
  gestopt: "Gestopt",
} as const;

export type DeelnameStand = keyof typeof DEELNAME_STANDEN;

export interface Stap {
  id: string;
  position: number;
  waitDays: number;
  kind: StapSoort;
  templateId: string | null;
  templateNaam: string | null;
  templateOnderwerp: string | null;
  title: string | null;
  note: string | null;
}

export interface Sequence {
  id: string;
  brand: Merk;
  name: string;
  description: string | null;
  senderId: string | null;
  senderNaam: string | null;
  isActive: boolean;
  stappen: Stap[];
  /** Hoeveel mensen er nu in lopen. Geteld, nooit opgeslagen. */
  aantalActief: number;
  aantalAfgerond: number;
}

export interface Deelname {
  id: string;
  sequenceId: string;
  sequenceNaam: string;
  contactId: string;
  contactNaam: string;
  contactEmail: string | null;
  status: DeelnameStand;
  nextStep: number;
  nextActionAt: string | null;
  stopReason: string | null;
  startedAt: string;
  finishedAt: string | null;
  /** Hoeveel stappen de reeks heeft, zodat je voortgang kunt tonen. */
  aantalStappen: number;
}

/**
 * Wanneer staat de volgende stap klaar?
 *
 * Puur rekenwerk: het startmoment plus de wachttijd van alle stappen tot en met
 * deze. Bewust opgeteld vanaf de start en niet vanaf "nu", zodat een reeks niet
 * opschuift doordat iemand een dag later kijkt.
 */
export function momentVanStap(
  startedAt: string,
  stappen: { position: number; waitDays: number }[],
  stapNummer: number
): string | null {
  const opVolgorde = [...stappen].sort((a, b) => a.position - b.position);
  if (stapNummer < 1 || stapNummer > opVolgorde.length) return null;

  const dagen = opVolgorde
    .slice(0, stapNummer)
    .reduce((som, stap) => som + Math.max(0, stap.waitDays), 0);

  const moment = new Date(startedAt);
  moment.setUTCDate(moment.getUTCDate() + dagen);
  return moment.toISOString();
}

interface StapRij {
  id: string;
  sequence_id: string;
  position: number;
  wait_days: number;
  kind: string;
  template_id: string | null;
  title: string | null;
  note: string | null;
}

export async function getSequences(merk?: Merk): Promise<Sequence[]> {
  const supabase = createServiceSupabase();

  let vraag = supabase.from("crm_sequences").select("*").order("name");
  if (merk) vraag = vraag.eq("brand", merk);
  const { data: reeksen } = await vraag;
  if (!reeksen || reeksen.length === 0) return [];

  const ids = reeksen.map((r) => r.id);
  const [{ data: stappen }, { data: deelnames }, { data: templates }, { data: beheerders }] =
    await Promise.all([
      supabase.from("crm_sequence_steps").select("*").in("sequence_id", ids).order("position"),
      supabase.from("crm_sequence_enrollments").select("sequence_id, status").in("sequence_id", ids),
      supabase.from("crm_templates").select("id, name, subject"),
      supabase.from("profiles").select("id, full_name, email"),
    ]);

  const templatePerId = new Map((templates ?? []).map((t) => [t.id, t]));
  const naamPerId = new Map((beheerders ?? []).map((b) => [b.id, b.full_name ?? b.email]));

  return reeksen.map((reeks) => {
    const eigen = ((stappen ?? []) as StapRij[]).filter((s) => s.sequence_id === reeks.id);
    const mensen = (deelnames ?? []).filter((d) => d.sequence_id === reeks.id);
    return {
      id: reeks.id,
      brand: isMerk(reeks.brand) ? reeks.brand : "skool_workshop",
      name: reeks.name,
      description: reeks.description,
      senderId: reeks.sender_id,
      senderNaam: reeks.sender_id ? (naamPerId.get(reeks.sender_id) ?? null) : null,
      isActive: reeks.is_active,
      stappen: eigen.map((stap) => {
        const template = stap.template_id ? templatePerId.get(stap.template_id) : null;
        return {
          id: stap.id,
          position: stap.position,
          waitDays: stap.wait_days,
          kind: isStapSoort(stap.kind) ? stap.kind : "taak",
          templateId: stap.template_id,
          templateNaam: template?.name ?? null,
          templateOnderwerp: template?.subject ?? null,
          title: stap.title,
          note: stap.note,
        };
      }),
      aantalActief: mensen.filter((d) => d.status === "actief" || d.status === "gepauzeerd").length,
      aantalAfgerond: mensen.filter((d) => d.status === "afgerond").length,
    };
  });
}

export async function getSequence(id: string): Promise<Sequence | null> {
  const alle = await getSequences();
  return alle.find((s) => s.id === id) ?? null;
}

/** Wie er in een reeks zit, met hun voortgang. */
export async function getDeelnames(sequenceId?: string): Promise<Deelname[]> {
  const supabase = createServiceSupabase();

  let vraag = supabase
    .from("crm_sequence_enrollments")
    .select("*")
    .order("next_action_at", { nullsFirst: false });
  if (sequenceId) vraag = vraag.eq("sequence_id", sequenceId);

  const { data: rijen } = await vraag;
  if (!rijen || rijen.length === 0) return [];

  const contactIds = [...new Set(rijen.map((r) => r.contact_id))];
  const sequenceIds = [...new Set(rijen.map((r) => r.sequence_id))];

  const [{ data: contacten }, { data: reeksen }, { data: stappen }] = await Promise.all([
    supabase.from("crm_contacts").select("id, full_name, email").in("id", contactIds),
    supabase.from("crm_sequences").select("id, name").in("id", sequenceIds),
    supabase.from("crm_sequence_steps").select("sequence_id").in("sequence_id", sequenceIds),
  ]);

  const contactPerId = new Map((contacten ?? []).map((c) => [c.id, c]));
  const reeksPerId = new Map((reeksen ?? []).map((r) => [r.id, r.name]));
  const stappenPerReeks = new Map<string, number>();
  for (const stap of stappen ?? []) {
    stappenPerReeks.set(stap.sequence_id, (stappenPerReeks.get(stap.sequence_id) ?? 0) + 1);
  }

  return rijen.map((rij) => {
    const contact = contactPerId.get(rij.contact_id);
    return {
      id: rij.id,
      sequenceId: rij.sequence_id,
      sequenceNaam: reeksPerId.get(rij.sequence_id) ?? "onbekende reeks",
      contactId: rij.contact_id,
      contactNaam: contact?.full_name ?? "onbekend contact",
      contactEmail: contact?.email ?? null,
      status: (rij.status as DeelnameStand) ?? "actief",
      nextStep: rij.next_step,
      nextActionAt: rij.next_action_at,
      stopReason: rij.stop_reason,
      startedAt: rij.started_at,
      finishedAt: rij.finished_at,
      aantalStappen: stappenPerReeks.get(rij.sequence_id) ?? 0,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Schrijven                                                                   */
/* -------------------------------------------------------------------------- */

export interface SequenceInvoer {
  id?: string | null;
  brand: Merk;
  name: string;
  description: string | null;
  senderId: string | null;
  isActive: boolean;
}

export async function bewaarSequence(invoer: SequenceInvoer, actor: Actor): Promise<string> {
  const supabase = createServiceSupabase();

  const naam = invoer.name.trim();
  if (naam.length < 2) throw new Error("Geef de reeks een naam.");

  const velden = {
    brand: invoer.brand,
    name: naam,
    description: invoer.description?.trim() || null,
    sender_id: invoer.senderId,
    is_active: invoer.isActive,
  };

  const { data, error } = invoer.id
    ? await supabase.from("crm_sequences").update(velden).eq("id", invoer.id).select("id").single()
    : await supabase
        .from("crm_sequences")
        .insert({ ...velden, created_by: actor.userId })
        .select("id")
        .single();

  if (error) throw new Error(vertaalFout(error));

  await recordAudit({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: invoer.id ? "crm.sequence.bijgewerkt" : "crm.sequence.aangemaakt",
    entityType: "crm_sequence",
    entityId: data.id,
    after: { name: naam, is_active: invoer.isActive },
  });

  return data.id;
}

export interface StapInvoer {
  sequenceId: string;
  kind: StapSoort;
  waitDays: number;
  templateId: string | null;
  title: string | null;
  note: string | null;
}

/** Een stap onderaan de reeks. De plek bepaalt het systeem, niet de invoerder. */
export async function voegStapToe(invoer: StapInvoer, actor: Actor): Promise<void> {
  const supabase = createServiceSupabase();

  const { data: bestaand } = await supabase
    .from("crm_sequence_steps")
    .select("position")
    .eq("sequence_id", invoer.sequenceId)
    .order("position", { ascending: false })
    .limit(1);

  const volgende = (bestaand?.[0]?.position ?? 0) + 1;

  if (invoer.kind === "email" && !invoer.templateId) {
    throw new Error("Kies een template voor deze e-mailstap.");
  }
  if (invoer.kind !== "email" && (invoer.title?.trim().length ?? 0) < 2) {
    throw new Error("Zeg wat er bij deze stap moet gebeuren.");
  }

  const { error } = await supabase.from("crm_sequence_steps").insert({
    sequence_id: invoer.sequenceId,
    position: volgende,
    wait_days: Math.min(365, Math.max(0, Math.round(invoer.waitDays))),
    kind: invoer.kind,
    template_id: invoer.kind === "email" ? invoer.templateId : null,
    title: invoer.kind === "email" ? null : invoer.title?.trim() || null,
    note: invoer.note?.trim() || null,
  });

  if (error) throw new Error(vertaalFout(error));

  await recordAudit({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: "crm.sequence.stap",
    entityType: "crm_sequence",
    entityId: invoer.sequenceId,
    after: { position: volgende, kind: invoer.kind },
  });
}

/**
 * Een stap een plek omhoog of omlaag.
 *
 * Er is een unieke index op (sequence_id, position), dus twee stappen kunnen
 * niet even dezelfde plek delen. Daarom gaat het ruilen via een tijdelijke
 * negatieve plek: eerst eentje opzij, dan de ander, dan terug.
 */
export async function verplaatsStap(stapId: string, richting: "omhoog" | "omlaag"): Promise<void> {
  const supabase = createServiceSupabase();

  const { data: stap } = await supabase
    .from("crm_sequence_steps")
    .select("id, sequence_id, position")
    .eq("id", stapId)
    .maybeSingle();
  if (!stap) throw new Error("Deze stap bestaat niet.");

  const { data: buur } = await supabase
    .from("crm_sequence_steps")
    .select("id, position")
    .eq("sequence_id", stap.sequence_id)
    [richting === "omhoog" ? "lt" : "gt"]("position", stap.position)
    .order("position", { ascending: richting !== "omhoog" })
    .limit(1);

  const ander = buur?.[0];
  if (!ander) return; // Al bovenaan of onderaan; niets te doen.

  await supabase.from("crm_sequence_steps").update({ position: -1 }).eq("id", stap.id);
  await supabase.from("crm_sequence_steps").update({ position: stap.position }).eq("id", ander.id);
  await supabase.from("crm_sequence_steps").update({ position: ander.position }).eq("id", stap.id);
}

export async function verwijderStap(stapId: string): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase.from("crm_sequence_steps").delete().eq("id", stapId);
  if (error) throw new Error(vertaalFout(error));
}

/**
 * Iemand in een reeks zetten.
 *
 * Twee dingen worden hier geweigerd, en allebei om dezelfde reden: je wilt
 * nooit dat iemand post krijgt die hij niet wil.
 *
 *   Een contact dat zich heeft afgemeld voor commerciele mail, gaat er niet in.
 *   Een contact zonder e-mailadres ook niet, want dan kan de eerste stap niet.
 */
export async function meldAan(
  sequenceId: string,
  contactId: string,
  actor: Actor,
  dealId?: string | null
): Promise<void> {
  const supabase = createServiceSupabase();

  const { data: contact } = await supabase
    .from("crm_contacts")
    .select("id, full_name, email, is_unsubscribed")
    .eq("id", contactId)
    .maybeSingle();
  if (!contact) throw new Error("Dit contact bestaat niet.");
  if (contact.is_unsubscribed) {
    throw new Error(`${contact.full_name} heeft zich afgemeld voor commerciele mail.`);
  }
  if (!contact.email) {
    throw new Error(`${contact.full_name} heeft geen e-mailadres.`);
  }

  const { data: stappen } = await supabase
    .from("crm_sequence_steps")
    .select("position, wait_days")
    .eq("sequence_id", sequenceId)
    .order("position");

  if (!stappen || stappen.length === 0) {
    throw new Error("Deze reeks heeft nog geen stappen.");
  }

  const gestart = new Date().toISOString();
  const eerste = momentVanStap(
    gestart,
    stappen.map((s) => ({ position: s.position, waitDays: s.wait_days })),
    1
  );

  const { error } = await supabase.from("crm_sequence_enrollments").insert({
    sequence_id: sequenceId,
    contact_id: contactId,
    deal_id: dealId ?? null,
    status: "actief",
    next_step: 1,
    next_action_at: eerste,
    started_by: actor.userId,
    started_at: gestart,
  });

  if (error) throw new Error(vertaalFout(error));

  await recordAudit({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: "crm.sequence.aangemeld",
    entityType: "crm_sequence",
    entityId: sequenceId,
    after: { contact_id: contactId },
  });
}

/** Een stap afvinken: hij is gedaan, de volgende komt klaar te staan. */
export async function stapGedaan(deelnameId: string, actor: Actor): Promise<void> {
  const supabase = createServiceSupabase();

  const { data: deelname } = await supabase
    .from("crm_sequence_enrollments")
    .select("*")
    .eq("id", deelnameId)
    .maybeSingle();
  if (!deelname) throw new Error("Deze deelname bestaat niet.");

  const { data: stappen } = await supabase
    .from("crm_sequence_steps")
    .select("position, wait_days")
    .eq("sequence_id", deelname.sequence_id)
    .order("position");

  const totaal = stappen?.length ?? 0;
  const volgende = deelname.next_step + 1;

  const klaar = volgende > totaal;
  const { error } = await supabase
    .from("crm_sequence_enrollments")
    .update(
      klaar
        ? { status: "afgerond", next_action_at: null, finished_at: new Date().toISOString() }
        : {
            next_step: volgende,
            next_action_at: momentVanStap(
              deelname.started_at,
              (stappen ?? []).map((s) => ({ position: s.position, waitDays: s.wait_days })),
              volgende
            ),
          }
    )
    .eq("id", deelnameId);

  if (error) throw new Error(vertaalFout(error));

  await recordAudit({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: klaar ? "crm.sequence.afgerond" : "crm.sequence.stap_gedaan",
    entityType: "crm_sequence",
    entityId: deelname.sequence_id,
    after: { contact_id: deelname.contact_id, stap: deelname.next_step },
  });
}

/** Iemand eruit halen. De reden is verplicht, en dat is de database die dat eist. */
export async function stopDeelname(
  deelnameId: string,
  reden: string,
  actor: Actor
): Promise<void> {
  const supabase = createServiceSupabase();

  if (reden.trim().length < 2) throw new Error("Zeg waarom je iemand uit de reeks haalt.");

  const { error } = await supabase
    .from("crm_sequence_enrollments")
    .update({
      status: "gestopt",
      stop_reason: reden.trim(),
      next_action_at: null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", deelnameId);

  if (error) throw new Error(vertaalFout(error));

  await recordAudit({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: "crm.sequence.gestopt",
    entityType: "crm_sequence_enrollment",
    entityId: deelnameId,
    after: { reden: reden.trim() },
  });
}
