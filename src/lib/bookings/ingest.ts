import "server-only";

import { recordAudit } from "@/lib/audit";
import { createServiceSupabase } from "@/lib/supabase/server";
import { getSettingsWithServiceRole } from "@/lib/settings";
import { awardPointsForBooking } from "@/lib/loyalty/ledger";
import { parseConfirmationEmail, type ParserInput, type ParseResult } from "./parser";
import { emailDomain } from "@/lib/utils";
import type { Json } from "@/lib/types/database";

export interface IngestOutcome {
  status: "created" | "needs_review" | "ignored" | "duplicate";
  bookingId?: string;
  sourceId?: string;
  reasons: string[];
}

interface OrganizationResolution {
  organizationId: string | null;
  certain: boolean;
  reasons: string[];
  method: string;
}

/**
 * Bepaalt bij welke organisatie een bevestiging hoort.
 *
 * Volgorde van betrouwbaarheid:
 *  1. geverifieerde contactpersoon (exact e-mailadres)
 *  2. geverifieerd organisatiedomein, mits uniek en niet publiek
 *  3. exacte organisatienaam (alleen als suggestie, nooit als zekerheid)
 */
export async function resolveOrganization(params: {
  contactEmail: string | null;
  recipientEmails: string[];
  organizationName: string | null;
}): Promise<OrganizationResolution> {
  const supabase = createServiceSupabase();
  const reasons: string[] = [];

  const candidateEmails = [params.contactEmail, ...params.recipientEmails]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  for (const email of candidateEmails) {
    const { data: contact } = await supabase
      .from("organization_contacts")
      .select("organization_id")
      .eq("email", email)
      .eq("is_verified", true)
      .maybeSingle();
    if (contact?.organization_id) {
      return {
        organizationId: contact.organization_id,
        certain: true,
        reasons: [],
        method: `verified_contact:${email}`,
      };
    }
  }

  const domains = Array.from(
    new Set(candidateEmails.map((email) => emailDomain(email)).filter(Boolean) as string[])
  );

  for (const domain of domains) {
    const { data: isPublic } = await supabase
      .from("public_email_domains")
      .select("domain")
      .eq("domain", domain)
      .maybeSingle();
    if (isPublic) continue;

    const { data: matches } = await supabase
      .from("organization_domains")
      .select("organization_id")
      .eq("domain", domain)
      .eq("is_verified", true);

    if (matches && matches.length === 1) {
      return {
        organizationId: matches[0].organization_id,
        certain: true,
        reasons: [],
        method: `verified_domain:${domain}`,
      };
    }
    if (matches && matches.length > 1) {
      reasons.push(`Domein ${domain} hoort bij meerdere organisaties`);
    }
  }

  if (params.organizationName) {
    const { data: byName } = await supabase
      .from("organizations")
      .select("id")
      .ilike("name", params.organizationName.trim())
      .eq("status", "active")
      .limit(2);

    if (byName && byName.length === 1) {
      reasons.push("Organisatie alleen op naam herkend, dit vraagt bevestiging");
      return {
        organizationId: byName[0].id,
        certain: false,
        reasons,
        method: "name_match",
      };
    }
  }

  reasons.push("Organisatie kon niet worden bepaald");
  return { organizationId: null, certain: false, reasons, method: "none" };
}

/**
 * Verwerkt één binnenkomende e-mail.
 *
 * Idempotent: de unieke index op (channel, external_message_id) zorgt ervoor
 * dat dezelfde Gmail-message nooit twee keer een boeking of punten oplevert.
 */
