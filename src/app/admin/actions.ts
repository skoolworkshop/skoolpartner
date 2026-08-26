"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { createServiceSupabase } from "@/lib/supabase/server";
import { createBookingFromSource } from "@/lib/bookings/ingest";
import { awardPointsForBooking, manualAdjustment, reverseTransaction } from "@/lib/loyalty/ledger";
import {
  approveMembership,
  createOrganization,
  setMembershipStatus,
} from "@/lib/organizations/service";
import { generateToken, hashToken } from "@/lib/crypto";
import {
  deleteOrganizationPermanently,
  deleteUserPermanently,
} from "@/lib/admin/delete";
import {
  addExternalLink,
  publishResult,
  RESULTS_BUCKET,
} from "@/lib/results/service";
import { resolveSiteUrl } from "@/lib/site-url";
import { publicEnv } from "@/lib/env";
import { SETTING_DEFAULTS, type SettingKey } from "@/lib/settings";
import type { Json } from "@/lib/types/database";

export interface AdminState {
  status: "idle" | "ok" | "error";
  message?: string;
  inviteUrl?: string;
}

/* -------------------------------------------------------------------------- */
/* Gebruikers en organisaties                                                  */
/* -------------------------------------------------------------------------- */

export async function approveMembershipAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const memberId = String(formData.get("member_id") ?? "");
  const role = String(formData.get("role") ?? "lid") === "beheerder" ? "beheerder" : "lid";

  const result = await approveMembership({
    memberId,
    adminId: session.userId,
    adminEmail: session.email,
    role,
  });

  revalidatePath("/admin/gebruikers");
  revalidatePath("/admin");
  return result.ok
    ? { status: "ok", message: "Lidmaatschap goedgekeurd." }
    : { status: "error", message: result.message };
}

export async function rejectMembershipAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const memberId = String(formData.get("member_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || "Niet goedgekeurd";

  const result = await setMembershipStatus({
    memberId,
    status: "rejected",
    reason,
    adminId: session.userId,
    adminEmail: session.email,
  });

  revalidatePath("/admin/gebruikers");
  return result.ok
    ? { status: "ok", message: "Aanvraag afgewezen." }
    : { status: "error", message: result.message };
}

export async function setUserBlockedAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  if (!session.profile?.is_super_admin) {
    return { status: "error", message: "Alleen een hoofdbeheerder kan accounts blokkeren." };
  }

  const userId = String(formData.get("user_id") ?? "");
  const blocked = String(formData.get("blocked") ?? "") === "1";
  const reason = String(formData.get("reason") ?? "").trim() || null;

  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("profiles")
    .update({ is_blocked: blocked })
    .eq("id", userId);

  if (error) return { status: "error", message: "Wijzigen is niet gelukt." };

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: blocked ? "user.blocked" : "user.unblocked",
    entityType: "profile",
    entityId: userId,
    reason,
  });

  revalidatePath("/admin/gebruikers");
  return { status: "ok", message: blocked ? "Account geblokkeerd." : "Blokkade opgeheven." };
}

export async function createOrganizationAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const name = String(formData.get("name") ?? "");
  const city = String(formData.get("city") ?? "").trim() || null;

  const result = await createOrganization({
    name,
    city,
    actorId: session.userId,
    actorEmail: session.email,
  });

  revalidatePath("/admin/organisaties");
  return result.ok
    ? { status: "ok", message: "Organisatie aangemaakt." }
    : { status: "error", message: result.message };
}

export async function addOrganizationDomainAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const organizationId = String(formData.get("organization_id") ?? "");
  const domain = String(formData.get("domain") ?? "").trim().toLowerCase();

  const supabase = createServiceSupabase();
  const { error } = await supabase.from("organization_domains").insert({
    organization_id: organizationId,
    domain,
    is_verified: true,
    verified_at: new Date().toISOString(),
    verified_by: session.userId,
  });

  if (error) {
    return {
      status: "error",
      message: error.message.includes("Publiek e-maildomein")
        ? "Een publiek e-maildomein kan niet aan een organisatie worden gekoppeld."
        : "Domein kon niet worden toegevoegd. Mogelijk bestaat het al bij een andere organisatie.",
    };
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "organization_domain.added",
    entityType: "organization_domain",
    entityId: domain,
    organizationId,
    after: { domain, is_verified: true },
  });

  revalidatePath(`/admin/organisaties/${organizationId}`);
  return { status: "ok", message: "Domein toegevoegd en geverifieerd." };
}

