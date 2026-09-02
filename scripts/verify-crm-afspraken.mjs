/**
 * Controleert de databasekant van de afspraken.
 *
 * De regels over tijd, overlap en status staan in tests/crm-afspraken.test.ts.
 * Dit script gaat over wat alleen een echte Postgres kan aantonen:
 *
 *   1. Migratie 034 raakt geen enkele bestaande tabel aan.
 *   2. Een afspraak eindigt na zijn begin, en duurt geen week.
 *   3. Een afspraak hoort ergens bij, net als een activiteit.
 *   4. Soort, vorm, stand en herkomst worden door de database bewaakt.
 *   5. Opruimen laat niets zweven.
 *   6. Het klantportaal kan er niet bij, ook niet straks via de boekingslink.
 *
 *   node scripts/verify-crm-afspraken.mjs
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const AFSPRAAK_MIGRATIE = "20260902180000_crm_afspraken.sql";

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
const CONTACT = "33333333-3333-3333-3333-333333333333";
const DEAL = "44444444-4444-4444-4444-444444444444";

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

async function schemaFoto(db, negeer = []) {
  const uitzondering = negeer.length
    ? `and table_name not in (${negeer.map((t) => `'${t}'`).join(", ")})`
    : "";
  const kolommen = (
    await db.query(
      `select table_name, column_name, data_type, is_nullable, column_default
       from information_schema.columns
       where table_schema = 'public' ${uitzondering}
       order by table_name, column_name`
    )
  ).rows;
  const policies = (
    await db.query(
      `select tablename, policyname, cmd, qual, with_check
       from pg_policies where schemaname = 'public' order by tablename, policyname`
    )
  ).rows;
  return { kolommen, policies };
}

/** Een afspraak invoegen met alleen wat afwijkt van het normale geval. */
function afspraak(velden = {}) {
  const basis = {
    title: "'Kennismaking Markenhage'",
    starts_at: "timestamptz '2026-09-20 10:00:00+02'",
    ends_at: "timestamptz '2026-09-20 11:00:00+02'",
    organization_id: `'${SCHOOL}'`,
    ...velden,
  };
  const kolommen = Object.keys(basis).join(", ");
  const waarden = Object.values(basis).join(", ");
  return `insert into public.crm_meetings (${kolommen}) values (${waarden})`;
}

