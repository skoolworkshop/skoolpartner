import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { beoordeelKoppeling } from "@/lib/integrations/moneybird/sync";

/**
 * Facturen koppelen aan de juiste schoollocatie.
 *
 * WAT HIER BEWEZEN MOET WORDEN
 *
 *   1. Een factuur van een Moneybird-contact dat bij geen enkele locatie hoort,
 *      komt niet binnen. Ook niet als losse factuur.
 *   2. Een factuur van een gekoppeld contact komt binnen bij precies die ene
 *      locatie.
 *   3. Twee locaties van hetzelfde bestuur delen niets: eigen contactpersonen,
 *      eigen facturen, eigen punten.
 *   4. Hoort één Moneybird-contact bij twee locaties, dan raadt het systeem
 *      niet. De factuur wacht op een mens en levert geen punten op.
 *   5. Opnieuw synchroniseren levert geen dubbele facturen en geen dubbele
 *      punten op.
 *   6. Een factuur van vóór de deelname levert geen punten op.
 *
 * Verzonnen scholen, verzonnen contacten, verzonnen bedragen.
 */

// =============================================================================
// Deel 1: de beslissing zelf
// =============================================================================

describe("bij welke locatie hoort dit Moneybird-contact", () => {
  it("vindt niets als er niets gekoppeld is", () => {
    expect(beoordeelKoppeling([])).toEqual({ soort: "geen" });
  });

  it("vindt de ene locatie die eraan hangt", () => {
    expect(beoordeelKoppeling(["loc-1"])).toEqual({ soort: "gevonden", organisatieId: "loc-1" });
  });

  it("telt dezelfde locatie uit twee bronnen als één", () => {
    // Het contact staat zowel in external_record_mappings als bij een
    // contactpersoon. Dat is geen twijfel, dat is twee keer hetzelfde.
    expect(beoordeelKoppeling(["loc-1", "loc-1"])).toEqual({ soort: "gevonden", organisatieId: "loc-1" });
  });

  it("gokt niet als twee locaties hetzelfde contact gebruiken", () => {
    const uitkomst = beoordeelKoppeling(["loc-1", "loc-2"]);
    expect(uitkomst.soort).toBe("meerdere");
    if (uitkomst.soort === "meerdere") expect(uitkomst.organisaties).toHaveLength(2);
  });

  it("negeert lege waarden", () => {
    expect(beoordeelKoppeling(["", "loc-1"])).toEqual({ soort: "gevonden", organisatieId: "loc-1" });
  });
});

// =============================================================================
// Deel 2: twee locaties van hetzelfde bestuur, met de echte database
// =============================================================================

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

let db: PGlite;
/** Twee locaties van Stichting Zuidwest, elk met een eigen contactpersoon. */
let noord: string;
let zuid: string;
let annaId: string;
let bramId: string;

async function rijen<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function een<T>(sql: string, params: unknown[] = []): Promise<T> {
  const lijst = await rijen<T>(sql, params);
  expect(lijst.length).toBeGreaterThan(0);
  return lijst[0];
}

/** Precies wat zoekKoppeling in de applicatie doet, maar dan tegen deze database. */
async function koppelingVan(moneybirdContact: string) {
  const uitMapping = await rijen<{ internal_id: string }>(
    `select internal_id from public.external_record_mappings
      where system = 'moneybird' and entity_type = 'contact' and external_id = $1`,
    [moneybirdContact],
  );
  const uitContacten = await rijen<{ organization_id: string }>(
    "select organization_id from public.organization_contacts where moneybird_contact_id = $1",
    [moneybirdContact],
  );
  return beoordeelKoppeling([
    ...uitMapping.map((r) => r.internal_id),
    ...uitContacten.map((r) => r.organization_id),
  ]);
}

