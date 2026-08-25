import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";

/**
 * Adminqueries draaien met de service role en omzeilen daarmee RLS.
 * Elke pagina die deze functies gebruikt, roept eerst requireAdmin() aan.
 */

export async function getAdminOverview() {
  const supabase = createServiceSupabase();

  const [
    reviewQueue,
    pendingMembers,
    openRedemptions,
    invoicesNeedingReview,
    bookingsNeedingReview,
    organizations,
    users,
  ] = await Promise.all([
    supabase
      .from("booking_sources")
      .select("id", { count: "exact", head: true })
      .eq("match_status", "needs_review"),
    supabase
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("redemption_requests")
      .select("id", { count: "exact", head: true })
      .in("status", ["requested", "approved"]),
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("needs_review", true),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("needs_review", true),
    supabase.from("organizations").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
  ]);

  return {
    reviewQueue: reviewQueue.count ?? 0,
    pendingMembers: pendingMembers.count ?? 0,
    openRedemptions: openRedemptions.count ?? 0,
    invoicesNeedingReview: invoicesNeedingReview.count ?? 0,
    bookingsNeedingReview: bookingsNeedingReview.count ?? 0,
    organizations: organizations.count ?? 0,
    users: users.count ?? 0,
  };
}

export async function getReviewQueue() {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("booking_sources")
    .select("*")
    .in("match_status", ["needs_review", "pending"])
    .order("received_at", { ascending: false })
    .limit(100);
  return data ?? [];
}

export async function getBookingSource(id: string) {
  const supabase = createServiceSupabase();
  const { data } = await supabase.from("booking_sources").select("*").eq("id", id).maybeSingle();
  return data;
}

export async function listOrganizations(query?: string) {
  const supabase = createServiceSupabase();
  let request = supabase
    .from("organizations")
    .select("*")
    .order("name")
    .limit(200);
  if (query && query.trim().length >= 2) {
    request = request.ilike("name", `%${query.trim()}%`);
  }
  const { data } = await request;
  return data ?? [];
}

export async function getOrganizationDetail(id: string) {
  const supabase = createServiceSupabase();

  const [organization, members, domains, contacts, balance, bookings, invoices] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("organization_members")
      .select("*, profiles(email, full_name)")
      .eq("organization_id", id)
      .order("created_at"),
    supabase.from("organization_domains").select("*").eq("organization_id", id).order("domain"),
    supabase.from("organization_contacts").select("*").eq("organization_id", id).order("email"),
    supabase.from("loyalty_balances").select("*").eq("organization_id", id).maybeSingle(),
    supabase
      .from("bookings")
      .select("*")
      .eq("organization_id", id)
      .order("scheduled_date", { ascending: false })
      .limit(25),
    supabase
      .from("invoices")
      .select("*")
      .eq("organization_id", id)
      .order("invoice_date", { ascending: false })
      .limit(25),
  ]);

  if (!organization.data) return null;

  return {
    organization: organization.data,
    members: members.data ?? [],
    domains: domains.data ?? [],
    contacts: contacts.data ?? [],
    balance: balance.data,
    bookings: bookings.data ?? [],
    invoices: invoices.data ?? [],
  };
}

export async function listPendingMembers() {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("organization_members")
    .select("*, profiles(email, full_name), organizations(name)")
    .eq("status", "pending")
    .order("created_at");
  return data ?? [];
}

export async function listUsers(query?: string) {
  const supabase = createServiceSupabase();
  let request = supabase.from("profiles").select("*").order("created_at", { ascending: false }).limit(200);
  if (query && query.trim().length >= 2) {
    request = request.ilike("email", `%${query.trim()}%`);
  }
  const { data } = await request;
  return data ?? [];
}

export async function listBookings(filter?: "review" | "all") {
  const supabase = createServiceSupabase();
  let request = supabase
    .from("bookings")
    .select("*, organizations(name)")
    .order("scheduled_date", { ascending: false })
    .limit(150);
  if (filter === "review") request = request.eq("needs_review", true);
  const { data } = await request;
  return data ?? [];
}

export async function listLoyaltyTransactions(organizationId?: string) {
  const supabase = createServiceSupabase();
  let request = supabase
    .from("loyalty_transactions")
    .select("*, organizations(name)")
    .order("created_at", { ascending: false })
    .limit(150);
  if (organizationId) request = request.eq("organization_id", organizationId);
  const { data } = await request;
  return data ?? [];
}

export async function listRedemptions() {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("redemption_requests")
    .select("*, organizations(name), profiles!redemption_requests_requested_by_fkey(email)")
    .order("created_at", { ascending: false })
    .limit(150);
  return data ?? [];
}

export async function listAuditLogs(limit = 200) {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function listSettings() {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("app_settings")
    .select("*")
    .order("group_name")
    .order("sort_order");
  return data ?? [];
}
