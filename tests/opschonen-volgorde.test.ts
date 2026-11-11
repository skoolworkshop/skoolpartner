import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { maakCode } from "@/lib/inschrijving/codes";
import { maakSleutels } from "@/lib/inschrijving/naam";

/**
 * De volgorde waarin een organisatie opgeruimd wordt.
 *
 * WAAROM DIT ER IS
 *
 *   scripts/opschonen.mjs verwijdert alles van één organisatie. Boekingen en
 *   cultuurdagen staan op RESTRICT: zolang die er zijn, blokkeren ze het
 *   verwijderen van de organisatie. Gaat de volgorde fout, dan stopt het
 *   script halverwege en blijft er rommel staan.
 *
 *   Deze test bouwt twee organisaties met alles erop en eraan, ruimt er één
 *   op in precies de volgorde van het script, en kijkt daarna of de andere
 *   nog helemaal intact is.
 *
 *   Verzonnen scholen, verzonnen namen, verzonnen bedragen.
 */

const SUPABASE_STUBS = `
create role anon;
create role authenticated;
create role service_role;
create schema if not exists auth;
create schema if not exists extensions;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid
language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text
language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
`;

/** Dezelfde volgorde als in scripts/opschonen.mjs. */
const PER_ORGANISATIE = [
  "enrollment_events",
  "workshop_results",
  "redemption_requests",
  "reviews",
  "loyalty_transactions",
  "loyalty_accounts",
  "invoices",
  "bookings",
  "message_threads",
  "outbound_messages",
  "organization_invites",
  "organization_contacts",
  "organization_domains",
  "organization_members",
  "cjp_parking_requests",
  "cjp_credit_transactions",
  "cjp_bonus_awards",
];

let db: PGlite;
let testOrg: string;
let echteOrg: string;
let beheerder: string;

async function rijen<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function een<T>(sql: string, params: unknown[] = []): Promise<T> {
  const lijst = await rijen<T>(sql, params);
  expect(lijst.length).toBeGreaterThan(0);
  return lijst[0];
}

