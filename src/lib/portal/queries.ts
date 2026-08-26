import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import type {
  BookingRow,
  InvoiceRow,
  LoyaltyBalanceRow,
  LoyaltyTransactionRow,
  MessageThreadRow,
  RedemptionRequestRow,
} from "@/lib/types/database";

const EMPTY_BALANCE: LoyaltyBalanceRow = {
  organization_id: "",
  account_id: "",
  enrolled_at: new Date().toISOString(),
  is_active: false,
  available_points: 0,
  pending_points: 0,
  reserved_points: 0,
  redeemed_points: 0,
  expired_points: 0,
  lifetime_earned_points: 0,
  last_earned_at: null,
};

/**
 * Alle queries hieronder draaien onder de sessie van de gebruiker. Row Level
 * Security in Supabase bepaalt wat er terugkomt: een organisatie-ID dat niet
 * bij de gebruiker hoort levert altijd een leeg resultaat op, ook als iemand
 * dat ID handmatig invult.
 */

export async function getLoyaltyBalance(organizationId: string): Promise<LoyaltyBalanceRow> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("loyalty_balances")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();

  return data ?? { ...EMPTY_BALANCE, organization_id: organizationId };
}

/**
 * Aankomende workshops: uitsluitend boekingen waarvan vaststaat dat ze
 * doorgaan. Aanvragen, offertes, concepten en annuleringen horen hier niet
 * thuis, want die kan een klant niet als zekerheid inplannen. In de database
 * is dat precies status 'confirmed'; 'concept' dekt alles wat nog in
 * voorbereiding is en 'cancelled' spreekt voor zich.
 *
 * Conceptboekingen tonen wij bewust nergens in het klantportaal. Een aanvraag
 * die nog loopt hoort thuis in het contact met Skool Workshop, niet als regel
 * in het overzicht van de klant. In de beheeromgeving zijn ze wel gewoon
 * zichtbaar.
 */
export async function getUpcomingBookings(organizationId: string, limit = 5) {
  const supabase = await createServerSupabase();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("bookings")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("status", "confirmed")
    .gte("scheduled_date", today)
    .order("scheduled_date", { ascending: true })
    .limit(limit);
  return (data ?? []) as BookingRow[];
}

export async function getPastBookings(organizationId: string, limit = 50) {
  const supabase = await createServerSupabase();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("bookings")
    .select("*")
    .eq("organization_id", organizationId)
    .or(`scheduled_date.lt.${today},status.eq.completed,status.eq.cancelled`)
    .order("scheduled_date", { ascending: false })
    .limit(limit);
  return (data ?? []) as BookingRow[];
}

export async function getInvoices(organizationId: string, limit = 50) {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("invoices")
    .select("*")
    .eq("organization_id", organizationId)
    .order("invoice_date", { ascending: false, nullsFirst: false })
    .limit(limit);
  return (data ?? []) as InvoiceRow[];
}

export async function getLoyaltyTransactions(organizationId: string, limit = 50) {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("loyalty_transactions")
    .select("*")
    .eq("organization_id", organizationId)
    .not("status", "in", '("cancelled")')
    .order("occurred_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as LoyaltyTransactionRow[];
}

export async function getRedemptionRequests(organizationId: string, limit = 20) {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("redemption_requests")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as RedemptionRequestRow[];
}

export async function getMessageThreads(organizationId: string, limit = 30) {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("message_threads")
    .select("*")
    .eq("organization_id", organizationId)
    .in("visibility", ["auto_allowed", "manual_allowed"])
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  return (data ?? []) as MessageThreadRow[];
}

export async function getThreadWithMessages(organizationId: string, threadId: string) {
  const supabase = await createServerSupabase();

  const { data: thread } = await supabase
    .from("message_threads")
    .select("*")
    .eq("id", threadId)
    .eq("organization_id", organizationId)
    .in("visibility", ["auto_allowed", "manual_allowed"])
    .maybeSingle();

  if (!thread) return null;

  const { data: messages } = await supabase
    .from("messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("sent_at", { ascending: true });

  return { thread: thread as MessageThreadRow, messages: messages ?? [] };
}

/** Alles wat het dashboard nodig heeft, in één keer opgehaald. */
export async function getDashboardData(organizationId: string) {
  const [balance, upcoming, invoices, threads] = await Promise.all([
    getLoyaltyBalance(organizationId),
    getUpcomingBookings(organizationId, 3),
    getInvoices(organizationId, 3),
    getMessageThreads(organizationId, 3),
  ]);

  return { balance, upcoming, invoices, threads };
}
