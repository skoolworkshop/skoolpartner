"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CUSTOMER_PREVIEW_COOKIE, requireAdmin } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { createServiceSupabase } from "@/lib/supabase/server";
import { createBookingFromSource } from "@/lib/bookings/ingest";
import { awardPointsForBooking, manualAdjustment, reverseTransaction } from "@/lib/loyalty/ledger";
import {
  approveMembership,
  setMembershipStatus,
} from "@/lib/organizations/service";
import { generateToken, hashToken } from "@/lib/crypto";
import { cjpAnswerToBoolean, normalizeCjpNumber } from "@/lib/cjp";
import {
  clearOrganizationLogo,
  fetchOrganizationLogo,
  setOrganizationLogo,
} from "@/lib/organizations/logo";
import { testIntegration } from "@/lib/integrations/health";
import {
  confirmParkingRequest,
  setParkingStatus,
  spendCredit,
} from "@/lib/tegoed/mutations";
import { getCreditBalanceForAdmin } from "@/lib/tegoed/queries";
import { checkSpend } from "@/lib/tegoed/regels";
import { MoneybirdClient } from "@/lib/integrations/moneybird/client";
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
import { integrationMode, publicEnv, serverEnv } from "@/lib/env";
import { buildMessageMime, GmailClient } from "@/lib/integrations/gmail/client";
import { SETTING_DEFAULTS, type SettingKey } from "@/lib/settings";
import type { Json } from "@/lib/types/database";

export interface AdminState {
  status: "idle" | "ok" | "error";
  message?: string;
  inviteUrl?: string;
  resultId?: string;
}

/** Open het klantportaal van een gewone klant als beheerder. */
export async function startCustomerPreviewAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const userId = String(formData.get("user_id") ?? "");
  const supabase = createServiceSupabase();

  const [{ data: profile }, { count }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, is_admin, is_blocked").eq("id", userId).maybeSingle(),
    supabase
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "active"),
  ]);

  if (!profile || profile.is_admin || profile.is_blocked || !count) {
    return { status: "error", message: "Dit klantportaal kan niet worden geopend." };
  }

  const cookieStore = await cookies();
  cookieStore.set(CUSTOMER_PREVIEW_COOKIE, userId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  });

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "customer_portal.preview_started",
    entityType: "profile",
    entityId: userId,
    after: { klant: profile.email },
  });

  redirect("/dashboard");
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

  const result = await approveMembership({
    memberId,
    adminId: session.userId,
    adminEmail: session.email,
    // Binnen een school is iedereen gelijk. Wie erbij hoort mag de gegevens
    // van die school aanpassen; daar is geen apart rolletje voor nodig.
    role: "beheerder",
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

  const userId = String(formData.get("user_id") ?? "");
  if (userId === session.userId) {
    return { status: "error", message: "U kunt uw eigen account niet blokkeren." };
  }
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
  const role = "beheerder" as const;

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

  const inviteUrl = `${publicEnv.siteUrl}/uitnodiging/${token}`;
  const { data: organization } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();

  let mailMessage = "De unieke link staat hieronder om te kopiëren.";
  if (integrationMode("gmail") === "live") {
    try {
      const client = await GmailClient.create();
      if (!client) throw new Error("Gmail is nog niet gekoppeld");
      await client.sendRaw(
        buildMessageMime({
          from: `Skool Workshop <${serverEnv.google.mailbox}>`,
          to: [email],
          subject: `Uitnodiging voor ${organization?.name ?? "SkoolPartner"}`,
          bodyText: [
            "Beste,",
            "",
            `U bent uitgenodigd voor ${organization?.name ?? "uw organisatie"} in SkoolPartner.`,
            "Open de persoonlijke link om uw account te activeren:",
            inviteUrl,
            "",
            "Deze link is 14 dagen geldig en kan maar één keer worden gebruikt.",
            "",
            "Met vriendelijke groet,",
            "Team Skool Workshop",
          ].join("\n"),
        })
      );
      mailMessage = `De uitnodiging is automatisch gemaild naar ${email}. De unieke link staat ook hieronder.`;
    } catch (mailError) {
      console.error("[invite] mail kon niet worden verstuurd", mailError);
      mailMessage = "De uitnodiging is aangemaakt, maar de e-mail kon niet worden verstuurd. Kopieer daarom de unieke link hieronder.";
    }
  } else {
    mailMessage = "Gmail staat in testmodus; er is geen echte e-mail verstuurd. Kopieer de unieke link hieronder.";
  }

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
    message: mailMessage,
    inviteUrl,
  };
}

