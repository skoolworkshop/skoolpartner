import "server-only";

import { recordAudit } from "@/lib/audit";
import { hashToken } from "@/lib/crypto";
import { awardWelcomeBonus } from "@/lib/loyalty/ledger";
import { createServiceSupabase } from "@/lib/supabase/server";
import { emailDomain, slugify } from "@/lib/utils";
import type { MembershipSource, OrganizationRow } from "@/lib/types/database";

export interface OrganizationSuggestion {
  organization: Pick<OrganizationRow, "id" | "name" | "city" | "kind">;
  reason: "verified_domain" | "invite";
}

/**
 * Zoekt mogelijke organisaties bij een e-mailadres.
 *
 * Belangrijk: een domeinmatch is uitsluitend een SUGGESTIE. Er wordt nooit
 * automatisch gekoppeld. Publieke domeinen (gmail, outlook, ...) worden
 * volledig genegeerd; die staan bovendien geblokkeerd in de database.
 */
export async function suggestOrganizationsForEmail(
  email: string
): Promise<OrganizationSuggestion[]> {
  const domain = emailDomain(email);
  if (!domain) return [];

  const supabase = createServiceSupabase();

  const { data: isPublic } = await supabase
    .from("public_email_domains")
    .select("domain")
    .eq("domain", domain)
    .maybeSingle();

  if (isPublic) return [];

  const { data } = await supabase
    .from("organization_domains")
    .select("organization_id, is_verified, organizations!inner(id, name, city, kind, status)")
    .eq("domain", domain)
    .eq("is_verified", true);

  const rows = (data ?? []) as unknown as {
    organizations: OrganizationSuggestion["organization"] & { status: string };
  }[];

  return rows
    .filter((row) => row.organizations?.status === "active")
    .map((row) => ({ organization: row.organizations, reason: "verified_domain" as const }));
}

/** Zoekt organisaties op naam, voor de handmatige keuze in de onboarding. */
export async function searchOrganizations(query: string, limit = 8) {
  const term = query.trim();
  if (term.length < 2) return [];

  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("organizations")
    .select("id, name, city, kind")
    .eq("status", "active")
    .ilike("name", `%${term}%`)
    .order("name")
    .limit(limit);

  return data ?? [];
}

/**
 * Vraagt lidmaatschap aan. Het lidmaatschap staat altijd op 'pending' tot een
 * admin het goedkeurt. Dat geldt ook bij een domeinmatch.
 */
/**
 * Zet iemand meteen als actief lid neer. Gebruikt bij zelf aanmelden met een
 * eigen, nieuwe organisatie: die persoon is per definitie de eerste van die
 * school, dus er valt niets te beschermen. Er hangen nog geen boekingen,
 * facturen of punten aan.
 */
