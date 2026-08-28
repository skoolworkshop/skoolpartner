import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";
import type { MembershipRole, OrganizationRow, ProfileRow } from "@/lib/types/database";

export interface ActiveMembership {
  organization: Pick<
    OrganizationRow,
    | "id"
    | "name"
    | "slug"
    | "kind"
    | "status"
    | "logo_url"
    | "cjp_school_number"
    | "has_cjp"
    | "skoolpartner_enrolled_at"
    | "verified_at"
  >;
  role: MembershipRole;
}

export interface SessionContext {
  userId: string;
  /**
   * Het e-mailadres waarmee daadwerkelijk is ingelogd, uit Supabase Auth.
   *
   * Bewust niet het adres uit profiles: dat veld kan een gebruiker zelf
   * aanpassen. Zou je dat gebruiken voor toegang, dan zou iemand met een
   * zelfgekozen adres bij een andere school in beeld kunnen komen.
   */
  email: string;
  profile: ProfileRow | null;
  memberships: ActiveMembership[];
  pendingMemberships: { organizationId: string; organizationName: string }[];
  isAdmin: boolean;
}

export interface CustomerPreview {
  active: true;
  userId: string;
  userName: string;
  userEmail: string;
}

/**
 * Haalt de volledige sessiecontext op. Gecached per request.
 * Gebruikt altijd getUser() (geverifieerd bij Supabase), nooit getSession().
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  const { data: memberRows } = await supabase
    .from("organization_members")
    .select(
      "role, status, organization_id, organizations!inner(id, name, slug, kind, status, logo_url, cjp_school_number, has_cjp, skoolpartner_enrolled_at, verified_at)"
    )
    .eq("user_id", user.id);

  const rows = (memberRows ?? []) as unknown as {
    role: MembershipRole;
    status: string;
    organization_id: string;
    organizations: ActiveMembership["organization"];
  }[];

  const memberships: ActiveMembership[] = rows
    .filter((r) => r.status === "active" && r.organizations && r.organizations.status === "active")
    .map((r) => ({ organization: r.organizations, role: r.role }));

  const pendingMemberships = rows
    .filter((r) => r.status === "pending")
    .map((r) => ({
      organizationId: r.organization_id,
      organizationName: r.organizations?.name ?? "Onbekende organisatie",
    }));

  return {
    userId: user.id,
    email: user.email ?? profile?.email ?? "",
    profile: profile ?? null,
    memberships,
    pendingMemberships,
    isAdmin: Boolean(profile?.is_admin && !profile?.is_blocked),
  };
});

/** Vereist een ingelogde gebruiker. Stuurt anders door naar het inlogscherm. */
export async function requireUser(): Promise<SessionContext> {
  const context = await getSessionContext();
  if (!context) redirect("/inloggen");
  if (context.profile?.is_blocked) redirect("/geen-toegang");
  return context;
}

export const ACTIVE_ORGANIZATION_COOKIE = "mijnskool.org";
export const CUSTOMER_PREVIEW_COOKIE = "mijnskool.preview_user";

/**
 * Vereist een ingelogde gebruiker met minimaal één actieve organisatie.
 * Zonder organisatie gaat de gebruiker naar de onboarding.
 *
 * Bij meerdere organisaties bepaalt een cookie welke actief is. De cookie
 * wordt altijd gevalideerd tegen de daadwerkelijke lidmaatschappen, dus een
 * gemanipuleerde waarde geeft nooit toegang tot een andere organisatie.
 */
export async function requireMember(): Promise<
  SessionContext & {
    activeOrganizationId: string;
    activeMembership: ActiveMembership;
    customerPreview: CustomerPreview | null;
  }
> {
  let context = await requireUser();
  let customerPreview: CustomerPreview | null = null;
  const cookieStore = await cookies();

  // Een beheerder kan een klantportaal read-only bekijken. De cookie is nooit
  // voldoende op zichzelf: alleen een op dit moment geautoriseerde beheerder
  // komt in deze tak, en het doelaccount wordt opnieuw server-side opgezocht.
  const previewUserId = context.isAdmin
    ? cookieStore.get(CUSTOMER_PREVIEW_COOKIE)?.value ?? null
    : null;

  if (previewUserId) {
    const service = createServiceSupabase();
    const [{ data: profile }, { data: memberRows }] = await Promise.all([
      service.from("profiles").select("*").eq("id", previewUserId).maybeSingle(),
      service
        .from("organization_members")
        .select(
          "role, status, organization_id, organizations!inner(id, name, slug, kind, status, logo_url, cjp_school_number, has_cjp, skoolpartner_enrolled_at, verified_at)"
        )
        .eq("user_id", previewUserId),
    ]);

    const rows = (memberRows ?? []) as unknown as {
      role: MembershipRole;
      status: string;
      organization_id: string;
      organizations: ActiveMembership["organization"];
    }[];
    const memberships = rows
      .filter((row) => row.status === "active" && row.organizations?.status === "active")
      .map((row) => ({ organization: row.organizations, role: row.role }));

    if (profile && !profile.is_admin && !profile.is_blocked && memberships.length > 0) {
      context = {
        ...context,
        userId: profile.id,
        email: profile.email,
        profile,
        memberships,
        pendingMemberships: [],
      };
      customerPreview = {
        active: true,
        userId: profile.id,
        userName: profile.full_name ?? profile.email,
        userEmail: profile.email,
      };
    }
  }

  if (context.memberships.length === 0) {
    // Een beheerder hoort niet in de klantonboarding thuis.
    if (context.isAdmin) redirect("/admin");
    redirect(context.pendingMemberships.length > 0 ? "/wachten" : "/aanmelden");
  }

  const preferred = cookieStore.get(ACTIVE_ORGANIZATION_COOKIE)?.value;
  const active =
    context.memberships.find((m) => m.organization.id === preferred) ?? context.memberships[0];

  return {
    ...context,
    activeOrganizationId: active.organization.id,
    activeMembership: active,
    customerPreview,
  };
}

/** Vereist adminrechten. */
export async function requireAdmin(): Promise<SessionContext> {
  const context = await requireUser();
  if (!context.isAdmin) redirect("/geen-toegang");
  return context;
}
