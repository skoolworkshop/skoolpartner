import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createServerSupabase } from "@/lib/supabase/server";
import type { MembershipRole, OrganizationRow, ProfileRow } from "@/lib/types/database";

export interface ActiveMembership {
  organization: Pick<OrganizationRow, "id" | "name" | "slug" | "kind" | "status" | "skoolpartner_enrolled_at">;
  role: MembershipRole;
}

export interface SessionContext {
  userId: string;
  email: string;
  profile: ProfileRow | null;
  memberships: ActiveMembership[];
  pendingMemberships: { organizationId: string; organizationName: string }[];
  isAdmin: boolean;
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
      "role, status, organization_id, organizations!inner(id, name, slug, kind, status, skoolpartner_enrolled_at)"
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
    email: profile?.email ?? user.email ?? "",
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

/**
 * Vereist een ingelogde gebruiker met minimaal één actieve organisatie.
 * Zonder organisatie gaat de gebruiker naar de onboarding.
 *
 * Bij meerdere organisaties bepaalt een cookie welke actief is. De cookie
 * wordt altijd gevalideerd tegen de daadwerkelijke lidmaatschappen, dus een
 * gemanipuleerde waarde geeft nooit toegang tot een andere organisatie.
 */
export async function requireMember(): Promise<
  SessionContext & { activeOrganizationId: string; activeMembership: ActiveMembership }
> {
  const context = await requireUser();
  if (context.memberships.length === 0) {
    // Een beheerder hoort niet in de klantonboarding thuis.
    if (context.isAdmin) redirect("/admin");
    redirect(context.pendingMemberships.length > 0 ? "/wachten" : "/aanmelden");
  }

  const cookieStore = await cookies();
  const preferred = cookieStore.get(ACTIVE_ORGANIZATION_COOKIE)?.value;
  const active =
    context.memberships.find((m) => m.organization.id === preferred) ?? context.memberships[0];

  return { ...context, activeOrganizationId: active.organization.id, activeMembership: active };
}

/** Vereist adminrechten. */
export async function requireAdmin(): Promise<SessionContext> {
  const context = await requireUser();
  if (!context.isAdmin) redirect("/geen-toegang");
  return context;
}