export async function ingestConfirmationEmail(input: ParserInput): Promise<IngestOutcome> {
  const supabase = createServiceSupabase();
  const settings = await getSettingsWithServiceRole();

  const { data: existing } = await supabase
    .from("booking_sources")
    .select("id, match_status, booking_id")
    .eq("channel", "gmail")
    .eq("external_message_id", input.messageId)
    .maybeSingle();

  if (existing) {
    return {
      status: "duplicate",
      sourceId: existing.id,
      bookingId: existing.booking_id ?? undefined,
      reasons: ["Deze e-mail is al eerder verwerkt"],
    };
  }

  const parsed: ParseResult = parseConfirmationEmail(input, {
    confirmationLabel: settings.booking_confirmation_label,
    allowedFromDomains: settings.booking_confirmation_from_domains,
    minimumBookingMinutes: settings.minimum_booking_minutes,
  });

  const resolution = await resolveOrganization({
    contactEmail: parsed.extracted.contactEmail,
    recipientEmails: [...(input.to ?? []), ...(input.cc ?? [])],
    organizationName: parsed.extracted.organizationName,
  });

  const reviewReasons = [...parsed.reviewReasons, ...resolution.reasons];
  const threshold = settings.parser_auto_approve_threshold / 100;

  const canAutoCreate =
    settings.parser_enabled &&
    parsed.isConfirmation &&
    resolution.certain &&
    reviewReasons.length === 0 &&
    parsed.confidence >= threshold &&
    Boolean(parsed.extracted.workshopName) &&
    Boolean(parsed.extracted.minutesPerWorkshop) &&
    Boolean(parsed.extracted.workshopCount);

  const { data: source, error: sourceError } = await supabase
    .from("booking_sources")
    .insert({
      channel: "gmail",
      external_message_id: input.messageId,
      external_thread_id: input.threadId,
      from_email: input.from,
      from_name: input.fromName ?? null,
      to_emails: input.to ?? [],
      cc_emails: input.cc ?? [],
      subject: input.subject,
      received_at: input.receivedAt ?? new Date().toISOString(),
      snippet: input.bodyText.slice(0, 300),
      body_text: input.bodyText.slice(0, 20000),
      parser_version: parsed.parserVersion,
      parsed: {
        extracted: parsed.extracted,
        signals: parsed.signals,
        resolution_method: resolution.method,
      } as unknown as Json,
      confidence: Number(parsed.confidence.toFixed(3)),
      match_status: !parsed.isConfirmation
        ? "ignored"
        : canAutoCreate
          ? "matched"
          : "needs_review",
      review_reasons: reviewReasons,
      suggested_organization_id: resolution.organizationId,
    })
    .select("id")
    .single();

  if (sourceError || !source) {
    // Unieke index geraakt: een parallelle verwerking was ons voor.
    if (sourceError?.code === "23505") {
      return { status: "duplicate", reasons: ["Gelijktijdig al verwerkt"] };
    }
    throw new Error(`Bron kon niet worden opgeslagen: ${sourceError?.message}`);
  }

  if (!parsed.isConfirmation) {
    return { status: "ignored", sourceId: source.id, reasons: parsed.reviewReasons };
  }

  if (!canAutoCreate) {
    return { status: "needs_review", sourceId: source.id, reasons: reviewReasons };
  }

  const bookingId = await createBookingFromSource({
    sourceId: source.id,
    organizationId: resolution.organizationId!,
    extracted: parsed.extracted,
    origin: "email_parser",
    // De bevestigingsmail is het moment waarop de boeking tot stand kwam.
    bookedAt: input.receivedAt ?? new Date().toISOString(),
  });

  await supabase
    .from("booking_sources")
    .update({ booking_id: bookingId, processed_at: new Date().toISOString() })
    .eq("id", source.id);

  await awardPointsForBooking(bookingId);

  return { status: "created", bookingId, sourceId: source.id, reasons: [] };
}

/** Maakt de daadwerkelijke boeking aan vanuit een geparste of gecontroleerde bron. */
export async function createBookingFromSource(params: {
  sourceId: string | null;
  organizationId: string;
  extracted: ParseResult["extracted"];
  origin: "email_parser" | "admin_manual" | "import";
  createdBy?: string | null;
  needsReview?: boolean;
  reviewReasons?: string[];
  /**
   * Wanneer de boeking bij Skool Workshop tot stand kwam. Bij een
   * bevestigingsmail is dat de datum van die mail, niet het moment waarop wij
   * hem inlezen. Dit bepaalt of de boeking binnen de SkoolPartner-periode van
   * de klant valt.
   */
  bookedAt?: string | null;
}): Promise<string> {
  const supabase = createServiceSupabase();
  const workshopCount = params.extracted.workshopCount ?? 1;
  const minutes = params.extracted.minutesPerWorkshop ?? 0;

  const { data, error } = await supabase
    .from("bookings")
    .insert({
      organization_id: params.organizationId,
      reference: params.extracted.reference,
      workshop_name: params.extracted.workshopName ?? "Workshop",
      workshop_count: workshopCount,
      minutes_per_workshop: minutes,
      qualifying_minutes: workshopCount * minutes,
      scheduled_date: params.extracted.date,
      start_time: params.extracted.startTime,
      end_time: params.extracted.endTime,
      location: params.extracted.location,
      participants: params.extracted.participants,
      status: "confirmed",
      origin: params.origin,
      booking_source_id: params.sourceId,
      contact_email: params.extracted.contactEmail,
      contact_name: params.extracted.contactName,
      needs_review: params.needsReview ?? false,
      review_reasons: params.reviewReasons ?? [],
      booked_at: params.bookedAt ?? new Date().toISOString(),
      created_by: params.createdBy ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Boeking kon niet worden aangemaakt: ${error?.message}`);
  }

  await recordAudit({
    actorId: params.createdBy ?? null,
    actorRole: params.createdBy ? "admin" : "systeem",
    action: "booking.created",
    entityType: "booking",
    entityId: data.id,
    organizationId: params.organizationId,
    after: {
      workshop_name: params.extracted.workshopName,
      workshop_count: workshopCount,
      minutes_per_workshop: minutes,
    } as unknown as Json,
  });

  return data.id;
}
