/**
 * Controleert de databasekant van de fragmenten.
 *
 * De tekstbewerking zelf staat in tests/crm-fragmenten.test.ts. Dit script gaat
 * over wat alleen een echte Postgres kan aantonen:
 *
 *   1. Migratie 033 raakt geen enkele bestaande tabel aan. Bewezen met een foto
 *      van het schema voor en na.
 *   2. De sneltoets is uniek binnen een merk, ook als het merk leeg is. Dat is
 *      de valkuil: in Postgres is null nooit gelijk aan null, dus een gewone
 *      unieke index dwingt daar niets af.
 *   3. De vorm van de sneltoets wordt door de database bewaakt, niet alleen
 *      door het formulier.
 *   4. Het aantal keer gebruikt is een telling en geen opgeslagen getal.
 *   5. Een fragment weggooien laat de gebruiksregels niet zwerven.
 *   6. Het klantportaal kan er niet bij.
 *
 *   node scripts/verify-crm-fragmenten.mjs
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const FRAGMENT_MIGRATIE = "20260902170000_crm_fragmenten.sql";

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

/** Een foto van het hele publieke schema, om voor en na te vergelijken. */
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
       from pg_policies where schemaname = 'public'
       order by tablename, policyname`
    )
  ).rows;
  return { kolommen, policies };
}

async function main() {
  const db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);

  const alle = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const index = alle.indexOf(FRAGMENT_MIGRATIE);
  if (index === -1) {
    console.error(`\n  FOUT: ${FRAGMENT_MIGRATIE} staat niet in supabase/migrations.\n`);
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
  console.log(`\n  ${ervoor.length} migraties geladen tot aan de fragmenten\n`);

  await db.exec(`
    insert into auth.users (id, email) values ('${GEBRUIKER}', 'directie@markenhage.nl');
    insert into public.organizations (id, name, slug) values ('${SCHOOL}', 'Markenhage College', 'markenhage');
    insert into public.crm_contacts (id, organization_id, full_name, contact_type)
      values ('33333333-3333-3333-3333-333333333333', '${SCHOOL}', 'Nora Bakker', 'cultuurcoordinator');
  `);

  // De nieuwe tabellen bestaan nog niet, dus die horen niet in de foto vooraf.
  const voor = await schemaFoto(db);
  const voorRijen = await een(
    db,
    `select
       (select count(*)::int from public.organizations) as organisaties,
       (select count(*)::int from public.crm_contacts)  as contacten,
       (select count(*)::int from public.profiles)      as profielen`
  );

  await draai([FRAGMENT_MIGRATIE]);
  console.log("  Migratie 033 geladen\n");

  console.log("  Er verandert niets aan wat er al stond");

  const na = await schemaFoto(db, ["crm_snippets", "crm_snippet_uses"]);
  check(
    JSON.stringify(voor.kolommen) === JSON.stringify(na.kolommen),
    "Geen kolom toegevoegd, verwijderd of veranderd buiten de twee nieuwe tabellen"
  );
  check(
    JSON.stringify(voor.policies) === JSON.stringify(na.policies),
    "Geen enkele bestaande beleidsregel is aangeraakt"
  );

  const naRijen = await een(
    db,
    `select
       (select count(*)::int from public.organizations) as organisaties,
       (select count(*)::int from public.crm_contacts)  as contacten,
       (select count(*)::int from public.profiles)      as profielen`
  );
  check(
    JSON.stringify(voorRijen) === JSON.stringify(naRijen),
    "Organisaties, contacten en profielen zijn onaangeroerd"
  );

  // ---------------------------------------------------------------------------
  console.log("\n  De sneltoets");

  const beginFragmenten = await een(db, `select count(*)::int as n from public.crm_snippets`);
  check(beginFragmenten.n > 0, `Er staan ${beginFragmenten.n} startfragmenten in`);

  const vorm = await moetFalen(
    db,
    `insert into public.crm_snippets (shortcut, name, body) values ('Offerte Nabellen', 'Fout', 'Tekst')`
  );
  check(Boolean(vorm), "Een sneltoets met hoofdletters en spaties wordt geweigerd");

  const streepVoor = await moetFalen(
    db,
    `insert into public.crm_snippets (shortcut, name, body) values ('-fout', 'Fout', 'Tekst')`
  );
  check(Boolean(streepVoor), "Een sneltoets die met een streepje begint wordt geweigerd");

  /*
    De valkuil. Zonder de aparte index op (shortcut) where brand is null zou
    dit gewoon lukken, want in Postgres is null nooit gelijk aan null en dus
    botsen twee rijen met een leeg merk niet met elkaar.
  */
  await db.exec(
    `insert into public.crm_snippets (shortcut, name, body) values ('uniektest', 'Eerste', 'Tekst een')`
  );
  const dubbelBeide = await moetFalen(
    db,
    `insert into public.crm_snippets (shortcut, name, body) values ('uniektest', 'Tweede', 'Tekst twee')`
  );
  check(
    Boolean(dubbelBeide),
    "Twee fragmenten zonder merk kunnen niet dezelfde sneltoets hebben"
  );

  const perMerk = await moetFalen(
    db,
    `insert into public.crm_snippets (brand, shortcut, name, body)
     values ('skool_workshop', 'welkom', 'Welkom school', 'Tekst'),
            ('suri_impact',    'welkom', 'Welkom deelnemer', 'Andere tekst')`
  );
  check(!perMerk, "Dezelfde sneltoets bij twee verschillende merken mag wel");

  const dubbelZelfdeMerk = await moetFalen(
    db,
    `insert into public.crm_snippets (brand, shortcut, name, body)
     values ('skool_workshop', 'welkom', 'Nog een keer', 'Tekst')`
  );
  check(Boolean(dubbelZelfdeMerk), "Maar twee keer dezelfde sneltoets binnen een merk niet");

  const leeg = await moetFalen(
    db,
    `insert into public.crm_snippets (shortcut, name, body) values ('leeg', 'Leeg', ' ')`
  );
  check(Boolean(leeg), "Een fragment zonder tekst wordt geweigerd");

  // ---------------------------------------------------------------------------
  console.log("\n  Het gebruik wordt geteld en niet opgeslagen");

  const teller = await een(
    db,
    `select count(*)::int as n from information_schema.columns
     where table_schema = 'public' and table_name = 'crm_snippets'
       and column_name in ('usage_count', 'times_used', 'aantal')`
  );
  check(teller.n === 0, "Er staat geen tellerkolom op crm_snippets");

  const fragment = await een(db, `select id from public.crm_snippets where shortcut = 'uniektest'`);
  const fase = await een(
    db,
    `select id from public.crm_pipeline_stages where brand = 'skool_workshop' and key = 'nieuwe_aanvraag'`
  );
  await db.exec(`
    insert into public.crm_deals (id, brand, title, stage_id, organization_id, value_cents)
      values ('44444444-4444-4444-4444-444444444444', 'skool_workshop', 'Cultuurdag 2026', '${fase.id}', '${SCHOOL}', 145000);
    insert into public.crm_snippet_uses (snippet_id, organization_id, deal_id) values
      ('${fragment.id}', '${SCHOOL}', '44444444-4444-4444-4444-444444444444'),
      ('${fragment.id}', '${SCHOOL}', '44444444-4444-4444-4444-444444444444'),
      ('${fragment.id}', null, null);
  `);

  const geteld = await een(
    db,
    `select count(*)::int as n from public.crm_snippet_uses where snippet_id = '${fragment.id}'`
  );
  check(geteld.n === 3, `Drie gebruiken geteld uit de regels (${geteld.n})`);

  const losGebruik = await een(
    db,
    `select count(*)::int as n from public.crm_snippet_uses
     where organization_id is null and contact_id is null and deal_id is null`
  );
  check(losGebruik.n === 1, "Een fragment mag ook los worden gebruikt, zonder onderwerp");

  const inhoudskopie = await een(
    db,
    `select count(*)::int as n from information_schema.columns
     where table_schema = 'public' and table_name = 'crm_snippet_uses'
       and column_name in ('body', 'text', 'inhoud', 'rendered')`
  );
  check(
    inhoudskopie.n === 0,
    "Er wordt geen kopie van de verstuurde tekst bewaard, dus klantgegevens staan hier niet dubbel"
  );

  // ---------------------------------------------------------------------------
  console.log("\n  Opruimen laat niets zweven");

  await db.exec(`delete from public.crm_deals where id = '44444444-4444-4444-4444-444444444444'`);
  const naDeal = await een(
    db,
    `select count(*)::int as n from public.crm_snippet_uses where snippet_id = '${fragment.id}'`
  );
  check(
    naDeal.n === 3,
    "Een verwijderde deal laat de gebruiksregels staan en haalt alleen de verwijzing weg"
  );

  await db.exec(`delete from public.crm_snippets where id = '${fragment.id}'`);
  const naFragment = await een(
    db,
    `select count(*)::int as n from public.crm_snippet_uses where snippet_id = '${fragment.id}'`
  );
  check(naFragment.n === 0, "Een verwijderd fragment neemt zijn eigen gebruiksregels wel mee");

  // ---------------------------------------------------------------------------
  console.log("\n  Het klantportaal kan er niet bij");

  for (const tabel of ["crm_snippets", "crm_snippet_uses"]) {
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

    const rls = await een(
      db,
      `select relrowsecurity as aan, relforcerowsecurity as gedwongen
       from pg_class where oid = ('public.' || $1)::regclass`,
      [tabel]
    );
    check(rls.aan === true && rls.gedwongen === true, `RLS staat aan en is afgedwongen op ${tabel}`);
  }

  // ---------------------------------------------------------------------------
  console.log("\n  Een fragment weet niets van gebruikers");

  const naarAuth = await een(
    db,
    `select count(*)::int as n from information_schema.columns
     where table_schema = 'public' and table_name in ('crm_snippets', 'crm_snippet_uses')
       and column_name in ('user_id', 'portal_user_id', 'auth_user_id')`
  );
  check(naarAuth.n === 0, "Er is geen enkele verwijzing naar een klantportaalaccount");

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
  console.log("\n  Fragmenten staan er, dicht, en zonder een teller die uit de pas kan lopen.\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
