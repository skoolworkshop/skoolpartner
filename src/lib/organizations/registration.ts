import "server-only";

import { recordAudit } from "@/lib/audit";
import { createServiceSupabase } from "@/lib/supabase/server";
import { emailDomain, slugify } from "@/lib/utils";
import type { RegistrationValues } from "@/lib/registration";
import type { RegistrationDetails } from "@/lib/types/database";

/**
 * Registratie afronden.
 *
 * Hier valt de belangrijkste bedrijfsregel van SkoolPartner: deelname begint
 * op het moment dat een organisatie voor het eerst actief lid krijgt, en geen
 * seconde eerder. Dat moment staat in loyalty_accounts.enrolled_at en dat is
 * de enige bron. Alles wat van vóór dat moment dateert telt niet mee.
 *
 * Twee wegen, met opzet verschillend:
 *
 *   Nieuwe organisatie   Deze persoon is de eerste. Er hangen nog geen
 *                        boekingen, facturen of punten aan, dus er valt niets
 *                        te beschermen. Hij komt meteen binnen en SkoolPartner
 *                        begint nu.
 *
 *   Bestaande organisatie De aanvraag gaat altijd langs een beheerder, ook bij
 *                        een domeinmatch. Wat de aanvrager invulde over die
 *                        organisatie wordt bewaard in requested_details en pas
 *                        overgenomen na goedkeuring. Zo kan niemand het adres
 *                        of telefoonnummer van een bestaande school wijzigen
 *                        door zich aan te melden.
 */

export type RegistrationOutcome =
  | { ok: true; state: "active"; organizationId: string }
  | { ok: true; state: "pending"; organizationId: string; organizationName: string }
  | { ok: false; message: string; technicalReason?: string };

function detailsFrom(values: RegistrationValues): RegistrationDetails {
  return {
    organization_name: values.organizationName,
    street: values.street,
    house_number: values.houseNumber,
    house_number_addition: values.houseNumberAddition ?? undefined,
    postal_code: values.postalCode,
    city: values.city,
    phone: values.phone,
    job_title: values.jobTitle,
  };
}