/**
 * Het logo van een organisatie ophalen van haar eigen domein.
 *
 * Force staat aan: vraagt een beheerder er bewust om, dan mag een eerder
 * handmatig ingesteld logo wél worden vervangen.
 */
export async function fetchOrganizationLogoAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const organizationId = String(formData.get("organization_id") ?? "");
  if (!organizationId) return { status: "error", message: "Onbekende organisatie." };

  const result = await fetchOrganizationLogo({
    organizationId,
    actorId: session.userId,
    actorEmail: session.email,
    force: true,
  });

  revalidatePath(`/admin/organisaties/${organizationId}`);
  revalidatePath("/", "layout");

  return result.ok
    ? { status: "ok", message: `Logo gevonden via ${result.bron}.` }
    : { status: "error", message: result.message ?? "Er is geen logo gevonden." };
}

/**
 * Verbinding testen. Uitsluitend lezen: er wordt niets aangemaakt, gewijzigd,
 * verstuurd of verwijderd in Moneybird of Gmail.
 */
export async function testIntegrationAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const naam = String(formData.get("integration") ?? "");

  if (naam !== "moneybird" && naam !== "gmail") {
    return { status: "error", message: "Onbekende integratie." };
  }

  const uitkomst = await testIntegration(naam);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "integration.tested",
    entityType: "integration",
    entityId: naam,
    after: { geslaagd: uitkomst.ok, samenvatting: uitkomst.summary },
  });

  const regels = uitkomst.details.length > 0 ? ` ${uitkomst.details.join(" ")}` : "";

  return uitkomst.ok
    ? { status: "ok", message: `${uitkomst.summary}${regels}` }
    : { status: "error", message: `${uitkomst.summary}${regels}` };
}

/**
 * Koppelt een Moneybird-contact aan een organisatie.
 *
 * Dit is de betrouwbare koppeling: het Moneybird-contact-ID verandert niet,
 * een bedrijfsnaam wel. Zonder deze koppeling komt een factuur in de
 * beheeromgeving terecht als "nog niet gekoppeld" en ziet de klant hem niet.
 *
 * Je mag hier ook een zoekterm invullen. Wij zoeken dan in Moneybird, puur
 * lezend, en koppelen alleen bij precies één treffer. Bij meerdere treffers
 * krijg je de lijst terug zodat je zelf het juiste ID kiest.
 */
