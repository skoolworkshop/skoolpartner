import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Integratietest voor Row Level Security.
 *
 * Deze test draait tegen een ECHT Supabase-project. Zonder de benodigde
 * environment variables wordt hij overgeslagen, zodat `npm test` altijd werkt.
 *
 * Draai hem tegen een ontwikkel- of testproject, nooit tegen productie:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   npm run test:rls
 *
 * De test controleert het belangrijkste beveiligingsprincipe van SkoolPartner:
 * gebruiker A mag nooit gegevens van organisatie B kunnen ophalen, ook niet
 * door handmatig een ander UUID in te vullen.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const configured = Boolean(url && anonKey && serviceKey);
const suite = configured ? describe : describe.skip;

const stamp = Date.now();
const userA = { email: `rls-a-${stamp}@voorbeeld-test.nl`, password: `Test!${stamp}aA` };
const userB = { email: `rls-b-${stamp}@voorbeeld-test.nl`, password: `Test!${stamp}bB` };

suite("Row Level Security", () => {
  let admin: SupabaseClient;
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;

  let orgA = "";
  let orgB = "";
  let userAId = "";
  let userBId = "";
  let bookingA = "";
  let invoiceA = "";
  let threadA = "";

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: orgs, error: orgError } = await admin
      .from("organizations")
      .insert([
        { name: `RLS Test A ${stamp}`, slug: `rls-test-a-${stamp}` },
        { name: `RLS Test B ${stamp}`, slug: `rls-test-b-${stamp}` },
      ])
      .select("id, name");
    if (orgError) throw orgError;

    orgA = orgs!.find((o) => o.name.includes("A"))!.id;
    orgB = orgs!.find((o) => o.name.includes("B"))!.id;

    const created = await Promise.all([
      admin.auth.admin.createUser({ ...userA, email_confirm: true }),
      admin.auth.admin.createUser({ ...userB, email_confirm: true }),
    ]);
    userAId = created[0].data.user!.id;
    userBId = created[1].data.user!.id;

    await admin.from("organization_members").insert([
      { organization_id: orgA, user_id: userAId, role: "lid", status: "active", source: "admin_manual" },
      { organization_id: orgB, user_id: userBId, role: "lid", status: "active", source: "admin_manual" },
    ]);

    await admin.rpc("ensure_loyalty_account", { p_org: orgA, p_actor: null });

    const { data: booking } = await admin
      .from("bookings")
      .insert({
        organization_id: orgA,
        workshop_name: "RLS Testworkshop",
        workshop_count: 4,
        minutes_per_workshop: 90,
        qualifying_minutes: 360,
        scheduled_date: "2026-06-01",
        status: "confirmed",
        origin: "admin_manual",
      })
      .select("id")
      .single();
    bookingA = booking!.id;

    const { data: invoice } = await admin
      .from("invoices")
      .insert({
        organization_id: orgA,
        moneybird_invoice_id: `rls-test-${stamp}`,
        invoice_number: `RLS-${stamp}`,
        state: "paid",
        total_incl_cents: 125000,
        fully_paid: true,
      })
      .select("id")
      .single();
    invoiceA = invoice!.id;

    const { data: thread } = await admin
      .from("message_threads")
      .insert({
        organization_id: orgA,
        gmail_thread_id: `rls-thread-${stamp}`,
        subject: "RLS test thread",
        visibility: "auto_allowed",
      })
      .select("id")
      .single();
    threadA = thread!.id;

    clientA = createClient(url!, anonKey!, { auth: { persistSession: false } });
    clientB = createClient(url!, anonKey!, { auth: { persistSession: false } });
    await clientA.auth.signInWithPassword(userA);
    await clientB.auth.signInWithPassword(userB);
  }, 60_000);

  afterAll(async () => {
    if (!configured) return;
    await admin.from("message_threads").delete().eq("id", threadA);
    await admin.from("invoices").delete().eq("id", invoiceA);
    await admin.from("bookings").delete().eq("id", bookingA);
    await admin.from("loyalty_transactions").delete().eq("organization_id", orgA);
    await admin.from("loyalty_accounts").delete().eq("organization_id", orgA);
    await admin.from("organization_members").delete().in("organization_id", [orgA, orgB]);
    await admin.from("organizations").delete().in("id", [orgA, orgB]);
    if (userAId) await admin.auth.admin.deleteUser(userAId);
    if (userBId) await admin.auth.admin.deleteUser(userBId);
  }, 60_000);

  it("gebruiker A ziet de eigen boekingen", async () => {
    const { data } = await clientA.from("bookings").select("id").eq("organization_id", orgA);
    expect(data?.length).toBe(1);
  });

  it("gebruiker B ziet GEEN boekingen van organisatie A", async () => {
    const { data } = await clientB.from("bookings").select("id").eq("organization_id", orgA);
    expect(data ?? []).toHaveLength(0);
  });

  it("gebruiker B ziet de boeking ook niet via het directe ID", async () => {
    const { data } = await clientB.from("bookings").select("id").eq("id", bookingA);
    expect(data ?? []).toHaveLength(0);
  });

  it("gebruiker B ziet geen facturen van organisatie A", async () => {
    const { data } = await clientB.from("invoices").select("id").eq("id", invoiceA);
    expect(data ?? []).toHaveLength(0);
  });

  it("gebruiker B ziet geen berichten van organisatie A", async () => {
    const { data } = await clientB.from("message_threads").select("id").eq("id", threadA);
    expect(data ?? []).toHaveLength(0);
  });

  it("gebruiker B ziet het saldo van organisatie A niet", async () => {
    const { data } = await clientB
      .from("loyalty_balances")
      .select("organization_id")
      .eq("organization_id", orgA);
    expect(data ?? []).toHaveLength(0);
  });

  it("gebruiker B kan geen inwisselverzoek indienen voor organisatie A", async () => {
    const { error } = await clientB.rpc("request_redemption", {
      p_org: orgA,
      p_points: 500,
      p_booking_reference: null,
      p_note: null,
    });
    expect(error).toBeTruthy();
  });

  it("niemand komt bij de opgeslagen integratietokens", async () => {
    const { data } = await clientA.from("integration_credentials").select("id");
    expect(data ?? []).toHaveLength(0);
  });

  it("een klant ziet geen rauwe bronmail", async () => {
    const { data } = await clientA.from("booking_sources").select("id");
    expect(data ?? []).toHaveLength(0);
  });

  it("een klant kan zichzelf geen beheerder maken", async () => {
    const { error } = await clientA.from("profiles").update({ is_admin: true }).eq("id", userAId);
    expect(error).toBeTruthy();
  });

  it("een publiek e-maildomein kan niet aan een organisatie worden gekoppeld", async () => {
    const { error } = await admin
      .from("organization_domains")
      .insert({ organization_id: orgA, domain: "gmail.com", is_verified: true });
    expect(error).toBeTruthy();
  });
});

if (!configured) {
  describe("Row Level Security", () => {
    it.skip("overgeslagen: stel NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY en SUPABASE_SERVICE_ROLE_KEY in", () => {
      /* zie de uitleg bovenaan dit bestand */
    });
  });
}
