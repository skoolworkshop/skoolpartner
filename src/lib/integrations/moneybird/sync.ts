import "server-only";

import { integrationMode } from "@/lib/env";
import { createServiceSupabase } from "@/lib/supabase/server";
import { isWithinPartnerPeriod } from "@/lib/loyalty/period";
import {
  markSyncError,
  markSyncStart,
  markSyncSuccess,
  type SyncResult,
} from "@/lib/integrations/sync-state";
import { amountToCents, MoneybirdClient, type MoneybirdSalesInvoice } from "./client";
import { MOCK_INVOICES } from "./mock";
import {
  extractLineHint,
  isWorkshopLine,
  mapInvoiceState,
  matchInvoiceToBooking,
  type BookingCandidate,
} from "./matching";
import type { InvoiceState } from "@/lib/types/database";

/**
 * Bij welke schoollocatie hoort dit Moneybird-contact?
 *
 * DRIE ANTWOORDEN, EN DAT IS MET OPZET
 *
 *   'gevonden'   precies één locatie. Alleen dan halen we de factuur binnen.
 *   'geen'       geen enkele locatie. Dan laten we de factuur staan waar hij
 *                hoort: in Moneybird. Wij halen de administratie van iemand
 *                die niet meedoet niet binnen.
 *   'meerdere'   twee of meer locaties gebruiken hetzelfde factuurcontact.
 *                Dan gokken we niet. De factuur komt binnen zonder locatie en
 *                zonder punten, en wacht op een mens.
 *
 * Er wordt uitsluitend op het Moneybird-contact-ID gekoppeld. Nooit op naam,
 * adres of e-mailadres: dan zou een factuur bij de verkeerde school kunnen
 * belanden, en dat is het enige wat hier echt niet mag.
 */
export type Koppeling =
  | { soort: "gevonden"; organisatieId: string }
  | { soort: "geen" }
  | { soort: "meerdere"; organisaties: string[] };

/**
 * De beslissing zelf, los van de database, zodat alle gevallen te testen zijn.
 * Krijgt de locatie-ids die bij dit contact gevonden zijn.
 */
export function beoordeelKoppeling(organisatieIds: string[]): Koppeling {
  const uniek = [...new Set(organisatieIds.filter(Boolean))];
  if (uniek.length === 0) return { soort: "geen" };
  if (uniek.length > 1) return { soort: "meerdere", organisaties: uniek };
  return { soort: "gevonden", organisatieId: uniek[0] };
}

async function zoekKoppeling(contactId: string | null): Promise<Koppeling> {
  if (!contactId) return { soort: "geen" };
  const supabase = createServiceSupabase();

  const [{ data: mappings }, { data: contacten }] = await Promise.all([
    supabase
      .from("external_record_mappings")
      .select("internal_id")
      .eq("system", "moneybird")
      .eq("entity_type", "contact")
      .eq("external_id", contactId),
    supabase
      .from("organization_contacts")
      .select("organization_id")
      .eq("moneybird_contact_id", contactId),
  ]);

  return beoordeelKoppeling([
    ...(mappings ?? []).map((rij) => rij.internal_id as string),
    ...(contacten ?? []).map((rij) => rij.organization_id as string),
  ]);
}

/**
 * Verwerkt één factuur: opslaan, regels bijwerken, koppelen aan een boeking en
 * bij volledige betaling de bijbehorende punten beschikbaar maken.
 *
 * Idempotent: de unieke index op moneybird_invoice_id zorgt ervoor dat
 * herhaalde webhooks of syncs nooit dubbele rijen of dubbele punten opleveren.
 */