export async function linkMoneybirdContactAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const organizationId = String(formData.get("organization_id") ?? "");
  const invoer = String(formData.get("moneybird_contact") ?? "").trim();

  if (!organizationId) return { status: "error", message: "Onbekende organisatie." };
  if (!invoer) return { status: "error", message: "Vul een contact-ID of een zoekterm in." };

  const client = MoneybirdClient.fromEnv();
  if (!client) {
    return {
      status: "error",
      message: "Moneybird draait in testmodus. Stel eerst de credentials in.",
    };
  }

  try {
    let contact = null;

    if (/^\d+$/.test(invoer)) {
      contact = await client.getContact(invoer);
    } else {
      const treffers = await client.listContacts({ query: invoer });
      if (treffers.length === 0) {
        return { status: "error", message: `Geen Moneybird-contact gevonden voor "${invoer}".` };
      }
      if (treffers.length > 1) {
        const lijst = treffers
          .slice(0, 8)
          .map((c) => `${c.company_name ?? `${c.firstname ?? ""} ${c.lastname ?? ""}`.trim()} (${c.id})`)
          .join(", ");
        return {
          status: "error",
          message: `Meerdere contacten gevonden. Vul het juiste ID in: ${lijst}`,
        };
      }
      contact = treffers[0];
    }

    if (!contact?.id) {
      return { status: "error", message: "Dit contact bestaat niet in Moneybird." };
    }

    const naam =
      contact.company_name ??
      (`${contact.firstname ?? ""} ${contact.lastname ?? ""}`.trim() || null);

    const supabase = createServiceSupabase();

    // Hangt dit contact al aan een ANDERE organisatie? Dan niet stilzwijgend
    // verplaatsen: dan zouden facturen van de ene klant bij de andere komen.
    const { data: bestaand } = await supabase
      .from("external_record_mappings")
      .select("internal_id")
      .eq("system", "moneybird")
      .eq("entity_type", "contact")
      .eq("external_id", contact.id)
      .maybeSingle();

    if (bestaand && bestaand.internal_id !== organizationId) {
      const { data: andere } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", bestaand.internal_id)
        .maybeSingle();

      return {
        status: "error",
        message: `Dit Moneybird-contact hangt al aan ${andere?.name ?? "een andere organisatie"}. Haal die koppeling daar eerst weg.`,
      };
    }

    const { error } = await supabase.from("external_record_mappings").upsert(
      {
        system: "moneybird",
        entity_type: "contact",
        internal_table: "organizations",
        internal_id: organizationId,
        external_id: contact.id,
        external_label: naam,
        created_by: session.userId,
      },
      { onConflict: "system,entity_type,external_id" }
    );

    if (error) return { status: "error", message: `Koppelen is niet gelukt: ${error.message}` };

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "moneybird_contact.linked",
      entityType: "organization",
      entityId: organizationId,
      organizationId,
      after: { moneybird_contact_id: contact.id, naam },
    });

    revalidatePath(`/admin/organisaties/${organizationId}`);
    return {
      status: "ok",
      message: `Gekoppeld aan ${naam ?? "contact"} (${contact.id}). Draai een synchronisatie om de facturen op te halen.`,
    };
  } catch (error) {
    return {
      status: "error",
      message: `Moneybird gaf een fout: ${error instanceof Error ? error.message.slice(0, 160) : "onbekend"}`,
    };
  }
}

export async function unlinkMoneybirdContactAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const organizationId = String(formData.get("organization_id") ?? "");
  const externalId = String(formData.get("external_id") ?? "");

  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("external_record_mappings")
    .delete()
    .eq("system", "moneybird")
    .eq("entity_type", "contact")
    .eq("external_id", externalId)
    .eq("internal_id", organizationId);

  if (error) return { status: "error", message: "Ontkoppelen is niet gelukt." };

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "moneybird_contact.unlinked",
    entityType: "organization",
    entityId: organizationId,
    organizationId,
    before: { moneybird_contact_id: externalId },
  });

  revalidatePath(`/admin/organisaties/${organizationId}`);
  return { status: "ok", message: "Koppeling verwijderd. Bestaande facturen blijven staan." };
}

/**
 * Zichtbaarheid van een e-mailgesprek voor de klant.
 *
 * Standaard is de regel streng: alleen gesprekken met precies één geverifieerde
 * contactpersoon worden automatisch zichtbaar. Alles daarbuiten blijft staan op
 * "controle nodig" en is voor de klant onzichtbaar. Hiermee kan een beheerder
 * zo'n gesprek alsnog vrijgeven, of juist definitief verbergen.
 */
