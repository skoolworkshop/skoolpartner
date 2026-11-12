import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Van wie zijn de SkoolPoints: van de schoollocatie of van de contactpersoon?
 *
 * WAAROM DEZE TEST ER IS
 *
 *   Het uitgangspunt is: het saldo hoort bij de locatie. Boeken twee collega's
 *   van dezelfde school, dan spaart de school, niet ieder voor zich. En gaat
 *   een contactpersoon weg, dan blijven de punten van de school staan.
 *
 *   Deze test legt vast hoe het nu werkt, en waar dat wel en niet klopt met dat
 *   uitgangspunt. Daar waar het afwijkt staat dat er met zoveel woorden bij,
 *   zodat de test niet stilletjes het verkeerde gedrag goedkeurt.
 *
 * DE OPZET
 *
 *   Eén locatie, twee contactpersonen: Anna en Bram. Allebei boeken ze een
 *   workshop. Daarnaast een tweede locatie van hetzelfde bestuur, om te zien
 *   dat die er niets van merkt.
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

let db: PGlite;
let locatie: string;
let zusterLocatie: string;
let anna: string;
let bram: string;

async function rijen<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function een<T>(sql: string, params: unknown[] = []): Promise<T> {
  const lijst = await rijen<T>(sql, params);
  expect(lijst.length).toBeGreaterThan(0);
  return lijst[0];
}

/** Het saldo van een hele locatie, opgeteld uit het grootboek. */
async function saldoVanLocatie(organisatie: string): Promise<number> {
  const rij = await een<{ punten: number }>(
    `select coalesce(sum(points), 0)::int as punten
       from public.loyalty_transactions
      where organization_id = $1
        and status in ('available', 'reserved', 'redeemed', 'expired')`,
    [organisatie],
  );
  return rij.punten;
}

/** Punten toekennen voor een boeking, zoals awardPointsForBooking dat doet. */
async function kenPuntenToe(opties: {
  organisatie: string;
  gebruiker: string;
  boekingId: string;
  punten: number;
  omschrijving: string;
}): Promise<void> {
  const account = await een<{ id: string }>("select public.ensure_loyalty_account($1::uuid, $2::uuid) as id", [
    opties.organisatie,
    opties.gebruiker,
  ]);

  await db.query(
    `insert into public.loyalty_transactions
       (organization_id, user_id, account_id, type, status, points, point_value_cents_per_100,
        description, external_reference, booking_id)
     values ($1, $2, $3, 'earn_workshop', 'available', $4, 250, $5, $6, $7)`,
    [
      opties.organisatie,
      opties.gebruiker,
      account.id,
      opties.punten,
      opties.omschrijving,
      `booking:${opties.boekingId}`,
      opties.boekingId,
    ],
  );
}

/** Een boeking met een contactpersoon erbij, zoals die binnenkomt. */
async function maakBoeking(opties: {
  organisatie: string;
  contactEmail: string;
  contactNaam: string;
  workshop: string;
}): Promise<string> {
  const rij = await een<{ id: string }>(
    `insert into public.bookings
       (organization_id, workshop_name, workshop_count, minutes_per_workshop, scheduled_date,
        status, origin, contact_email, contact_name)
     values ($1, $2, 2, 90, current_date - 7, 'completed', 'admin_manual', $3, $4)
     returning id`,
    [opties.organisatie, opties.workshop, opties.contactEmail, opties.contactNaam],
  );
  return rij.id;
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);

  const map = path.join(process.cwd(), "supabase", "migrations");
  for (const bestand of (await readdir(map)).filter((naam) => naam.endsWith(".sql")).sort()) {
    await db.exec(await readFile(path.join(map, bestand), "utf8"));
  }

  locatie = (
    await een<{ id: string }>(
      "insert into public.organizations (name, slug) values ('Zuidwest, locatie Noord', 'zw-noord') returning id",
    )
  ).id;
  zusterLocatie = (
    await een<{ id: string }>(
      "insert into public.organizations (name, slug) values ('Zuidwest, locatie Zuid', 'zw-zuid') returning id",
    )
  ).id;

  for (const [mail, naam] of [
    ["anna@zw-noord.test", "Anna de Vries"],
    ["bram@zw-noord.test", "Bram Jansen"],
  ] as const) {
    const gebruiker = await een<{ id: string }>("insert into auth.users (email) values ($1) returning id", [mail]);
    await db.query(
      "insert into public.profiles (id, email, full_name) values ($1, $2, $3) on conflict (id) do nothing",
      [gebruiker.id, mail, naam],
    );
    await db.query(
      "insert into public.organization_members (organization_id, user_id, role, status, source) values ($1, $2, 'lid', 'active', 'admin_manual')",
      [locatie, gebruiker.id],
    );
    await db.query(
      "insert into public.organization_contacts (organization_id, email, full_name, is_verified, verified_at) values ($1, $2, $3, true, now())",
      [locatie, mail, naam],
    );
    if (mail.startsWith("anna")) anna = gebruiker.id;
    else bram = gebruiker.id;
  }
});

