import "server-only";

import { recordAudit } from "@/lib/audit";
import { createServiceSupabase } from "@/lib/supabase/server";
import { getSettingsWithServiceRole, ratesFromSettings } from "@/lib/settings";
import { calculateBookingPoints, describeWorkshopEarning } from "@/lib/loyalty/calc";
import { bookingQualifiesForPoints } from "@/lib/loyalty/period";
import type { LoyaltyTransactionRow } from "@/lib/types/database";

export interface AwardResult {
  ok: boolean;
  skipped?: string;
  points?: number;
  transactionId?: string;
  message?: string;
}

/**
 * Kent punten toe voor een bevestigde boeking.
 *
 * Regels:
 *  - alleen voor organisaties die deelnemen aan SkoolPartner;
 *  - nooit met terugwerkende kracht voor boekingen van vóór de deelname;
 *  - punten starten in status 'pending' en worden pas 'available' na volledige
 *    betaling van de bijbehorende factuur;
 *  - idempotent via external_reference en een unieke index per boeking.
 */
export async function awardPointsForBooking(bookingId: string): Promise<AwardResult> {
  const supabase = createServiceSupabase();
  const settings = await getSettingsWithServiceRole();

  if (!settings.loyalty_enabled) {
    return { ok: false, skipped: "SkoolPartner staat uit" };
  }

  const { data: booking } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle();

  if (!booking) return { ok: false, message: "Boeking niet gevonden" };
  if (booking.status === "cancelled") return { ok: false, skipped: "Boeking is geannuleerd" };
  if (booking.needs_review) return { ok: false, skipped: "Boeking wacht nog op controle" };
  if (booking.points_awarded) return { ok: false, skipped: "Punten zijn al toegekend" };

  // Een boeking levert punten op voor de bijbehorende contactpersoon, nooit
  // voor alle medewerkers van de school samen.
  const contactEmail = booking.contact_email?.trim().toLowerCase();
  if (!contactEmail) return { ok: false, skipped: "Boeking heeft geen contactpersoon" };
  const { data: beneficiary } = await supabase
    .from("profiles")
    .select("id")
    .ilike("email", contactEmail)
    .maybeSingle();
  if (!beneficiary) return { ok: false, skipped: "Contactpersoon heeft nog geen account" };
  const { data: membership } = await supabase
    .from("organization_members")
    .select("id")
    .eq("organization_id", booking.organization_id)
    .eq("user_id", beneficiary.id)
    .eq("status", "active")
    .maybeSingle();
  if (!membership) return { ok: false, skipped: "Contactpersoon is geen actief lid van deze school" };

  await supabase.rpc("ensure_loyalty_account", {
    p_org: booking.organization_id,
    p_actor: beneficiary.id,
  });
  const { data: account } = await supabase
    .from("loyalty_accounts")
    .select("id, enrolled_at, is_active")
    .eq("organization_id", booking.organization_id)
    .eq("user_id", beneficiary.id)
    .maybeSingle();

  if (!account || !account.is_active) {
    return { ok: false, skipped: "Organisatie neemt niet deel aan SkoolPartner" };
  }

  // Geen punten met terugwerkende kracht. Wij kijken naar het moment waarop de
  // boeking tot stand kwam, niet naar de factuurdatum en niet naar het moment
  // waarop wij hem binnenhaalden. Een boeking van 1 september bij een
  // registratie van 10 september levert dus niets op, ook al komt de factuur
  // pas op 15 september.
  if (!bookingQualifiesForPoints(booking, account.enrolled_at)) {
    return { ok: false, skipped: "Boeking dateert van vóór deelname aan SkoolPartner" };
  }

  const rates = ratesFromSettings(settings);
  const result = calculateBookingPoints(
    {
      workshopCount: booking.workshop_count,
      minutesPerWorkshop: booking.minutes_per_workshop,
    },
    rates
  );

  if (result.points <= 0) {
    return { ok: false, skipped: "Geen kwalificerende workshopuren" };
  }

  const { data: transaction, error } = await supabase
    .from("loyalty_transactions")
    .upsert(
      {
        organization_id: booking.organization_id,
        user_id: beneficiary.id,
        account_id: account.id,
        type: "earn_workshop",
        status: "pending",
        points: result.points,
        point_value_cents_per_100: rates.pointValueCentsPer100,
        points_per_hour_at_time: rates.pointsPerHour,
        qualifying_minutes: result.qualifyingMinutes,
        description: describeWorkshopEarning(
          booking.workshop_name,
          booking.workshop_count,
          booking.minutes_per_workshop
        ),
        source: booking.origin,
        external_reference: `booking:${booking.id}`,
        booking_id: booking.id,
        occurred_at: booking.scheduled_date
          ? new Date(booking.scheduled_date).toISOString()
          : new Date().toISOString(),
      },
      { onConflict: "organization_id,user_id,type,external_reference", ignoreDuplicates: true }
    )
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, message: `Punten konden niet worden vastgelegd: ${error.message}` };
  }

  await supabase
    .from("bookings")
    .update({ points_awarded: true, qualifying_minutes: result.qualifyingMinutes })
    .eq("id", booking.id);

  // Was de bijbehorende factuur al betaald? Dan meteen beschikbaar maken.
  const { data: links } = await supabase
    .from("booking_invoices")
    .select("invoice_id")
    .eq("booking_id", booking.id);

  for (const link of links ?? []) {
    await supabase.rpc("release_points_for_invoice", { p_invoice: link.invoice_id });
  }

  return { ok: true, points: result.points, transactionId: transaction?.id };
}