export async function setThreadVisibilityAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const threadId = String(formData.get("thread_id") ?? "");
  const keuze = String(formData.get("visibility") ?? "");

  if (keuze !== "manual_allowed" && keuze !== "blocked") {
    return { status: "error", message: "Onbekende keuze." };
  }

  const supabase = createServiceSupabase();
  const { data: thread } = await supabase
    .from("message_threads")
    .select("id, organization_id, visibility, subject")
    .eq("id", threadId)
    .maybeSingle();

  if (!thread) return { status: "error", message: "Gesprek niet gevonden." };

  // Vrijgeven kan alleen als duidelijk is bij welke organisatie het hoort.
  // Anders zou een gesprek bij de verkeerde klant terecht kunnen komen.
  if (keuze === "manual_allowed" && !thread.organization_id) {
    return {
      status: "error",
      message:
        "Dit gesprek hangt nog aan geen enkele organisatie. Koppel eerst de contactpersoon, anders weten wij niet wie het mag zien.",
    };
  }

  const { error } = await supabase
    .from("message_threads")
    .update({
      visibility: keuze,
      visibility_reason:
        keuze === "manual_allowed"
          ? `Handmatig vrijgegeven door ${session.email}`
          : `Handmatig verborgen door ${session.email}`,
      allowlisted_by: session.userId,
      allowlisted_at: new Date().toISOString(),
    })
    .eq("id", threadId);

  if (error) return { status: "error", message: "Wijzigen is niet gelukt." };

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: keuze === "manual_allowed" ? "message_thread.released" : "message_thread.blocked",
    entityType: "message_thread",
    entityId: threadId,
    organizationId: thread.organization_id,
    before: { visibility: thread.visibility },
    after: { visibility: keuze, onderwerp: thread.subject },
  });

  revalidatePath("/admin/berichten");
  revalidatePath(`/admin/berichten/${threadId}`);
  return {
    status: "ok",
    message:
      keuze === "manual_allowed"
        ? "Gesprek is nu zichtbaar voor deze klant."
        : "Gesprek is verborgen voor de klant.",
  };
}

export async function uploadOrganizationLogoAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const organizationId = String(formData.get("organization_id") ?? "");
  if (!organizationId) return { status: "error", message: "Onbekende organisatie." };

  const bestand = formData.get("logo");
  if (!(bestand instanceof File) || bestand.size === 0) {
    return { status: "error", message: "Kies eerst een bestand." };
  }
  if (bestand.size > 2 * 1024 * 1024) {
    return { status: "error", message: "Dit bestand is groter dan 2 MB." };
  }

  const result = await setOrganizationLogo({
    organizationId,
    file: await bestand.arrayBuffer(),
    actorId: session.userId,
    actorEmail: session.email,
  });

  revalidatePath(`/admin/organisaties/${organizationId}`);
  revalidatePath("/", "layout");

  return result.ok
    ? { status: "ok", message: "Logo opgeslagen." }
    : { status: "error", message: result.message ?? "Het logo kon niet worden opgeslagen." };
}

export async function clearOrganizationLogoAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const organizationId = String(formData.get("organization_id") ?? "");
  if (!organizationId) return { status: "error", message: "Onbekende organisatie." };

  await clearOrganizationLogo({
    organizationId,
    actorId: session.userId,
    actorEmail: session.email,
  });

  revalidatePath(`/admin/organisaties/${organizationId}`);
  revalidatePath("/", "layout");
  return { status: "ok", message: "Logo verwijderd. Het standaardicoon is weer zichtbaar." };
}

/**
 * Het CJP-schoolnummer vastleggen.
 *
 * Puur registratie. Dit veroorzaakt uit zichzelf nooit een korting, een
 * factuurwijziging of welke financiële actie dan ook.
 */