export async function inviteMemberAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const organizationId = String(formData.get("organization_id") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "lid") === "beheerder" ? "beheerder" : "lid";

  if (!email.includes("@")) return { status: "error", message: "Vul een geldig e-mailadres in." };

  const token = generateToken(24);
  const supabase = createServiceSupabase();
  const { error } = await supabase.from("organization_invites").insert({
    organization_id: organizationId,
    email,
    role,
    token_hash: hashToken(token),
    expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    created_by: session.userId,
  });

  if (error) return { status: "error", message: "Uitnodiging kon niet worden aangemaakt." };

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "organization_invite.created",
    entityType: "organization_invite",
    entityId: email,
    organizationId,
  });

  revalidatePath(`/admin/organisaties/${organizationId}`);
  return {
    status: "ok",
    message: `Uitnodiging aangemaakt voor ${email}. Stuur onderstaande link naar deze persoon.`,
    inviteUrl: `${publicEnv.siteUrl}/uitnodiging/${token}`,
  };
}

/* -------------------------------------------------------------------------- */
/* Controle nodig                                                              */
/* -------------------------------------------------------------------------- */

export async function approveBookingSourceAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const sourceId = String(formData.get("source_id") ?? "");
  const organizationId = String(formData.get("organization_id") ?? "");
  const workshopName = String(formData.get("workshop_name") ?? "").trim();
  const workshopCount = Number.parseInt(String(formData.get("workshop_count") ?? "1"), 10);
  const minutes = Number.parseInt(String(formData.get("minutes_per_workshop") ?? "0"), 10);
  const date = String(formData.get("scheduled_date") ?? "").trim() || null;
  const location = String(formData.get("location") ?? "").trim() || null;
  const reference = String(formData.get("reference") ?? "").trim() || null;

  if (!organizationId) return { status: "error", message: "Kies eerst een organisatie." };
  if (workshopName.length < 2) return { status: "error", message: "Vul een workshopnaam in." };
  if (!Number.isInteger(workshopCount) || workshopCount < 1) {
    return { status: "error", message: "Vul een geldig aantal workshops in." };
  }
  if (!Number.isInteger(minutes) || minutes < 1) {
    return { status: "error", message: "Vul de duur per workshop in minuten in." };
  }

  const supabase = createServiceSupabase();
  const { data: source } = await supabase
    .from("booking_sources")
    .select("*")
    .eq("id", sourceId)
    .maybeSingle();

  if (!source) return { status: "error", message: "Bron niet gevonden." };
  if (source.booking_id) return { status: "error", message: "Er bestaat al een boeking voor deze e-mail." };

  const bookingId = await createBookingFromSource({
    sourceId,
    organizationId,
    origin: "email_parser",
    createdBy: session.userId,
    extracted: {
      organizationName: null,
      contactName: source.from_name,
      contactEmail: source.from_email,
      workshopName,
      workshopCount,
      minutesPerWorkshop: minutes,
      date,
      startTime: null,
      endTime: null,
      location,
      participants: null,
      reference,
    },
  });

  await supabase
    .from("booking_sources")
    .update({
      booking_id: bookingId,
      match_status: "matched",
      reviewed_by: session.userId,
      reviewed_at: new Date().toISOString(),
      processed_at: new Date().toISOString(),
    })
    .eq("id", sourceId);

  const award = await awardPointsForBooking(bookingId);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "booking_source.approved",
    entityType: "booking_source",
    entityId: sourceId,
    organizationId,
    after: { booking_id: bookingId, points: award.points ?? 0 } as unknown as Json,
  });

  revalidatePath("/admin/controle");
  revalidatePath("/admin");
  return {
    status: "ok",
    message: award.ok
      ? `Boeking aangemaakt en ${award.points} SkoolPoints toegekend (in behandeling tot de factuur betaald is).`
      : `Boeking aangemaakt. Geen punten toegekend: ${award.skipped ?? award.message}`,
  };
}

