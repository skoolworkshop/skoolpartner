import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";
import { betaalStand, bezetting, leeftijdSignaal } from "@/lib/crm/regels";
import { sorteerFases, type Fase, type FaseOverzicht } from "@/lib/crm/merk";
import type {
  CrmContactRow,
  CrmDealRow,
  CrmSuriEditionCapacityRow,
  CrmSuriEditionRow,
  CrmSuriPaymentRow,
  CrmSuriProfileRow,
} from "@/lib/types/database";

/**
 * De leeskant van Suri Impact.
 *
 * Alles via de serviceclient, want de CRM-tabellen kennen geen enkele policy
 * voor ingelogde gebruikers. De aanroeper heeft al geautoriseerd met
 * requireAdmin() in de layout van het beheerportaal.
 */

export interface Periode extends CrmSuriEditionCapacityRow {
  stand: ReturnType<typeof bezetting>;
}

function metStand(rij: CrmSuriEditionCapacityRow): Periode {
  return { ...rij, stand: bezetting(Number(rij.aangemeld), Number(rij.capacity)) };
}

export async function getPeriodes(): Promise<Periode[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("crm_suri_edition_capacity")
    .select("*")
    .order("starts_on", { ascending: true });

  if (error) throw new Error(`Reisperiodes ophalen mislukt: ${error.message}`);
  return (data ?? []).map(metStand);
}

export async function getPeriode(id: string): Promise<Periode | null> {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("crm_suri_edition_capacity")
    .select("*")
    .eq("edition_id", id)
    .maybeSingle();

  return data ? metStand(data) : null;
}