export async function setCjpNumberAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const organizationId = String(formData.get("organization_id") ?? "");
  if (!organizationId) return { status: "error", message: "Onbekende organisatie." };

  const nummer = normalizeCjpNumber(String(formData.get("cjp_school_number") ?? ""));
  if (!nummer.ok) return { status: "error", message: nummer.message ?? "Controleer het nummer." };

  const antwoord = String(formData.get("has_cjp") ?? "onbekend");
  const heeftCjp = cjpAnswerToBoolean(antwoord);

  const supabase = createServiceSupabase();
  const { data: vorige } = await supabase
    .from("organizations")
    .select("cjp_school_number, has_cjp")
    .eq("id", organizationId)
    .maybeSingle();

  const { error } = await supabase
    .from("organizations")
    .update({
      cjp_school_number: heeftCjp === false ? null : nummer.value,
      has_cjp: nummer.value ? true : heeftCjp,
    })
    .eq("id", organizationId);

  if (error) return { status: "error", message: "Opslaan is niet gelukt." };

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "organization.cjp_updated",
    entityType: "organization",
    entityId: organizationId,
    organizationId,
    before: {
      cjp_school_number: vorige?.cjp_school_number ?? null,
      has_cjp: vorige?.has_cjp ?? null,
    },
    after: {
      cjp_school_number: heeftCjp === false ? null : (nummer.value ?? null),
      has_cjp: nummer.value ? true : heeftCjp,
    },
  });

  revalidatePath(`/admin/organisaties/${organizationId}`);
  return { status: "ok", message: "CJP-gegevens opgeslagen." };
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
    // De boeking kwam tot stand op het moment van de bevestigingsmail, niet nu
    // dat een beheerder hem goedkeurt.
    bookedAt: source.received_at,
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
  const userId = String(formData.get("user_id") ?? "");
  const points = Number.parseInt(String(formData.get("points") ?? ""), 10);
  const reason = String(formData.get("reason") ?? "");
  const description = String(formData.get("description") ?? "").trim() || undefined;

  const result = await manualAdjustment({
    organizationId,
    userId,
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
  const invoiceNumber = String(formData.get("invoice_number") ?? "").trim() || null;

  const supabase = createServiceSupabase();
  const { data: request } = await supabase
    .from("redemption_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!request) return { status: "error", message: "Verzoek niet gevonden." };

  // Een afgehandeld verzoek blijft afgehandeld. Anders zouden punten die al
  // zijn vrijgegeven opnieuw kunnen worden afgeschreven, of andersom.
  if (request.status !== "requested" && request.status !== "approved") {
    return {
      status: "error",
      message: "Dit verzoek is al afgehandeld en kan niet opnieuw worden gewijzigd.",
    };
  }

  // Verwerkt betekent: de korting staat echt op een factuur. Zonder
  // factuurnummer kunnen wij dat later niet aantonen.
  if (decision === "applied" && !invoiceNumber) {
    return {
      status: "error",
      message: "Vul het factuurnummer in waarop de korting is verwerkt.",
    };
  }

  if (decision === "approved") {
    await supabase
      .from("redemption_requests")
      .update({
        status: "approved",
        decided_by: session.userId,
        decided_at: new Date().toISOString(),
        decision_note: note,
        invoice_number: invoiceNumber ?? request.invoice_number,
      })
      .eq("id", id);
  } else if (decision === "applied") {
    await supabase
      .from("redemption_requests")
      .update({
        status: "applied",
        applied_at: new Date().toISOString(),
        applied_by: session.userId,
        decided_by: request.decided_by ?? session.userId,
        decided_at: request.decided_at ?? new Date().toISOString(),
        decision_note: note ?? request.decision_note,
        invoice_number: invoiceNumber,
      })
      .eq("id", id);

    // De reservering wordt definitief: de punten zijn nu daadwerkelijk gebruikt.
    // De punten- en eurowaarde op de transactie blijven staan zoals ze bij het
    // verzoek golden, ook als de puntwaarde later wordt aangepast.
    if (request.reserve_transaction_id) {
      await supabase
        .from("loyalty_transactions")
        .update({
          status: "redeemed",
          reason: `Voordeel verwerkt op factuur ${invoiceNumber}`,
        })
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
    before: {
      status: request.status,
      factuurnummer: request.invoice_number,
    },
    after: {
      status: decision,
      punten: request.points,
      waarde_centen: request.value_cents,
      punt_waarde_per_100: request.point_value_cents_per_100,
      boeking_id: request.booking_id,
      factuurnummer: decision === "applied" ? invoiceNumber : (invoiceNumber ?? request.invoice_number),
      punten_vrijgegeven: decision === "rejected",
    },
    reason: note,
  });

  revalidatePath("/admin/inwisselen");
  revalidatePath("/skoolpartner");
  return {
    status: "ok",
    message:
      decision === "applied"
        ? `Verwerkt en vastgelegd op factuur ${invoiceNumber}.`
        : decision === "rejected"
          ? "Afgewezen. De gereserveerde punten zijn weer beschikbaar."
          : "Goedgekeurd. De punten blijven gereserveerd tot u het voordeel verwerkt.",
  };
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

  const runner =
    which === "gmail" ? syncGmail : which === "moneybird" ? syncMoneybirdInvoices : null;

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
  const { data: organization } = await supabase
    .from("organizations")
    .select("id")
    .eq("id", organizationId)
    .maybeSingle();

  if (!organization) return { status: "error", message: "Deze organisatie bestaat niet meer." };

  if (bookingId) {
    const { data: booking } = await supabase
      .from("bookings")
      .select("id")
      .eq("id", bookingId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!booking) {
      return {
        status: "error",
        message: "Deze boeking hoort niet bij de gekozen organisatie. Kies de boeking opnieuw.",
      };
    }
  }

  const { data: created, error } = await supabase
    .from("workshop_results")
    .insert({
      organization_id: organizationId,
      booking_id: bookingId || null,
      title,
      description: description || null,
      status: "concept",
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !created) {
    return { status: "error", message: error?.message ?? "De set kon niet worden aangemaakt." };
  }

  revalidatePath("/admin/resultaten");
  return {
    status: "ok",
    message: "Set aangemaakt. Voeg nu bestanden of downloadlinks toe.",
    resultId: created.id,
  };
}

export async function addResultLinkAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const resultId = String(formData.get("result_id") ?? "");
  const url = String(formData.get("url") ?? "");
  const fileName = String(formData.get("file_name") ?? "");
  const description = String(formData.get("description") ?? "");

  const result = await addExternalLink({
    resultId,
    url,
    fileName,
    description,
    userId: session.userId,
  });

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
 *  1. alleen een ingelogde beheerder mag ze uitvoeren
 *  2. de beheerder moet het e-mailadres of de organisatienaam letterlijk
 *     overtypen, zodat een misklik nooit genoeg is
 *  3. er gaat altijd eerst een regel in het auditlogboek
 */

export async function deleteUserAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();

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

/* -------------------------------------------------------------------------- */
/* Rechten en lidmaatschappen, zonder SQL                                      */
/* -------------------------------------------------------------------------- */

/** Wisselt uitsluitend tussen de twee rollen van SkoolPartner: klant en beheerder. */
export async function setUserRoleAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();

  const userId = String(formData.get("user_id") ?? "");
  const role = String(formData.get("rol") ?? "klant");

  if (userId === session.userId) {
    return {
      status: "error",
      message: "U kunt uw eigen beheerdersrechten niet wijzigen. Vraag een andere beheerder.",
    };
  }

  if (role !== "klant" && role !== "beheerder") {
    return { status: "error", message: "Onbekende rol." };
  }

  const rechten =
    role === "beheerder"
      ? { is_admin: true, is_super_admin: false }
      : { is_admin: false, is_super_admin: false };

  const supabase = createServiceSupabase();
  const { error } = await supabase.from("profiles").update(rechten).eq("id", userId);

  if (error) return { status: "error", message: `Wijzigen is niet gelukt: ${error.message}` };

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "user.role_changed",
    entityType: "profile",
    entityId: userId,
    after: { rol: role },
  });

  revalidatePath("/admin/gebruikers");
  return { status: "ok", message: `Rechten aangepast naar ${role}.` };
}