export async function rejectBookingSourceAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const sourceId = String(formData.get("source_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || "Geen definitieve boeking";

  const supabase = createServiceSupabase();
  await supabase
    .from("booking_sources")
    .update({
      match_status: "rejected",
      review_reasons: [reason],
      reviewed_by: session.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", sourceId);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "booking_source.rejected",
    entityType: "booking_source",
    entityId: sourceId,
    reason,
  });

  revalidatePath("/admin/controle");
  return { status: "ok", message: "Bron afgewezen." };
}

/* -------------------------------------------------------------------------- */
/* SkoolPoints                                                                 */
/* -------------------------------------------------------------------------- */

export async function manualAdjustmentAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const organizationId = String(formData.get("organization_id") ?? "");
  const points = Number.parseInt(String(formData.get("points") ?? ""), 10);
  const reason = String(formData.get("reason") ?? "");
  const description = String(formData.get("description") ?? "").trim() || undefined;

  const result = await manualAdjustment({
    organizationId,
    points,
    reason,
    description,
    adminId: session.userId,
    adminEmail: session.email,
  });

  revalidatePath("/admin/skoolpoints");
  return result.ok
    ? { status: "ok", message: `Correctie van ${points} punten vastgelegd.` }
    : { status: "error", message: result.message };
}

export async function reverseTransactionAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const transactionId = String(formData.get("transaction_id") ?? "");
  const reason = String(formData.get("reason") ?? "");

  const result = await reverseTransaction({
    transactionId,
    reason,
    adminId: session.userId,
    adminEmail: session.email,
  });

  revalidatePath("/admin/skoolpoints");
  return result.ok
    ? { status: "ok", message: "Transactie teruggedraaid." }
    : { status: "error", message: result.message ?? result.skipped };
}

/* -------------------------------------------------------------------------- */
/* Inwisselverzoeken                                                           */
/* -------------------------------------------------------------------------- */

export async function decideRedemptionAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const id = String(formData.get("request_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;

  const supabase = createServiceSupabase();
  const { data: request } = await supabase
    .from("redemption_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!request) return { status: "error", message: "Verzoek niet gevonden." };

  if (decision === "approved") {
    await supabase
      .from("redemption_requests")
      .update({
        status: "approved",
        decided_by: session.userId,
        decided_at: new Date().toISOString(),
        decision_note: note,
      })
      .eq("id", id);
  } else if (decision === "applied") {
    await supabase
      .from("redemption_requests")
      .update({
        status: "applied",
        applied_at: new Date().toISOString(),
        decided_by: session.userId,
        decided_at: new Date().toISOString(),
        decision_note: note,
      })
      .eq("id", id);

    // De reservering wordt definitief: de punten zijn nu daadwerkelijk gebruikt.
    if (request.reserve_transaction_id) {
      await supabase
        .from("loyalty_transactions")
        .update({ status: "redeemed", reason: note ?? "Voordeel verwerkt op boeking" })
        .eq("id", request.reserve_transaction_id);
    }
  } else if (decision === "rejected") {
    await supabase
      .from("redemption_requests")
      .update({
        status: "rejected",
        decided_by: session.userId,
        decided_at: new Date().toISOString(),
        decision_note: note,
      })
      .eq("id", id);

    if (request.reserve_transaction_id) {
      await supabase
        .from("loyalty_transactions")
        .update({ status: "cancelled", reason: note ?? "Verzoek afgewezen" })
        .eq("id", request.reserve_transaction_id);
    }
  } else {
    return { status: "error", message: "Onbekende beslissing." };
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: `redemption.${decision}`,
    entityType: "redemption_request",
    entityId: id,
    organizationId: request.organization_id,
    before: { status: request.status },
    after: { status: decision },
    reason: note,
  });

  revalidatePath("/admin/inwisselen");
  return { status: "ok", message: "Verzoek bijgewerkt." };
}

/* -------------------------------------------------------------------------- */
/* Instellingen                                                                */
/* -------------------------------------------------------------------------- */

export async function updateSettingAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const key = String(formData.get("key") ?? "") as SettingKey;
  const rawValue = String(formData.get("value") ?? "");

  if (!(key in SETTING_DEFAULTS)) {
    return { status: "error", message: "Onbekende instelling." };
  }

  const fallback = SETTING_DEFAULTS[key];
  let parsed: Json;

  if (typeof fallback === "number") {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric) || numeric < 0) {
      return { status: "error", message: "Vul een geldig getal in." };
    }
    parsed = numeric;
  } else if (typeof fallback === "boolean") {
    parsed = rawValue === "true" || rawValue === "on" || rawValue === "1";
  } else if (Array.isArray(fallback)) {
    parsed = rawValue
      .split(/[\n,]/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
  } else {
    parsed = rawValue;
  }

  const supabase = createServiceSupabase();
  const { data: before } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  const { error } = await supabase
    .from("app_settings")
    .update({ value: parsed, updated_by: session.userId, updated_at: new Date().toISOString() })
    .eq("key", key);

  if (error) return { status: "error", message: "Opslaan is niet gelukt." };

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "setting.updated",
    entityType: "app_setting",
    entityId: key,
    before: before?.value ?? null,
    after: parsed,
  });

  revalidatePath("/admin/instellingen");
  revalidatePath("/", "layout");
  return { status: "ok", message: "Instelling opgeslagen." };
}

