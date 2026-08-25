import "server-only";

import { integrationMode } from "@/lib/env";
import { createServiceSupabase } from "@/lib/supabase/server";
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

/** Zoekt de organisatie die bij een Moneybird-contact hoort. */
async function resolveOrganizationId(contactId: string | null): Promise<string | null> {
  if (!contactId) return null;
  const supabase = createServiceSupabase();

  const { data: mapping } = await supabase
    .from("external_record_mappings")
    .select("internal_id")
    .eq("system", "moneybird")
    .eq("entity_type", "contact")
    .eq("external_id", contactId)
    .maybeSingle();

  if (mapping?.internal_id) return mapping.internal_id;

  // Tweede kans: een geverifieerde contactpersoon met dit Moneybird-contact-ID.
  const { data: contact } = await supabase
    .from("organization_contacts")
    .select("organization_id")
    .eq("moneybird_contact_id", contactId)
    .maybeSingle();

  return contact?.organization_id ?? null;
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
}> {
  const supabase = createServiceSupabase();
  const organizationId = await resolveOrganizationId(invoice.contact_id);

  const totalIncl = amountToCents(invoice.total_price_incl_tax);
  const totalPaid = amountToCents(invoice.total_paid);
  const totalUnpaid = amountToCents(invoice.total_unpaid);
  const state = mapInvoiceState(invoice.state) as InvoiceState;
  const fullyPaid = state === "paid" || (totalIncl > 0 && totalUnpaid <= 0 && totalPaid >= totalIncl);

  const reviewReasons: string[] = [];
  if (!organizationId) reviewReasons.push("Geen organisatie gekoppeld aan dit Moneybird-contact");

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
    for (const invoice of invoices) {
      const result = await upsertInvoice(invoice);
      processed += 1;
      released += result.releasedTransactions;
    }

    const newCursor = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await markSyncSuccess("moneybird", {
      itemsProcessed: processed,
      cursor: mode === "mock" ? null : newCursor,
      metadata: { mode, released_transactions: released },
    });

    return {
      integration: "moneybird",
      ok: true,
      mode,
      itemsProcessed: processed,
      details: { released_transactions: released },
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