export async function joinAsFirstMember(params: {
  userId: string;
  userEmail: string;
  organizationId: string;
}): Promise<{ ok: boolean; message?: string }> {
  const supabase = createServiceSupabase();

  const { error } = await supabase.from("organization_members").upsert(
    {
      organization_id: params.organizationId,
      user_id: params.userId,
      role: "beheerder",
      status: "active",
      source: "self_request",
      approved_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,user_id" }
  );

  if (error) return { ok: false, message: "Aanmelden kon niet worden opgeslagen." };

  await recordAudit({
    actorId: params.userId,
    actorEmail: params.userEmail,
    actorRole: "klant",
    action: "organization_membership.self_started",
    entityType: "organization_member",
    entityId: params.organizationId,
    organizationId: params.organizationId,
    after: { status: "active", rol: "beheerder" },
  });

  return { ok: true };
}

export async function requestMembership(params: {
  userId: string;
  userEmail: string;
  organizationId: string;
  source: MembershipSource;
}): Promise<{ ok: boolean; message?: string }> {
  const supabase = createServiceSupabase();

  const { data: existing } = await supabase
    .from("organization_members")
    .select("id, status")
    .eq("organization_id", params.organizationId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (existing?.status === "active") {
    return { ok: true, message: "U bent al lid van deze organisatie." };
  }
  if (existing?.status === "pending") {
    return { ok: true, message: "Uw aanvraag staat al klaar voor goedkeuring." };
  }

  const { error } = await supabase.from("organization_members").upsert(
    {
      organization_id: params.organizationId,
      user_id: params.userId,
      role: "lid",
      status: "pending",
      source: params.source,
    },
    { onConflict: "organization_id,user_id" }
  );

  if (error) return { ok: false, message: "Aanvraag kon niet worden opgeslagen." };

  await recordAudit({
    actorId: params.userId,
    actorEmail: params.userEmail,
    actorRole: "klant",
    action: "organization_membership.requested",
    entityType: "organization_member",
    entityId: params.organizationId,
    organizationId: params.organizationId,
    after: { status: "pending", source: params.source },
  });

  return { ok: true };
}

/**
 * Keurt een lidmaatschap goed. Vanaf dat moment neemt de organisatie deel aan
 * SkoolPartner: het loyalty account wordt aangemaakt met de datum van nu.
 * Er worden nooit punten met terugwerkende kracht toegekend.
 */
export async function approveMembership(params: {
  memberId: string;
  adminId: string;
  adminEmail: string;
  role?: "beheerder" | "lid";
}): Promise<{ ok: boolean; message?: string }> {
  const supabase = createServiceSupabase();

  const { data: member } = await supabase
    .from("organization_members")
    .select("*")
    .eq("id", params.memberId)
    .maybeSingle();

  if (!member) return { ok: false, message: "Lidmaatschap niet gevonden." };

  const { error } = await supabase
    .from("organization_members")
    .update({
      status: "active",
      role: params.role ?? member.role,
      approved_by: params.adminId,
      approved_at: new Date().toISOString(),
      rejected_reason: null,
    })
    .eq("id", params.memberId);

  if (error) return { ok: false, message: "Goedkeuren is niet gelukt." };

  await supabase.rpc("ensure_loyalty_account", {
    p_org: member.organization_id,
    p_actor: member.user_id,
  });

  // Activeert deze organisatie hiermee voor het eerst, dan hoort daar het
  // persoonlijke welkomsttegoed bij. De unieke index laat dit per gebruiker
  // maar eenmaal toe, ook als een aanvraag dubbel wordt verwerkt.
  await awardWelcomeBonus({
    organizationId: member.organization_id,
    actorId: member.user_id,
  });

  // Wat de aanvrager invulde over deze organisatie stond geparkeerd. Nu een
  // beheerder de aanvraag goedkeurt, mogen die gegevens erin. Alleen lege
  // velden worden aangevuld: wat de organisatie al had, blijft staan.
  const gevraagd = member.requested_details;
  if (gevraagd) {
    const { data: organisatie } = await supabase
      .from("organizations")
      .select(
        "street, house_number, house_number_addition, postal_code, city, phone, cjp_school_number"
      )
      .eq("id", member.organization_id)
      .maybeSingle();

    if (organisatie) {
      const aanvulling: Partial<OrganizationRow> = {};
      const vul = (veld: keyof typeof organisatie, waarde?: string) => {
        if (!organisatie[veld] && waarde) aanvulling[veld] = waarde;
      };
      vul("street", gevraagd.street);
      vul("house_number", gevraagd.house_number);
      vul("house_number_addition", gevraagd.house_number_addition);
      vul("postal_code", gevraagd.postal_code);
      vul("city", gevraagd.city);
      vul("phone", gevraagd.phone);
      vul("cjp_school_number", gevraagd.cjp_school_number);

      if (Object.keys(aanvulling).length > 0) {
        await supabase.from("organizations").update(aanvulling).eq("id", member.organization_id);
        await recordAudit({
          actorId: params.adminId,
          actorEmail: params.adminEmail,
          action: "organization.details_completed",
          entityType: "organization",
          entityId: member.organization_id,
          organizationId: member.organization_id,
          after: aanvulling,
          reason: "Aangevuld vanuit een goedgekeurde registratie",
        });
      }
    }
  }

  // Het e-mailadres van dit lid is nu een geverifieerde contactpersoon.
  //
  // Wij nemen hier bewust het inlogadres uit Supabase Auth en niet het adres
  // uit profiles. Aan een geverifieerd contact hangt de zichtbaarheid van
  // e-mailthreads, en dat mag nooit afhangen van een veld dat de gebruiker
  // zelf kan aanpassen.
  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name")
    .eq("id", member.user_id)
    .maybeSingle();

  const { data: authUser } = await supabase.auth.admin.getUserById(member.user_id);
  const loginEmail = authUser?.user?.email ?? profile?.email ?? null;

  if (loginEmail) {
    await supabase.from("organization_contacts").upsert(
      {
        organization_id: member.organization_id,
        email: loginEmail.toLowerCase(),
        full_name: profile?.full_name ?? null,
        user_id: member.user_id,
        is_verified: true,
        verified_at: new Date().toISOString(),
        verified_by: params.adminId,
      },
      { onConflict: "organization_id,email" }
    );
  }

  await recordAudit({
    actorId: params.adminId,
    actorEmail: params.adminEmail,
    action: "organization_membership.approved",
    entityType: "organization_member",
    entityId: params.memberId,
    organizationId: member.organization_id,
    before: { status: member.status },
    after: { status: "active" },
  });

  return { ok: true };
}

export async function setMembershipStatus(params: {
  memberId: string;
  status: "rejected" | "removed" | "pending";
  reason?: string;
  adminId: string;
  adminEmail: string;
}): Promise<{ ok: boolean; message?: string }> {
  const supabase = createServiceSupabase();

  const { data: member } = await supabase
    .from("organization_members")
    .select("*")
    .eq("id", params.memberId)
    .maybeSingle();
  if (!member) return { ok: false, message: "Lidmaatschap niet gevonden." };

  const { error } = await supabase
    .from("organization_members")
    .update({ status: params.status, rejected_reason: params.reason ?? null })
    .eq("id", params.memberId);

  if (error) return { ok: false, message: "Wijzigen is niet gelukt." };

  if (params.status !== "pending") {
    // Toegang tot berichten intrekken door de contactpersoon te ontverifiëren.
    await supabase
      .from("organization_contacts")
      .update({ is_verified: false })
      .eq("organization_id", member.organization_id)
      .eq("user_id", member.user_id);
  }

  await recordAudit({
    actorId: params.adminId,
    actorEmail: params.adminEmail,
    action: `organization_membership.${params.status}`,
    entityType: "organization_member",
    entityId: params.memberId,
    organizationId: member.organization_id,
    before: { status: member.status },
    after: { status: params.status },
    reason: params.reason ?? null,
  });

  return { ok: true };
}

export async function createOrganization(params: {
  name: string;
  kind?: OrganizationRow["kind"];
  city?: string | null;
  contactEmail?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
  /** Door een beheerder aangemaakt? Dan hoeft er niets meer gecontroleerd te worden. */
  verified?: boolean;
}): Promise<{
  ok: boolean;
  organizationId?: string;
  message?: string;
  alreadyExisted?: boolean;
  /** Alleen voor de serverlog en voor beheerders. Nooit voor een klant. */
  technicalReason?: string;
}> {
  const supabase = createServiceSupabase();
  const name = params.name.trim();
  if (name.length < 2) return { ok: false, message: "Vul een organisatienaam in." };

  // Bestaat deze organisatie al? Dan is aanmaken niet de bedoeling, maar
  // aansluiten. Anders loopt iemand vast op een foutmelding zonder uitweg.
  const slug = slugify(name);
  const { data: existing } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (existing) {
    return { ok: true, organizationId: existing.id, alreadyExisted: true };
  }

  const { data, error } = await supabase
    .from("organizations")
    .insert({
      name,
      slug,
      kind: params.kind ?? "school",
      city: params.city ?? null,
      contact_email: params.contactEmail ?? null,
      verified_at: params.verified ? new Date().toISOString() : null,
      verified_by: params.verified ? (params.actorId ?? null) : null,
    })
    .select("id")
    .single();

  if (error || !data) {
    // De echte reden hoort niet op een klantpagina, maar wel in de serverlog.
    console.error("[organisatie aanmaken] mislukt", {
      naam: name,
      slug,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      code: error?.code,
    });
    await recordAudit({
      actorId: params.actorId ?? null,
      actorEmail: params.actorEmail ?? null,
      action: "organization.create_failed",
      entityType: "organization",
      after: {
        naam: name,
        slug,
        melding: error?.message ?? "onbekende fout",
        details: error?.details ?? null,
        code: error?.code ?? null,
      },
    });

    return {
      ok: false,
      message:
        "Het aanmaken lukte niet. Neem contact op met Skool Workshop, dan zetten wij uw organisatie klaar.",
      technicalReason: error?.message ?? "onbekende fout",
    };
  }

  await recordAudit({
    actorId: params.actorId ?? null,
    actorEmail: params.actorEmail ?? null,
    action: "organization.created",
    entityType: "organization",
    entityId: data.id,
    organizationId: data.id,
    after: { name, slug },
  });

  return { ok: true, organizationId: data.id };
}

/** Accepteert een uitnodiging. Het token zelf staat nooit in de database. */
export async function acceptInvite(params: {
  token: string;
  userId: string;
  userEmail: string;
}): Promise<{ ok: boolean; message?: string; organizationId?: string }> {
  const supabase = createServiceSupabase();
  const tokenHash = hashToken(params.token);

  const { data: invite } = await supabase
    .from("organization_invites")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!invite) return { ok: false, message: "Deze uitnodiging is niet geldig." };
  if (invite.revoked_at) return { ok: false, message: "Deze uitnodiging is ingetrokken." };
  if (invite.accepted_at) return { ok: false, message: "Deze uitnodiging is al gebruikt." };
  if (new Date(invite.expires_at) < new Date()) {
    return { ok: false, message: "Deze uitnodiging is verlopen. Vraag een nieuwe aan." };
  }
  if (invite.email.toLowerCase() !== params.userEmail.toLowerCase()) {
    return {
      ok: false,
      message: "Deze uitnodiging is voor een ander e-mailadres. Log in met dat adres.",
    };
  }

  const { error } = await supabase.from("organization_members").upsert(
    {
      organization_id: invite.organization_id,
      user_id: params.userId,
      role: invite.role,
      status: "active",
      source: "invite",
      invited_by: invite.created_by,
      approved_by: invite.created_by,
      approved_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,user_id" }
  );

  if (error) return { ok: false, message: "Uitnodiging kon niet worden verwerkt." };

  await supabase
    .from("organization_invites")
    .update({ accepted_at: new Date().toISOString(), accepted_by: params.userId })
    .eq("id", invite.id);

  await supabase.rpc("ensure_loyalty_account", {
    p_org: invite.organization_id,
    p_actor: params.userId,
  });

  await supabase.from("organization_contacts").upsert(
    {
      organization_id: invite.organization_id,
      email: params.userEmail.toLowerCase(),
      user_id: params.userId,
      is_verified: true,
      verified_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,email" }
  );

  await recordAudit({
    actorId: params.userId,
    actorEmail: params.userEmail,
    actorRole: "klant",
    action: "organization_invite.accepted",
    entityType: "organization_invite",
    entityId: invite.id,
    organizationId: invite.organization_id,
  });

  return { ok: true, organizationId: invite.organization_id };
}