export async function upsertInvoice(invoice: MoneybirdSalesInvoice): Promise<{
  invoiceId: string | null;
  releasedTransactions: number;
  overgeslagen?: "geen-koppeling" | "meerdere-locaties" | "voor-deelname";
}> {
  const supabase = createServiceSupabase();
  const koppeling = await zoekKoppeling(invoice.contact_id);

  /*
    De harde regel: geen locatie, geen factuur.

    SkoolPartner is geen tweede boekhouding. Wij tonen uitsluitend de financiële
    gegevens van scholen die bij het loyaliteitsprogramma zijn aangesloten. Van
    een Moneybird-contact dat bij geen enkele locatie hoort, halen we dus niets
    binnen: niet als gekoppelde factuur en ook niet als losse factuur die later
    "nog even nagekeken" moet worden. In Moneybird blijft alles gewoon staan.

    Bestond er al wel een rij van deze factuur, bijvoorbeeld van vóór deze
    regel, dan laten we die met rust. Opruimen is iets wat bewust gebeurt, niet
    als bijwerking van een synchronisatie.
  */
  if (koppeling.soort === "geen") {
    return { invoiceId: null, releasedTransactions: 0, overgeslagen: "geen-koppeling" };
  }

  /*
    Twijfel is ook geen koppeling.

    Gebruiken twee schoollocaties hetzelfde Moneybird-contact, dan weten wij
    niet bij welke van de twee deze factuur hoort. Vroeger kwam hij dan binnen
    zonder locatie, met de vraag erbij. Dat betekent in de praktijk een rij die
    op het dashboard blijft rondzwerven en die bij de volgende synchronisatie
    gewoon terugkomt. Dus: niet binnenhalen, en de reden in het logboek.
  */
  if (koppeling.soort === "meerdere") {
    return { invoiceId: null, releasedTransactions: 0, overgeslagen: "meerdere-locaties" };
  }

  const organizationId = koppeling.organisatieId;

  // Wij halen de bestaande administratie van een klant niet binnen. Hoort deze
  // factuur bij een organisatie die meedoet, en dateert zij van vóór haar
  // SkoolPartner-startmoment, dan slaan wij haar niet op. Een factuur die er al
  // stond werken wij wel gewoon bij, bijvoorbeeld als er betaald wordt.
  if (organizationId) {
    const { data: bestaat } = await supabase
      .from("invoices")
      .select("id")
      .eq("moneybird_invoice_id", invoice.id)
      .maybeSingle();

    if (!bestaat) {
      const { data: account } = await supabase
        .from("loyalty_accounts")
        .select("enrolled_at")
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (
        account?.enrolled_at &&
        !isWithinPartnerPeriod(invoice.invoice_date, account.enrolled_at)
      ) {
        return { invoiceId: null, releasedTransactions: 0, overgeslagen: "voor-deelname" };
      }
    }
  }

  const totalIncl = amountToCents(invoice.total_price_incl_tax);
  const totalPaid = amountToCents(invoice.total_paid);
  const totalUnpaid = amountToCents(invoice.total_unpaid);
  const state = mapInvoiceState(invoice.state) as InvoiceState;
  const fullyPaid = state === "paid" || (totalIncl > 0 && totalUnpaid <= 0 && totalPaid >= totalIncl);

  // Hier is de koppeling altijd eenduidig: alles daarvoor is al teruggestuurd.
  const reviewReasons: string[] = [];

  const { data: saved, error } = await supabase
    .from("invoices")
    .upsert(
      {
        organization_id: organizationId,
        moneybird_invoice_id: invoice.id,
        moneybird_contact_id: invoice.contact_id,
        invoice_number: invoice.invoice_id,
        reference: invoice.reference,
        invoice_date: invoice.invoice_date,
        due_date: invoice.due_date,
        state,
        currency: invoice.currency ?? "EUR",
        total_excl_cents: amountToCents(invoice.total_price_excl_tax),
        total_incl_cents: totalIncl,
        total_paid_cents: totalPaid,
        total_unpaid_cents: totalUnpaid,
        paid_at: invoice.paid_at,
        fully_paid: fullyPaid,
        needs_review: reviewReasons.length > 0,
        review_reasons: reviewReasons,
        // Alleen de velden bewaren die we nodig hebben (dataminimalisatie).
        raw: {
          state: invoice.state,
          updated_at: invoice.updated_at,
        },
        synced_at: new Date().toISOString(),
      },
      { onConflict: "moneybird_invoice_id" }
    )
    .select("id, organization_id")
    .single();

  if (error || !saved) {
    throw new Error(`Factuur ${invoice.id} kon niet worden opgeslagen: ${error?.message}`);
  }

  // Factuurregels bijwerken.
  if (invoice.details?.length) {
    await supabase.from("invoice_lines").delete().eq("invoice_id", saved.id);
    await supabase.from("invoice_lines").insert(
      invoice.details.map((detail, index) => ({
        invoice_id: saved.id,
        moneybird_line_id: detail.id,
        position: index,
        description: detail.description,
        amount: detail.amount ? Number.parseFloat(detail.amount) : null,
        price_cents: amountToCents(detail.price),
        total_cents: amountToCents(detail.total_price_excl_tax_with_discount),
        is_workshop_line: isWorkshopLine(detail.description),
      }))
    );
  }

  // Koppeling met een boeking proberen.
  if (saved.organization_id) {
    await linkInvoiceToBooking(saved.id, saved.organization_id, invoice);
  }

  // Punten vrijgeven bij volledige betaling.
  let releasedTransactions = 0;
  if (fullyPaid) {
    const { data: released } = await supabase.rpc("release_points_for_invoice", {
      p_invoice: saved.id,
    });
    releasedTransactions = typeof released === "number" ? released : 0;
  }

  return { invoiceId: saved.id, releasedTransactions };
}

