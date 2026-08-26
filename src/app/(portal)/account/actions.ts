"use server";

import { revalidatePath } from "next/cache";

import { requireMember, requireUser } from "@/lib/auth/session";
import { normalizePhone } from "@/lib/phone";
import { recordAudit } from "@/lib/audit";
import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";

export interface AccountState {
  status: "idle" | "ok" | "error";
  message?: string;
}

export async function updateProfile(
  _prev: AccountState,
  formData: FormData
): Promise<AccountState> {
  const session = await requireUser();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const jobTitle = String(formData.get("job_title") ?? "").trim() || null;

  if (fullName.length < 2) return { status: "error", message: "Vul uw naam in." };

  // Telefoonnummer is verplicht: wij moeten een school op de dag zelf kunnen
  // bereiken als er iets misgaat met een workshop.
  const phoneResult = normalizePhone(String(formData.get("phone") ?? ""));
  if (!phoneResult.ok || !phoneResult.value) {
    return { status: "error", message: phoneResult.message ?? "Vul uw telefoonnummer in." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName, phone: phoneResult.value, job_title: jobTitle })
    .eq("id", session.userId);

  if (error) return { status: "error", message: "Opslaan is niet gelukt." };

  revalidatePath("/account");
  revalidatePath("/", "layout");
  return { status: "ok", message: "Uw gegevens zijn opgeslagen." };
}

/**
 * Verwijdert het lidmaatschap van de actieve organisatie.
 * De gegevens van de organisatie zelf blijven bestaan; alleen de toegang van
 * deze gebruiker vervalt, inclusief de zichtbaarheid van e-mailthreads.
 */
export async function leaveOrganization(
  _prev: AccountState,
  formData: FormData
): Promise<AccountState> {
  const session = await requireMember();
  const organizationId = String(formData.get("organization_id") ?? "");

  if (!session.memberships.some((m) => m.organization.id === organizationId)) {
    return { status: "error", message: "U bent geen lid van deze organisatie." };
  }

  const supabase = createServiceSupabase();
  await supabase
    .from("organization_members")
    .update({ status: "removed" })
    .eq("organization_id", organizationId)
    .eq("user_id", session.userId);

  await supabase
    .from("organization_contacts")
    .update({ is_verified: false })
    .eq("organization_id", organizationId)
    .eq("user_id", session.userId);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    actorRole: "klant",
    action: "organization_membership.left",
    entityType: "organization_member",
    organizationId,
  });

  revalidatePath("/", "layout");
  return { status: "ok", message: "U bent geen lid meer van deze organisatie." };
}

/**
 * Deactiveert het account op verzoek van de gebruiker (AVG).
 * Persoonsgegevens worden gewist; financiële en loyaltyhistorie blijft bestaan
 * op organisatieniveau, omdat die bij de organisatie hoort en niet bij de
 * persoon.
 */
export async function deactivateAccount(): Promise<AccountState> {
  const session = await requireUser();
  const supabase = createServiceSupabase();

  await supabase
    .from("organization_members")
    .update({ status: "removed" })
    .eq("user_id", session.userId);

  await supabase
    .from("organization_contacts")
    .update({ is_verified: false, user_id: null })
    .eq("user_id", session.userId);

  await supabase
    .from("profiles")
    .update({
      full_name: null,
      phone: null,
      job_title: null,
      deactivated_at: new Date().toISOString(),
      is_blocked: true,
    })
    .eq("id", session.userId);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    actorRole: "klant",
    action: "account.deactivated",
    entityType: "profile",
    entityId: session.userId,
  });

  return {
    status: "ok",
    message:
      "Uw account is gedeactiveerd. Neem contact op met Skool Workshop als u het weer wilt gebruiken.",
  };
}
