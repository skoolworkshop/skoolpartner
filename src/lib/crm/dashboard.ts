import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";
import {
  berekenDashboard,
  type DashboardCijfers,
  type DealGebeurtenisInvoer,
  type DealInvoer,
  type FactuurInvoer,
  type FaseInvoer,
  type MerkFilter,
  type Periode,
  type SuriBetalingInvoer,
  type TaakInvoer,
} from "@/lib/crm/dashboard-berekening";
import type { Merk } from "@/lib/crm/merk";

/**
 * Het ophalen van de dashboardgegevens.
 *
 * OVER HET AANTAL VRAGEN AAN DE DATABASE
 *
 *   Dit scherm stelt zes vragen, allemaal tegelijk, en rekent daarna zelf.
 *   Niet zes per KPI-tegel en niet een per fase: dat zou bij twaalf fases en
 *   elf tegels op tientallen rondjes uitkomen, en dat merk je.
 *
 *   Rekenen gebeurt in Node en niet in SQL. Bij de omvang waar dit systeem
 *   over gaat (honderden deals, duizenden facturen) is dat ruim snel genoeg,
 *   en het levert iets op wat een aggregatie in de database niet geeft:
 *   dezelfde berekening is los te testen, zonder database. Zie
 *   dashboard-berekening.ts en tests/crm-dashboard.test.ts.
 *
 *   Groeit dit ooit uit tot honderdduizenden rijen, dan is de volgende stap
 *   een materialized view of een gefilterde selectie per periode. Een apart
 *   datawarehouse is dat niet, en dat is nu ook niet nodig.
 *
 * OVER DE OMZETBRON
 *
 *   Zie de kop van dashboard-berekening.ts. Kort: betaalde facturen voor
 *   Skool Workshop, ontvangen deelnemersbetalingen voor Suri, en de
 *   dealwaarde nooit. De twee bronnen kunnen elkaar niet overlappen.
 */

/** Hoever terug de fasehistorie wordt gelezen. Genoeg voor een doorlooptijd, niet het hele archief. */
const HISTORIE_MAANDEN = 24;

export interface DashboardGegevens extends DashboardCijfers {
  /** Namen bij de organisatie-id's die op het scherm komen. */
  organisatieNamen: Map<string, string>;
  /** Zijn er uberhaupt al deals? Zo niet, dan is een leeg dashboard geen fout. */
  heeftDeals: boolean;
  /** Aantal facturen zonder betaaldatum, zodat het scherm dat eerlijk kan melden. */
  facturenZonderDatum: number;
}

function isoMaandenTerug(maanden: number): string {
  const nu = new Date();
  return new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth() - maanden, 1)).toISOString();
}

export async function getDashboard(
  periode: Periode,
  merk: MerkFilter,
  vandaag: string
): Promise<DashboardGegevens> {
  const supabase = createServiceSupabase();

  const [
    { data: faseRijen },
    { data: dealRijen },
    { data: gebeurtenisRijen },
    { data: factuurRijen },
    { data: suriRijen },
    { data: taakRijen },
  ] = await Promise.all([
    supabase
      .from("crm_pipeline_stages")
      .select("id, brand, key, label, position, is_won, is_lost")
      .order("position", { ascending: true }),

    supabase
      .from("crm_deals")
      .select(
        "id, brand, title, stage_id, organization_id, contact_id, value_cents, expected_date, created_at, closed_at, stage_since, owner_id"
      ),

    // Alleen de recente historie: ouder dan twee jaar zegt niets meer over hoe
    // er nu gewerkt wordt.
    supabase
      .from("crm_deal_events")
      .select("deal_id, from_stage_id, to_stage_id, created_at")
      .gte("created_at", isoMaandenTerug(HISTORIE_MAANDEN)),

    // Alleen facturen waar echt iets op betaald is. Een openstaande factuur is
    // geen omzet.
    supabase
      .from("invoices")
      .select("organization_id, paid_at, invoice_date, total_paid_cents")
      .gt("total_paid_cents", 0),

    supabase.from("crm_suri_payments").select("deal_id, amount_cents, received_on"),

    // Alleen wat nog open staat. Afgeronde taken zijn hier niet interessant en
    // zouden de zwaarste selectie van dit scherm worden.
    supabase
      .from("crm_tasks")
      .select("id, title, due_on, done_at, deal_id, organization_id, contact_id, owner_id")
      .is("done_at", null),
  ]);

  const fases: FaseInvoer[] = (faseRijen ?? []).map((f) => ({
    id: f.id,
    brand: f.brand as Merk,
    key: f.key,
    label: f.label,
    position: f.position,
    isWon: f.is_won,
    isLost: f.is_lost,
  }));

  const deals: DealInvoer[] = (dealRijen ?? []).map((d) => ({
    id: d.id,
    brand: d.brand as Merk,
    title: d.title,
    stageId: d.stage_id,
    organizationId: d.organization_id,
    contactId: d.contact_id,
    valueCents: d.value_cents,
    expectedDate: d.expected_date,
    createdAt: d.created_at,
    closedAt: d.closed_at,
    stageSince: d.stage_since,
    ownerId: d.owner_id,
  }));

  const gebeurtenissen: DealGebeurtenisInvoer[] = (gebeurtenisRijen ?? []).map((g) => ({
    dealId: g.deal_id,
    fromStageId: g.from_stage_id,
    toStageId: g.to_stage_id,
    createdAt: g.created_at,
  }));

  // paid_at als die er is, anders de factuurdatum. Zonder een van beide kan
  // het bedrag niet aan een maand worden toegewezen; berekenOmzet houdt dat
  // apart bij in plaats van het weg te moffelen.
  const facturen: FactuurInvoer[] = (factuurRijen ?? []).map((f) => ({
    organizationId: f.organization_id,
    betaaldOp: f.paid_at ?? f.invoice_date ?? null,
    betaaldCents: f.total_paid_cents ?? 0,
  }));

  const suriBetalingen: SuriBetalingInvoer[] = (suriRijen ?? []).map((b) => ({
    dealId: b.deal_id,
    amountCents: b.amount_cents,
    ontvangenOp: b.received_on,
  }));

  const taken: TaakInvoer[] = (taakRijen ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    dueOn: t.due_on,
    doneAt: t.done_at,
    dealId: t.deal_id,
    organizationId: t.organization_id,
    contactId: t.contact_id,
    ownerId: t.owner_id,
  }));

  const cijfers = berekenDashboard({
    deals,
    fases,
    gebeurtenissen,
    facturen,
    suriBetalingen,
    taken,
    periode,
    merk,
    vandaag,
  });

  // Namen ophalen voor precies de organisaties die op het scherm komen, en
  // geen enkele meer.
  const nodig = new Set<string>([
    ...cijfers.klanten.perOrganisatie.slice(0, 10).map((o) => o.organizationId),
    ...cijfers.klantenbehoud.slapend.slice(0, 8).map((s) => s.organizationId),
  ]);

  const { data: organisaties } = nodig.size
    ? await supabase.from("organizations").select("id, name").in("id", [...nodig])
    : { data: [] };

  return {
    ...cijfers,
    organisatieNamen: new Map((organisaties ?? []).map((o) => [o.id, o.name])),
    heeftDeals: deals.length > 0,
    facturenZonderDatum: facturen.filter((f) => !f.betaaldOp).length,
  };
}
