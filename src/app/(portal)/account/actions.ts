"use server";

import { revalidatePath } from "next/cache";

import { isValidEmail } from "@/lib/account";
import { normalizeCjpNumber } from "@/lib/cjp";
import { domeinNaarUrl } from "@/lib/organizations/logo-parse";
import {
  clearOrganizationLogo,
  fetchOrganizationLogo,
  setOrganizationLogo,
} from "@/lib/organizations/logo";
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

  // Het e-mailadres is verplicht, maar niet iets wat de klant hier invult: het
  // is zijn inlogadres. Wij controleren of het klopt en zetten het meteen goed
  // in het profiel als daar iets is scheefgelopen. Wisselen van inlogadres
  // loopt via ons, zodat niemand met een zelfgekozen adres bij de gegevens van
  // een andere school kan komen.
  if (!isValidEmail(session.email)) {
    return {
      status: "error",
      message:
        "Er is iets mis met het e-mailadres van uw account. Neem contact met ons op, dan zetten wij het goed.",
    };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      phone: phoneResult.value,
      job_title: jobTitle,
      email: session.email,
    })
    .eq("id", session.userId);

  if (error) return { status: "error", message: "Opslaan is niet gelukt." };

  revalidatePath("/account");
  revalidatePath("/", "layout");
  return { status: "ok", message: "Uw gegevens zijn opgeslagen." };
}

/**
 * Het CJP-schoolnummer van de organisatie bijwerken.
 *
 * Iedereen die bij deze organisatie hoort mag dit. Het nummer hoort bij de
 * school en niet bij een persoon, dus een collega ziet dezelfde wijziging. Het
 * invullen van een nummer verandert nooit iets aan een prijs, korting of
 * factuur; het wordt alleen vastgelegd.
 *
 * requireMember() zorgt ervoor dat iemand alleen bij zijn eigen organisatie
 * kan komen. Een ander organisatie-ID meesturen heeft geen zin: wij gebruiken
 * uitsluitend de actieve organisatie uit de gecontroleerde sessie.
 */
export async function updateCjpNumber(
  _prev: AccountState,
  formData: FormData
): Promise<AccountState> {
  const session = await requireMember();

  const resultaat = normalizeCjpNumber(String(formData.get("cjp_school_number") ?? ""));
  if (!resultaat.ok) {
    return { status: "error", message: resultaat.message ?? "Controleer het nummer." };
  }

  const supabase = createServiceSupabase();
  const { data: vorige } = await supabase
    .from("organizations")
    .select("cjp_school_number, has_cjp")
    .eq("id", session.activeOrganizationId)
    .maybeSingle();

  const { error } = await supabase
    .from("organizations")
    .update({
      cjp_school_number: resultaat.value,
      // Een ingevuld nummer betekent dat de school er een heeft. Wordt het
      // leeggemaakt, dan weten wij het weer niet zeker.
      has_cjp: resultaat.value ? true : (vorige?.has_cjp ?? null),
    })
    .eq("id", session.activeOrganizationId);

  if (error) return { status: "error", message: "Opslaan is niet gelukt." };

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    actorRole: "klant",
    action: "organization.cjp_updated",
    entityType: "organization",
    entityId: session.activeOrganizationId,
    organizationId: session.activeOrganizationId,
    before: { cjp_school_number: vorige?.cjp_school_number ?? null },
    after: { cjp_school_number: resultaat.value ?? null },
  });

  revalidatePath("/account");
  return {
    status: "ok",
    message: resultaat.value
      ? "Het CJP-schoolnummer is opgeslagen."
      : "Het CJP-schoolnummer is verwijderd.",
  };
}

/**
 * De website van de organisatie bijwerken.
 *
 * Daar zoeken wij het logo. Puur visueel: een website zegt nooit iets over wie
 * toegang heeft tot welke gegevens.
 */
export async function updateOrganizationWebsite(
  _prev: AccountState,
  formData: FormData
): Promise<AccountState> {
  const session = await requireMember();
  const ingevuld = String(formData.get("website") ?? "").trim();

  if (ingevuld === "") {
    const supabase = createServiceSupabase();
    await supabase
      .from("organizations")
      .update({ website: null })
      .eq("id", session.activeOrganizationId);
    revalidatePath("/account");
    return { status: "ok", message: "De website is verwijderd." };
  }

  const url = domeinNaarUrl(ingevuld);
  if (!url) {
    return {
      status: "error",
      message: "Vul een gewoon webadres in, bijvoorbeeld goudsewaarden.nl.",
    };
  }

  const supabase = createServiceSupabase();
  const { data: vorige } = await supabase
    .from("organizations")
    .select("website")
    .eq("id", session.activeOrganizationId)
    .maybeSingle();

  const { error } = await supabase
    .from("organizations")
    .update({ website: url })
    .eq("id", session.activeOrganizationId);

  if (error) return { status: "error", message: "Opslaan is niet gelukt." };

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    actorRole: "klant",
    action: "organization.website_updated",
    entityType: "organization",
    entityId: session.activeOrganizationId,
    organizationId: session.activeOrganizationId,
    before: { website: vorige?.website ?? null },
    after: { website: url },
  });

  revalidatePath("/account");
  return { status: "ok", message: "De website is opgeslagen. U kunt nu het logo laten ophalen." };
}

/** Het logo laten ophalen van de eigen website. */
export async function fetchOwnLogo(): Promise<AccountState> {
  const session = await requireMember();

  const result = await fetchOrganizationLogo({
    organizationId: session.activeOrganizationId,
    actorId: session.userId,
    actorEmail: session.email,
    // De klant vraagt er zelf om, dus een eerder ingesteld logo mag vervangen.
    force: true,
  });

  revalidatePath("/account");
  revalidatePath("/", "layout");

  return result.ok
    ? { status: "ok", message: `Logo gevonden via ${result.bron}.` }
    : { status: "error", message: result.message ?? "Wij hebben geen logo kunnen vinden." };
}

/** Zelf een logo uploaden. */
export async function uploadOwnLogo(
  _prev: AccountState,
  formData: FormData
): Promise<AccountState> {
  const session = await requireMember();
  const bestand = formData.get("logo");

  if (!(bestand instanceof File) || bestand.size === 0) {
    return { status: "error", message: "Kies eerst een bestand." };
  }

  if (bestand.size > 2 * 1024 * 1024) {
    return { status: "error", message: "Dit bestand is groter dan 2 MB." };
  }

  const result = await setOrganizationLogo({
    organizationId: session.activeOrganizationId,
    file: await bestand.arrayBuffer(),
    actorId: session.userId,
    actorEmail: session.email,
    actorRole: "klant",
  });

  revalidatePath("/account");
  revalidatePath("/", "layout");

  return result.ok
    ? { status: "ok", message: "Uw logo staat erop." }
    : { status: "error", message: result.message ?? "Het logo kon niet worden opgeslagen." };
}

/** Terug naar het standaardicoon. */
export async function removeOwnLogo(): Promise<AccountState> {
  const session = await requireMember();

  await clearOrganizationLogo({
    organizationId: session.activeOrganizationId,
    actorId: session.userId,
    actorEmail: session.email,
  });

  revalidatePath("/account");
  revalidatePath("/", "layout");
  return { status: "ok", message: "Het logo is verwijderd." };
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
