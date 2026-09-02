/**
 * Controleert de tijdlijn en de taken tegen een echte Postgres in het geheugen.
 *
 *   node scripts/verify-crm-tijdlijn.mjs
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const TABELLEN = ["crm_activities", "crm_tasks"];

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

const ORG = "22222222-2222-2222-2222-222222222222";
const CONTACT = "aaaaaaaa-0000-4000-8000-000000000001";
const DEAL = "dddddddd-0000-4000-8000-000000000001";

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

  const policies = await een(
    db,
    `select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = any($1)`,
    [TABELLEN]
  );
  check(policies.n === 0, `Geen enkele policy op de nieuwe tabellen (${policies.n})`);

  // ---------------------------------------------------------------------------
  await db.exec(`
    insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'beheer@skoolworkshop.nl');
    insert into public.organizations (id, name, slug) values ('${ORG}', 'Testschool', 'testschool');
    insert into public.crm_contacts (id, organization_id, full_name, email)
      values ('${CONTACT}', '${ORG}', 'Sanne de Vries', 'sanne@testschool.nl');
  `);
  const fase = await een(
    db,
    `select id from public.crm_pipeline_stages where brand = 'skool_workshop' and key = 'nieuwe_aanvraag'`
  );
  await db.exec(`
    insert into public.crm_deals (id, brand, title, stage_id, organization_id)
    values ('${DEAL}', 'skool_workshop', 'Cultuurdag maart', '${fase.id}', '${ORG}');
  `);

  console.log("\n  Activiteiten");

  const zwevend = await moetFalen(
    db,
    `insert into public.crm_activities (kind, summary) values ('notitie', 'Hangt nergens aan')`
  );
  check(Boolean(zwevend), "Een activiteit zonder onderwerp wordt geweigerd");

  const leeg = await moetFalen(
    db,
    `insert into public.crm_activities (summary, organization_id) values ('x', '${ORG}')`
  );
  check(Boolean(leeg), "Een lege samenvatting wordt geweigerd");

  const gekkeSoort = await moetFalen(
    db,
    `insert into public.crm_activities (kind, summary, organization_id)
     values ('duifpost', 'Bericht verstuurd', '${ORG}')`
  );
  check(Boolean(gekkeSoort), "Een onbekende soort wordt geweigerd");

  const gedeeld = await moetFalen(
    db,
    `insert into public.crm_activities (kind, summary, organization_id, contact_id, deal_id)
     values ('gesprek', 'Gebeld over de offerte', '${ORG}', '${CONTACT}', '${DEAL}')`
  );
  check(!gedeeld, "Een activiteit mag aan meerdere dingen tegelijk hangen");

  const opDrie = await een(
    db,
    `select
       (select count(*)::int from public.crm_activities where organization_id = '${ORG}') as org,
       (select count(*)::int from public.crm_activities where contact_id = '${CONTACT}') as contact,
       (select count(*)::int from public.crm_activities where deal_id = '${DEAL}') as deal`
  );
  check(
    opDrie.org === 1 && opDrie.contact === 1 && opDrie.deal === 1,
    "En verschijnt dan op alle drie de schermen"
  );

  console.log("\n  Taken");

  const losseTaak = await moetFalen(
    db,
    `insert into public.crm_tasks (title, due_on) values ('Drukker bellen', current_date + 3)`
  );
  check(!losseTaak, "Een taak mag los staan van een relatie");

  const taakBijDeal = await moetFalen(
    db,
    `insert into public.crm_tasks (title, due_on, deal_id, organization_id)
     values ('Offerte nabellen', current_date - 2, '${DEAL}', '${ORG}')`
  );
  check(!taakBijDeal, "En mag ook aan een deal hangen");

  const teLaat = await een(
    db,
    `select count(*)::int as n from public.crm_tasks where done_at is null and due_on < current_date`
  );
  check(teLaat.n === 1, `Een taak over de datum is te vinden (${teLaat.n})`);

  // Afronden.
  await db.exec(`
    update public.crm_tasks set done_at = now(), done_by = '11111111-1111-1111-1111-111111111111'
    where title = 'Offerte nabellen'
  `);
  const naAfronden = await een(
    db,
    `select count(*)::int as n from public.crm_tasks where done_at is null and due_on < current_date`
  );
  check(naAfronden.n === 0, "En verdwijnt uit de lijst zodra hij af is");

  const halfAf = await moetFalen(
    db,
    `insert into public.crm_tasks (title, done_by) values ('Half afgerond', '11111111-1111-1111-1111-111111111111')`
  );
  check(Boolean(halfAf), "Afgerond door iemand, maar zonder moment, kan niet");

  console.log("\n  Opruimen loopt mee");

  await db.exec(`delete from public.crm_deals where id = '${DEAL}'`);
  const naDeal = await een(
    db,
    `select
       (select count(*)::int from public.crm_activities where deal_id = '${DEAL}') as activiteiten,
       (select count(*)::int from public.crm_tasks where deal_id = '${DEAL}') as taken`
  );
  check(
    naDeal.activiteiten === 0 && naDeal.taken === 0,
    "Een verwijderde deal laat geen losse activiteiten of taken achter"
  );

  const losseTaakBestaatNog = await een(
    db,
    `select count(*)::int as n from public.crm_tasks where title = 'Drukker bellen'`
  );
  check(losseTaakBestaatNog.n === 1, "Maar de losse taak staat er nog gewoon");

  console.log("\n  Bestaande gegevens");
  const org = await een(db, `select count(*)::int as n from public.organizations`);
  check(org.n === 1, "De organisatie bestaat nog");

  await db.close();

  if (fouten > 0) {
    console.error(`\n  ${fouten} controle(s) mislukt.\n`);
    process.exitCode = 1;
    return;
  }
  console.log("\n  De tijdlijn en de taken doen wat er staat.\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
