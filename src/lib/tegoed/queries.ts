import "server-only";

import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";
import type {
  CjpCreditBalanceRow,
  CjpCreditTransactionRow,
  CjpParkingRequestRow,
} from "@/lib/types/database";

/** Het lege saldo. Handig als er nog nooit iets is geparkeerd. */
export const LEEG_SALDO: Omit<CjpCreditBalanceRow, "organization_id"> = {
  available_cents: 0,
  added_cents: 0,
  spent_cents: 0,
  last_movement_at: null,
};

export type CreditTransactionWithBooking = CjpCreditTransactionRow & {
  bookings: { workshop_name: string; scheduled_date: string | null; reference: string | null } | null;
};

/* -------------------------------------------------------------------------- */
/* Voor de klant                                                               */
/* -------------------------------------------------------------------------- */
/* Deze queries draaien met de rechten van de ingelogde gebruiker. Row Level   */
/* Security zorgt ervoor dat hij nooit het tegoed van een andere school ziet.  */

export async function getCreditBalance(organizationId: string) {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("cjp_credit_balances")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();

  return { organization_id: organizationId, ...LEEG_SALDO, ...(data ?? {}) } as CjpCreditBalanceRow;
}

export async function getParkingRequests(organizationId: string, limit = 25) {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("cjp_parking_requests")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as CjpParkingRequestRow[];
}

/**
 * De tegoedhistorie: elke bij- en afboeking, met de boeking erbij waar het
 * tegoed aan is besteed.
 */
export async function getCreditTransactions(organizationId: string, limit = 50) {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("cjp_credit_transactions")
    .select("*, bookings(workshop_name, scheduled_date, reference)")
    .eq("organization_id", organizationId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as CreditTransactionWithBooking[];
}

/** Staat er nog een aanvraag open? Dan waarschuwen wij voor een dubbele. */
export function heeftOpenAanvraag(requests: CjpParkingRequestRow[]): CjpParkingRequestRow | null {
  return requests.find((r) => r.status === "requested" || r.status === "in_review") ?? null;
}

/* -------------------------------------------------------------------------- */
/* Voor de beheerder                                                           */
/* -------------------------------------------------------------------------- */
/* Met de service role, dus buiten RLS om. Elke pagina die dit gebruikt roept  */
/* eerst requireAdmin() aan.                                                   */

export type AdminParkingRequest = CjpParkingRequestRow & {
  organizations: { id: string; name: string; cjp_school_number: string | null } | null;
};

export async function listParkingRequests(filter?: "open" | "all") {
  const supabase = createServiceSupabase();
  let request = supabase
    .from("cjp_parking_requests")
    .select("*, organizations(id, name, cjp_school_number)")
    .order("created_at", { ascending: false })
    .limit(200);

  if (filter === "open") request = request.in("status", ["requested", "in_review"]);

  const { data } = await request;
  return (data ?? []) as unknown as AdminParkingRequest[];
}

export async function getParkingRequestForAdmin(id: string) {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("cjp_parking_requests")
    .select("*, organizations(id, name, cjp_school_number)")
    .eq("id", id)
    .maybeSingle();
  return (data ?? null) as unknown as AdminParkingRequest | null;
}

export async function getCreditBalanceForAdmin(organizationId: string) {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("cjp_credit_balances")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return { organization_id: organizationId, ...LEEG_SALDO, ...(data ?? {}) } as CjpCreditBalanceRow;
}

export async function getCreditTransactionsForAdmin(organizationId: string, limit = 100) {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("cjp_credit_transactions")
    .select("*, bookings(workshop_name, scheduled_date, reference)")
    .eq("organization_id", organizationId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as CreditTransactionWithBooking[];
}

/** Alle organisaties die op dit moment tegoed hebben staan. */
export async function listOrganizationsWithCredit() {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("cjp_credit_balances")
    .select("*")
    .gt("added_cents", 0)
    .order("available_cents", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as CjpCreditBalanceRow[];
  if (rows.length === 0) return [];

  const { data: orgs } = await supabase
    .from("organizations")
    .select("id, name")
    .in(
      "id",
      rows.map((r) => r.organization_id)
    );

  const namen = new Map((orgs ?? []).map((o) => [o.id, o.name]));
  return rows.map((row) => ({ ...row, name: namen.get(row.organization_id) ?? "Onbekend" }));
}

/** De bevestigde workshops waar tegoed op afgeboekt kan worden. */
export async function listBookingsForSpending(organizationId: string) {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("bookings")
    .select("id, workshop_name, scheduled_date, reference")
    .eq("organization_id", organizationId)
    .in("status", ["confirmed", "completed"])
    .order("scheduled_date", { ascending: false })
    .limit(50);
  return data ?? [];
}

export async function countOpenParkingRequests() {
  const supabase = createServiceSupabase();
  const { count } = await supabase
    .from("cjp_parking_requests")
    .select("id", { count: "exact", head: true })
    .in("status", ["requested", "in_review"]);
  return count ?? 0;
}