/** Een factuur binnenhalen volgens de nieuwe regel. Geeft terug wat er gebeurde. */
async function haalFactuurBinnen(factuur: {
  moneybirdId: string;
  contactId: string;
  nummer: string;
  datum: string;
  bedragCenten: number;
  betaald?: boolean;
}): Promise<"opgeslagen" | "geen-koppeling" | "meerdere-locaties"> {
  const koppeling = await koppelingVan(factuur.contactId);

  // Geen koppeling en twijfel over de koppeling leiden tot hetzelfde: de
  // factuur komt niet binnen. Alleen de reden verschilt, en die gaat naar het
  // synchronisatielogboek.
  if (koppeling.soort === "geen") return "geen-koppeling";
  if (koppeling.soort === "meerdere") return "meerdere-locaties";

  const organisatie = koppeling.organisatieId;
  const redenen: string[] = [];

  await db.query(
    `insert into public.invoices
       (organization_id, moneybird_invoice_id, moneybird_contact_id, invoice_number, invoice_date,
        state, total_incl_cents, total_unpaid_cents, fully_paid, needs_review, review_reasons)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (moneybird_invoice_id) do update
       set state = excluded.state,
           total_unpaid_cents = excluded.total_unpaid_cents,
           fully_paid = excluded.fully_paid`,
    [
      organisatie,
      factuur.moneybirdId,
      factuur.contactId,
      factuur.nummer,
      factuur.datum,
      factuur.betaald ? "paid" : "open",
      factuur.bedragCenten,
      factuur.betaald ? 0 : factuur.bedragCenten,
      factuur.betaald ?? false,
      redenen.length > 0,
      redenen,
    ],
  );

  return "opgeslagen";
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);

  const map = path.join(process.cwd(), "supabase", "migrations");
  for (const bestand of (await readdir(map)).filter((naam) => naam.endsWith(".sql")).sort()) {
    await db.exec(await readFile(path.join(map, bestand), "utf8"));
  }

  // Eén bestuur, twee locaties. In SkoolPartner zijn dat twee organisaties.
  noord = (
    await een<{ id: string }>(
      "insert into public.organizations (name, slug) values ('Stichting Zuidwest, locatie Noord', 'zuidwest-noord') returning id",
    )
  ).id;
  zuid = (
    await een<{ id: string }>(
      "insert into public.organizations (name, slug) values ('Stichting Zuidwest, locatie Zuid', 'zuidwest-zuid') returning id",
    )
  ).id;

  // Elke locatie een eigen contactpersoon met een eigen account.
  const anna = await een<{ id: string }>(
    "insert into auth.users (email) values ('anna@zuidwest-noord.test') returning id",
  );
  const bram = await een<{ id: string }>(
    "insert into auth.users (email) values ('bram@zuidwest-zuid.test') returning id",
  );
  annaId = anna.id;
  bramId = bram.id;

  for (const [gebruiker, mail, locatie] of [
    [annaId, "anna@zuidwest-noord.test", noord],
    [bramId, "bram@zuidwest-zuid.test", zuid],
  ] as const) {
    await db.query(
      "insert into public.profiles (id, email) values ($1, $2) on conflict (id) do update set email = excluded.email",
      [gebruiker, mail],
    );
    await db.query(
      "insert into public.organization_members (organization_id, user_id, role, status, source) values ($1, $2, 'beheerder', 'active', 'admin_manual')",
      [locatie, gebruiker],
    );
    await db.query("select public.ensure_loyalty_account($1::uuid, $2::uuid)", [locatie, gebruiker]);
  }

  // En elk een eigen Moneybird-contact.
  await db.query(
    "insert into public.organization_contacts (organization_id, email, full_name, moneybird_contact_id, is_verified, verified_at) values ($1, $2, 'Anna de Vries', 'mb-noord', true, now())",
    [noord, "anna@zuidwest-noord.test"],
  );
  await db.query(
    "insert into public.organization_contacts (organization_id, email, full_name, moneybird_contact_id, is_verified, verified_at) values ($1, $2, 'Bram Jansen', 'mb-zuid', true, now())",
    [zuid, "bram@zuidwest-zuid.test"],
  );
});

describe("facturen binnenhalen", () => {
  it("laat een factuur van een onbekend contact buiten de deur", async () => {
    const uitkomst = await haalFactuurBinnen({
      moneybirdId: "mb-f-vreemd",
      contactId: "mb-een-andere-klant",
      nummer: "20260107",
      datum: "2026-08-25",
      bedragCenten: 121000,
    });

    expect(uitkomst).toBe("geen-koppeling");
    const facturen = await rijen("select id from public.invoices");
    expect(facturen).toHaveLength(0);
  });

  it("slaat zo'n factuur ook niet op als losse factuur", async () => {
    const losse = await een<{ n: number }>(
      "select count(*)::int as n from public.invoices where organization_id is null",
    );
    expect(losse.n).toBe(0);
  });

  it("haalt een factuur van een gekoppeld contact wel binnen, bij de juiste locatie", async () => {
    expect(
      await haalFactuurBinnen({
        moneybirdId: "mb-f-noord-1",
        contactId: "mb-noord",
        nummer: "2026-00500",
        datum: "2026-09-10",
        bedragCenten: 59500,
      }),
    ).toBe("opgeslagen");

    const factuur = await een<{ organization_id: string }>(
      "select organization_id from public.invoices where moneybird_invoice_id = 'mb-f-noord-1'",
    );
    expect(factuur.organization_id).toBe(noord);
  });

  it("houdt de twee locaties helemaal uit elkaar", async () => {
    await haalFactuurBinnen({
      moneybirdId: "mb-f-zuid-1",
      contactId: "mb-zuid",
      nummer: "2026-00501",
      datum: "2026-09-11",
      bedragCenten: 74500,
    });

    const perLocatie = await rijen<{ organization_id: string; n: number }>(
      "select organization_id, count(*)::int as n from public.invoices group by organization_id order by n",
    );
    expect(perLocatie).toHaveLength(2);
    expect(perLocatie.every((rij) => rij.n === 1)).toBe(true);

    const vanNoord = await een<{ nummer: string }>(
      "select invoice_number as nummer from public.invoices where organization_id = $1",
      [noord],
    );
    expect(vanNoord.nummer).toBe("2026-00500");
  });

  it("levert bij opnieuw synchroniseren geen tweede rij op", async () => {
    await haalFactuurBinnen({
      moneybirdId: "mb-f-noord-1",
      contactId: "mb-noord",
      nummer: "2026-00500",
      datum: "2026-09-10",
      bedragCenten: 59500,
      betaald: true,
    });

    const aantal = await een<{ n: number }>(
      "select count(*)::int as n from public.invoices where moneybird_invoice_id = 'mb-f-noord-1'",
    );
    expect(aantal.n).toBe(1);

    // En de betaalstatus is wel bijgewerkt.
    const factuur = await een<{ state: string; fully_paid: boolean; total_unpaid_cents: number }>(
      "select state, fully_paid, total_unpaid_cents from public.invoices where moneybird_invoice_id = 'mb-f-noord-1'",
    );
    expect(factuur.state).toBe("paid");
    expect(factuur.fully_paid).toBe(true);
    expect(factuur.total_unpaid_cents).toBe(0);
  });
});

