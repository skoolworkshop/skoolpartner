import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/audit";
import { createBookingFromSource } from "@/lib/bookings/ingest";
import { sorteerFases, type Fase, type FaseOverzicht, type Merk } from "@/lib/crm/merk";
import { vertaalFout, type Actor } from "@/lib/crm/mutations";
import { legSysteemregelVast } from "@/lib/crm/tijdlijn";
import type { CrmDealEventRow, CrmDealRow } from "@/lib/types/database";

/**
 * De pijplijn van Skool Workshop.
 *
 * Suri gebruikt dezelfde tabel maar een eigen scherm, want daar is een deal
 * een aanmelding van een persoon en hier een aanvraag van een school.
 */

export interface DealRegel {
  deal: CrmDealRow;
  organisatieNaam: string | null;
  contactNaam: string | null;
  ownerNaam: string | null;
}

export interface Kolom {
  fase: Fase;
  deals: DealRegel[];
  waardeCents: number;
}

async function verrijk(deals: CrmDealRow[]): Promise<DealRegel[]> {
  if (deals.length === 0) return [];
  const supabase = createServiceSupabase();

  const orgIds = [...new Set(deals.map((d) => d.organization_id).filter((id): id is string => Boolean(id)))];
  const contactIds = [...new Set(deals.map((d) => d.contact_id).filter((id): id is string => Boolean(id)))];
  const ownerIds = [...new Set(deals.map((d) => d.owner_id).filter((id): id is string => Boolean(id)))];

  const [{ data: organisaties }, { data: contacten }, { data: eigenaren }] = await Promise.all([
    orgIds.length ? supabase.from("organizations").select("id, name").in("id", orgIds) : Promise.resolve({ data: [] }),
    contactIds.length
      ? supabase.from("crm_contacts").select("id, full_name").in("id", contactIds)
      : Promise.resolve({ data: [] }),
    ownerIds.length
      ? supabase.from("profiles").select("id, full_name, email").in("id", ownerIds)
      : Promise.resolve({ data: [] }),
  ]);

  const orgPerId = new Map((organisaties ?? []).map((o) => [o.id, o.name]));
  const contactPerId = new Map((contacten ?? []).map((c) => [c.id, c.full_name]));
  const ownerPerId = new Map((eigenaren ?? []).map((p) => [p.id, p.full_name ?? p.email]));

  return deals.map((deal) => ({
    deal,
    organisatieNaam: deal.organization_id ? (orgPerId.get(deal.organization_id) ?? null) : null,
    contactNaam: deal.contact_id ? (contactPerId.get(deal.contact_id) ?? null) : null,
    ownerNaam: deal.owner_id ? (ownerPerId.get(deal.owner_id) ?? null) : null,
  }));
}

/**
 * De pijplijn als kolommen.
 *
 * Afgesloten deals staan er wel bij, maar in hun eigen kolom aan het eind. Ze
 * helemaal verbergen maakt de kolommen rustig en het beeld onvolledig: je wilt
 * kunnen zien wat er vorige maand is gewonnen en verloren.
 */
export async function getPijplijn(merk: Merk): Promise<{ kolommen: Kolom[]; fases: FaseOverzicht }> {
  const supabase = createServiceSupabase();

  const [{ data: fases }, { data: deals }] = await Promise.all([
    supabase.from("crm_pipeline_stages").select("*").eq("brand", merk).order("position"),
    supabase.from("crm_deals").select("*").eq("brand", merk).order("expected_date", { nullsFirst: false }),
  ]);

  const alleFases = (fases ?? []) as Fase[];
  const regels = await verrijk(deals ?? []);

  const kolommen = alleFases.map((fase) => {
    const inFase = regels.filter((r) => r.deal.stage_id === fase.id);
    return {
      fase,
      deals: inFase,
      waardeCents: inFase.reduce((som, r) => som + r.deal.value_cents, 0),
    };
  });

  return { kolommen, fases: sorteerFases(alleFases) };
}

export interface DealDetail {
  deal: CrmDealRow;
  fase: Fase;
  fases: FaseOverzicht;
  organisatieNaam: string | null;
  contactNaam: string | null;
  ownerNaam: string | null;
  historie: (CrmDealEventRow & { vanLabel: string | null; naarLabel: string | null; actorNaam: string | null })[];
  boeking: { id: string; reference: string | null; status: string; scheduled_date: string | null } | null;
}