/* -------------------------------------------------------------------------- */
/* Integraties                                                                 */
/* -------------------------------------------------------------------------- */

export async function runSyncAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const session = await requireAdmin();
  const which = String(formData.get("integration") ?? "");

  const { syncGmail } = await import("@/lib/integrations/gmail/sync");
  const { syncMoneybirdInvoices } = await import("@/lib/integrations/moneybird/sync");
  const { syncHubSpot } = await import("@/lib/integrations/hubspot/sync");

  const runner =
    which === "gmail" ? syncGmail : which === "moneybird" ? syncMoneybirdInvoices : which === "hubspot" ? syncHubSpot : null;

  if (!runner) return { status: "error", message: "Onbekende integratie." };

  const result = await runner();

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "integration.manual_sync",
    entityType: "integration",
    entityId: which,
    after: { ok: result.ok, items: result.itemsProcessed, mode: result.mode } as unknown as Json,
  });

  revalidatePath("/admin/integraties");
  return result.ok
    ? {
        status: "ok",
        message: `Synchronisatie klaar (${result.mode === "mock" ? "testmodus" : "live"}): ${result.itemsProcessed} items verwerkt.`,
      }
    : { status: "error", message: result.message ?? "Synchronisatie mislukt." };
}

/* -------------------------------------------------------------------------- */
/* Resultaten van workshops                                                    */
/* -------------------------------------------------------------------------- */

export async function createResultAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const bookingId = String(formData.get("booking_id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!organizationId) return { status: "error", message: "Kies een organisatie." };
  if (title.length < 2) return { status: "error", message: "Vul een titel in." };

  const supabase = createServiceSupabase();
  const { error } = await supabase.from("workshop_results").insert({
    organization_id: organizationId,
    booking_id: bookingId || null,
    title,
    description: description || null,
    status: "concept",
    created_by: session.userId,
  });

  if (error) return { status: "error", message: error.message };

  revalidatePath("/admin/resultaten");
  return { status: "ok", message: "Set aangemaakt. Voeg nu bestanden of links toe." };
}

export async function addResultLinkAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const resultId = String(formData.get("result_id") ?? "");
  const url = String(formData.get("url") ?? "");
  const label = String(formData.get("label") ?? "");

  const result = await addExternalLink({ resultId, url, label, userId: session.userId });

  revalidatePath("/admin/resultaten");
  return result.ok
    ? { status: "ok", message: "Link toegevoegd." }
    : { status: "error", message: result.error ?? "Toevoegen is niet gelukt." };
}

