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
import { requireMember } from "@/lib/auth/session";
import { normalizePhone } from "@/lib/phone";
import { normalizePostalCode } from "@/lib/registration";
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
  const session = await requireMember();
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const requestedEmail = String(formData.get("email") ?? "").trim().toLowerCase();
  const jobTitle = String(formData.get("job_title") ?? "").trim() || null;

  if (firstName.length < 2 || lastName.length < 2) {
    return { status: "error", message: "Vul uw voor- en achternaam in." };
  }
  if (!isValidEmail(requestedEmail)) {
    return { status: "error", message: "Vul een geldig e-mailadres in." };
  }

  // Telefoonnummer is verplicht: wij moeten een school op de dag zelf kunnen
  // bereiken als er iets misgaat met een workshop.
  const phoneResult = normalizePhone(String(formData.get("phone") ?? ""));
  if (!phoneResult.ok || !phoneResult.value) {
    return { status: "error", message: phoneResult.message ?? "Vul uw telefoonnummer in." };
  }

  const emailChanged = requestedEmail !== session.email.toLowerCase();
  const server = await createServerSupabase();
  const service = createServiceSupabase();

  if (emailChanged) {
    const authResult = session.customerPreview
      ? await service.auth.admin.updateUserById(session.userId, {
          email: requestedEmail,
          email_confirm: true,
          user_metadata: { full_name: fullName, first_name: firstName, last_name: lastName },
        })
      : await server.auth.updateUser({
          email: requestedEmail,
          data: { full_name: fullName, first_name: firstName, last_name: lastName },
        });
    if (authResult.error) {
      console.error("[account] e-mailadres wijzigen mislukt", authResult.error);
      return { status: "error", message: "Het e-mailadres kon niet worden gewijzigd. Mogelijk is het al in gebruik." };
    }
  } else {
    const authResult = session.customerPreview
      ? await service.auth.admin.updateUserById(session.userId, { user_metadata: { full_name: fullName, first_name: firstName, last_name: lastName } })
      : await server.auth.updateUser({ data: { full_name: fullName, first_name: firstName, last_name: lastName } });
    if (authResult.error) console.error("[account] auth-metadata bijwerken mislukt", authResult.error);
  }

  const profileEmail = emailChanged && !session.customerPreview ? session.email : requestedEmail;
  const { error } = await service
    .from("profiles")
    .update({
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      phone: phoneResult.value,
      job_title: jobTitle,
      email: profileEmail,
    })
    .eq("id", session.userId);

  if (error) return { status: "error", message: "Opslaan is niet gelukt." };

  await recordAudit({
    actorId: session.customerPreview?.administratorId ?? session.userId,
    actorEmail: session.customerPreview?.administratorEmail ?? session.email,
    actorRole: session.customerPreview ? "admin" : "klant",
    action: "profile.updated",
    entityType: "profile",
    entityId: session.userId,
    organizationId: session.activeOrganizationId,
    after: { full_name: fullName, email: requestedEmail, phone: phoneResult.value, job_title: jobTitle },
    reason: session.customerPreview ? "Aangepast vanuit klantportaal door beheerder" : null,
  });

  revalidatePath("/account");
  revalidatePath("/", "layout");
  return {
    status: "ok",
    message: emailChanged && !session.customerPreview
      ? "Uw gegevens zijn opgeslagen. Bevestig het nieuwe e-mailadres via de e-mail die wij daarheen hebben gestuurd."
      : "Uw gegevens zijn opgeslagen.",
  };
}