export async function getDeal(dealId: string): Promise<DealDetail | null> {
  const supabase = createServiceSupabase();

  const { data: deal } = await supabase.from("crm_deals").select("*").eq("id", dealId).maybeSingle();
  if (!deal) return null;

  const [{ data: fases }, { data: historie }, verrijkt] = await Promise.all([
    supabase.from("crm_pipeline_stages").select("*").eq("brand", deal.brand),
    supabase
      .from("crm_deal_events")
      .select("*")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false }),
    verrijk([deal]),
  ]);

  const alleFases = (fases ?? []) as Fase[];
  const fase = alleFases.find((f) => f.id === deal.stage_id);
  if (!fase) return null;

  const labelPerId = new Map(alleFases.map((f) => [f.id, f.label]));
  const actorIds = [
    ...new Set((historie ?? []).map((h) => h.actor_id).filter((id): id is string => Boolean(id))),
  ];
  const { data: actoren } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", actorIds)
    : { data: [] };
  const actorPerId = new Map((actoren ?? []).map((p) => [p.id, p.full_name ?? p.email]));

  const { data: boeking } = deal.booking_id
    ? await supabase
        .from("bookings")
        .select("id, reference, status, scheduled_date")
        .eq("id", deal.booking_id)
        .maybeSingle()
    : { data: null };

  return {
    deal,
    fase,
    fases: sorteerFases(alleFases),
    organisatieNaam: verrijkt[0]?.organisatieNaam ?? null,
    contactNaam: verrijkt[0]?.contactNaam ?? null,
    ownerNaam: verrijkt[0]?.ownerNaam ?? null,
    historie: (historie ?? []).map((h) => ({
      ...h,
      vanLabel: h.from_stage_id ? (labelPerId.get(h.from_stage_id) ?? null) : null,
      naarLabel: h.to_stage_id ? (labelPerId.get(h.to_stage_id) ?? null) : null,
      actorNaam: h.actor_id ? (actorPerId.get(h.actor_id) ?? null) : null,
    })),
    boeking: boeking ?? null,
  };
}

/** Een nieuwe aanvraag in de pijplijn zetten. */
export async function maakDeal(
  waarden: {
    organizationId: string;
    title: string;
    valueCents: number;
    expectedDate?: string | null;
    source?: string | null;
    note?: string | null;
  },
  actor: Actor
): Promise<string> {
  if (waarden.title.trim().length < 2) throw new Error("Vul een omschrijving in.");

  const supabase = createServiceSupabase();

  const { data: organisatie } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", waarden.organizationId)
    .maybeSingle();
  if (!organisatie) throw new Error("Kies eerst een organisatie.");

  const { data: eersteFase } = await supabase
    .from("crm_pipeline_stages")
    .select("id")
    .eq("brand", "skool_workshop")
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!eersteFase) throw new Error("Er zijn geen pijplijnfases ingesteld.");

  const { data, error } = await supabase
    .from("crm_deals")
    .insert({
      brand: "skool_workshop",
      title: waarden.title.trim(),
      stage_id: eersteFase.id,
      organization_id: waarden.organizationId,
      value_cents: Math.max(waarden.valueCents, 0),
      expected_date: waarden.expectedDate || null,
      source: waarden.source?.trim() || null,
      note: waarden.note?.trim() || null,
      owner_id: actor.userId,
      created_by: actor.userId,
    })
    .select("id")
    .single();

  if (error) throw new Error(vertaalFout(error));

  await legSysteemregelVast(
    { organizationId: waarden.organizationId, dealId: data.id },
    `Aanvraag aangemaakt: ${waarden.title.trim()}`,
    actor.userId
  );

  await recordAudit({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: "crm.deal.aangemaakt",
    entityType: "crm_deal",
    entityId: data.id,
    organizationId: waarden.organizationId,
    after: { titel: waarden.title.trim(), waarde_centen: waarden.valueCents },
  });

  return data.id;
}