describe("twee contactpersonen van dezelfde locatie", () => {
  it("boeken allebei, en allebei de boekingen horen bij die ene locatie", async () => {
    const boekingAnna = await maakBoeking({
      organisatie: locatie,
      contactEmail: "anna@zw-noord.test",
      contactNaam: "Anna de Vries",
      workshop: "Workshop Hiphop",
    });
    const boekingBram = await maakBoeking({
      organisatie: locatie,
      contactEmail: "bram@zw-noord.test",
      contactNaam: "Bram Jansen",
      workshop: "Workshop Graffiti",
    });

    const boekingen = await rijen<{ organization_id: string; contact_email: string }>(
      "select organization_id, contact_email from public.bookings order by contact_email",
    );
    expect(boekingen).toHaveLength(2);
    expect(boekingen.every((b) => b.organization_id === locatie)).toBe(true);
    // Bij elke boeking staat wie hem heeft aangevraagd.
    expect(boekingen.map((b) => b.contact_email)).toEqual(["anna@zw-noord.test", "bram@zw-noord.test"]);

    await kenPuntenToe({
      organisatie: locatie,
      gebruiker: anna,
      boekingId: boekingAnna,
      punten: 300,
      omschrijving: "Workshop Hiphop",
    });
    await kenPuntenToe({
      organisatie: locatie,
      gebruiker: bram,
      boekingId: boekingBram,
      punten: 200,
      omschrijving: "Workshop Graffiti",
    });
  });

  it("dragen allebei bij aan hetzelfde locatiesaldo", async () => {
    // Dit is het uitgangspunt: de school spaart, niet de medewerker.
    expect(await saldoVanLocatie(locatie)).toBe(500);
  });

  it("laat de zusterlocatie er niets van merken", async () => {
    expect(await saldoVanLocatie(zusterLocatie)).toBe(0);
  });

  it("legt bij elke toekenning vast om welke boeking en welke persoon het ging", async () => {
    const transacties = await rijen<{ booking_id: string | null; user_id: string | null; points: number }>(
      "select booking_id, user_id, points from public.loyalty_transactions where organization_id = $1 order by points desc",
      [locatie],
    );
    expect(transacties).toHaveLength(2);
    expect(transacties.every((t) => t.booking_id !== null)).toBe(true);
    expect(transacties.map((t) => t.user_id).sort()).toEqual([anna, bram].sort());
  });

  /**
   * LET OP: hier wijkt het systeem af van het uitgangspunt.
   *
   * De weergave loyalty_balances rekent per persoon binnen een organisatie, niet
   * per organisatie. Twee collega's van dezelfde school zien dus allebei hun
   * eigen saldo, en nergens het totaal van de school. Het grootboek klopt wel:
   * daar staat gewoon 500 op de locatie.
   */
  it("maar de saldoweergave rekent vandaag nog per persoon", async () => {
    const regels = await rijen<{ user_id: string; available_points: number }>(
      "select user_id, available_points from public.loyalty_balances where organization_id = $1 order by available_points desc",
      [locatie],
    );

    expect(regels).toHaveLength(2);
    expect(regels.map((r) => r.available_points)).toEqual([300, 200]);

    // Opgeteld klopt het wel met het grootboek.
    const totaal = regels.reduce((som, regel) => som + regel.available_points, 0);
    expect(totaal).toBe(await saldoVanLocatie(locatie));
  });
});

describe("een contactpersoon vertrekt", () => {
  it("laat de punten van de school staan", async () => {
    const voor = await saldoVanLocatie(locatie);
    expect(voor).toBe(500);

    // Bram gaat weg: zijn account verdwijnt uit het systeem.
    await db.query("delete from public.organization_members where user_id = $1", [bram]);
    await db.query("delete from public.profiles where id = $1", [bram]);
    await db.query("delete from auth.users where id = $1", [bram]);

    // De transactie blijft staan, met de locatie eraan. Alleen de verwijzing
    // naar de persoon is leeg.
    const na = await saldoVanLocatie(locatie);
    expect(na).toBe(500);

    const vanBram = await een<{ user_id: string | null; organization_id: string; points: number }>(
      "select user_id, organization_id, points from public.loyalty_transactions where description = 'Workshop Graffiti'",
    );
    expect(vanBram.user_id).toBeNull();
    expect(vanBram.organization_id).toBe(locatie);
    expect(vanBram.points).toBe(200);
  });

  it("en de boeking weet nog steeds wie hem had aangevraagd", async () => {
    const boeking = await een<{ contact_email: string; contact_name: string }>(
      "select contact_email, contact_name from public.bookings where workshop_name = 'Workshop Graffiti'",
    );
    expect(boeking.contact_email).toBe("bram@zw-noord.test");
    expect(boeking.contact_name).toBe("Bram Jansen");
  });

  it("houdt het spaaraccount van de school overeind, zonder eigenaar", async () => {
    // Het account blijft staan met een lege user_id, dus de punten blijven in
    // beeld. Ze horen alleen bij niemand meer persoonlijk, en dat is precies
    // goed: ze zijn van de school.
    const regels = await rijen<{ user_id: string | null; available_points: number }>(
      "select user_id, available_points from public.loyalty_balances where organization_id = $1 order by available_points desc",
      [locatie],
    );
    const zichtbaar = regels.reduce((som, regel) => som + regel.available_points, 0);

    expect(zichtbaar).toBe(500);
    expect(await saldoVanLocatie(locatie)).toBe(500);
    expect(regels.some((regel) => regel.user_id === null)).toBe(true);
  });
});
