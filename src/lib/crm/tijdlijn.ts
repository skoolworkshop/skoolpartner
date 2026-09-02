import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/audit";
import type { Actor } from "@/lib/crm/mutations";
import { vertaalFout } from "@/lib/crm/mutations";
import type { CrmActivityKind, CrmActivityRow, CrmTaskRow } from "@/lib/types/database";

/**
 * De tijdlijn en de taken.
 *
 * Een activiteit ligt in het verleden en is een feit. Een taak ligt in de
 * toekomst en is een voornemen. Ze staan daarom in aparte tabellen en hebben
 * hier ook aparte functies.
 */

export const ACTIVITEIT_LABELS: Record<CrmActivityKind, string> = {
  notitie: "Notitie",
  gesprek: "Gesprek",
  telefoon: "Telefoon",
  email: "E-mail",
  afspraak: "Afspraak",
  systeem: "Automatisch",
};

/** Wat een gebruiker zelf mag kiezen. 'systeem' hoort daar niet bij. */
export const HANDMATIGE_SOORTEN: CrmActivityKind[] = [
  "notitie",
  "gesprek",
  "telefoon",
  "email",
  "afspraak",
];

export function isActiviteitSoort(waarde: unknown): waarde is CrmActivityKind {
  return typeof waarde === "string" && waarde in ACTIVITEIT_LABELS;
}

export interface Onderwerp {
  organizationId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
}

function heeftOnderwerp(onderwerp: Onderwerp): boolean {
  return Boolean(onderwerp.organizationId || onderwerp.contactId || onderwerp.dealId);
}

export interface TijdlijnRegel extends CrmActivityRow {
  actorNaam: string | null;
}

/**
 * De tijdlijn van een onderwerp.
 *
 * Er wordt met "of" gezocht: een gesprek dat aan de deal hangt hoort ook thuis
 * op de relatiekaart, want anders moet je op twee plekken kijken om te weten
 * wat er is besproken.
 */
export async function getTijdlijn(onderwerp: Onderwerp, limiet = 50): Promise<TijdlijnRegel[]> {
  if (!heeftOnderwerp(onderwerp)) return [];

  const supabase = createServiceSupabase();
  const voorwaarden: string[] = [];
  if (onderwerp.organizationId) voorwaarden.push(`organization_id.eq.${onderwerp.organizationId}`);
  if (onderwerp.contactId) voorwaarden.push(`contact_id.eq.${onderwerp.contactId}`);
  if (onderwerp.dealId) voorwaarden.push(`deal_id.eq.${onderwerp.dealId}`);

  const { data } = await supabase
    .from("crm_activities")
    .select("*")
    .or(voorwaarden.join(","))
    .order("occurred_at", { ascending: false })
    .limit(limiet);

  return await metNamen(data ?? []);
}

