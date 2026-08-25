/**
 * Zet een testomgeving klaar in Supabase en print twee kant-en-klare
 * inloglinks: een voor een beheerder en een voor een klant.
 *
 *   node scripts/seed-demo.mjs
 *
 * Vereist in .env.local (of als environment variables):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   NEXT_PUBLIC_SITE_URL          (bijv. http://localhost:3000)
 *
 * Optioneel:
 *   SEED_ADMIN_EMAIL              standaard info@skoolworkshop.nl
 *   SEED_CUSTOMER_EMAIL           standaard s.devries@goudsewaarden.nl
 *
 * Het script is idempotent: opnieuw draaien werkt de bestaande demodata bij
 * in plaats van dubbele records aan te maken. Draai dit uitsluitend op een
 * ontwikkel- of testproject, nooit op productie met echte klantgegevens.
 */

import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

/* --- .env.local inlezen zonder extra afhankelijkheid ---------------------- */
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "info@skoolworkshop.nl").toLowerCase();
const customerEmail = (
  process.env.SEED_CUSTOMER_EMAIL ?? "s.devries@goudsewaarden.nl"
).toLowerCase();

if (!url || !serviceKey) {
  console.error(
    "\n  NEXT_PUBLIC_SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY ontbreken.\n" +
      "  Vul ze in .env.local in en probeer het opnieuw.\n"
  );
  process.exit(1);
}

const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ORG_NAME = "De Goudse Waarden";
const ORG_SLUG = "de-goudse-waarden";
const ORG_DOMAIN = "goudsewaarden.nl";

function daysFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function check(label, { error }) {
  if (error) {
    console.error(`  fout bij ${label}: ${error.message}`);
    process.exit(1);
  }
}

/** Maakt de gebruiker aan of geeft de bestaande terug. */
async function ensureUser(email, fullName) {
  const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = list?.users?.find((u) => u.email?.toLowerCase() === email);
  if (existing) return existing.id;

  const { data, error } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) {
    console.error(`  gebruiker ${email} kon niet worden aangemaakt: ${error.message}`);
    process.exit(1);
  }
  return data.user.id;
}