async function linkInvoiceToBooking(
  invoiceId: string,
  organizationId: string,
  invoice: MoneybirdSalesInvoice
) {
  const supabase = createServiceSupabase();

  const { data: existing } = await supabase
    .from("booking_invoices")
    .select("id")
    .eq("invoice_id", invoiceId)
    .limit(1);
  if (existing && existing.length > 0) return;

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, reference, workshop_name, scheduled_date, workshop_count, minutes_per_workshop")
    .eq("organization_id", organizationId)
    .in("status", ["confirmed", "completed"])
    .order("scheduled_date", { ascending: false })
    .limit(50);

  const candidates = (bookings ?? []) as BookingCandidate[];
  const lineHints = (invoice.details ?? []).map(extractLineHint);

  const outcome = matchInvoiceToBooking(
    { reference: invoice.reference, invoiceDate: invoice.invoice_date, lineHints },
    candidates
  );

  if (!outcome.bookingId) {
    await supabase
      .from("invoices")
      .update({ needs_review: true, review_reasons: outcome.reasons })
      .eq("id", invoiceId);
    return;
  }

  await supabase.from("booking_invoices").upsert(
    {
      booking_id: outcome.bookingId,
      invoice_id: invoiceId,
      link_method: outcome.method,
      confidence: Number(outcome.confidence.toFixed(3)),
    },
    { onConflict: "booking_id,invoice_id" }
  );

  await supabase
    .from("invoices")
    .update({ needs_review: false, review_reasons: [] })
    .eq("id", invoiceId);
}

/** Volledige synchronisatie. Draait als cron job en na een webhook. */
export async function syncMoneybirdInvoices(): Promise<SyncResult> {
  const mode = integrationMode("moneybird");
  await markSyncStart("moneybird");

  try {
    const supabase = createServiceSupabase();
    const { data: state } = await supabase
      .from("integration_sync_state")
      .select("cursor")
      .eq("integration", "moneybird")
      .eq("key", "default")
      .maybeSingle();

    let invoices: MoneybirdSalesInvoice[];

    if (mode === "mock") {
      /*
        In productie nooit stilletjes verzonnen facturen.

        Mockgegevens zijn bedoeld om lokaal te kunnen ontwikkelen zonder
        Moneybird. Draaide dit in productie, dan zou een ontbrekend token
        demo-facturen in de echte database zetten, en dat is precies hoe er
        ooit vier demo-facturen zijn binnengekomen. Beter een duidelijke fout.
      */
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "Moneybird is niet verbonden: MONEYBIRD_API_TOKEN of MONEYBIRD_ADMINISTRATION_ID ontbreekt."
        );
      }
      invoices = MOCK_INVOICES;
    } else {
      const client = MoneybirdClient.fromEnv();
      if (!client) throw new Error("Moneybird-client kon niet worden opgezet");
      invoices = await client.listSalesInvoices({
        updatedAfter: state?.cursor ?? undefined,
      });
    }

    let processed = 0;
    let released = 0;
    const overgeslagen: Record<string, number> = {};
    for (const invoice of invoices) {
      const result = await upsertInvoice(invoice);
      if (result.overgeslagen) {
        overgeslagen[result.overgeslagen] = (overgeslagen[result.overgeslagen] ?? 0) + 1;
        continue;
      }
      processed += 1;
      released += result.releasedTransactions;
    }

    const aantalOvergeslagen = Object.values(overgeslagen).reduce((totaal, n) => totaal + n, 0);

    const newCursor = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await markSyncSuccess("moneybird", {
      itemsProcessed: processed,
      cursor: mode === "mock" ? null : newCursor,
      metadata: {
        mode,
        released_transactions: released,
        // Wat er niet is binnengehaald, en waarom. Zo is in het logboek terug
        // te zien dat er facturen langsgekomen zijn die wij bewust laten staan.
        overgeslagen: aantalOvergeslagen,
        overgeslagen_per_reden: overgeslagen,
      },
    });

    return {
      integration: "moneybird",
      ok: true,
      mode,
      itemsProcessed: processed,
      details: {
        released_transactions: released,
        overgeslagen: aantalOvergeslagen,
        overgeslagen_per_reden: overgeslagen,
      },
    };
  } catch (error) {
    await markSyncError("moneybird", error);
    return {
      integration: "moneybird",
      ok: false,
      mode,
      itemsProcessed: 0,
      message: error instanceof Error ? error.message : "Onbekende fout",
    };
  }
}