export async function publishResultAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const resultId = String(formData.get("result_id") ?? "");

  const portalUrl = await resolveSiteUrl();
  const result = await publishResult({ resultId, userId: session.userId, portalUrl });

  revalidatePath("/admin/resultaten");
  revalidatePath("/resultaten");
  return result.ok
    ? { status: "ok", message: result.message }
    : { status: "error", message: result.message };
}

export async function deleteResultAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const resultId = String(formData.get("result_id") ?? "");

  const supabase = createServiceSupabase();
  const { data: files } = await supabase
    .from("workshop_result_files")
    .select("storage_path")
    .eq("result_id", resultId);

  const paths = (files ?? [])
    .map((f) => f.storage_path)
    .filter((p): p is string => Boolean(p));

  if (paths.length > 0) {
    await supabase.storage.from(RESULTS_BUCKET).remove(paths);
  }

  await supabase.from("workshop_results").delete().eq("id", resultId);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "workshop_result.deleted",
    entityType: "workshop_results",
    entityId: resultId,
  });

  revalidatePath("/admin/resultaten");
  revalidatePath("/resultaten");
  return { status: "ok", message: "Set verwijderd, inclusief de bestanden." };
}

export async function deleteResultFileAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  await requireAdmin();
  const fileId = String(formData.get("file_id") ?? "");

  const supabase = createServiceSupabase();
  const { data: file } = await supabase
    .from("workshop_result_files")
    .select("storage_path")
    .eq("id", fileId)
    .maybeSingle();

  if (file?.storage_path) {
    await supabase.storage.from(RESULTS_BUCKET).remove([file.storage_path]);
  }
  await supabase.from("workshop_result_files").delete().eq("id", fileId);

  revalidatePath("/admin/resultaten");
  return { status: "ok", message: "Bestand verwijderd." };
}

/* -------------------------------------------------------------------------- */
/* Definitief verwijderen                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Beide acties zijn onomkeerbaar. Daarom drie sloten:
 *  1. alleen een super admin mag ze uitvoeren
 *  2. de beheerder moet het e-mailadres of de organisatienaam letterlijk
 *     overtypen, zodat een misklik nooit genoeg is
 *  3. er gaat altijd eerst een regel in het auditlogboek
 */

export async function deleteUserAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();

  if (!session.profile?.is_super_admin) {
    return { status: "error", message: "Alleen een super admin mag accounts verwijderen." };
  }

  const userId = String(formData.get("user_id") ?? "");
  const typed = String(formData.get("bevestiging") ?? "").trim().toLowerCase();
  const expected = String(formData.get("verwacht") ?? "").trim().toLowerCase();

  if (!expected || typed !== expected) {
    return {
      status: "error",
      message: `Typ ter bevestiging het volledige e-mailadres over: ${formData.get("verwacht")}`,
    };
  }

  const result = await deleteUserPermanently({
    userId,
    actorId: session.userId,
    actorEmail: session.email,
  });

  revalidatePath("/admin/gebruikers");
  revalidatePath("/admin");
  return result.ok
    ? { status: "ok", message: result.message }
    : { status: "error", message: result.message };
}

export async function deleteOrganizationAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();

  if (!session.profile?.is_super_admin) {
    return { status: "error", message: "Alleen een super admin mag organisaties verwijderen." };
  }

  const organizationId = String(formData.get("organization_id") ?? "");
  const typed = String(formData.get("bevestiging") ?? "").trim().toLowerCase();
  const expected = String(formData.get("verwacht") ?? "").trim().toLowerCase();

  if (!expected || typed !== expected) {
    return {
      status: "error",
      message: `Typ ter bevestiging de volledige naam over: ${formData.get("verwacht")}`,
    };
  }

  const result = await deleteOrganizationPermanently({
    organizationId,
    actorId: session.userId,
    actorEmail: session.email,
  });

  revalidatePath("/admin/organisaties");
  revalidatePath("/admin");
  return result.ok
    ? { status: "ok", message: result.message }
    : { status: "error", message: result.message };
}