export async function werkDealBij(
  dealId: string,
  waarden: {
    title?: string;
    valueCents?: number;
    expectedDate?: string | null;
    ownerId?: string | null;
    source?: string | null;
    note?: string | null;
  },
  actor: Actor
): Promise<void> {
  const supabase = createServiceSupabase();

  const { data: deal } = await supabase.from("crm_deals").select("*").eq("id", dealId).maybeSingle();
  if (!deal) throw new Error("Deze deal bestaat niet.");

  const { error } = await supabase
    .from("crm_deals")
    .update({
      title: waarden.title?.trim() || deal.title,
      value_cents: waarden.valueCents !== undefined ? Math.max(waarden.valueCents, 0) : deal.value_cents,
      expected_date: waarden.expectedDate !== undefined ? waarden.expectedDate : deal.expected_date,
      owner_id: waarden.ownerId !== undefined ? waarden.ownerId : deal.owner_id,
      source: waarden.source !== undefined ? waarden.source : deal.source,
      note: waarden.note !== undefined ? waarden.note : deal.note,
    })
    .eq("id", dealId);

  if (error) throw new Error(vertaalFout(error));

  await recordAudit({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: "crm.deal.bijgewerkt",
    entityType: "crm_deal",
    entityId: dealId,
    organizationId: deal.organization_id,
  });
}

/**
 * Van een gewonnen deal een boeking maken.
 *
 * DIT IS HET ENIGE PUNT WAAROP HET CRM KLANTGEGEVENS SCHRIJFT, EN DAAROM
 * GEBEURT HET BEHOEDZAAM.
 *
 *   1. De boeking krijgt status 'concept' en niet 'confirmed'. Een concept
 *      verschijnt nergens in het klantportaal, telt niet als aankomende
 *      workshop, en levert geen SkoolPoints op. Jij bevestigt hem daarna zelf
 *      in Admin > Boekingen, en dat blijft een bewuste handeling.
 *   2. Het gebeurt maar een keer. Hangt er al een boeking aan de deal, dan
 *      wordt er geen tweede gemaakt.
 *   3. De boeking en de deal verwijzen naar elkaar, zodat later te zien is
 *      waar die boeking vandaan kwam.
 */
export async function maakBoekingVanDeal(
  dealId: string,
  waarden: {
    workshopName: string;
    workshopCount: number;
    minutesPerWorkshop: number;
    scheduledDate?: string | null;
    location?: string | null;
    reference?: string | null;
  },
  actor: Actor
): Promise<string> {
  const supabase = createServiceSupabase();

  const { data: deal } = await supabase.from("crm_deals").select("*").eq("id", dealId).maybeSingle();
  if (!deal) throw new Error("Deze deal bestaat niet.");
  if (deal.brand !== "skool_workshop") {
    throw new Error("Alleen een deal van Skool Workshop wordt een boeking. Suri werkt met deelnemers.");
  }
  if (!deal.organization_id) throw new Error("Deze deal hangt niet aan een organisatie.");
  if (deal.booking_id) throw new Error("Er hangt al een boeking aan deze deal.");

  if (waarden.workshopName.trim().length < 2) throw new Error("Vul een workshopnaam in.");
  if (!Number.isInteger(waarden.workshopCount) || waarden.workshopCount < 1) {
    throw new Error("Vul een geldig aantal workshops in.");
  }
  if (!Number.isInteger(waarden.minutesPerWorkshop) || waarden.minutesPerWorkshop < 1) {
    throw new Error("Vul de duur per workshop in minuten in.");
  }

  const bookingId = await createBookingFromSource({
    sourceId: null,
    organizationId: deal.organization_id,
    origin: "admin_manual",
    createdBy: actor.userId,
    // Bewust een concept: een boeking die vanuit een deal ontstaat, is nog
    // geen bevestigde afspraak met de school.
    status: "concept",
    extracted: {
      organizationName: null,
      contactName: null,
      contactEmail: null,
      workshopName: waarden.workshopName.trim(),
      workshopCount: waarden.workshopCount,
      minutesPerWorkshop: waarden.minutesPerWorkshop,
      date: waarden.scheduledDate || null,
      startTime: null,
      endTime: null,
      location: waarden.location?.trim() || null,
      participants: null,
      reference: waarden.reference?.trim() || null,
    },
  });

  const { error } = await supabase
    .from("crm_deals")
    .update({ booking_id: bookingId })
    .eq("id", dealId);
  if (error) throw new Error(vertaalFout(error));

  await legSysteemregelVast(
    { organizationId: deal.organization_id, dealId },
    `Conceptboeking aangemaakt vanuit deze aanvraag. Nog niet bevestigd.`,
    actor.userId
  );

  await recordAudit({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: "crm.deal.boeking_aangemaakt",
    entityType: "crm_deal",
    entityId: dealId,
    organizationId: deal.organization_id,
    after: { booking_id: bookingId, status: "concept" },
  });

  return bookingId;
}