export async function getPeriodeRij(id: string): Promise<CrmSuriEditionRow | null> {
  const supabase = createServiceSupabase();
  const { data } = await supabase.from("crm_suri_editions").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

export interface Deelnemer {
  deal: CrmDealRow;
  contact: CrmContactRow;
  fase: Fase;
  betaaldCents: number;
  stand: ReturnType<typeof betaalStand>;
  leeftijd: ReturnType<typeof leeftijdSignaal>;
}

/**
 * De deelnemers van een reisperiode, met hun betaalstand erbij.
 *
 * De betalingen worden in een tweede vraag opgehaald en hier opgeteld in
 * plaats van in de database. Reden: het gaat om hooguit vijftien deelnemers
 * per periode, en zo blijft de optelling op een plek staan waar een test hem
 * kan controleren.
 */
export async function getDeelnemers(editionId: string): Promise<Deelnemer[]> {
  const supabase = createServiceSupabase();

  const [{ data: deals }, { data: fases }, { data: periode }] = await Promise.all([
    supabase
      .from("crm_deals")
      .select("*")
      .eq("edition_id", editionId)
      .order("created_at", { ascending: true }),
    supabase.from("crm_pipeline_stages").select("*").eq("brand", "suri_impact"),
    supabase.from("crm_suri_editions").select("starts_on, price_cents").eq("id", editionId).maybeSingle(),
  ]);

  if (!deals || deals.length === 0) return [];

  const ids = deals.map((d) => d.id);
  const contactIds = deals.map((d) => d.contact_id).filter((id): id is string => Boolean(id));

  const [{ data: betalingen }, { data: contacten }, { data: profielen }] = await Promise.all([
    supabase.from("crm_suri_payments").select("deal_id, amount_cents").in("deal_id", ids),
    supabase.from("crm_contacts").select("*").in("id", contactIds),
    supabase.from("crm_suri_profiles").select("contact_id, birth_date").in("contact_id", contactIds),
  ]);

  const betaaldPerDeal = new Map<string, number>();
  for (const rij of betalingen ?? []) {
    betaaldPerDeal.set(rij.deal_id, (betaaldPerDeal.get(rij.deal_id) ?? 0) + rij.amount_cents);
  }

  const contactPerId = new Map((contacten ?? []).map((c) => [c.id, c]));
  const geboortePerId = new Map((profielen ?? []).map((p) => [p.contact_id, p.birth_date]));
  const fasePerId = new Map((fases ?? []).map((f) => [f.id, f as Fase]));

  const prijs = periode?.price_cents ?? 0;
  const vertrek = periode?.starts_on ?? null;

  return deals
    .map((deal) => {
      const contact = deal.contact_id ? contactPerId.get(deal.contact_id) : undefined;
      const fase = fasePerId.get(deal.stage_id);
      if (!contact || !fase) return null;

      const betaald = betaaldPerDeal.get(deal.id) ?? 0;
      return {
        deal,
        contact,
        fase,
        betaaldCents: betaald,
        stand: betaalStand(deal.value_cents || prijs, betaald),
        leeftijd: leeftijdSignaal(geboortePerId.get(contact.id) ?? null, vertrek),
      } satisfies Deelnemer;
    })
    .filter((d): d is Deelnemer => d !== null)
    .sort((a, b) => a.fase.position - b.fase.position || a.contact.full_name.localeCompare(b.contact.full_name));
}

export interface DeelnemerDetail extends Deelnemer {
  profiel: CrmSuriProfileRow | null;
  periode: Periode | null;
  betalingen: CrmSuriPaymentRow[];
  fases: FaseOverzicht;
}

export async function getDeelnemer(dealId: string): Promise<DeelnemerDetail | null> {
  const supabase = createServiceSupabase();

  const { data: deal } = await supabase.from("crm_deals").select("*").eq("id", dealId).maybeSingle();
  if (!deal || deal.brand !== "suri_impact" || !deal.contact_id) return null;

  const [{ data: contact }, { data: profiel }, { data: betalingen }, { data: fases }] =
    await Promise.all([
      supabase.from("crm_contacts").select("*").eq("id", deal.contact_id).maybeSingle(),
      supabase.from("crm_suri_profiles").select("*").eq("contact_id", deal.contact_id).maybeSingle(),
      supabase
        .from("crm_suri_payments")
        .select("*")
        .eq("deal_id", dealId)
        .order("received_on", { ascending: false }),
      supabase.from("crm_pipeline_stages").select("*").eq("brand", "suri_impact"),
    ]);

  if (!contact) return null;

  const alleFases = (fases ?? []) as Fase[];
  const fase = alleFases.find((f) => f.id === deal.stage_id);
  if (!fase) return null;

  const periode = deal.edition_id ? await getPeriode(deal.edition_id) : null;
  const betaald = (betalingen ?? []).reduce((som, b) => som + b.amount_cents, 0);
  const prijs = deal.value_cents || periode?.price_cents || 0;

  return {
    deal,
    contact,
    fase,
    profiel: profiel ?? null,
    periode,
    betalingen: betalingen ?? [],
    betaaldCents: betaald,
    stand: betaalStand(prijs, betaald),
    leeftijd: leeftijdSignaal(profiel?.birth_date ?? null, periode?.starts_on ?? null),
    fases: sorteerFases(alleFases),
  };
}

/** Deelnemers die nog geen reisperiode hebben. Die vallen anders tussen wal en schip. */
export async function getDeelnemersZonderPeriode(): Promise<
  { deal: CrmDealRow; contact: CrmContactRow | null }[]
> {
  const supabase = createServiceSupabase();
  const { data: deals } = await supabase
    .from("crm_deals")
    .select("*")
    .eq("brand", "suri_impact")
    .is("edition_id", null)
    .order("created_at", { ascending: false });

  if (!deals || deals.length === 0) return [];

  const contactIds = deals.map((d) => d.contact_id).filter((id): id is string => Boolean(id));
  const { data: contacten } = await supabase.from("crm_contacts").select("*").in("id", contactIds);
  const perId = new Map((contacten ?? []).map((c) => [c.id, c]));

  return deals.map((deal) => ({
    deal,
    contact: deal.contact_id ? (perId.get(deal.contact_id) ?? null) : null,
  }));
}
