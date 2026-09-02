import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/audit";
import type { Actor } from "@/lib/crm/mutations";
import { vertaalFout } from "@/lib/crm/mutations";
import {
  botsendeAfspraken,
  controleerAfspraak,
  deelAfsprakenIn,
  duurInMinuten,
  isAfspraakSoort,
  isAfspraakStatus,
  isAfspraakVorm,
  leesInvoerTijd,
  magStatusWorden,
  type AfspraakIndeling,
  type AfspraakSoort,
  type AfspraakStatus,
  type AfspraakVorm,
} from "@/lib/crm/afspraken-regels";

/**
 * Afspraken: opslaan, opzoeken en afronden.
 *
 * De regels zelf staan in afspraken-regels.ts en zijn puur. Hier staat wat de
 * database nodig heeft.
 *
 * WAT HIER BEWUST NIET GEBEURT
 *
 *   Er wordt niets naar een agenda geschreven en er gaat geen uitnodiging de
 *   deur uit. Een afspraak vastleggen is precies dat: vastleggen dat hij er is.
 *   De koppeling met Google Agenda en de boekingslink komen in fase 9b, en die
 *   vragen een nieuwe toestemming van de gebruiker.
 */

export interface Afspraak {
  id: string;
  title: string;
  kind: AfspraakSoort;
  form: AfspraakVorm;
  startsAt: string;
  endsAt: string;
  location: string | null;
  status: AfspraakStatus;
  outcome: string | null;
  note: string | null;
  organizationId: string | null;
  contactId: string | null;
  dealId: string | null;
  ownerId: string | null;
  ownerNaam: string | null;
  /** Alleen gevuld op het overzichtsscherm, waar je moet zien met wie het is. */
  organisatieNaam: string | null;
  contactNaam: string | null;
  dealTitel: string | null;
  duurMinuten: number | null;
  createdAt: string;
}

interface AfspraakRij {
  id: string;
  title: string;
  kind: string;
  form: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  status: string;
  outcome: string | null;
  note: string | null;
  organization_id: string | null;
  contact_id: string | null;
  deal_id: string | null;
  owner_id: string | null;
  created_at: string;
}

function naarAfspraak(rij: AfspraakRij, namen: Namen = {}): Afspraak {
  return {
    id: rij.id,
    title: rij.title,
    kind: isAfspraakSoort(rij.kind) ? rij.kind : "overig",
    form: isAfspraakVorm(rij.form) ? rij.form : "op_locatie",
    startsAt: rij.starts_at,
    endsAt: rij.ends_at,
    location: rij.location,
    status: isAfspraakStatus(rij.status) ? rij.status : "gepland",
    outcome: rij.outcome,
    note: rij.note,
    organizationId: rij.organization_id,
    contactId: rij.contact_id,
    dealId: rij.deal_id,
    ownerId: rij.owner_id,
    ownerNaam: rij.owner_id ? (namen.eigenaren?.get(rij.owner_id) ?? null) : null,
    organisatieNaam: rij.organization_id
      ? (namen.organisaties?.get(rij.organization_id) ?? null)
      : null,
    contactNaam: rij.contact_id ? (namen.contacten?.get(rij.contact_id) ?? null) : null,
    dealTitel: rij.deal_id ? (namen.deals?.get(rij.deal_id) ?? null) : null,
    duurMinuten: duurInMinuten(rij.starts_at, rij.ends_at),
    createdAt: rij.created_at,
  };
}

interface Namen {
  eigenaren?: Map<string, string>;
  organisaties?: Map<string, string>;
  contacten?: Map<string, string>;
  deals?: Map<string, string>;
}

const KOLOMMEN =
  "id, title, kind, form, starts_at, ends_at, location, status, outcome, note, organization_id, contact_id, deal_id, owner_id, created_at";

export interface AfspraakOnderwerp {
  organizationId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
}

function heeftOnderwerp(onderwerp: AfspraakOnderwerp): boolean {
  return Boolean(onderwerp.organizationId || onderwerp.contactId || onderwerp.dealId);
}

/**
 * De afspraken van een onderwerp.
 *
 * Er wordt met "of" gezocht, net als bij de tijdlijn: een afspraak die aan de
 * deal hangt hoort ook op de kaart van de school te staan, want anders moet je
 * op twee plekken kijken om te weten wat er is afgesproken.
 */
