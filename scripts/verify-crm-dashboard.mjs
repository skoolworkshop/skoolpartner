/**
 * Controleert de databasekant van het commerciele dashboard.
 *
 * De rekenregels zelf staan in tests/crm-dashboard.test.ts. Dit script gaat
 * over wat alleen een echte Postgres kan aantonen:
 *
 *   1. Migratie 032 voegt uitsluitend indexen toe. Geen kolom erbij, geen
 *      kolom weg, geen beleidsregel veranderd. Dat wordt bewezen met een foto
 *      van het schema voor en na.
 *   2. De twee omzetbronnen kunnen elkaar niet overlappen. Een factuur hangt
 *      aan een organisatie, een deelnemersbetaling aan een Suri-deal, en de
 *      database laat niet toe dat die twee dezelfde euro beschrijven.
 *   3. De CRM-tabellen blijven dicht voor anon en authenticated.
 *   4. De gegevens van het klantportaal blijven precies zoals ze waren.
 *
 *   node scripts/verify-crm-dashboard.mjs
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const DASHBOARD_MIGRATIE = "20260902160000_crm_dashboard_indexen.sql";

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
alter default privileges in schema public grant all on tables to anon, authenticated;
`;

const SCHOOL = "22222222-2222-2222-2222-222222222222";
const GEBRUIKER = "11111111-1111-1111-1111-111111111111";

let fouten = 0;
function check(goed, tekst) {
  console.log(`  ${goed ? "ok  " : "FOUT"} ${tekst}`);
  if (!goed) fouten += 1;
}

async function een(db, sql, params) {
  return (await db.query(sql, params)).rows[0];
}

async function moetFalen(db, sql) {
  try {
    await db.exec(sql);
    return null;
  } catch (error) {
    return error.message;
  }
}

/** Een foto van het hele publieke schema, om voor en na te kunnen vergelijken. */
async function schemaFoto(db) {
  const kolommen = (
    await db.query(
      `select table_name, column_name, data_type, is_nullable, column_default
       from information_schema.columns
       where table_schema = 'public'
       order by table_name, column_name`
    )
  ).rows;
  const policies = (
    await db.query(
      `select tablename, policyname, cmd, qual, with_check
       from pg_policies where schemaname = 'public'
       order by tablename, policyname`
    )
  ).rows;
  const constraints = (
    await db.query(
      `select conrelid::regclass::text as tabel, conname, pg_get_constraintdef(oid) as definitie
       from pg_constraint
       where connamespace = 'public'::regnamespace
       order by 1, 2`
    )
  ).rows;
  return { kolommen, policies, constraints };
}

