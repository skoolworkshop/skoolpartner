import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import {
  bookingMoment,
  bookingQualifiesForPoints,
  invoiceBelongsToPeriod,
} from "@/lib/loyalty/period";
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
  user_id: null,
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
 *
 * Daarnaast geldt overal de SkoolPartner-periode: wat van vóór het startmoment
 * van deze organisatie dateert, tonen wij niet. Dat is geen technische keuze
 * maar een afspraak met de klant. Het startmoment staat in
 * loyalty_accounts.enrolled_at en wordt hier opgehaald via enrolledAt().
 */

/**
 * De gedeelde gegevens van de organisatie zelf.
 *
 * Draait onder de sessie van de gebruiker, dus RLS bepaalt wat er terugkomt.
 * Een organisatie waar iemand geen lid van is, levert altijd niets op.
 */
export async function getOrganizationDetails(organizationId: string) {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("organizations")
    .select("id, name, logo_url, logo_source, website, phone, address_line, street, house_number, house_number_addition, postal_code, city, cjp_school_number, has_cjp")
    .eq("id", organizationId)
    .maybeSingle();

  return (
    data ?? {
      id: organizationId,
      name: "Onbekende organisatie",
      logo_url: null,
      logo_source: null,
      website: null,
      phone: null,
      address_line: null,
      street: null,
      house_number: null,
      house_number_addition: null,
      postal_code: null,
      city: null,
      cjp_school_number: null,
      has_cjp: null,
    }
  );
}

/** Het startmoment van deze organisatie, of null als zij niet deelneemt. */
export async function getEnrolledAt(organizationId: string): Promise<string | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("loyalty_accounts")
    .select("enrolled_at")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return data?.enrolled_at ?? null;
}

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
  const enrolledAt = await getEnrolledAt(organizationId);
  if (!enrolledAt) return [];

  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("bookings")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("status", "confirmed")
    .gte("scheduled_date", today)
    .order("scheduled_date", { ascending: true })
    .limit(limit + 25);

  return withinPeriod(data as BookingRow[] | null, enrolledAt).slice(0, limit);
}

/**
 * Filtert boekingen op de SkoolPartner-periode.
 *
 * Wij halen er iets meer op dan nodig en filteren daarna, omdat de grens op
 * booked_at ligt en de sortering op de workshopdatum. Zonder die marge zou een
 * oude boeking een nieuwe uit de lijst kunnen duwen.
 */
function withinPeriod(rows: BookingRow[] | null, enrolledAt: string): BookingRow[] {
  return (rows ?? []).filter((booking) => bookingQualifiesForPoints(booking, enrolledAt));
}

export async function getPastBookings(organizationId: string, limit = 50) {
  const supabase = await createServerSupabase();
  const enrolledAt = await getEnrolledAt(organizationId);
  if (!enrolledAt) return [];

  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("bookings")
    .select("*")
    .eq("organization_id", organizationId)
    .or(`scheduled_date.lt.${today},status.eq.completed,status.eq.cancelled`)
    .order("scheduled_date", { ascending: false })
    .limit(limit + 25);

  return withinPeriod(data as BookingRow[] | null, enrolledAt).slice(0, limit);
}

/**
 * Facturen binnen de SkoolPartner-periode.
 *
 * Een factuur hoort erbij als de boeking waaruit zij voortkomt binnen de
 * periode valt. Is er geen boeking gekoppeld, dan kijken wij naar de
 * factuurdatum. De boeking gaat voor: een factuur van 20 september bij een
 * boeking van 1 september hoort niet bij SkoolPartner, ook al ligt de
 * factuurdatum na het startmoment.
 */
export async function getInvoices(organizationId: string, limit = 50) {
  const supabase = await createServerSupabase();
  const enrolledAt = await getEnrolledAt(organizationId);
  if (!enrolledAt) return [];

  const { data } = await supabase
    .from("invoices")
    .select("*, booking_invoices(bookings(booked_at, created_at))")
    .eq("organization_id", organizationId)
    .order("invoice_date", { ascending: false, nullsFirst: false })
    .limit(limit);

  const rows = (data ?? []) as unknown as (InvoiceRow & {
    booking_invoices?: { bookings: { booked_at: string | null; created_at: string } | null }[];
  })[];

  return rows
    .filter((invoice) => {
      const boeking = invoice.booking_invoices?.find((link) => link.bookings)?.bookings;
      return invoiceBelongsToPeriod(
        invoice,
        enrolledAt,
        boeking ? bookingMoment(boeking) : undefined
      );
    })
    .map((invoice) => {
      const kopie = { ...invoice } as Partial<typeof invoice>;
      delete kopie.booking_invoices;
      return kopie as InvoiceRow;
    });
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

/** Inwisselverzoeken met de workshop erbij, zodat de klant ziet waar het voordeel heen ging. */
export async function getRedemptionRequests(organizationId: string, limit = 20) {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("redemption_requests")
    .select("*, bookings(workshop_name, scheduled_date)")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as RedemptionWithBooking[];
}

export type RedemptionWithBooking = RedemptionRequestRow & {
  bookings: { workshop_name: string; scheduled_date: string | null } | null;
};

/** Gesprekken binnen de SkoolPartner-periode. Oudere mailhistorie blijft weg. */
export async function getMessageThreads(organizationId: string, limit = 30) {
  const supabase = await createServerSupabase();
  const enrolledAt = await getEnrolledAt(organizationId);
  if (!enrolledAt) return [];

  const { data } = await supabase
    .from("message_threads")
    .select("*")
    .eq("organization_id", organizationId)
    .in("visibility", ["auto_allowed", "manual_allowed"])
    .gte("last_message_at", enrolledAt)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  return (data ?? []) as MessageThreadRow[];
}

export async function getThreadWithMessages(organizationId: string, threadId: string) {
  const supabase = await createServerSupabase();

  const enrolledAt = await getEnrolledAt(organizationId);
  if (!enrolledAt) return null;

  const { data: thread } = await supabase
    .from("message_threads")
    .select("*")
    .eq("id", threadId)
    .eq("organization_id", organizationId)
    .in("visibility", ["auto_allowed", "manual_allowed"])
    .gte("last_message_at", enrolledAt)
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
/**
 * Het welkomsttegoed van deze organisatie, als het er is.
 *
 * Gebruikt om net na de registratie te laten zien dat de eerste punten
 * klaarstaan. Er is er per organisatie maar één, want de database staat er ook
 * maar één toe.
 */
export async function getWelcomeBonus(organizationId: string) {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("loyalty_transactions")
    .select("id, points, point_value_cents_per_100, created_at")
    .eq("organization_id", organizationId)
    .eq("type", "welcome_bonus")
    .maybeSingle();

  if (!data) return null;

  // "Net geregistreerd" bepalen wij hier en niet in de pagina, zodat de
  // dashboardcomponent geen klok hoeft te raadplegen tijdens het renderen.
  const VEERTIEN_DAGEN = 14 * 24 * 60 * 60 * 1000;
  return {
    ...data,
    isRecent: Date.now() - new Date(data.created_at).getTime() < VEERTIEN_DAGEN,
  };
}

export async function getDashboardData(organizationId: string) {
  const [balance, upcoming, invoices, threads] = await Promise.all([
    getLoyaltyBalance(organizationId),
    getUpcomingBookings(organizationId, 3),
    getInvoices(organizationId, 3),
    getMessageThreads(organizationId, 3),
  ]);

  return { balance, upcoming, invoices, threads };
}