export async function getAfspraken(
  onderwerp: AfspraakOnderwerp,
  limiet = 100
): Promise<Afspraak[]> {
  if (!heeftOnderwerp(onderwerp)) return [];

  const supabase = createServiceSupabase();
  const voorwaarden: string[] = [];
  if (onderwerp.organizationId) voorwaarden.push(`organization_id.eq.${onderwerp.organizationId}`);
  if (onderwerp.contactId) voorwaarden.push(`contact_id.eq.${onderwerp.contactId}`);
  if (onderwerp.dealId) voorwaarden.push(`deal_id.eq.${onderwerp.dealId}`);

  const { data } = await supabase
    .from("crm_meetings")
    .select(KOLOMMEN)
    .or(voorwaarden.join(","))
    .order("starts_at", { ascending: false })
    .limit(limiet);

  const eigenaren = await eigenaarNamen((data ?? []) as AfspraakRij[]);
  return ((data ?? []) as AfspraakRij[]).map((rij) => naarAfspraak(rij, { eigenaren }));
}

async function eigenaarNamen(rijen: AfspraakRij[]): Promise<Map<string, string>> {
  const ids = [...new Set(rijen.map((r) => r.owner_id).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();

  const supabase = createServiceSupabase();
  const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
  return new Map((data ?? []).map((p) => [p.id, p.full_name ?? p.email]));
}

export interface AfsprakenFilter {
  status?: AfspraakStatus | "alles" | "open";
  zoek?: string;
}

/**
 * Alle afspraken voor het overzichtsscherm, met de namen erbij.
 *
 * Vier selecties in totaal, ongeacht het aantal afspraken. Niet een per rij:
 * dat is precies hoe een overzicht traag wordt.
 */
export async function getAlleAfspraken(limiet = 400): Promise<Afspraak[]> {
  const supabase = createServiceSupabase();

  const { data } = await supabase
    .from("crm_meetings")
    .select(KOLOMMEN)
    .order("starts_at", { ascending: false })
    .limit(limiet);

  const rijen = (data ?? []) as AfspraakRij[];
  if (rijen.length === 0) return [];

  const orgIds = [...new Set(rijen.map((r) => r.organization_id).filter(Boolean))] as string[];
  const contactIds = [...new Set(rijen.map((r) => r.contact_id).filter(Boolean))] as string[];
  const dealIds = [...new Set(rijen.map((r) => r.deal_id).filter(Boolean))] as string[];

  const [eigenaren, { data: organisaties }, { data: contacten }, { data: deals }] =
    await Promise.all([
      eigenaarNamen(rijen),
      orgIds.length
        ? supabase.from("organizations").select("id, name").in("id", orgIds)
        : Promise.resolve({ data: [] }),
      contactIds.length
        ? supabase.from("crm_contacts").select("id, full_name").in("id", contactIds)
        : Promise.resolve({ data: [] }),
      dealIds.length
        ? supabase.from("crm_deals").select("id, title").in("id", dealIds)
        : Promise.resolve({ data: [] }),
    ]);

  const namen: Namen = {
    eigenaren,
    organisaties: new Map((organisaties ?? []).map((o) => [o.id, o.name])),
    contacten: new Map((contacten ?? []).map((c) => [c.id, c.full_name])),
    deals: new Map((deals ?? []).map((d) => [d.id, d.title])),
  };

  return rijen.map((rij) => naarAfspraak(rij, namen));
}

/** De indeling van een lijst afspraken: wat komt er, wat blijft liggen, wat is geweest. */
export function deelIn(afspraken: Afspraak[], nu: string): AfspraakIndeling<Afspraak> {
  return deelAfsprakenIn(afspraken, nu);
}

// -----------------------------------------------------------------------------
// Opslaan
// -----------------------------------------------------------------------------

export interface AfspraakInvoer extends AfspraakOnderwerp {
  id?: string | null;
  title: string;
  kind: string;
  form: string;
  /** Zoals het invoerveld het geeft: "2026-09-10T14:00". */
  startsAt: string | null;
  endsAt: string | null;
  location?: string | null;
  note?: string | null;
  ownerId?: string | null;
  /** Minuten die de invoer voorloopt op UTC. De browser geeft dit mee. */
  zoneOffsetMinuten?: number;
}

export interface AfspraakResultaat {
  id: string;
  /** Afspraken die op hetzelfde moment vallen. Een waarschuwing, geen blokkade. */
  botsingen: { id: string; title: string; startsAt: string }[];
}

export async function bewaarAfspraak(
  invoer: AfspraakInvoer,
  wie: Actor
): Promise<AfspraakResultaat> {
  const offset = invoer.zoneOffsetMinuten ?? 0;
  const startsAt = leesInvoerTijd(invoer.startsAt, offset);
  const endsAt = leesInvoerTijd(invoer.endsAt, offset);

  const fouten = controleerAfspraak({
    title: invoer.title,
    startsAt,
    endsAt,
    soort: invoer.kind,
    vorm: invoer.form,
    heeftOnderwerp: heeftOnderwerp(invoer),
  });
  if (fouten.length > 0) throw new Error(fouten.join(" "));

  // controleerAfspraak heeft hierboven al vastgesteld dat allebei de tijden
  // leesbaar zijn. Dit is de plek waar dat ook voor de typecontrole vaststaat,
  // zodat er verderop geen uitroepteken nodig is.
  if (!startsAt || !endsAt) throw new Error("Vul een geldig begin- en eindtijdstip in.");

  const supabase = createServiceSupabase();
  const velden = {
    title: invoer.title.trim(),
    kind: invoer.kind,
    form: invoer.form,
    starts_at: startsAt,
    ends_at: endsAt,
    location: invoer.location?.trim() || null,
    note: invoer.note?.trim() || null,
    organization_id: invoer.organizationId ?? null,
    contact_id: invoer.contactId ?? null,
    deal_id: invoer.dealId ?? null,
    owner_id: invoer.ownerId || null,
  };

  let id: string;

  if (invoer.id) {
    const { error } = await supabase.from("crm_meetings").update(velden).eq("id", invoer.id);
    if (error) throw new Error(vertaalFout(error));
    id = invoer.id;
  } else {
    const { data, error } = await supabase
      .from("crm_meetings")
      .insert({ ...velden, created_by: wie.userId })
      .select("id")
      .single();
    if (error) throw new Error(vertaalFout(error));
    id = data.id;
  }

  await recordAudit({
    actorId: wie.userId,
    actorEmail: wie.email,
    action: invoer.id ? "crm.afspraak.bijgewerkt" : "crm.afspraak.gepland",
    entityType: "crm_meeting",
    entityId: id,
    organizationId: invoer.organizationId ?? null,
    after: { titel: velden.title, begint: startsAt },
  });

  return { id, botsingen: await zoekBotsingen(id, startsAt, endsAt, invoer.ownerId || null) };
}

/**
 * Kijkt of er op hetzelfde moment al iets staat.
 *
 * Alleen bij dezelfde eigenaar, want twee collega's kunnen prima tegelijk
 * ergens zijn. Staat er geen eigenaar op, dan is er niets zinnigs te
 * vergelijken en wordt er niet gewaarschuwd.
 */
async function zoekBotsingen(
  id: string,
  startsAt: string,
  endsAt: string,
  ownerId: string | null
): Promise<{ id: string; title: string; startsAt: string }[]> {
  if (!ownerId) return [];

  const supabase = createServiceSupabase();
  // Een ruime venster ophalen en het echte vergelijken in de pure functie doen,
  // zodat de regel over aansluitende afspraken op een plek staat.
  const dag = 24 * 60 * 60 * 1000;
  const { data } = await supabase
    .from("crm_meetings")
    .select("id, title, starts_at, ends_at")
    .eq("owner_id", ownerId)
    .eq("status", "gepland")
    .gte("starts_at", new Date(Date.parse(startsAt) - dag).toISOString())
    .lte("starts_at", new Date(Date.parse(endsAt) + dag).toISOString());

  const bestaand = (data ?? []).map((r) => ({
    id: r.id,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    title: r.title,
  }));

  return botsendeAfspraken({ id, startsAt, endsAt }, bestaand).map((b) => {
    const rij = bestaand.find((r) => r.id === b.id);
    return { id: b.id, title: rij?.title ?? "Afspraak", startsAt: b.startsAt };
  });
}

/**
 * De stand van een afspraak veranderen, met de uitkomst erbij.
 *
 * De controle of dit mag, staat in magStatusWorden en niet hier: die hangt af
 * van "nu" en hoort daarom in de pure, testbare laag.
 */
export async function zetAfspraakStand(
  id: string,
  nieuw: string,
  uitkomst: string | null,
  wie: Actor,
  nu = new Date().toISOString()
): Promise<void> {
  if (!isAfspraakStatus(nieuw)) throw new Error("Onbekende stand.");

  const supabase = createServiceSupabase();
  const { data: bestaand } = await supabase
    .from("crm_meetings")
    .select("id, starts_at, status, organization_id")
    .eq("id", id)
    .maybeSingle();

  if (!bestaand) throw new Error("Deze afspraak bestaat niet meer.");

  const oordeel = magStatusWorden(
    {
      startsAt: bestaand.starts_at,
      status: isAfspraakStatus(bestaand.status) ? bestaand.status : "gepland",
    },
    nieuw,
    nu
  );
  if (!oordeel.toegestaan) throw new Error(oordeel.reden ?? "Dat kan nu niet.");

  const { error } = await supabase
    .from("crm_meetings")
    .update({ status: nieuw, outcome: uitkomst?.trim() || null })
    .eq("id", id);
  if (error) throw new Error(vertaalFout(error));

  await recordAudit({
    actorId: wie.userId,
    actorEmail: wie.email,
    action: "crm.afspraak.stand",
    entityType: "crm_meeting",
    entityId: id,
    organizationId: bestaand.organization_id,
    before: { stand: bestaand.status },
    after: { stand: nieuw },
  });
}
