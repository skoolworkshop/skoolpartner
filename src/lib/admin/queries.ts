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

  // Tweede ronde: de totalen die de beheerder in één oogopslag wil zien.
  const [bookings, invoices, threadsNeedingReview, unpaid] = await Promise.all([
    supabase.from("bookings").select("id", { count: "exact", head: true }),
    supabase.from("invoices").select("id", { count: "exact", head: true }),
    supabase
      .from("message_threads")
      .select("id", { count: "exact", head: true })
      .eq("visibility", "needs_review"),
    supabase.from("invoices").select("total_unpaid_cents").eq("fully_paid", false).limit(1000),
  ]);

  const unpaidRows = (unpaid.data ?? []) as { total_unpaid_cents: number }[];

  return {
    reviewQueue: reviewQueue.count ?? 0,
    pendingMembers: pendingMembers.count ?? 0,
    openRedemptions: openRedemptions.count ?? 0,
    invoicesNeedingReview: invoicesNeedingReview.count ?? 0,
    bookingsNeedingReview: bookingsNeedingReview.count ?? 0,
    organizations: organizations.count ?? 0,
    users: users.count ?? 0,
    bookings: bookings.count ?? 0,
    invoices: invoices.count ?? 0,
    threadsNeedingReview: threadsNeedingReview.count ?? 0,
    unpaidCents: unpaidRows.reduce((sum, row) => sum + (row.total_unpaid_cents ?? 0), 0),
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

/** Scholen die zich zelf hebben aangemeld en nog gekoppeld moeten worden. */
export async function listUnverifiedOrganizations() {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("organizations")
    .select("*")
    .is("verified_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  return data ?? [];
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

  const [organization, members, domains, contacts, balance, bookings, invoices, threads] =
    await Promise.all([
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
      .limit(100),
    supabase
      .from("invoices")
      .select("*")
      .eq("organization_id", id)
      .order("invoice_date", { ascending: false })
      .limit(100),
    supabase
      .from("message_threads")
      .select("id, subject, visibility, message_count, last_message_at")
      .eq("organization_id", id)
      .order("last_message_at", { ascending: false, nullsFirst: false })
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
    threads: threads.data ?? [],
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

/**
 * Alle facturen van alle organisaties. De beheerder moet hier hetzelfde zien
 * als de klant in zijn eigen portaal, plus de facturen die nog aan geen enkele
 * organisatie gekoppeld zijn.
 */
export async function listInvoices(options?: { filter?: "review" | "unpaid" | "all"; query?: string }) {
  const supabase = createServiceSupabase();
  let request = supabase
    .from("invoices")
    .select("*, organizations(name)")
    .order("invoice_date", { ascending: false, nullsFirst: false })
    .limit(200);

  if (options?.filter === "review") request = request.eq("needs_review", true);
  if (options?.filter === "unpaid") request = request.eq("fully_paid", false);

  const term = options?.query?.trim();
  if (term && term.length >= 2) request = request.ilike("invoice_number", `%${term}%`);

  const { data } = await request;
  return data ?? [];
}

/** Alle e-mailgesprekken, ook die nog geen organisatie hebben. */
export async function listMessageThreads(options?: { filter?: "review" | "all" }) {
  const supabase = createServiceSupabase();
  let request = supabase
    .from("message_threads")
    .select("*, organizations(name)")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(150);

  if (options?.filter === "review") request = request.eq("visibility", "needs_review");

  const { data } = await request;
  return data ?? [];
}

export async function getMessageThreadForAdmin(id: string) {
  const supabase = createServiceSupabase();
  const { data: thread } = await supabase
    .from("message_threads")
    .select("*, organizations(id, name)")
    .eq("id", id)
    .maybeSingle();
  if (!thread) return null;

  const { data: messages } = await supabase
    .from("messages")
    .select("*")
    .eq("thread_id", id)
    .order("sent_at", { ascending: true });

  return { thread, messages: messages ?? [] };
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

/**
 * Alle inwisselverzoeken, met alles wat de beheerder nodig heeft om te
 * beoordelen en om het achteraf te kunnen aantonen: klant, organisatie,
 * boeking, workshopdatum, punten, euro's, aanvraagdatum, status en de
 * gekoppelde factuur.
 */
export async function listRedemptions() {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("redemption_requests")
    .select(
      "*, organizations(name), profiles!redemption_requests_requested_by_fkey(email, full_name), bookings(workshop_name, scheduled_date, reference)"
    )
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