export async function completeRegistration(params: {
  userId: string;
  userEmail: string;
  values: RegistrationValues;
  /** Gekozen bestaande organisatie, als de gebruiker die heeft aangeklikt. */
  organizationId?: string | null;
}): Promise<RegistrationOutcome> {
  const supabase = createServiceSupabase();
  const { values } = params;

  // 1. Het persoonlijke profiel. Het e-mailadres komt uit Supabase Auth en
  //    nooit uit het formulier.
  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      first_name: values.firstName,
      last_name: values.lastName,
      full_name: values.fullName,
      phone: values.phone,
      job_title: values.jobTitle,
      email: params.userEmail,
    })
    .eq("id", params.userId);

  if (profileError) {
    return { ok: false, message: "Uw gegevens konden niet worden opgeslagen." };
  }

  // 2. Welke organisatie wordt het?
  const gekozen = params.organizationId?.trim() || null;
  let organizationId = gekozen;
  let isNieuw = false;

  if (!organizationId) {
    const slug = slugify(values.organizationName);
    const { data: bestaand } = await supabase
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (bestaand) {
      // Zelfde naam als een bestaande school. Nooit automatisch koppelen:
      // dit gaat langs de beheerder.
      organizationId = bestaand.id;
    } else {
      const { data: nieuw, error } = await supabase
        .from("organizations")
        .insert({
          name: values.organizationName,
          slug,
          kind: "school",
          contact_email: params.userEmail,
          phone: values.phone,
          street: values.street,
          house_number: values.houseNumber,
          house_number_addition: values.houseNumberAddition,
          postal_code: values.postalCode,
          city: values.city,
        })
        .select("id")
        .single();

      if (error || !nieuw) {
        console.error("[registratie] organisatie aanmaken mislukt", {
          naam: values.organizationName,
          slug,
          message: error?.message,
          details: error?.details,
          code: error?.code,
        });
        await recordAudit({
          actorId: params.userId,
          actorEmail: params.userEmail,
          action: "organization.create_failed",
          entityType: "organization",
          after: {
            naam: values.organizationName,
            slug,
            melding: error?.message ?? "onbekende fout",
            code: error?.code ?? null,
          },
        });
        return {
          ok: false,
          message: "Uw organisatie kon niet worden aangemaakt. Neem contact met ons op.",
          technicalReason: error?.message,
        };
      }

      organizationId = nieuw.id;
      isNieuw = true;
    }
  }

  if (!organizationId) {
    return { ok: false, message: "Er ging iets mis bij het kiezen van uw organisatie." };
  }

  // 3. Het lidmaatschap.
  if (isNieuw) {
    const { error } = await supabase.from("organization_members").upsert(
      {
        organization_id: organizationId,
        user_id: params.userId,
        role: "beheerder",
        status: "active",
        source: "self_request",
        approved_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,user_id" }
    );

    if (error) return { ok: false, message: "Uw aanmelding kon niet worden opgeslagen." };

    // Het startmoment van SkoolPartner. Hier en nergens anders.
    await supabase.rpc("ensure_loyalty_account", {
      p_org: organizationId,
      p_actor: params.userId,
    });

    await supabase.from("organization_contacts").upsert(
      {
        organization_id: organizationId,
        email: params.userEmail.toLowerCase(),
        full_name: values.fullName,
        user_id: params.userId,
        is_verified: true,
        verified_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,email" }
    );

    // Het e-maildomein van de eerste medewerker is een geverifieerd domein van
    // deze school. Daarmee herkennen wij collega's die zich later aanmelden.
    const domain = emailDomain(params.userEmail);
    if (domain) {
      const { data: publiek } = await supabase
        .from("public_email_domains")
        .select("domain")
        .eq("domain", domain)
        .maybeSingle();

      if (!publiek) {
        const { data: alBekend } = await supabase
          .from("organization_domains")
          .select("id")
          .eq("domain", domain)
          .maybeSingle();

        if (!alBekend) {
          await supabase.from("organization_domains").insert({
            organization_id: organizationId,
            domain,
            is_verified: true,
            verified_at: new Date().toISOString(),
          });
        }
      }
    }

    await recordAudit({
      actorId: params.userId,
      actorEmail: params.userEmail,
      actorRole: "klant",
      action: "registration.completed",
      entityType: "organization_member",
      entityId: organizationId,
      organizationId,
      after: { status: "active", organisatie: values.organizationName, nieuw: true },
    });

    return { ok: true, state: "active", organizationId };
  }

  // Bestaande organisatie: altijd in de wachtrij.
  const { data: bestaandLid } = await supabase
    .from("organization_members")
    .select("id, status")
    .eq("organization_id", organizationId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (bestaandLid?.status !== "active") {
    const { error } = await supabase.from("organization_members").upsert(
      {
        organization_id: organizationId,
        user_id: params.userId,
        role: "lid",
        status: "pending",
        source: "self_request",
        requested_details: detailsFrom(values),
      },
      { onConflict: "organization_id,user_id" }
    );

    if (error) return { ok: false, message: "Uw aanvraag kon niet worden opgeslagen." };
  }

  const { data: organisatie } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();

  await recordAudit({
    actorId: params.userId,
    actorEmail: params.userEmail,
    actorRole: "klant",
    action: "registration.completed",
    entityType: "organization_member",
    entityId: organizationId,
    organizationId,
    after: {
      status: bestaandLid?.status === "active" ? "active" : "pending",
      organisatie: organisatie?.name ?? values.organizationName,
      nieuw: false,
    },
  });

  if (bestaandLid?.status === "active") {
    return { ok: true, state: "active", organizationId };
  }

  return {
    ok: true,
    state: "pending",
    organizationId,
    organizationName: organisatie?.name ?? values.organizationName,
  };
}