async function main() {
  const db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);

  const alle = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const index = alle.indexOf(AFSPRAAK_MIGRATIE);
  if (index === -1) {
    console.error(`\n  FOUT: ${AFSPRAAK_MIGRATIE} staat niet in supabase/migrations.\n`);
    process.exitCode = 1;
    return;
  }

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

  const ervoor = alle.slice(0, index);
  const erna = alle.slice(index + 1);

  await draai(ervoor);
  console.log(`\n  ${ervoor.length} migraties geladen tot aan de afspraken\n`);

  const fase = await een(
    db,
    `select id from public.crm_pipeline_stages where brand = 'skool_workshop' and key = 'nieuwe_aanvraag'`
  );

  await db.exec(`
    insert into auth.users (id, email) values ('${GEBRUIKER}', 'directie@markenhage.nl');
    insert into public.organizations (id, name, slug) values ('${SCHOOL}', 'Markenhage College', 'markenhage');
    insert into public.organization_members (organization_id, user_id, role, status)
      values ('${SCHOOL}', '${GEBRUIKER}', 'beheerder', 'active');
    insert into public.crm_contacts (id, organization_id, full_name, contact_type)
      values ('${CONTACT}', '${SCHOOL}', 'Nora Bakker', 'cultuurcoordinator');
    insert into public.crm_deals (id, brand, title, stage_id, organization_id, contact_id, value_cents)
      values ('${DEAL}', 'skool_workshop', 'Cultuurdag 2026', '${fase.id}', '${SCHOOL}', '${CONTACT}', 145000);
  `);

  const voor = await schemaFoto(db);
  const voorRijen = await een(
    db,
    `select
       (select count(*)::int from public.organizations)        as organisaties,
       (select count(*)::int from public.organization_members) as leden,
       (select count(*)::int from public.crm_contacts)         as contacten,
       (select count(*)::int from public.crm_deals)            as deals,
       (select count(*)::int from public.crm_activities)       as activiteiten`
  );

  await draai([AFSPRAAK_MIGRATIE]);
  console.log("  Migratie 034 geladen\n");

  // ---------------------------------------------------------------------------
  console.log("  Er verandert niets aan wat er al stond");

  const na = await schemaFoto(db, ["crm_meetings"]);
  check(
    JSON.stringify(voor.kolommen) === JSON.stringify(na.kolommen),
    "Geen kolom toegevoegd, verwijderd of veranderd buiten de nieuwe tabel"
  );
  check(
    JSON.stringify(voor.policies) === JSON.stringify(na.policies),
    "Geen enkele bestaande beleidsregel is aangeraakt"
  );

  const naRijen = await een(
    db,
    `select
       (select count(*)::int from public.organizations)        as organisaties,
       (select count(*)::int from public.organization_members) as leden,
       (select count(*)::int from public.crm_contacts)         as contacten,
       (select count(*)::int from public.crm_deals)            as deals,
       (select count(*)::int from public.crm_activities)       as activiteiten`
  );
  check(
    JSON.stringify(voorRijen) === JSON.stringify(naRijen),
    "Organisaties, gebruikers, contacten, deals en de tijdlijn zijn onaangeroerd"
  );

  const eigenTabel = await een(
    db,
    `select count(*)::int as n from information_schema.columns
     where table_schema = 'public' and table_name = 'crm_activities'
       and column_name in ('starts_at', 'ends_at', 'meeting_status')`
  );
  check(
    eigenTabel.n === 0,
    "De tijdlijn heeft geen afspraakkolommen gekregen, afspraken staan in een eigen tabel"
  );

  // ---------------------------------------------------------------------------
  console.log("\n  Een afspraak heeft een geldig begin en eind");

  const goed = await moetFalen(db, afspraak());
  check(!goed, "Een gewone afspraak van een uur kan worden vastgelegd");

  const omgedraaid = await moetFalen(
    db,
    afspraak({
      title: "'Omgedraaid'",
      starts_at: "timestamptz '2026-09-20 11:00:00+02'",
      ends_at: "timestamptz '2026-09-20 10:00:00+02'",
    })
  );
  check(Boolean(omgedraaid), "Een afspraak die eindigt voor hij begint wordt geweigerd");

  const nulDuur = await moetFalen(
    db,
    afspraak({
      title: "'Nul minuten'",
      ends_at: "timestamptz '2026-09-20 10:00:00+02'",
    })
  );
  check(Boolean(nulDuur), "Een afspraak van nul minuten wordt geweigerd");

  const teLang = await moetFalen(
    db,
    afspraak({
      title: "'Verkeerd jaartal'",
      ends_at: "timestamptz '2027-09-20 11:00:00+02'",
    })
  );
  check(
    Boolean(teLang),
    "Een afspraak van langer dan een etmaal wordt geweigerd, dat is een typefout in de datum"
  );

  const precies24 = await moetFalen(
    db,
    afspraak({
      title: "'Precies een etmaal'",
      ends_at: "timestamptz '2026-09-21 10:00:00+02'",
    })
  );
  check(!precies24, "Precies een etmaal mag nog net wel");

  // ---------------------------------------------------------------------------
  console.log("\n  Een afspraak hoort ergens bij");

  const zwevend = await moetFalen(
    db,
    `insert into public.crm_meetings (title, starts_at, ends_at)
     values ('Zwevend', timestamptz '2026-09-20 10:00:00+02', timestamptz '2026-09-20 11:00:00+02')`
  );
  check(Boolean(zwevend), "Een afspraak zonder organisatie, contact of deal wordt geweigerd");

  const alledrie = await moetFalen(
    db,
    afspraak({
      title: "'Bij alledrie'",
      contact_id: `'${CONTACT}'`,
      deal_id: `'${DEAL}'`,
    })
  );
  check(
    !alledrie,
    "Aan alledrie tegelijk hangen mag wel: een gesprek over een deal hoort ook bij de school"
  );

  // ---------------------------------------------------------------------------
  console.log("\n  Soort, vorm, stand en herkomst");

  for (const [kolom, waarde] of [
    ["kind", "'koffie'"],
    ["form", "'per_duif'"],
    ["status", "'misschien'"],
    ["source", "'geimporteerd'"],
  ]) {
    const fout = await moetFalen(db, afspraak({ title: `'Fout ${kolom}'`, [kolom]: waarde }));
    check(Boolean(fout), `Een onbekende waarde voor ${kolom} wordt geweigerd`);
  }

  const standaarden = await een(
    db,
    `select status, kind, form, source, calendar_event_id
     from public.crm_meetings where title = 'Kennismaking Markenhage'`
  );
  check(standaarden.status === "gepland", "Een nieuwe afspraak staat standaard op gepland");
  check(
    standaarden.source === "handmatig" && standaarden.calendar_event_id === null,
    "Herkomst is handmatig en er is geen agendakoppeling, precies zoals in deze fase hoort"
  );

  // ---------------------------------------------------------------------------
  console.log("\n  Opruimen laat niets zweven");

  await db.exec(
    afspraak({ title: "'Hangt aan de deal'", organization_id: "null", deal_id: `'${DEAL}'` })
  );
  const voorVerwijderen = await een(
    db,
    `select count(*)::int as n from public.crm_meetings where title = 'Hangt aan de deal'`
  );
  check(voorVerwijderen.n === 1, "De afspraak bij de deal staat erin");

  await db.exec(`delete from public.crm_deals where id = '${DEAL}'`);
  const naVerwijderen = await een(
    db,
    `select count(*)::int as n from public.crm_meetings where title = 'Hangt aan de deal'`
  );
  check(
    naVerwijderen.n === 0,
    "Een verwijderde deal neemt de afspraak mee die alleen aan die deal hing"
  );

  const bijSchool = await een(
    db,
    `select count(*)::int as n from public.crm_meetings where organization_id = '${SCHOOL}'`
  );
  check(bijSchool.n > 0, `De afspraken bij de school staan er nog (${bijSchool.n})`);

  // ---------------------------------------------------------------------------
  console.log("\n  Het klantportaal kan er niet bij");

  for (const rol of ["anon", "authenticated"]) {
    const rechten = await een(
      db,
      `select bool_or(has_table_privilege($1, 'public.crm_meetings', p)) as iets
       from unnest(array['select','insert','update','delete']) p`,
      [rol]
    );
    check(rechten.iets === false, `${rol} heeft nul rechten op crm_meetings`);
  }

  const policies = await een(
    db,
    `select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = 'crm_meetings'`
  );
  check(policies.n === 0, "Geen enkele policy op crm_meetings");

  const rls = await een(
    db,
    `select relrowsecurity as aan, relforcerowsecurity as gedwongen
     from pg_class where oid = 'public.crm_meetings'::regclass`
  );
  check(rls.aan === true && rls.gedwongen === true, "RLS staat aan en is afgedwongen");

  const naarAuth = await een(
    db,
    `select count(*)::int as n from information_schema.columns
     where table_schema = 'public' and table_name = 'crm_meetings'
       and column_name in ('user_id', 'portal_user_id', 'auth_user_id')`
  );
  check(naarAuth.n === 0, "Een afspraak kent geen klantportaalaccount");

  const portaal = await een(
    db,
    `select
       (select count(*)::int from public.organization_members) as leden,
       (select count(*)::int from public.organizations)        as organisaties`
  );
  check(
    portaal.leden === 1 && portaal.organisaties === 1,
    "Lidmaatschappen en organisaties zijn niet veranderd door dit alles"
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
  console.log("\n  Afspraken staan in een eigen tabel, met geldige tijden en dicht voor de klant.\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
