/**
 * Controleert de pijplijn, de reisperiodes en de deelnemers tegen een echte
 * Postgres in het geheugen.
 *
 * Wat hier bewezen wordt:
 *
 *   1. De database weigert een deal zonder onderwerp of met een fase van het
 *      verkeerde merk, en staat een organisatie met contactpersoon wel toe.
 *   2. Een reisperiode kan niet stiekem aan een Skool Workshop-deal hangen.
 *   3. De bezetting klopt en wordt berekend, niet bijgehouden.
 *   4. Een klant kan bij niets van dit alles.
 *
 *   node scripts/verify-crm-deals.mjs
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const TABELLEN = [
  "crm_suri_editions",
  "crm_deals",
  "crm_deal_events",
  "crm_suri_profiles",
  "crm_suri_payments",
];

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

-- Supabase deelt nieuwe tabellen standaard rechten uit. Nabootsen, anders
-- test je een situatie die in productie niet bestaat.
alter default privileges in schema public grant all on tables to anon, authenticated;
`;

const ORG = "22222222-2222-2222-2222-222222222222";

let fouten = 0;
function check(goed, tekst) {
  console.log(`  ${goed ? "ok  " : "FOUT"} ${tekst}`);
  if (!goed) fouten += 1;
}

async function moetFalen(db, sql) {
  try {
    await db.exec(sql);
    return null;
  } catch (error) {
    return error.message;
  }
}

async function een(db, sql, params) {
  return (await db.query(sql, params)).rows[0];
}

async function main() {
  const db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    try {
      await db.exec(await readFile(path.join(MIGRATIONS_DIR, file), "utf8"));
    } catch (error) {
      console.error(`\n  FOUT in ${file}\n       ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
  }
  console.log(`\n  ${files.length} migraties geladen\n`);

  // ---------------------------------------------------------------------------
  // Beveiliging
  // ---------------------------------------------------------------------------
  console.log("  Beveiliging");

  for (const tabel of TABELLEN) {
    const rij = await een(
      db,
      `select c.relrowsecurity as rls, c.relforcerowsecurity as geforceerd
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = $1`,
      [tabel]
    );
    check(rij?.rls === true && rij?.geforceerd === true, `${tabel}: RLS aan en geforceerd`);

    const rechten = await een(
      db,
      `select bool_or(has_table_privilege(r, 'public.' || $1, p)) as iets
       from unnest(array['anon','authenticated']) r,
            unnest(array['select','insert','update','delete']) p`,
      [tabel]
    );
    check(rechten.iets === false, `${tabel}: anon en authenticated hebben nul rechten`);
  }

  const viewRecht = await een(
    db,
    `select bool_or(has_table_privilege(r, 'public.crm_suri_edition_capacity', 'select')) as iets
     from unnest(array['anon','authenticated']) r`
  );
  check(viewRecht.iets === false, "De bezettingsview is ook dicht");

  const policies = await een(
    db,
    `select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = any($1)`,
    [TABELLEN]
  );
  check(policies.n === 0, `Geen enkele policy op de nieuwe tabellen (${policies.n})`);

  // ---------------------------------------------------------------------------
  // Testgegevens
  // ---------------------------------------------------------------------------
  await db.exec(`
    insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'beheer@skoolworkshop.nl');
    insert into public.organizations (id, name, slug) values ('${ORG}', 'Testschool', 'testschool');
    insert into public.crm_contacts (id, full_name, email) values
      ('aaaaaaaa-0000-4000-8000-000000000001', 'Jayden Refos', 'jayden@voorbeeld.nl'),
      ('aaaaaaaa-0000-4000-8000-000000000002', 'Naomi Pinas',  'naomi@voorbeeld.nl'),
      ('aaaaaaaa-0000-4000-8000-000000000003', 'Ruben Doelwijt','ruben@voorbeeld.nl');
    insert into public.crm_contacts (id, organization_id, full_name, email) values
      ('bbbbbbbb-0000-4000-8000-000000000001', '${ORG}', 'Sanne de Vries', 'sanne@testschool.nl');
    insert into public.crm_suri_editions (id, name, starts_on, ends_on, capacity, price_cents, status)
    values ('cccccccc-0000-4000-8000-000000000001', 'Oktober 2026', date '2026-10-02', date '2026-11-01', 3, 425000, 'open');
  `);

  const swFase = await een(
    db,
    `select id from public.crm_pipeline_stages where brand = 'skool_workshop' and key = 'nieuwe_aanvraag'`
  );
  const swGewonnen = await een(
    db,
    `select id from public.crm_pipeline_stages where brand = 'skool_workshop' and is_won`
  );
  const suriFase = await een(
    db,
    `select id from public.crm_pipeline_stages where brand = 'suri_impact' and key = 'aanmelding'`
  );
  const suriBetaald = await een(
    db,
    `select id from public.crm_pipeline_stages where brand = 'suri_impact' and is_won`
  );
  const suriAf = await een(
    db,
    `select id from public.crm_pipeline_stages where brand = 'suri_impact' and is_lost`
  );

  // ---------------------------------------------------------------------------
  // Regel 1: een deal hangt ergens aan
  // ---------------------------------------------------------------------------
  console.log("\n  Een deal hangt aan een organisatie, een persoon of allebei");

  const zonder = await moetFalen(
    db,
    `insert into public.crm_deals (brand, title, stage_id) values ('skool_workshop', 'Zwevende deal', '${swFase.id}')`
  );
  check(Boolean(zonder), "Een deal zonder organisatie en zonder persoon wordt geweigerd");

  // Sinds migratie 031 mag een deal aan een organisatie EN een contactpersoon
  // hangen. Bij een school wil je juist weten met wie je praat.
  const allebei = await moetFalen(
    db,
    `insert into public.crm_deals (brand, title, stage_id, organization_id, contact_id)
     values ('skool_workshop', 'School met contactpersoon', '${swFase.id}', '${ORG}', 'bbbbbbbb-0000-4000-8000-000000000001')`
  );
  check(!allebei, "Een deal mag aan een organisatie en een contactpersoon tegelijk hangen");

  const school = await moetFalen(
    db,
    `insert into public.crm_deals (id, brand, title, stage_id, organization_id, value_cents)
     values ('dddddddd-0000-4000-8000-000000000001', 'skool_workshop', 'Cultuurdag maart', '${swFase.id}', '${ORG}', 145000)`
  );
  check(!school, "Een schooldeal met alleen een organisatie mag");

  // ---------------------------------------------------------------------------
  // Regel 2: de fase hoort bij het merk
  // ---------------------------------------------------------------------------
  console.log("\n  De fase hoort bij het merk");

  const verkeerdeFase = await moetFalen(
    db,
    `insert into public.crm_deals (brand, title, stage_id, contact_id)
     values ('suri_impact', 'Aanmelding met schoolfase', '${swFase.id}', 'aaaaaaaa-0000-4000-8000-000000000001')`
  );
  check(
    Boolean(verkeerdeFase),
    "Een Suri-deal kan niet in een Skool Workshop-fase worden gezet"
  );

  const goedeFase = await moetFalen(
    db,
    `insert into public.crm_deals (id, brand, title, stage_id, contact_id, edition_id, value_cents)
     values ('dddddddd-0000-4000-8000-000000000002', 'suri_impact', 'Jayden Refos', '${suriFase.id}',
             'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', 425000)`
  );
  check(!goedeFase, "Met de eigen fase van Suri mag het wel");

  // ---------------------------------------------------------------------------
  // Regel 3: reisperiode en boeking horen bij het juiste merk
  // ---------------------------------------------------------------------------
  console.log("\n  Reisperiode en boeking horen bij het juiste merk");

  const periodeBijSchool = await moetFalen(
    db,
    `update public.crm_deals set edition_id = 'cccccccc-0000-4000-8000-000000000001'
     where id = 'dddddddd-0000-4000-8000-000000000001'`
  );
  check(Boolean(periodeBijSchool), "Een schooldeal kan niet in een reisperiode worden gezet");

  const suriZonderPersoon = await moetFalen(
    db,
    `insert into public.crm_deals (brand, title, stage_id, organization_id)
     values ('suri_impact', 'School boekt Breekjaar', '${suriFase.id}', '${ORG}')`
  );
  check(Boolean(suriZonderPersoon), "Een school kan zich niet aanmelden voor het Breekjaar");

  const dubbeleAanmelding = await moetFalen(
    db,
    `insert into public.crm_deals (brand, title, stage_id, contact_id, edition_id)
     values ('suri_impact', 'Jayden nog een keer', '${suriFase.id}',
             'aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001')`
  );
  check(Boolean(dubbeleAanmelding), "Dezelfde persoon staat niet twee keer in dezelfde reisperiode");

  // ---------------------------------------------------------------------------
  // De funnel van Skool Workshop
  // ---------------------------------------------------------------------------
  console.log("\n  De funnel");

  const funnel = (
    await db.query(
      `select key, label, position, is_won, is_lost from public.crm_pipeline_stages
       where brand = 'skool_workshop' order by position`
    )
  ).rows;

  const verwacht = [
    "nieuwe_aanvraag",
    "contact_gelegd",
    "offerte_verstuurd",
    "opvolging",
    "akkoord",
    "facturatie",
    "ingepland",
    "uitgevoerd",
    "evaluatie",
    "afgerond",
    "verloren",
  ];
  check(
    JSON.stringify(funnel.map((f) => f.key)) === JSON.stringify(verwacht),
    `De elf fases staan in de goede volgorde (${funnel.map((f) => f.label).join(" → ")})`
  );

  check(
    funnel.filter((f) => f.is_won).length === 1 && funnel.find((f) => f.is_won)?.key === "afgerond",
    "Afgerond is de enige fase die telt als gewonnen"
  );
  check(
    funnel.filter((f) => f.is_lost).length === 1 && funnel.find((f) => f.is_lost)?.key === "verloren",
    "Niet doorgegaan is de enige fase die telt als verloren"
  );

  const posities = funnel.map((f) => Number(f.position));
  check(
    posities.every((p, i) => i === 0 || p > posities[i - 1]),
    "Geen twee fases delen dezelfde plek in de volgorde"
  );

  // stage_since hoort gevuld te zijn, ook bij een deal die al bestond.
  const zonderSince = await een(
    db,
    `select count(*)::int as n from public.crm_deals where stage_since is null`
  );
  check(zonderSince.n === 0, "Elke deal weet sinds wanneer hij in zijn fase staat");

  // ---------------------------------------------------------------------------
  // Betalingen
  // ---------------------------------------------------------------------------
  console.log("\n  Betalingen");

  const verkeerdTeken = await moetFalen(
    db,
    `insert into public.crm_suri_payments (deal_id, kind, amount_cents)
     values ('dddddddd-0000-4000-8000-000000000002', 'aanbetaling', -50000)`
  );
  check(Boolean(verkeerdTeken), "Een aanbetaling kan niet negatief zijn");

  const correctieZonderReden = await moetFalen(
    db,
    `insert into public.crm_suri_payments (deal_id, kind, amount_cents)
     values ('dddddddd-0000-4000-8000-000000000002', 'correctie', 1000)`
  );
  check(Boolean(correctieZonderReden), "Een correctie zonder reden wordt geweigerd");

  await db.exec(`
    insert into public.crm_suri_payments (deal_id, kind, amount_cents, external_reference)
    values ('dddddddd-0000-4000-8000-000000000002', 'aanbetaling', 50000, 'mb-1');
  `);
  const dubbeleBetaling = await moetFalen(
    db,
    `insert into public.crm_suri_payments (deal_id, kind, amount_cents, external_reference)
     values ('dddddddd-0000-4000-8000-000000000002', 'aanbetaling', 50000, 'mb-1')`
  );
  check(Boolean(dubbeleBetaling), "Dezelfde betaling kan niet twee keer worden ingelezen");

  // ---------------------------------------------------------------------------
  // De bezetting
  // ---------------------------------------------------------------------------
  console.log("\n  De bezetting per reisperiode");

  let bezetting = await een(
    db,
    `select * from public.crm_suri_edition_capacity where edition_id = 'cccccccc-0000-4000-8000-000000000001'`
  );
  check(Number(bezetting.aangemeld) === 1, `Een aanmelding geteld (${bezetting.aangemeld})`);
  check(Number(bezetting.vrij) === 2, `Twee plaatsen vrij van de drie (${bezetting.vrij})`);
  check(
    Number(bezetting.ontvangen_cents) === 50000,
    `De aanbetaling telt mee (${bezetting.ontvangen_cents})`
  );

  await db.exec(`
    insert into public.crm_deals (id, brand, title, stage_id, contact_id, edition_id)
    values ('dddddddd-0000-4000-8000-000000000003', 'suri_impact', 'Naomi Pinas', '${suriBetaald.id}',
            'aaaaaaaa-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000001'),
           ('dddddddd-0000-4000-8000-000000000004', 'suri_impact', 'Ruben Doelwijt', '${suriAf.id}',
            'aaaaaaaa-0000-4000-8000-000000000003', 'cccccccc-0000-4000-8000-000000000001');
  `);

  bezetting = await een(
    db,
    `select * from public.crm_suri_edition_capacity where edition_id = 'cccccccc-0000-4000-8000-000000000001'`
  );
  check(Number(bezetting.aangemeld) === 2, `Wie afhaakt telt niet mee (${bezetting.aangemeld})`);
  check(Number(bezetting.afgehaakt) === 1, `De afhaker wordt wel apart geteld (${bezetting.afgehaakt})`);
  check(
    Number(bezetting.volledig_betaald) === 1,
    `En wie volledig betaald heeft ook (${bezetting.volledig_betaald})`
  );
  check(Number(bezetting.vrij) === 1, `Nog een plaats vrij (${bezetting.vrij})`);

  // De view is berekend: haal een deal weg en het getal loopt vanzelf mee.
  await db.exec(`delete from public.crm_deals where id = 'dddddddd-0000-4000-8000-000000000003'`);
  bezetting = await een(
    db,
    `select * from public.crm_suri_edition_capacity where edition_id = 'cccccccc-0000-4000-8000-000000000001'`
  );
  check(
    Number(bezetting.aangemeld) === 1 && Number(bezetting.vrij) === 2,
    "De bezetting loopt vanzelf mee als er een deal verdwijnt"
  );

  const leeg = await een(
    db,
    `insert into public.crm_suri_editions (name, starts_on, ends_on)
     values ('Maart 2027', date '2027-03-12', date '2027-04-11')
     returning id`
  );
  const legeBezetting = await een(
    db,
    `select * from public.crm_suri_edition_capacity where edition_id = $1`,
    [leeg.id]
  );
  check(
    Number(legeBezetting.aangemeld) === 0 && Number(legeBezetting.vrij) === 15,
    `Een lege periode toont vijftien vrije plaatsen (${legeBezetting.vrij})`
  );

  // ---------------------------------------------------------------------------
  // Reisperiodes zelf
  // ---------------------------------------------------------------------------
  console.log("\n  Reisperiodes");

  const omgekeerd = await moetFalen(
    db,
    `insert into public.crm_suri_editions (name, starts_on, ends_on)
     values ('Onmogelijk', date '2027-05-30', date '2027-04-30')`
  );
  check(Boolean(omgekeerd), "Een periode die eerder eindigt dan hij begint wordt geweigerd");

  const gekkeStatus = await moetFalen(
    db,
    `insert into public.crm_suri_editions (name, starts_on, ends_on, status)
     values ('Rare status', date '2027-05-01', date '2027-05-30', 'misschien')`
  );
  check(Boolean(gekkeStatus), "Een onbekende status wordt geweigerd");

  // ---------------------------------------------------------------------------
  // Deelnemersprofiel
  // ---------------------------------------------------------------------------
  console.log("\n  Het deelnemersprofiel");

  const kolommen = (
    await db.query(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'crm_suri_profiles'`
    )
  ).rows.map((r) => r.column_name);

  const nietOpgeslagen = ["medical", "medisch", "allergie", "dieet", "passport", "paspoort", "bsn"];
  const gevonden = kolommen.filter((k) => nietOpgeslagen.some((n) => k.includes(n)));
  check(
    gevonden.length === 0,
    gevonden.length === 0
      ? "Er staan geen medische, dieet- of paspoortvelden in"
      : `Er staat iets in wat er niet hoort: ${gevonden.join(", ")}`
  );

  const profiel = await moetFalen(
    db,
    `insert into public.crm_suri_profiles (contact_id, birth_date, guardian_name, guardian_email)
     values ('aaaaaaaa-0000-4000-8000-000000000001', date '2008-04-12', 'M. Refos', 'ouder@voorbeeld.nl')`
  );
  check(!profiel, "Een profiel met een ouder erbij kan worden vastgelegd");

  const toekomst = await moetFalen(
    db,
    `insert into public.crm_suri_profiles (contact_id, birth_date)
     values ('aaaaaaaa-0000-4000-8000-000000000003', current_date + 1)`
  );
  check(Boolean(toekomst), "Een geboortedatum in de toekomst wordt geweigerd");

  // ---------------------------------------------------------------------------
  // Fasehistorie
  // ---------------------------------------------------------------------------
  console.log("\n  Fasewisselingen blijven bewaard");

  await db.exec(`
    insert into public.crm_deal_events (deal_id, from_stage_id, to_stage_id)
    values ('dddddddd-0000-4000-8000-000000000001', '${swFase.id}', '${swGewonnen.id}');
    update public.crm_deals set stage_id = '${swGewonnen.id}', closed_at = now()
    where id = 'dddddddd-0000-4000-8000-000000000001';
  `);

  const historie = await een(
    db,
    `select count(*)::int as n from public.crm_deal_events where deal_id = 'dddddddd-0000-4000-8000-000000000001'`
  );
  check(historie.n === 1, "De fasewisseling staat in de historie");

  await db.exec(`delete from public.crm_deals where id = 'dddddddd-0000-4000-8000-000000000001'`);
  const naVerwijderen = await een(db, `select count(*)::int as n from public.crm_deal_events`);
  check(naVerwijderen.n === 0, "En verdwijnt netjes mee als de deal wordt verwijderd");

  // ---------------------------------------------------------------------------
  // Klantgegevens blijven heel
  // ---------------------------------------------------------------------------
  console.log("\n  Bestaande gegevens");

  const org = await een(db, `select count(*)::int as n from public.organizations`);
  check(org.n === 1, "De organisatie bestaat nog");

  const boekingKolom = await een(
    db,
    `select count(*)::int as n from information_schema.columns
     where table_schema = 'public' and table_name = 'bookings' and column_name = 'brand'`
  );
  check(boekingKolom.n === 0, "bookings heeft nog steeds geen merkkolom gekregen");

  await db.close();

  if (fouten > 0) {
    console.error(`\n  ${fouten} controle(s) mislukt.\n`);
    process.exitCode = 1;
    return;
  }
  console.log("\n  De pijplijn, de reisperiodes en de deelnemers doen wat er staat.\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