/**
 * Welkomsttegoed bij de eerste activatie van een organisatie.
 *
 * Dit is de enige puntenboeking die meteen bij de start mag ontstaan. Voor
 * gewone boekingen blijft gelden dat alleen kwalificerende nieuwe boekingen na
 * het startmoment punten opleveren.
 *
 * Eenmalig per ORGANISATIE, niet per persoon. Een tweede medewerker van
 * dezelfde school levert dus geen tweede bonus op.
 *
 * Hoe dat waterdicht is: er staat al een unieke index op
 * (organization_id, type, external_reference). Met external_reference 'welcome'
 * kan er per organisatie maar één welkomstbonus bestaan. Ook twee registraties
 * die elkaar op dezelfde seconde kruisen leveren er samen precies één op; de
 * tweede botst op de index en wordt genegeerd. Wij hoeven dus niet eerst te
 * kijken of hij al bestaat, wat juist een gaatje zou openzetten.
 */
export async function awardWelcomeBonus(params: {
  organizationId: string;
  actorId?: string | null;
  actorEmail?: string | null;
}): Promise<AwardResult> {
  const supabase = createServiceSupabase();
  const settings = await getSettingsWithServiceRole();

  if (!settings.loyalty_enabled) return { ok: false, skipped: "SkoolPartner staat uit" };
  if (!settings.welcome_bonus_enabled) return { ok: false, skipped: "Welkomstbonus staat uit" };
  if (settings.welcome_bonus_points <= 0) {
    return { ok: false, skipped: "Welkomstbonus staat op 0 punten" };
  }

  if (!params.actorId) return { ok: false, skipped: "Geen gebruiker voor welkomstbonus" };
  const { data: account } = await supabase
    .from("loyalty_accounts")
    .select("id, is_active")
    .eq("organization_id", params.organizationId)
    .eq("user_id", params.actorId)
    .maybeSingle();

  // Geen account betekent: nog niet echt geactiveerd. Dan ook geen bonus.
  if (!account?.is_active) {
    return { ok: false, skipped: "Organisatie neemt nog niet deel aan SkoolPartner" };
  }

  const { data: transaction, error } = await supabase
    .from("loyalty_transactions")
    .upsert(
      {
        organization_id: params.organizationId,
        user_id: params.actorId,
        account_id: account.id,
        type: "welcome_bonus",
        status: "available",
        points: settings.welcome_bonus_points,
        point_value_cents_per_100: settings.point_value_cents_per_100,
        description: "Welkomstbonus SkoolPartner",
        source: "portal",
        external_reference: "welcome",
        available_at: new Date().toISOString(),
        expires_at: settings.points_expiry_enabled
          ? new Date(
              Date.now() + settings.points_validity_months * 30 * 24 * 60 * 60 * 1000
            ).toISOString()
          : null,
        created_by: params.actorId ?? null,
      },
      { onConflict: "organization_id,user_id,type,external_reference", ignoreDuplicates: true }
    )
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, message: error.message };

  // Geen rij terug betekent: er was er al een. Dat is geen fout, dat is de
  // bedoeling.
  if (!transaction) return { ok: false, skipped: "Deze gebruiker had de welkomstbonus al" };

  await recordAudit({
    actorId: params.actorId ?? null,
    actorEmail: params.actorEmail ?? null,
    actorRole: "systeem",
    action: "loyalty.welcome_bonus_awarded",
    entityType: "loyalty_transaction",
    entityId: transaction.id,
    organizationId: params.organizationId,
    after: {
      punten: settings.welcome_bonus_points,
      waarde_centen: Math.floor(
        (settings.welcome_bonus_points * settings.point_value_cents_per_100) / 100
      ),
    },
  });

  return { ok: true, points: settings.welcome_bonus_points, transactionId: transaction.id };
}