describe("één contact bij twee locaties", () => {
  it("kan niet per ongeluk ontstaan: de database weigert het", async () => {
    // Dit is wat migratie 044 toevoegt.
    let geweigerd = false;
    try {
      await db.query(
        "insert into public.organization_contacts (organization_id, email, moneybird_contact_id) values ($1, $2, 'mb-noord')",
        [zuid, "administratie@zuidwest-zuid.test"],
      );
    } catch {
      geweigerd = true;
    }
    expect(geweigerd).toBe(true);
  });

  it("en als het er toch staat, raadt het systeem niet", async () => {
    // Via de andere route, external_record_mappings, kan hetzelfde contact nog
    // wel bij een tweede locatie uitkomen. Dan hoort de factuur te wachten.
    await db.query(
      `insert into public.external_record_mappings (system, entity_type, internal_table, internal_id, external_id)
       values ('moneybird', 'contact', 'organizations', $1, 'mb-noord')`,
      [zuid],
    );

    const uitkomst = await haalFactuurBinnen({
      moneybirdId: "mb-f-twijfel",
      contactId: "mb-noord",
      nummer: "2026-00502",
      datum: "2026-09-12",
      bedragCenten: 49500,
    });

    expect(uitkomst).toBe("meerdere-locaties");

    // En er komt geen losse factuur binnen die later op het dashboard
    // rondzwerft. De reden staat in het synchronisatielogboek, niet in een rij
    // die bij de volgende synchronisatie weer terugkomt.
    const factuur = await rijen(
      "select id from public.invoices where moneybird_invoice_id = 'mb-f-twijfel'",
    );
    expect(factuur).toHaveLength(0);

    await db.query("delete from public.external_record_mappings where external_id = 'mb-noord'");
  });
});

describe("punten blijven bij de juiste locatie", () => {
  it("geeft punten aan de locatie van de boeking, niet aan de zusterlocatie", async () => {
    const account = await een<{ id: string }>(
      "select id from public.loyalty_accounts where organization_id = $1",
      [noord],
    );

    await db.query(
      `insert into public.loyalty_transactions
         (organization_id, user_id, account_id, type, status, points, point_value_cents_per_100,
          description, external_reference)
       values ($1, $2, $3, 'earn_workshop', 'available', 400, 250, 'Workshop Hiphop', 'booking:noord-1')`,
      [noord, annaId, account.id],
    );

    const saldoNoord = await een<{ available_points: number }>(
      "select available_points from public.loyalty_balances where organization_id = $1",
      [noord],
    );
    expect(saldoNoord.available_points).toBe(400);

    const saldoZuid = await rijen<{ available_points: number }>(
      "select available_points from public.loyalty_balances where organization_id = $1",
      [zuid],
    );
    expect(saldoZuid[0]?.available_points ?? 0).toBe(0);
  });

  it("laat dezelfde boeking nooit twee keer punten opleveren", async () => {
    const account = await een<{ id: string }>(
      "select id from public.loyalty_accounts where organization_id = $1",
      [noord],
    );

    let geweigerd = false;
    try {
      await db.query(
        `insert into public.loyalty_transactions
           (organization_id, user_id, account_id, type, status, points, point_value_cents_per_100,
            description, external_reference)
         values ($1, $2, $3, 'earn_workshop', 'available', 400, 250, 'Nog een keer', 'booking:noord-1')`,
        [noord, annaId, account.id],
      );
    } catch {
      geweigerd = true;
    }
    expect(geweigerd).toBe(true);

    const saldo = await een<{ available_points: number }>(
      "select available_points from public.loyalty_balances where organization_id = $1",
      [noord],
    );
    expect(saldo.available_points).toBe(400);
  });

  it("houdt bij welke boeking en welke factuur bij een toekenning horen", async () => {
    const kolommen = await rijen<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'loyalty_transactions'
          and column_name in ('booking_id', 'invoice_id', 'user_id', 'organization_id')`,
    );
    expect(kolommen.map((k) => k.column_name).sort()).toEqual([
      "booking_id",
      "invoice_id",
      "organization_id",
      "user_id",
    ]);
  });
});