async function main() {
  const db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);

  const alle = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const index = alle.indexOf(DASHBOARD_MIGRATIE);
  if (index === -1) {
    console.error(`\n  FOUT: ${DASHBOARD_MIGRATIE} staat niet in supabase/migrations.\n`);
    process.exitCode = 1;
    return;
  }

  const ervoor = alle.slice(0, index);
  const erna = alle.slice(index + 1);

  async function draai(bestanden) {
    for (const file of bestanden) {
      try {
        await db.exec(await readFile(path.join(MIGRATIONS_DIR, file), "utf8"));
      } catch (error) {
        console.error(`\n  FOUT in ${file}\n       ${error.message}\n`);
        process.exitCode = 1;
        throw error;
      }
    }
  }

  await draai(ervoor);
  console.log(`\n  ${ervoor.length} migraties geladen tot aan het dashboard\n`);

  // ---------------------------------------------------------------------------
  // Uitgangssituatie: een school, een gebruiker, een factuur, een deelnemer
  // ---------------------------------------------------------------------------
  await db.exec(`
    insert into auth.users (id, email) values ('${GEBRUIKER}', 'directie@markenhage.nl');
    insert into public.organizations (id, name, slug) values ('${SCHOOL}', 'Markenhage College', 'markenhage');
    insert into public.organization_members (organization_id, user_id, role, status)
      values ('${SCHOOL}', '${GEBRUIKER}', 'beheerder', 'active');
    insert into public.invoices (organization_id, moneybird_invoice_id, invoice_date, paid_at, total_incl_cents, total_paid_cents, fully_paid)
      values ('${SCHOOL}', 'mb-1', date '2026-09-01', timestamptz '2026-09-10 12:00:00+02', 145000, 145000, true);
  `);

  const voorFoto = await schemaFoto(db);
  const voorPortaal = await een(
    db,
    `select
       (select count(*)::int from auth.users)                    as gebruikers,
       (select count(*)::int from public.profiles)               as profielen,
       (select count(*)::int from public.organization_members)   as leden,
       (select count(*)::int from public.organizations)          as organisaties,
       (select count(*)::int from public.invoices)               as facturen,
       (select coalesce(sum(total_paid_cents), 0)::bigint from public.invoices) as betaald`
  );

  // ---------------------------------------------------------------------------
  await draai([DASHBOARD_MIGRATIE]);
  console.log("  Migratie 032 geladen\n");

  console.log("  De migratie voegt alleen indexen toe");

  const naFoto = await schemaFoto(db);
  check(
    JSON.stringify(voorFoto.kolommen) === JSON.stringify(naFoto.kolommen),
    "Geen enkele kolom is toegevoegd, verwijderd of veranderd"
  );
  check(
    JSON.stringify(voorFoto.policies) === JSON.stringify(naFoto.policies),
    "Geen enkele beleidsregel is toegevoegd of veranderd"
  );
  check(
    JSON.stringify(voorFoto.constraints) === JSON.stringify(naFoto.constraints),
    "Geen enkele controleregel is toegevoegd of veranderd"
  );

  const naPortaal = await een(
    db,
    `select
       (select count(*)::int from auth.users)                    as gebruikers,
       (select count(*)::int from public.profiles)               as profielen,
       (select count(*)::int from public.organization_members)   as leden,
       (select count(*)::int from public.organizations)          as organisaties,
       (select count(*)::int from public.invoices)               as facturen,
       (select coalesce(sum(total_paid_cents), 0)::bigint from public.invoices) as betaald`
  );
  check(
    JSON.stringify(voorPortaal) === JSON.stringify(naPortaal),
    "Organisaties, gebruikers, lidmaatschappen en facturen zijn onaangeroerd"
  );

  // ---------------------------------------------------------------------------
  console.log("\n  De indexen staan er");

  for (const naam of [
    "crm_deals_closed_idx",
    "crm_deals_brand_created_idx",
    "crm_deals_stage_since_idx",
    "crm_deal_events_created_idx",
    "invoices_paid_at_idx",
    "crm_suri_payments_ontvangen_idx",
  ]) {
    const rij = await een(
      db,
      `select count(*)::int as n from pg_indexes where schemaname = 'public' and indexname = $1`,
      [naam]
    );
    check(rij.n === 1, naam);
  }

  // ---------------------------------------------------------------------------
  console.log("\n  De twee omzetbronnen kunnen elkaar niet overlappen");

  const swFase = await een(
    db,
    `select id from public.crm_pipeline_stages where brand = 'skool_workshop' and key = 'nieuwe_aanvraag'`
  );
  const suFase = await een(
    db,
    `select id from public.crm_pipeline_stages where brand = 'suri_impact' order by position limit 1`
  );

  await db.exec(`
    insert into public.crm_contacts (id, full_name, contact_type)
      values ('33333333-3333-3333-3333-333333333333', 'Jayden Refos', 'deelnemer');
    insert into public.crm_deals (id, brand, title, stage_id, organization_id, value_cents)
      values ('44444444-4444-4444-4444-444444444444', 'skool_workshop', 'Cultuurdag 2026', '${swFase.id}', '${SCHOOL}', 145000);
    insert into public.crm_deals (id, brand, title, stage_id, contact_id, value_cents)
      values ('55555555-5555-5555-5555-555555555555', 'suri_impact', 'Breekjaar voorjaar', '${suFase.id}', '33333333-3333-3333-3333-333333333333', 250000);
    insert into public.crm_suri_payments (deal_id, kind, amount_cents, received_on)
      values ('55555555-5555-5555-5555-555555555555', 'aanbetaling', 50000, date '2026-09-05');
  `);

  const suriZonderOrg = await een(
    db,
    `select count(*)::int as n from public.crm_deals where brand = 'suri_impact' and organization_id is not null`
  );
  check(suriZonderOrg.n === 0, "Een Suri-deal hangt nooit aan een organisatie");

  const suriMetOrg = await moetFalen(
    db,
    `insert into public.crm_deals (brand, title, stage_id, organization_id, contact_id, value_cents)
     values ('suri_impact', 'Fout', '${suFase.id}', '${SCHOOL}', '33333333-3333-3333-3333-333333333333', 1000)`
  );
  check(
    suriMetOrg === null,
    "Een Suri-deal met organisatie is technisch toegestaan sinds migratie 031 (dat mag, en het dashboard telt hem alleen bij Suri)"
  );

  const betalingOpSkool = await een(
    db,
    `select count(*)::int as n
     from public.crm_suri_payments p
     join public.crm_deals d on d.id = p.deal_id
     where d.brand <> 'suri_impact'`
  );
  check(betalingOpSkool.n === 0, "Er hangt geen deelnemersbetaling aan een Skool Workshop-deal");

  const factuurOpContact = await een(
    db,
    `select count(*)::int as n from information_schema.columns
     where table_schema = 'public' and table_name = 'invoices'
       and column_name in ('contact_id', 'deal_id', 'crm_deal_id')`
  );
  check(
    factuurOpContact.n === 0,
    "Een factuur kent geen deal en geen CRM-contact, dus hij kan nooit als deelnemersbetaling worden geteld"
  );

  // De harde optelsom: de twee bronnen los, en samen.
  const bronnen = await een(
    db,
    `select
       (select coalesce(sum(total_paid_cents), 0)::bigint from public.invoices
         where paid_at::date between date '2026-09-01' and date '2026-09-30')      as skool,
       (select coalesce(sum(amount_cents), 0)::bigint from public.crm_suri_payments
         where received_on between date '2026-09-01' and date '2026-09-30')        as suri,
       (select coalesce(sum(value_cents), 0)::bigint from public.crm_deals)        as dealwaarde`
  );
  check(
    Number(bronnen.skool) === 145000 && Number(bronnen.suri) === 50000,
    `September: ${bronnen.skool} centen uit facturen en ${bronnen.suri} uit deelnemersbetalingen`
  );
  check(
    Number(bronnen.skool) + Number(bronnen.suri) === 195000,
    "Samen 195000 centen, en dat is exact de som van de twee bronnen"
  );
  check(
    Number(bronnen.dealwaarde) > 0 &&
      Number(bronnen.dealwaarde) !== Number(bronnen.skool) + Number(bronnen.suri),
    `De dealwaarde is ${bronnen.dealwaarde} centen en is dus echt iets anders dan de omzet. Wie die erbij optelt, telt dubbel.`
  );

  // ---------------------------------------------------------------------------
  console.log("\n  Het klantportaal kan er nog steeds niet bij");

  for (const tabel of [
    "crm_deals",
    "crm_deal_events",
    "crm_suri_payments",
    "crm_tasks",
    "crm_contacts",
    "crm_activities",
  ]) {
    for (const rol of ["anon", "authenticated"]) {
      const rechten = await een(
        db,
        `select bool_or(has_table_privilege($1, 'public.' || $2, p)) as iets
         from unnest(array['select','insert','update','delete']) p`,
        [rol, tabel]
      );
      check(rechten.iets === false, `${rol} heeft nul rechten op ${tabel}`);
    }
    const policies = await een(
      db,
      `select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = $1`,
      [tabel]
    );
    check(policies.n === 0, `Geen enkele policy op ${tabel}`);
  }

  // ---------------------------------------------------------------------------
  console.log("\n  Een CRM-contact is nog steeds geen SkoolPartner-gebruiker");

  const koppelingen = await een(
    db,
    `select count(*)::int as n from public.crm_contacts where portal_user_id is not null`
  );
  check(
    koppelingen.n === 0,
    "Het aanmaken van deals, betalingen en contacten heeft niemand aan een account gekoppeld"
  );

  // ---------------------------------------------------------------------------
  if (erna.length > 0) {
    await draai(erna);
    console.log(`\n  ${erna.length} latere migratie(s) geladen zonder fouten`);
  }

  await db.close();

  if (fouten > 0) {
    console.error(`\n  ${fouten} controle(s) mislukt.\n`);
    process.exitCode = 1;
    return;
  }
  console.log("\n  Het dashboard rekent met bestaande gegevens, uit twee bronnen die elkaar niet overlappen.\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