/** Bonuspunten voor een geverifieerde review. Maximaal één keer per boeking. */
export async function awardReviewBonus(params: {
  reviewId: string;
  adminId: string;
  adminEmail: string;
}): Promise<AwardResult> {
  const supabase = createServiceSupabase();
  const settings = await getSettingsWithServiceRole();

  if (!settings.loyalty_enabled) return { ok: false, skipped: "SkoolPartner staat uit" };
  if (settings.review_bonus_points <= 0) return { ok: false, skipped: "Reviewbonus staat op 0" };

  const { data: review } = await supabase
    .from("reviews")
    .select("*")
    .eq("id", params.reviewId)
    .maybeSingle();

  if (!review) return { ok: false, message: "Review niet gevonden" };
  if (review.status !== "verified") return { ok: false, skipped: "Review is nog niet geverifieerd" };
  if (!review.submitted_by) return { ok: false, skipped: "Review heeft geen gekoppelde gebruiker" };

  const { data: account } = await supabase
    .from("loyalty_accounts")
    .select("id, is_active")
    .eq("organization_id", review.organization_id)
    .eq("user_id", review.submitted_by)
    .maybeSingle();

  if (!account?.is_active) {
    return { ok: false, skipped: "Organisatie neemt niet deel aan SkoolPartner" };
  }

  const { data: transaction, error } = await supabase
    .from("loyalty_transactions")
    .upsert(
      {
        organization_id: review.organization_id,
        user_id: review.submitted_by,
        account_id: account.id,
        type: "earn_review",
        status: "available",
        points: settings.review_bonus_points,
        point_value_cents_per_100: settings.point_value_cents_per_100,
        description: "Review geplaatst",
        source: "review",
        external_reference: `review:${review.id}`,
        review_id: review.id,
        booking_id: review.booking_id,
        available_at: new Date().toISOString(),
        expires_at: settings.points_expiry_enabled
          ? new Date(
              Date.now() + settings.points_validity_months * 30 * 24 * 60 * 60 * 1000
            ).toISOString()
          : null,
        created_by: params.adminId,
      },
      { onConflict: "organization_id,user_id,type,external_reference", ignoreDuplicates: true }
    )
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, message: error.message };

  await recordAudit({
    actorId: params.adminId,
    actorEmail: params.adminEmail,
    action: "loyalty.review_bonus_awarded",
    entityType: "review",
    entityId: review.id,
    organizationId: review.organization_id,
    after: { points: settings.review_bonus_points },
  });

  return { ok: true, points: settings.review_bonus_points, transactionId: transaction?.id };
}