/**
 * Het persoonlijke CJP-schoolnummer van de ingelogde contactpersoon bijwerken.
 * Een school kan meerdere gebruikers met verschillende nummers hebben. Het
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
    .from("profiles")
    .select("cjp_school_number, has_cjp")
    .eq("id", session.userId)
    .maybeSingle();

  const { error } = await supabase
    .from("profiles")
    .update({
      cjp_school_number: resultaat.value,
      // Een ingevuld nummer betekent dat de school er een heeft. Wordt het
      // leeggemaakt, dan weten wij het weer niet zeker.
      has_cjp: resultaat.value ? true : (vorige?.has_cjp ?? null),
    })
    .eq("id", session.userId);

  if (error) return { status: "error", message: "Opslaan is niet gelukt." };

  await recordAudit({
    actorId: session.customerPreview?.administratorId ?? session.userId,
    actorEmail: session.customerPreview?.administratorEmail ?? session.email,
    actorRole: session.customerPreview ? "admin" : "klant",
    action: "profile.cjp_updated",
    entityType: "profile",
    entityId: session.userId,
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

/** Werkt de gedeelde school- en adresgegevens van de actieve organisatie bij. */
export async function updateOrganizationDetails(
  _prev: AccountState,
  formData: FormData
): Promise<AccountState> {
  const session = await requireMember();
  const name = String(formData.get("organization_name") ?? "").trim();
  const street = String(formData.get("street") ?? "").trim();
  const houseNumber = String(formData.get("house_number") ?? "").trim();
  const houseNumberAddition = String(formData.get("house_number_addition") ?? "").trim();
  const postalCode = normalizePostalCode(String(formData.get("postal_code") ?? ""));
  const city = String(formData.get("city") ?? "").trim();
  const phoneInput = String(formData.get("organization_phone") ?? "").trim();

  if (name.length < 2) return { status: "error", message: "Vul de naam van de organisatie in." };
  if (street.length < 2) return { status: "error", message: "Vul de straatnaam in." };
  if (!/^[0-9]{1,5}$/.test(houseNumber)) return { status: "error", message: "Vul een geldig huisnummer in." };
  if (houseNumberAddition.length > 10) return { status: "error", message: "De huisnummertoevoeging is te lang." };
  if (!postalCode) return { status: "error", message: "Vul een geldige Nederlandse postcode in." };
  if (city.length < 2) return { status: "error", message: "Vul de woonplaats in." };

  const phoneResult = phoneInput ? normalizePhone(phoneInput) : { ok: true as const, value: null };
  if (!phoneResult.ok) return { status: "error", message: phoneResult.message ?? "Controleer het telefoonnummer." };

  const service = createServiceSupabase();
  const { data: before } = await service
    .from("organizations")
    .select("name, street, house_number, house_number_addition, postal_code, city, phone")
    .eq("id", session.activeOrganizationId)
    .maybeSingle();

  const after = {
    name,
    street,
    house_number: houseNumber,
    house_number_addition: houseNumberAddition || null,
    postal_code: postalCode,
    city,
    phone: phoneResult.value ?? null,
    address_line: `${street} ${houseNumber}${houseNumberAddition ? ` ${houseNumberAddition}` : ""}, ${postalCode} ${city}`,
  };
  const { error } = await service.from("organizations").update(after).eq("id", session.activeOrganizationId);
  if (error) {
    console.error("[account] organisatiegegevens opslaan mislukt", error);
    return { status: "error", message: "De organisatiegegevens konden niet worden opgeslagen." };
  }

  await recordAudit({
    actorId: session.customerPreview?.administratorId ?? session.userId,
    actorEmail: session.customerPreview?.administratorEmail ?? session.email,
    actorRole: session.customerPreview ? "admin" : "klant",
    action: "organization.details_updated",
    entityType: "organization",
    entityId: session.activeOrganizationId,
    organizationId: session.activeOrganizationId,
    before: before ?? null,
    after,
    reason: session.customerPreview ? "Aangepast vanuit klantportaal door beheerder" : null,
  });

  revalidatePath("/account");
  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
  return { status: "ok", message: "De organisatie- en adresgegevens zijn opgeslagen." };
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
    actorId: session.customerPreview?.administratorId ?? session.userId,
    actorEmail: session.customerPreview?.administratorEmail ?? session.email,
    actorRole: session.customerPreview ? "admin" : "klant",
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
    actorId: session.customerPreview?.administratorId ?? session.userId,
    actorEmail: session.customerPreview?.administratorEmail ?? session.email,
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
    actorId: session.customerPreview?.administratorId ?? session.userId,
    actorEmail: session.customerPreview?.administratorEmail ?? session.email,
    actorRole: session.customerPreview ? "admin" : "klant",
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
    actorId: session.customerPreview?.administratorId ?? session.userId,
    actorEmail: session.customerPreview?.administratorEmail ?? session.email,
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
  if (session.customerPreview) return { status: "error", message: "Lidmaatschappen beheert u vanuit het beheerportaal." };
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
  const session = await requireMember();
  if (session.customerPreview) return { status: "error", message: "Accounts verwijdert of blokkeert u vanuit het beheerportaal." };
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
