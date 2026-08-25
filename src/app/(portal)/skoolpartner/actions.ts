"use server";

import { revalidatePath } from "next/cache";

import { requireMember } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { createServerSupabase } from "@/lib/supabase/server";

export interface RedemptionState {
  status: "idle" | "ok" | "error";
  message?: string;
}

/**
 * Dient een inwisselverzoek in.
 *
 * De daadwerkelijke controle (saldo, minimum, maximum, reservering) gebeurt in
 * de databasefunctie request_redemption. Die draait in één transactie met een
 * lock op het loyalty account, zodat dezelfde punten nooit twee keer kunnen
 * worden gebruikt.
 */
export async function requestRedemption(
  _prev: RedemptionState,
  formData: FormData
): Promise<RedemptionState> {
  const session = await requireMember();
  const points = Number.parseInt(String(formData.get("points") ?? ""), 10);
  const reference = String(formData.get("booking_reference") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!Number.isFinite(points) || points <= 0) {
    return { status: "error", message: "Vul een geldig aantal punten in." };
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("request_redemption", {
    p_org: session.activeOrganizationId,
    p_points: points,
    p_booking_reference: reference,
    p_note: note,
  });

  if (error) {
    return { status: "error", message: vertaalDatabaseFout(error.message) };
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    actorRole: "klant",
    action: "redemption.requested",
    entityType: "redemption_request",
    entityId: (data as { id?: string } | null)?.id ?? null,
    organizationId: session.activeOrganizationId,
    after: { points, booking_reference: reference },
  });

  revalidatePath("/skoolpartner");
  revalidatePath("/dashboard");

  return {
    status: "ok",
    message:
      "Uw verzoek is ontvangen. De punten zijn gereserveerd; wij verwerken het voordeel bij uw volgende boeking.",
  };
}

export async function cancelRedemption(
  _prev: RedemptionState,
  formData: FormData
): Promise<RedemptionState> {
  const session = await requireMember();
  const id = String(formData.get("request_id") ?? "");
  if (!id) return { status: "error", message: "Onbekend verzoek." };

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("cancel_redemption", {
    p_request: id,
    p_reason: "Geannuleerd door de klant",
  });

  if (error) return { status: "error", message: vertaalDatabaseFout(error.message) };

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    actorRole: "klant",
    action: "redemption.cancelled",
    entityType: "redemption_request",
    entityId: id,
    organizationId: session.activeOrganizationId,
  });

  revalidatePath("/skoolpartner");
  return { status: "ok", message: "Uw verzoek is geannuleerd en de punten zijn weer beschikbaar." };
}

/** Databasefouten omzetten naar begrijpelijke taal, zonder technische details. */
function vertaalDatabaseFout(message: string): string {
  if (message.includes("Onvoldoende saldo")) {
    return message.replace(/^.*Onvoldoende saldo/, "Onvoldoende saldo");
  }
  if (message.includes("Minimaal")) return message.slice(message.indexOf("Minimaal"));
  if (message.includes("Maximaal")) return message.slice(message.indexOf("Maximaal"));
  if (message.includes("niet actief")) return "SkoolPartner is op dit moment niet actief.";
  if (message.includes("Geen toegang")) return "U heeft geen toegang tot deze organisatie.";
  if (message.includes("neemt nog niet deel")) {
    return "Uw organisatie neemt nog niet deel aan SkoolPartner.";
  }
  return "Uw verzoek kon niet worden verwerkt. Probeer het later opnieuw.";
}