/** Een organisatie met van alles eraan, zoals na een jaar gebruik. */
async function maakOrganisatie(naam: string, gebruiker: string): Promise<string> {
  const slug = naam.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const org = await een<{ id: string }>(
    "insert into public.organizations (name, slug) values ($1, $2) returning id",
    [naam, slug],
  );

  await db.query(
    "insert into public.organization_members (organization_id, user_id, role, status, source) values ($1, $2, 'beheerder', 'active', 'admin_manual')",
    [org.id, gebruiker],
  );
  await db.query(
    "insert into public.organization_contacts (organization_id, email, full_name) values ($1, $2, 'Contactpersoon')",
    [org.id, `contact@${slug}.test`],
  );
  await db.query("insert into public.organization_domains (organization_id, domain) values ($1, $2)", [
    org.id,
    `${slug}.test`,
  ]);
  await db.query(
    "insert into public.organization_invites (organization_id, email, token_hash, expires_at) values ($1, $2, $3, now() + interval '14 days')",
    [org.id, `nieuw@${slug}.test`, `hash-${slug}`],
  );

  const boeking = await een<{ id: string }>(
    `insert into public.bookings (organization_id, workshop_name, scheduled_date, status, origin)
     values ($1, 'Workshop Hiphop', current_date - 30, 'completed', 'admin_manual') returning id`,
    [org.id],
  );

  const factuur = await een<{ id: string }>(
    `insert into public.invoices (organization_id, invoice_number, invoice_date, state, moneybird_invoice_id)
     values ($1, $2, current_date - 20, 'paid', $3) returning id`,
    [org.id, `F-${slug}`, `mb-${slug}`],
  );
  await db.query(
    "insert into public.invoice_lines (invoice_id, description, total_cents) values ($1, 'Workshop Hiphop', 49500)",
    [factuur.id],
  );
  await db.query("insert into public.booking_invoices (booking_id, invoice_id) values ($1, $2)", [
    boeking.id,
    factuur.id,
  ]);

  const account = await een<{ id: string }>("select public.ensure_loyalty_account($1::uuid, $2::uuid) as id", [
    org.id,
    gebruiker,
  ]);
  await db.query(
    `insert into public.loyalty_transactions
       (organization_id, user_id, account_id, type, status, points, point_value_cents_per_100, description, external_reference)
     values ($1, $2, $3, 'earn_workshop', 'available', 400, 250, 'Workshop Hiphop', $4)`,
    [org.id, gebruiker, account.id, `booking:${slug}`],
  );

  const dag = await een<{ id: string }>(
    `insert into public.enrollment_events (organization_id, name, event_date, status, slug, shared_code)
     values ($1, 'Cultuurdag', current_date - 10, 'gesloten', $2, $3) returning id`,
    [org.id, `cultuurdag-${slug}`, maakCode(8)],
  );
  const klas = await een<{ id: string }>(
    "insert into public.enrollment_groups (event_id, name, position) values ($1, '1A', 1) returning id",
    [dag.id],
  );
  const ronde = await een<{ id: string }>(
    `insert into public.enrollment_rounds (event_id, position, label, starts_at, ends_at)
     values ($1, 1, 'Workshopronde 1', '09:15', '10:15') returning id`,
    [dag.id],
  );
  const workshop = await een<{ id: string }>(
    "insert into public.enrollment_workshops (event_id, name, position) values ($1, 'Workshop Hiphop', 1) returning id",
    [dag.id],
  );
  const sessie = await een<{ id: string }>(
    `insert into public.enrollment_sessions (event_id, workshop_id, round_id, capacity, position)
     values ($1, $2, $3, 25, 1) returning id`,
    [dag.id, workshop.id, ronde.id],
  );
  for (const leerlingNaam of ["Lissa van der Velde", "Jan-Peter Bakker"]) {
    const sleutels = maakSleutels(leerlingNaam);
    const deelnemer = await een<{ id: string }>(
      `insert into public.enrollment_participants
         (event_id, group_id, display_name, search_key, flat_key, claim_token, access_code)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [dag.id, klas.id, leerlingNaam, sleutels.sleutel, sleutels.platteSleutel, maakCode(24), maakCode(8)],
    );
    await db.query("select public.enrollment_choose($1::uuid, $2::uuid, 'automatisch')", [deelnemer.id, sessie.id]);
  }
  await db.query(
    `insert into public.enrollment_access (event_id, label, token_hash, code_hash, expires_at)
     values ($1, 'Contactpersoon', $2, $3, now() + interval '30 days')`,
    [dag.id, `toegang-${slug}`, `code-${slug}`],
  );

  await db.query(
    `insert into public.message_threads (organization_id, subject, gmail_thread_id)
     values ($1, 'Vraag over de cultuurdag', $2)`,
    [org.id, `thread-${slug}`],
  );

  return org.id;
}

/** Tellen wat er nog van een organisatie over is. */
async function telAlles(orgId: string): Promise<Record<string, number>> {
  const uitkomst: Record<string, number> = {};
  for (const tabel of PER_ORGANISATIE) {
    const sleutel = tabel === "cjp_bonus_awards" ? "organization_id" : "id";
    const rij = await een<{ n: number }>(
      `select count(*)::int as n from public."${tabel}" where organization_id = $1`,
      [orgId],
    );
    uitkomst[tabel] = rij.n;
    void sleutel;
  }
  uitkomst.organisatie = (
    await een<{ n: number }>("select count(*)::int as n from public.organizations where id = $1", [orgId])
  ).n;
  return uitkomst;
}

/** Precies wat het script doet, in dezelfde volgorde. */
async function ruimOp(orgId: string): Promise<void> {
  for (const tabel of PER_ORGANISATIE) {
    const sleutel = tabel === "cjp_bonus_awards" ? "organization_id" : "id";
    const ids = (
      await rijen<Record<string, string>>(
        `select "${sleutel}" from public."${tabel}" where organization_id = $1 order by "${sleutel}"`,
        [orgId],
      )
    ).map((rij) => rij[sleutel]);
    if (ids.length === 0) continue;
    await db.query(`delete from public."${tabel}" where "${sleutel}" = any($1::uuid[])`, [ids]);
  }
  await db.query("delete from public.organizations where id = $1", [orgId]);
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);

  const map = path.join(process.cwd(), "supabase", "migrations");
  for (const bestand of (await readdir(map)).filter((naam) => naam.endsWith(".sql")).sort()) {
    await db.exec(await readFile(path.join(map, bestand), "utf8"));
  }

  const gebruiker = await een<{ id: string }>(
    "insert into auth.users (id, email) values (gen_random_uuid(), 'contact@skoolworkshop.test') returning id",
  );
  beheerder = gebruiker.id;
  await db.query(
    "insert into public.profiles (id, email, is_admin) values ($1, 'contact@skoolworkshop.test', true) on conflict (id) do update set is_admin = true",
    [beheerder],
  );

  testOrg = await maakOrganisatie("Testschool De Proef", beheerder);
  echteOrg = await maakOrganisatie("Blijft Staan College", beheerder);
}, 60_000);

describe("een organisatie opruimen", () => {
  it("staat vol voordat we beginnen", async () => {
    const voor = await telAlles(testOrg);
    expect(voor.organisatie).toBe(1);
    expect(voor.enrollment_events).toBe(1);
    expect(voor.bookings).toBe(1);
    expect(voor.invoices).toBe(1);
    expect(voor.loyalty_transactions).toBe(1);
    expect(voor.organization_members).toBe(1);
  });

  it("gaat er in de goede volgorde helemaal uit", async () => {
    await expect(ruimOp(testOrg)).resolves.not.toThrow();

    const na = await telAlles(testOrg);
    for (const [tabel, aantal] of Object.entries(na)) {
      expect(`${tabel}: ${aantal}`).toBe(`${tabel}: 0`);
    }
  });

  it("neemt alles mee wat aan die organisatie hing", async () => {
    // De cultuurdag met klassen, leerlingen, keuzes en toegangslinks.
    const resten = await een<{ dagen: number; leerlingen: number; keuzes: number; toegang: number; regels: number }>(
      `select
         (select count(*)::int from public.enrollment_events) as dagen,
         (select count(*)::int from public.enrollment_participants) as leerlingen,
         (select count(*)::int from public.enrollment_choices) as keuzes,
         (select count(*)::int from public.enrollment_access) as toegang,
         (select count(*)::int from public.invoice_lines) as regels`,
    );
    // Alleen die van de andere organisatie zijn er nog: 1 dag, 2 leerlingen,
    // 2 keuzes, 1 toegangslink en 1 factuurregel.
    expect(resten.dagen).toBe(1);
    expect(resten.leerlingen).toBe(2);
    expect(resten.keuzes).toBe(2);
    expect(resten.toegang).toBe(1);
    expect(resten.regels).toBe(1);
  });

  it("laat de andere organisatie volledig intact", async () => {
    const na = await telAlles(echteOrg);
    expect(na.organisatie).toBe(1);
    expect(na.enrollment_events).toBe(1);
    expect(na.bookings).toBe(1);
    expect(na.invoices).toBe(1);
    expect(na.loyalty_transactions).toBe(1);
    expect(na.loyalty_accounts).toBe(1);
    expect(na.organization_members).toBe(1);
    expect(na.organization_contacts).toBe(1);
    expect(na.message_threads).toBe(1);
  });

  it("laat het account en de beheerrechten met rust", async () => {
    const profiel = await een<{ email: string; is_admin: boolean }>(
      "select email, is_admin from public.profiles where id = $1",
      [beheerder],
    );
    expect(profiel.email).toBe("contact@skoolworkshop.test");
    expect(profiel.is_admin).toBe(true);

    const account = await een<{ n: number }>("select count(*)::int as n from auth.users where id = $1", [beheerder]);
    expect(account.n).toBe(1);
  });

  it("laat de instellingen en de koppelingen met rust", async () => {
    const instellingen = await een<{ n: number }>("select count(*)::int as n from public.app_settings");
    expect(instellingen.n).toBeGreaterThan(40);

    const sync = await een<{ n: number }>("select count(*)::int as n from public.integration_sync_state");
    expect(sync.n).toBeGreaterThanOrEqual(0);
  });

  it("kan daarna gewoon een nieuwe school aanmaken", async () => {
    const nieuw = await maakOrganisatie("Eerste Echte School", beheerder);
    const na = await telAlles(nieuw);
    expect(na.organisatie).toBe(1);
    expect(na.enrollment_events).toBe(1);
  });
});