async function magicLink(email) {
  const { data, error } = await db.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${siteUrl}/auth/callback?volgende=/dashboard` },
  });
  if (error) return `(link mislukt: ${error.message})`;
  return data.properties.action_link;
}

async function main() {
  console.log(`\n  Demodata klaarzetten op ${url}\n`);

  /* --- Organisatie ------------------------------------------------------- */
  // Let op: verschillende unieke indexen staan op een expressie, bijvoorbeeld
  // lower(slug) of lower(email). Daar werkt upsert met onConflict niet op, dus
  // zoeken we eerst en voegen we alleen toe wanneer het record ontbreekt.
  let orgId;
  const { data: existingOrg } = await db
    .from("organizations")
    .select("id")
    .eq("slug", ORG_SLUG)
    .maybeSingle();

  if (existingOrg) {
    orgId = existingOrg.id;
  } else {
    const { data: created, error } = await db
      .from("organizations")
      .insert({
        name: ORG_NAME,
        slug: ORG_SLUG,
        kind: "school",
        status: "active",
        city: "Gouda",
        contact_email: customerEmail,
      })
      .select("id")
      .single();
    check("organisatie aanmaken", { error });
    orgId = created.id;
  }
  console.log(`  organisatie   ${ORG_NAME}`);

  const { data: existingDomain } = await db
    .from("organization_domains")
    .select("id")
    .eq("domain", ORG_DOMAIN)
    .maybeSingle();
  if (!existingDomain) {
    await db.from("organization_domains").insert({
      organization_id: orgId,
      domain: ORG_DOMAIN,
      is_verified: true,
      verified_at: new Date().toISOString(),
    });
  }

  /* --- Gebruikers -------------------------------------------------------- */
  const adminId = await ensureUser(adminEmail, "Beheerder Skool Workshop");
  const customerId = await ensureUser(customerEmail, "Sanne de Vries");

  check(
    "beheerdersrechten",
    await db
      .from("profiles")
      .update({ is_admin: true, is_super_admin: true, is_blocked: false })
      .eq("id", adminId)
  );
  console.log(`  beheerder     ${adminEmail}`);

  check(
    "lidmaatschap klant",
    await db.from("organization_members").upsert(
      {
        organization_id: orgId,
        user_id: customerId,
        role: "beheerder",
        status: "active",
        source: "admin_manual",
        approved_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,user_id" }
    )
  );
  console.log(`  klant         ${customerEmail}`);

  const { data: existingContact } = await db
    .from("organization_contacts")
    .select("id")
    .eq("organization_id", orgId)
    .eq("email", customerEmail)
    .maybeSingle();

  if (existingContact) {
    check(
      "contactpersoon bijwerken",
      await db
        .from("organization_contacts")
        .update({ is_verified: true, user_id: customerId })
        .eq("id", existingContact.id)
    );
  } else {
    check(
      "contactpersoon",
      await db.from("organization_contacts").insert({
        organization_id: orgId,
        email: customerEmail,
        full_name: "Sanne de Vries",
        user_id: customerId,
        is_verified: true,
        verified_at: new Date().toISOString(),
      })
    );
  }

  /* --- SkoolPartner ------------------------------------------------------ */
  const { data: accountId } = await db.rpc("ensure_loyalty_account", {
    p_org: orgId,
    p_actor: adminId,
  });

  /* --- Boekingen --------------------------------------------------------- */
  const bookings = [
    {
      reference: "SW-2026-0123",
      workshop_name: "Graffiti",
      workshop_count: 4,
      minutes_per_workshop: 90,
      scheduled_date: daysFromNow(-45),
      start_time: "09:00",
      end_time: "15:00",
      location: "Kanaalstraat 5, Gouda",
      participants: 96,
      status: "completed",
    },
    {
      reference: "SW-2026-0187",
      workshop_name: "Podcast",
      workshop_count: 2,
      minutes_per_workshop: 90,
      scheduled_date: daysFromNow(-8),
      start_time: "10:00",
      end_time: "13:00",
      location: "Kanaalstraat 5, Gouda",
      participants: 48,
      status: "completed",
    },
    {
      reference: "SW-2026-0231",
      workshop_name: "Breakdance",
      workshop_count: 3,
      minutes_per_workshop: 90,
      scheduled_date: daysFromNow(21),
      start_time: "09:30",
      end_time: "14:00",
      location: "Sporthal De Mammoet, Gouda",
      participants: 72,
      status: "confirmed",
    },
  ];

  const bookingIds = {};
  for (const booking of bookings) {
    const { data: existing } = await db
      .from("bookings")
      .select("id")
      .eq("reference", booking.reference)
      .maybeSingle();

    if (existing) {
      bookingIds[booking.reference] = existing.id;
      continue;
    }
    const { data, error } = await db
      .from("bookings")
      .insert({
        ...booking,
        organization_id: orgId,
        qualifying_minutes: booking.workshop_count * booking.minutes_per_workshop,
        origin: "admin_manual",
        contact_email: customerEmail,
        contact_name: "Sanne de Vries",
        created_by: adminId,
      })
      .select("id")
      .single();
    check(`boeking ${booking.reference}`, { error });
    bookingIds[booking.reference] = data.id;
  }
  console.log(`  boekingen     ${bookings.length}`);

  /* --- Facturen ---------------------------------------------------------- */
  const invoices = [
    {
      moneybird_invoice_id: "demo-mb-2026-00123",
      invoice_number: "2026-00123",
      reference: "Cultuurdag SW-2026-0123",
      invoice_date: daysFromNow(-43),
      due_date: daysFromNow(-15),
      state: "paid",
      total_excl_cents: 103306,
      total_incl_cents: 125000,
      total_paid_cents: 125000,
      total_unpaid_cents: 0,
      paid_at: new Date(Date.now() - 20 * 86400000).toISOString(),
      fully_paid: true,
      booking: "SW-2026-0123",
    },
    {
      moneybird_invoice_id: "demo-mb-2026-00187",
      invoice_number: "2026-00187",
      reference: "Projectdag SW-2026-0187",
      invoice_date: daysFromNow(-6),
      due_date: daysFromNow(22),
      state: "open",
      total_excl_cents: 53719,
      total_incl_cents: 65000,
      total_paid_cents: 0,
      total_unpaid_cents: 65000,
      paid_at: null,
      fully_paid: false,
      booking: "SW-2026-0187",
    },
  ];

  for (const { booking, ...invoice } of invoices) {
    const { data, error } = await db
      .from("invoices")
      .upsert({ ...invoice, organization_id: orgId }, { onConflict: "moneybird_invoice_id" })
      .select("id")
      .single();
    check(`factuur ${invoice.invoice_number}`, { error });

    await db.from("booking_invoices").upsert(
      {
        booking_id: bookingIds[booking],
        invoice_id: data.id,
        link_method: "seed",
        confidence: 1,
      },
      { onConflict: "booking_id,invoice_id" }
    );
  }
  console.log(`  facturen      ${invoices.length}`);

  /* --- SkoolPoints ------------------------------------------------------- */
  const now = new Date().toISOString();
  const inTwoYears = new Date(Date.now() + 730 * 86400000).toISOString();

  const transactions = [
    {
      type: "earn_workshop",
      status: "available",
      points: 600,
      description: "Graffiti — 4 × 90 minuten",
      external_reference: `booking:${bookingIds["SW-2026-0123"]}`,
      booking_id: bookingIds["SW-2026-0123"],
      qualifying_minutes: 360,
      available_at: now,
      expires_at: inTwoYears,
      occurred_at: new Date(Date.now() - 45 * 86400000).toISOString(),
    },
    {
      type: "earn_review",
      status: "available",
      points: 50,
      description: "Review geplaatst",
      external_reference: "review:demo-1",
      available_at: now,
      expires_at: inTwoYears,
      occurred_at: new Date(Date.now() - 30 * 86400000).toISOString(),
    },
    {
      type: "earn_workshop",
      status: "pending",
      points: 300,
      description: "Podcast — 2 × 90 minuten",
      external_reference: `booking:${bookingIds["SW-2026-0187"]}`,
      booking_id: bookingIds["SW-2026-0187"],
      qualifying_minutes: 180,
      occurred_at: new Date(Date.now() - 8 * 86400000).toISOString(),
    },
  ];

  for (const transaction of transactions) {
    const { data: existingTx } = await db
      .from("loyalty_transactions")
      .select("id")
      .eq("organization_id", orgId)
      .eq("type", transaction.type)
      .eq("external_reference", transaction.external_reference)
      .maybeSingle();
    if (existingTx) continue;

    await db.from("loyalty_transactions").insert({
      organization_id: orgId,
      account_id: accountId,
      point_value_cents_per_100: 250,
      points_per_hour_at_time: 100,
      source: "seed",
      ...transaction,
    });
  }
  console.log("  skoolpoints   650 beschikbaar, 300 in behandeling");

  /* --- Berichten --------------------------------------------------------- */
  const { data: thread } = await db
    .from("message_threads")
    .upsert(
      {
        organization_id: orgId,
        gmail_thread_id: "demo-thread-1",
        subject: "Boekingsbevestiging Cultuurdag",
        participant_emails: [customerEmail, "boekingen@skoolworkshop.nl"],
        visibility: "auto_allowed",
        visibility_reason: "Demodata",
      },
      { onConflict: "gmail_thread_id" }
    )
    .select("id")
    .single();

  if (thread) {
    const messages = [
      {
        gmail_message_id: "demo-msg-1",
        direction: "outbound",
        from_email: "boekingen@skoolworkshop.nl",
        from_name: "Skool Workshop",
        to_emails: [customerEmail],
        sent_at: new Date(Date.now() - 50 * 86400000).toISOString(),
        body_text:
          "Beste Sanne,\n\nHierbij bevestigen wij uw boeking. De boeking is definitief.\n\nWorkshop: Graffiti\nAantal workshops: 4\nDuur: 90 minuten per workshop\nLocatie: Kanaalstraat 5, Gouda\nBoekingsnummer: SW-2026-0123\n\nMet vriendelijke groet,\nTeam Skool Workshop",
      },
      {
        gmail_message_id: "demo-msg-2",
        direction: "inbound",
        from_email: customerEmail,
        from_name: "Sanne de Vries",
        to_emails: ["boekingen@skoolworkshop.nl"],
        sent_at: new Date(Date.now() - 49 * 86400000).toISOString(),
        body_text:
          "Dank voor de bevestiging. Nemen de leerlingen zelf oude kleding mee, of regelen jullie schorten?",
      },
    ];

    for (const message of messages) {
      await db
        .from("messages")
        .upsert(
          { ...message, thread_id: thread.id, subject: "Boekingsbevestiging Cultuurdag" },
          { onConflict: "gmail_message_id", ignoreDuplicates: true }
        );
    }
    console.log("  berichten     1 gesprek");
  }

  /* --- Inloglinks -------------------------------------------------------- */
  const adminLink = await magicLink(adminEmail);
  const customerLink = await magicLink(customerEmail);

  console.log("\n  Klaar. Inloggen kan met onderstaande links.");
  console.log("  Elke link werkt één keer en is 60 minuten geldig.");
  console.log("  Draai dit script opnieuw voor verse links.\n");
  console.log(`  BEHEERDER  ${adminEmail}`);
  console.log(`  ${adminLink}\n`);
  console.log(`  KLANT      ${customerEmail}`);
  console.log(`  ${customerLink}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