async function metNamen(rijen: CrmActivityRow[]): Promise<TijdlijnRegel[]> {
  const ids = [...new Set(rijen.map((r) => r.actor_id).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return rijen.map((r) => ({ ...r, actorNaam: null }));

  const supabase = createServiceSupabase();
  const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
  const perId = new Map((data ?? []).map((p) => [p.id, p.full_name ?? p.email]));

  return rijen.map((r) => ({ ...r, actorNaam: r.actor_id ? (perId.get(r.actor_id) ?? null) : null }));
}

export async function legActiviteitVast(
  waarden: Onderwerp & {
    kind: CrmActivityKind;
    summary: string;
    body?: string | null;
    occurredAt?: string | null;
  },
  actor: Actor
): Promise<void> {
  if (!heeftOnderwerp(waarden)) throw new Error("Een activiteit hoort ergens bij.");
  if (waarden.summary.trim().length < 2) throw new Error("Vul een korte samenvatting in.");
  if (!isActiviteitSoort(waarden.kind)) throw new Error("Onbekende soort.");

  const supabase = createServiceSupabase();
  const { error } = await supabase.from("crm_activities").insert({
    kind: waarden.kind,
    summary: waarden.summary.trim(),
    body: waarden.body?.trim() || null,
    occurred_at: waarden.occurredAt || new Date().toISOString(),
    organization_id: waarden.organizationId ?? null,
    contact_id: waarden.contactId ?? null,
    deal_id: waarden.dealId ?? null,
    actor_id: actor.userId,
    is_system: false,
  });

  if (error) throw new Error(vertaalFout(error));

  await recordAudit({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: "crm.activiteit.vastgelegd",
    entityType: "crm_activity",
    organizationId: waarden.organizationId ?? null,
    after: { soort: waarden.kind },
  });
}

/**
 * Een regel die het systeem zelf schrijft.
 *
 * Faalt nooit hard. Een tijdlijnregel die niet wordt opgeslagen is vervelend,
 * maar mag nooit de handeling blokkeren die hem veroorzaakte. Dezelfde regel
 * als bij het audit log.
 */
export async function legSysteemregelVast(
  onderwerp: Onderwerp,
  samenvatting: string,
  actorId?: string | null
): Promise<void> {
  if (!heeftOnderwerp(onderwerp)) return;
  try {
    const supabase = createServiceSupabase();
    await supabase.from("crm_activities").insert({
      kind: "systeem",
      summary: samenvatting.slice(0, 200),
      organization_id: onderwerp.organizationId ?? null,
      contact_id: onderwerp.contactId ?? null,
      deal_id: onderwerp.dealId ?? null,
      actor_id: actorId ?? null,
      is_system: true,
    });
  } catch (error) {
    console.error("[crm] kon tijdlijnregel niet opslaan", samenvatting, error);
  }
}

// -----------------------------------------------------------------------------
// Taken
// -----------------------------------------------------------------------------

export interface Taak extends CrmTaskRow {
  ownerNaam: string | null;
  organisatieNaam: string | null;
  /** Negatief betekent te laat. null als er geen datum staat. */
  dagenTotVervaldatum: number | null;
}

function dagenTot(datum: string | null, vandaag: string): number | null {
  if (!datum) return null;
  const a = Date.parse(`${vandaag}T00:00:00Z`);
  const b = Date.parse(`${datum.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

async function verrijkTaken(rijen: CrmTaskRow[]): Promise<Taak[]> {
  if (rijen.length === 0) return [];
  const supabase = createServiceSupabase();

  const eigenaarIds = [
    ...new Set(rijen.map((r) => r.owner_id).filter((id): id is string => Boolean(id))),
  ];
  const orgIds = [
    ...new Set(rijen.map((r) => r.organization_id).filter((id): id is string => Boolean(id))),
  ];

  const [{ data: eigenaren }, { data: organisaties }] = await Promise.all([
    eigenaarIds.length
      ? supabase.from("profiles").select("id, full_name, email").in("id", eigenaarIds)
      : Promise.resolve({ data: [] }),
    orgIds.length
      ? supabase.from("organizations").select("id, name").in("id", orgIds)
      : Promise.resolve({ data: [] }),
  ]);

  const eigenaarPerId = new Map((eigenaren ?? []).map((p) => [p.id, p.full_name ?? p.email]));
  const orgPerId = new Map((organisaties ?? []).map((o) => [o.id, o.name]));
  const vandaag = new Date().toISOString().slice(0, 10);

  return rijen.map((r) => ({
    ...r,
    ownerNaam: r.owner_id ? (eigenaarPerId.get(r.owner_id) ?? null) : null,
    organisatieNaam: r.organization_id ? (orgPerId.get(r.organization_id) ?? null) : null,
    dagenTotVervaldatum: dagenTot(r.due_on, vandaag),
  }));
}

/** Alle open taken, oudste vervaldatum eerst. Taken zonder datum achteraan. */
export async function getOpenTaken(limiet = 100): Promise<Taak[]> {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("crm_tasks")
    .select("*")
    .is("done_at", null)
    .order("due_on", { ascending: true, nullsFirst: false })
    .limit(limiet);

  return verrijkTaken(data ?? []);
}

export async function getTakenVoor(onderwerp: Onderwerp): Promise<Taak[]> {
  if (!heeftOnderwerp(onderwerp)) return [];

  const supabase = createServiceSupabase();
  const voorwaarden: string[] = [];
  if (onderwerp.organizationId) voorwaarden.push(`organization_id.eq.${onderwerp.organizationId}`);
  if (onderwerp.contactId) voorwaarden.push(`contact_id.eq.${onderwerp.contactId}`);
  if (onderwerp.dealId) voorwaarden.push(`deal_id.eq.${onderwerp.dealId}`);

  const { data } = await supabase
    .from("crm_tasks")
    .select("*")
    .or(voorwaarden.join(","))
    .order("done_at", { ascending: true, nullsFirst: true })
    .order("due_on", { ascending: true, nullsFirst: false })
    .limit(50);

  return verrijkTaken(data ?? []);
}

export async function maakTaak(
  waarden: Onderwerp & {
    title: string;
    note?: string | null;
    dueOn?: string | null;
    ownerId?: string | null;
  },
  actor: Actor
): Promise<void> {
  if (waarden.title.trim().length < 2) throw new Error("Vul een omschrijving in.");

  const supabase = createServiceSupabase();
  const { error } = await supabase.from("crm_tasks").insert({
    title: waarden.title.trim(),
    note: waarden.note?.trim() || null,
    due_on: waarden.dueOn || null,
    owner_id: waarden.ownerId || actor.userId,
    organization_id: waarden.organizationId ?? null,
    contact_id: waarden.contactId ?? null,
    deal_id: waarden.dealId ?? null,
    created_by: actor.userId,
  });

  if (error) throw new Error(vertaalFout(error));
}

/** Afvinken, of juist weer openzetten. */
export async function zetTaakAf(taakId: string, af: boolean, actor: Actor): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("crm_tasks")
    .update(
      af
        ? { done_at: new Date().toISOString(), done_by: actor.userId }
        : { done_at: null, done_by: null }
    )
    .eq("id", taakId);

  if (error) throw new Error(vertaalFout(error));
}