/** Handmatige correctie door een admin. Een reden is verplicht. */
export async function manualAdjustment(params: {
  organizationId: string;
  userId: string;
  points: number;
  reason: string;
  description?: string;
  adminId: string;
  adminEmail: string;
}): Promise<AwardResult> {
  if (!params.reason || params.reason.trim().length < 3) {
    return { ok: false, message: "Geef een reden op voor deze correctie." };
  }
  if (!Number.isInteger(params.points) || params.points === 0) {
    return { ok: false, message: "Vul een geheel aantal punten in, positief of negatief." };
  }

  const supabase = createServiceSupabase();
  const settings = await getSettingsWithServiceRole();

  const { data: account } = await supabase
    .from("loyalty_accounts")
    .select("id")
    .eq("organization_id", params.organizationId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (!account) return { ok: false, message: "Deze organisatie heeft nog geen SkoolPartner-account." };

  if (params.points < 0) {
    const { data: balance } = await supabase
      .from("loyalty_balances")
      .select("available_points")
      .eq("account_id", account.id)
      .maybeSingle();
    const available = balance?.available_points ?? 0;
    if (available + params.points < 0) {
      return { ok: false, message: `Onvoldoende saldo: er is ${available} beschikbaar.` };
    }
  }

  const { data: transaction, error } = await supabase
    .from("loyalty_transactions")
    .insert({
      organization_id: params.organizationId,
      user_id: params.userId,
      account_id: account.id,
      type: "manual_adjustment",
      status: "available",
      points: params.points,
      point_value_cents_per_100: settings.point_value_cents_per_100,
      description: params.description?.trim() || "Handmatige correctie",
      source: "admin",
      reason: params.reason.trim(),
      created_by: params.adminId,
      available_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) return { ok: false, message: error.message };

  await recordAudit({
    actorId: params.adminId,
    actorEmail: params.adminEmail,
    action: "loyalty.manual_adjustment",
    entityType: "loyalty_transaction",
    entityId: transaction.id,
    organizationId: params.organizationId,
    after: { points: params.points, description: params.description ?? null },
    reason: params.reason,
  });

  return { ok: true, points: params.points, transactionId: transaction.id };
}

/**
 * Draait een transactie terug. De oorspronkelijke regel blijft staan (historie
 * wordt nooit verwijderd) maar telt niet meer mee in het saldo.
 */
export async function reverseTransaction(params: {
  transactionId: string;
  reason: string;
  adminId: string;
  adminEmail: string;
}): Promise<AwardResult> {
  if (!params.reason || params.reason.trim().length < 3) {
    return { ok: false, message: "Geef een reden op." };
  }

  const supabase = createServiceSupabase();
  const { data: original } = await supabase
    .from("loyalty_transactions")
    .select("*")
    .eq("id", params.transactionId)
    .maybeSingle();

  if (!original) return { ok: false, message: "Transactie niet gevonden." };
  if (original.status === "reversed") return { ok: false, skipped: "Al teruggedraaid" };

  const typed = original as LoyaltyTransactionRow;

  await supabase
    .from("loyalty_transactions")
    .update({ status: "reversed", reason: params.reason, created_by: params.adminId })
    .eq("id", typed.id);

  const { data: reversal, error } = await supabase
    .from("loyalty_transactions")
    .insert({
      organization_id: typed.organization_id,
      user_id: typed.user_id,
      account_id: typed.account_id,
      type: "reversal",
      status: "reversed",
      points: -typed.points,
      point_value_cents_per_100: typed.point_value_cents_per_100,
      description: `Teruggedraaid: ${typed.description}`,
      source: "admin",
      reason: params.reason,
      reverses_transaction_id: typed.id,
      created_by: params.adminId,
    })
    .select("id")
    .single();

  if (error) return { ok: false, message: error.message };

  if (typed.booking_id && typed.type === "earn_workshop") {
    await supabase.from("bookings").update({ points_awarded: false }).eq("id", typed.booking_id);
  }

  await recordAudit({
    actorId: params.adminId,
    actorEmail: params.adminEmail,
    action: "loyalty.transaction_reversed",
    entityType: "loyalty_transaction",
    entityId: typed.id,
    organizationId: typed.organization_id,
    before: { status: typed.status, points: typed.points },
    after: { status: "reversed" },
    reason: params.reason,
  });

  return { ok: true, transactionId: reversal.id };
}