/** Voegt een bestaand account direct toe aan een organisatie. */
export async function addMemberByEmailAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();

  const organizationId = String(formData.get("organization_id") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = "beheerder" as const;

  if (!email) return { status: "error", message: "Vul een e-mailadres in." };

  const supabase = createServiceSupabase();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email")
    .ilike("email", email)
    .maybeSingle();

  if (!profile) {
    return {
      status: "error",
      message:
        "Dit adres heeft nog geen account. Gebruik hierboven Uitnodigen, dan krijgt deze persoon een link om zich aan te melden.",
    };
  }

  const { error } = await supabase
    .from("organization_members")
    .upsert(
      {
        organization_id: organizationId,
        user_id: profile.id,
        role,
        status: "active",
        source: "admin_manual",
        approved_by: session.userId,
        approved_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,user_id" }
    );

  if (error) return { status: "error", message: `Toevoegen is niet gelukt: ${error.message}` };

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "membership.added_by_admin",
    entityType: "organization_members",
    entityId: profile.id,
    organizationId,
    after: { email: profile.email, rol: role },
  });

  revalidatePath(`/admin/organisaties/${organizationId}`);
  revalidatePath("/admin/gebruikers");
  return { status: "ok", message: `${profile.email} is toegevoegd als ${role}.` };
}

