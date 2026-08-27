/**
 * Controleert het opruimen van de laatste HubSpot-sporen tegen een echte
 * Postgres in het geheugen (PGlite).
 *
 * Twee dingen worden hier bewezen:
 *
 *   1. Migratie 022 haalt de dode syncregel weg en raakt niets anders.
 *   2. Het voorstel in supabase/voorstel-hubspot-kolommen-opruimen.sql doet
 *      wat het belooft: deel A stelt de ID's veilig voordat de kolommen
 *      verdwijnen, en weigert als dat niet lukt.
 *
 *   node scripts/verify-hubspot-opruimen.mjs
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const VOORSTEL = path.join(process.cwd(), "supabase", "voorstel-hubspot-kolommen-opruimen.sql");

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

const ORG = "22222222-2222-2222-2222-222222222222";

let fouten = 0;
function check(goed, tekst) {
  console.log(`  ${goed ? "ok  " : "FOUT"} ${tekst}`);
  if (!goed) fouten += 1;
}

/**
 * Haalt één blok uit het voorstel op.
 *
 * De koppen staan tussen twee streepjeslijnen, dus wij zoeken de kop, slaan de
 * streepjeslijn eronder over, en lopen door tot de volgende streepjeslijn.
 */
function deel(sql, letter) {
  const regels = sql.split("\n");
  const kop = regels.findIndex((r) => r.startsWith(`-- ${letter}. `));
  if (kop === -1) throw new Error(`Deel ${letter} niet gevonden`);

  // De regel direct onder de kop is de sluitende streepjeslijn.
  let begin = kop + 1;
  while (begin < regels.length && regels[begin].startsWith("-- ---")) begin += 1;

  let eind = begin;
  while (eind < regels.length && !regels[eind].startsWith("-- ---")) eind += 1;

  const blok = regels.slice(begin, eind).join("\n").trim();
  if (blok.length < 20) throw new Error(`Deel ${letter} is leeg gebleven`);

  // De delen B en C staan in blokcommentaar; dat halen wij hier weg om ze te
  // kunnen uitvoeren in de test.
  return blok.replace(/\/\*/g, "").replace(/\*\//g, "");
}

async function main() {
  const db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await db.exec(await readFile(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  console.log(`\n  ${files.length} migraties geladen (inclusief 022)\n`);

  // -------------------------------------------------------------------------
  // 1. Migratie 022
  // -------------------------------------------------------------------------
  const sync = (
    await db.query(`select count(*)::int as n from public.integration_sync_state where integration = 'hubspot'`)
  ).rows[0].n;
  check(sync === 0, "De dode syncregel van HubSpot is weg");

  const overig = (
    await db.query(`select count(*)::int as n from public.integration_sync_state`)
  ).rows[0].n;
  check(overig === 2, `Gmail en Moneybird staan er nog wel (gevonden: ${overig})`);

  // Herhaalbaar: nog een keer draaien mag niets kapotmaken.
  await db.exec(await readFile(path.join(MIGRATIONS_DIR, "20260827120000_hubspot_syncstate_opruimen.sql"), "utf8"));
  check(true, "Migratie 022 is herhaalbaar");

  // -------------------------------------------------------------------------
  // Testdata met echte HubSpot-sporen erin
  // -------------------------------------------------------------------------
  await db.exec(`
    insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'test@voorbeeld.nl');
    insert into public.organizations (id, name, slug) values ('${ORG}', 'Testschool', 'testschool');

    insert into public.organization_contacts (organization_id, email, hubspot_contact_id, is_verified)
    values ('${ORG}', 'sanne@testschool.nl', 'hs-contact-1', true),
           ('${ORG}', 'jan@testschool.nl',   'hs-contact-2', true),
           ('${ORG}', 'zonder@testschool.nl', null,          true);

    insert into public.bookings (id, organization_id, reference, workshop_name, status, scheduled_date, hubspot_deal_id, origin)
    values ('44444444-4444-4444-4444-444444444444', '${ORG}', 'SW-2026-9001', 'Graffiti', 'confirmed', current_date + 10, 'hs-deal-1', 'hubspot'),
           ('55555555-5555-5555-5555-555555555555', '${ORG}', 'SW-2026-9002', 'Dans',     'confirmed', current_date + 20, null,        'email_parser');
  `);

  // -------------------------------------------------------------------------
  // 2. Deel A: kolommen opruimen, met de ID's veiliggesteld
  // -------------------------------------------------------------------------
  const voorstel = await readFile(VOORSTEL, "utf8");

  try {
    await db.exec(deel(voorstel, "A"));
    check(true, "Deel A draait zonder fouten");
  } catch (error) {
    check(false, `Deel A mislukt: ${error.message}`);
    await db.close();
    process.exitCode = 1;
    return;
  }

  const archief = (
    await db.query(`
      select entity_type, external_id, external_label, internal_id
      from public.external_record_mappings
      where system = 'hubspot' order by external_id
    `)
  ).rows;

  check(archief.length === 3, `Alle drie de HubSpot-ID's staan in het archief (gevonden: ${archief.length})`);
  check(
    archief.some((r) => r.external_id === "hs-contact-1" && r.external_label === "sanne@testschool.nl"),
    "Bij een gearchiveerd contact staat ook het e-mailadres, zodat het terug te vinden is"
  );
  check(
    archief.some((r) => r.external_id === "hs-deal-1" && r.external_label === "SW-2026-9001"),
    "Bij een gearchiveerde deal staat het boekingsnummer"
  );

  const kolommen = (
    await db.query(`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public' and column_name in ('hubspot_contact_id', 'hubspot_deal_id')
    `)
  ).rows;
  check(kolommen.length === 0, "Beide kolommen zijn verdwenen");

  // De klantgegevens zelf moeten er nog gewoon zijn.
  const contacten = (await db.query(`select count(*)::int as n from public.organization_contacts`)).rows[0].n;
  const boekingen = (await db.query(`select count(*)::int as n from public.bookings`)).rows[0].n;
  check(contacten === 3, `Alle contactpersonen bestaan nog (${contacten})`);
  check(boekingen === 2, `Alle boekingen bestaan nog (${boekingen})`);

  // -------------------------------------------------------------------------
  // 3. Deel B: de enumwaarde uit booking_origin
  // -------------------------------------------------------------------------
  try {
    await db.exec(deel(voorstel, "B"));
    check(true, "Deel B draait zonder fouten");
  } catch (error) {
    check(false, `Deel B mislukt: ${error.message}`);
  }

  const origins = (
    await db.query(`
      select e.enumlabel from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'booking_origin' order by e.enumsortorder
    `)
  ).rows.map((r) => r.enumlabel);
  check(!origins.includes("hubspot"), `booking_origin bevat geen hubspot meer (${origins.join(", ")})`);

  const omgezet = (
    await db.query(`select origin from public.bookings where reference = 'SW-2026-9001'`)
  ).rows[0];
  check(omgezet?.origin === "import", `De boeking die op hubspot stond is nu import (${omgezet?.origin})`);
  check(
    (await db.query(`select count(*)::int as n from public.bookings`)).rows[0].n === 2,
    "Er is geen boeking verdwenen bij het omzetten"
  );

  // -------------------------------------------------------------------------
  // 4. Deel C: en dit is precies waarom ik het afraad
  // -------------------------------------------------------------------------
  const voorC = (
    await db.query(`select count(*)::int as n from public.external_record_mappings where system = 'hubspot'`)
  ).rows[0].n;

  try {
    await db.exec(deel(voorstel, "C"));
    check(true, "Deel C draait zonder fouten");
  } catch (error) {
    check(false, `Deel C mislukt: ${error.message}`);
  }

  // Let op: na deel C bestaat de enumwaarde niet meer, dus vergelijken met
  // 'hubspot' zou hier een typefout geven. Daarom via tekst.
  const naC = (
    await db.query(`select count(*)::int as n from public.external_record_mappings where system::text = 'hubspot'`)
  ).rows[0].n;

  check(
    voorC === 3 && naC === 0,
    `Deel C gooit het archief van deel A weg: ${voorC} regels ervoor, ${naC} erna. Dit is de reden om deel C niet te doen.`
  );

  const systemen = (
    await db.query(`
      select e.enumlabel from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'integration_system' order by e.enumsortorder
    `)
  ).rows.map((r) => r.enumlabel);
  check(!systemen.includes("hubspot"), `integration_system bevat geen hubspot meer (${systemen.join(", ")})`);

  await db.close();

  if (fouten > 0) {
    console.error(`\n  ${fouten} controle(s) mislukt.\n`);
    process.exitCode = 1;
    return;
  }
  console.log("\n  Migratie 022 en alle drie de delen van het voorstel doen wat er staat.\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