/** Markeert een zelf aangemelde organisatie als gecontroleerd. */
export async function verifyOrganizationAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const organizationId = String(formData.get("organization_id") ?? "");

  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("organizations")
    .update({ verified_at: new Date().toISOString(), verified_by: session.userId })
    .eq("id", organizationId);

  if (error) return { status: "error", message: `Bijwerken is niet gelukt: ${error.message}` };

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "organization.verified",
    entityType: "organization",
    entityId: organizationId,
    organizationId,
  });

  revalidatePath("/admin/organisaties");
  revalidatePath("/admin");
  return { status: "ok", message: "Organisatie gecontroleerd." };
}

/* -------------------------------------------------------------------------- */
/* CJP-tegoed                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Bevestigt een parkeeraanvraag: het tegoed erbij en de bonuspunten erbij, in
 * één transactie in de database. Twee keer klikken kan geen kwaad.
 */
export async function confirmCjpParkingAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const requestId = String(formData.get("request_id") ?? "");
  if (!requestId) return { status: "error", message: "Onbekende aanvraag." };

  const result = await confirmParkingRequest({
    requestId,
    actorId: session.userId,
    actorEmail: session.email,
    note: String(formData.get("note") ?? "").trim() || null,
  });

  revalidatePath("/admin/cjp-tegoed");
  revalidatePath("/admin");
  return result.ok
    ? { status: "ok", message: result.message }
    : { status: "error", message: result.message };
}

/** Zet een aanvraag op In behandeling of Afgewezen. Raakt geen geld en geen punten. */
export async function setCjpParkingStatusAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const requestId = String(formData.get("request_id") ?? "");
  const status = String(formData.get("status") ?? "");

  if (!requestId) return { status: "error", message: "Onbekende aanvraag." };
  if (status !== "in_review" && status !== "rejected") {
    return { status: "error", message: "Deze status kan hier niet worden gezet." };
  }

  const note = String(formData.get("note") ?? "").trim() || null;
  if (status === "rejected" && !note) {
    return {
      status: "error",
      message: "Vul kort in waarom u afwijst. Dat staat later ook bij de aanvraag van de klant.",
    };
  }

  const result = await setParkingStatus({
    requestId,
    status,
    actorId: session.userId,
    actorEmail: session.email,
    note,
  });

  revalidatePath("/admin/cjp-tegoed");
  return result.ok
    ? { status: "ok", message: result.message }
    : { status: "error", message: result.message };
}

/**
 * Boekt handmatig tegoed af op een boeking.
 *
 * Richting Moneybird gaat er niets. Het factuurnummer is alleen een verwijzing
 * zodat later terug te vinden is waar het bedrag is verrekend.
 */
export async function spendCjpCreditAction(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const session = await requireAdmin();
  const organizationId = String(formData.get("organization_id") ?? "");
  if (!organizationId) return { status: "error", message: "Kies eerst een organisatie." };

  const saldo = await getCreditBalanceForAdmin(organizationId);
  const controle = checkSpend(String(formData.get("amount") ?? ""), saldo.available_cents);
  if (!controle.ok) return { status: "error", message: controle.message };

  const result = await spendCredit({
    organizationId,
    amountCents: controle.cents!,
    bookingId: String(formData.get("booking_id") ?? "").trim() || null,
    invoiceNumber: String(formData.get("invoice_number") ?? "").trim() || null,
    actorId: session.userId,
    actorEmail: session.email,
    note: String(formData.get("note") ?? "").trim() || null,
  });

  revalidatePath("/admin/cjp-tegoed");
  revalidatePath(`/admin/organisaties/${organizationId}`);
  return result.ok
    ? { status: "ok", message: result.message }
    : { status: "error", message: result.message };
}
