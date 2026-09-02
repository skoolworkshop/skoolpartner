/**
 * Controleert de databasekant van de overstap uit HubSpot.
 *
 * De omzetregels zelf staan in tests/crm-hubspot-import.test.ts. Dit script
 * gaat over wat alleen een echte Postgres kan aantonen:
 *
 *   1. Migratie 037 voegt alleen kolommen toe en raakt geen rij aan.
 *   2. Een tweede import kan geen dubbele rij maken.
 *   3. Rijen zonder HubSpot-herkomst blijven gewoon naast elkaar bestaan.
 *   4. Het klantportaal kan ook na de import nergens bij.
 *   5. Elke fase waar de omzetting naartoe wijst, bestaat ook echt.
 *
 *   node scripts/verify-crm-hubspot.mjs
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const MIGRATIE = "20260902210000_crm_hubspot_herkomst.sql";
const OMZETTING = path.join(process.cwd(), "src", "lib", "crm", "hubspot-import.ts");

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

let fouten = 0;
function check(goed, tekst) {
  console.log(`  ${goed ? "ok  " : "FOUT"} ${tekst}`);
  if (!goed) fouten += 1;
}

async function een(db, sql) {
  return (await db.query(sql)).rows[0];
}

async function moetFalen(db, sql) {
  try {
    await db.exec(sql);
    return null;
  } catch (error) {
    return error.message;
  }
}

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
       from pg_policies where schemaname = 'public' order by tablename, policyname`
    )
  ).rows;
  return { kolommen, policies };
}

async function main() {
  const db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);

  const alle = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const index = alle.indexOf(MIGRATIE);
  if (index === -1) {
    console.error(`\n  FOUT: ${MIGRATIE} staat niet in supabase/migrations.\n`);
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
  await draai(ervoor);
  console.log(`\n  ${ervoor.length} migraties geladen tot aan de herkomstkolom\n`);

  const fase = await een(
    db,
    `select id from public.crm_pipeline_stages where brand = 'skool_workshop' and key = 'nieuwe_aanvraag'`
  );

  await db.exec(`
    insert into auth.users (id, email) values ('${GEBRUIKER}', 'directie@markenhage.nl');
    insert into public.organizations (id, name, slug) values ('${SCHOOL}', 'Markenhage College', 'markenhage');
    insert into public.crm_contacts (id, organization_id, full_name, email)
      values ('${CONTACT}', '${SCHOOL}', 'Nora Bakker', 'nora@markenhage.nl');
    insert into public.crm_deals (brand, title, stage_id, contact_id, value_cents)
      values ('skool_workshop', 'Cultuurdag 2026', '${fase.id}', '${CONTACT}', 145000);
  `);

  const voor = await schemaFoto(db);
  const voorRijen = await een(
    db,
    `select
       (select count(*)::int from public.organizations) as organisaties,
       (select count(*)::int from public.crm_contacts)  as contacten,
       (select count(*)::int from public.crm_deals)     as deals,
       (select count(*)::int from public.crm_meetings)  as afspraken`
  );

  await draai([MIGRATIE]);
  console.log("  Migratie 037 geladen\n");

  // ---------------------------------------------------------------------------
  console.log("  Er verandert niets aan wat er al stond");

  const na = await schemaFoto(db);
  const nieuweKolommen = na.kolommen.filter(
    (k) => !voor.kolommen.some((v) => v.table_name === k.table_name && v.column_name === k.column_name)
  );
  const verdwenen = voor.kolommen.filter(
    (v) => !na.kolommen.some((k) => k.table_name === v.table_name && k.column_name === v.column_name)
  );
  const veranderd = voor.kolommen.filter((v) =>
    na.kolommen.some(
      (k) =>
        k.table_name === v.table_name &&
        k.column_name === v.column_name &&
        (k.data_type !== v.data_type ||
          k.is_nullable !== v.is_nullable ||
          k.column_default !== v.column_default)
    )
  );

  check(verdwenen.length === 0, "Er is geen kolom verdwenen");
  check(veranderd.length === 0, "Er is geen bestaande kolom veranderd");
  check(
    nieuweKolommen.length === 4 && nieuweKolommen.every((k) => k.column_name === "hubspot_id"),
    "Er zijn precies vier kolommen bijgekomen, allemaal hubspot_id"
  );
  check(
    ["crm_activities", "crm_contacts", "crm_deals", "crm_meetings"].every((t) =>
      nieuweKolommen.some((k) => k.table_name === t)
    ),
    "De kolom staat op contacten, deals, afspraken en de tijdlijn"
  );
  check(
    nieuweKolommen.every((k) => k.is_nullable === "YES"),
    "De kolom mag leeg zijn, want bijna alles in het CRM komt niet uit HubSpot"
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
       (select count(*)::int from public.crm_deals)     as deals,
       (select count(*)::int from public.crm_meetings)  as afspraken`
  );
  check(
    JSON.stringify(voorRijen) === JSON.stringify(naRijen),
    "Er is geen rij bijgekomen of verdwenen"
  );

  // ---------------------------------------------------------------------------
  console.log("\n  Een import kan niet dubbel lopen");

  await db.exec(
    `update public.crm_contacts set hubspot_id = '101' where id = '${CONTACT}'`
  );

  const dubbel = await moetFalen(
    db,
    `insert into public.crm_contacts (organization_id, full_name, email, hubspot_id)
     values ('${SCHOOL}', 'Nora Bakker (dubbel)', 'nora2@markenhage.nl', '101')`
  );
  check(Boolean(dubbel), "Twee contacten met hetzelfde HubSpot-nummer worden geweigerd");

  const tweeLeeg = await moetFalen(
    db,
    `insert into public.crm_contacts (organization_id, full_name, email) values
       ('${SCHOOL}', 'Met de hand een', 'hand1@markenhage.nl'),
       ('${SCHOOL}', 'Met de hand twee', 'hand2@markenhage.nl')`
  );
  check(!tweeLeeg, "Contacten zonder HubSpot-nummer staan gewoon naast elkaar");

  const dealDubbel = await moetFalen(
    db,
    `insert into public.crm_deals (brand, title, stage_id, contact_id, hubspot_id) values
       ('skool_workshop', 'Deal een', '${fase.id}', '${CONTACT}', '201'),
       ('skool_workshop', 'Deal twee', '${fase.id}', '${CONTACT}', '201')`
  );
  check(Boolean(dealDubbel), "Twee deals met hetzelfde HubSpot-nummer worden geweigerd");

  const herhaald = await moetFalen(
    db,
    `insert into public.crm_deals (brand, title, stage_id, contact_id, hubspot_id)
     values ('skool_workshop', 'Deal een', '${fase.id}', '${CONTACT}', '202')
     on conflict (hubspot_id) do update set title = excluded.title`
  );
  check(!herhaald, "Nog een keer draaien werkt de bestaande rij bij in plaats van er een naast te zetten");

  // ---------------------------------------------------------------------------
  console.log("\n  Het klantportaal kan er nog steeds niet bij");

  for (const tabel of ["crm_contacts", "crm_deals", "crm_meetings", "crm_activities"]) {
    const rechten = await een(
      db,
      `select count(*)::int as n from information_schema.role_table_grants
       where table_schema = 'public' and table_name = '${tabel}'
         and grantee in ('anon', 'authenticated')`
    );
    check(rechten.n === 0, `anon en authenticated hebben geen enkel recht op ${tabel}`);
  }

  // ---------------------------------------------------------------------------
  console.log("\n  Elke fase waar de omzetting naartoe wijst, bestaat ook echt");

  const bron = await readFile(OMZETTING, "utf8");
  const doelen = new Set([...bron.matchAll(/doel:\s*"([a-z_]+)"/g)].map((m) => m[1]));
  // De omzetting kan een oude evaluatie ook op Afgerond zetten. Die fase komt
  // niet uit de tabel hierboven en wordt daarom apart meegenomen.
  doelen.add("afgerond");

  check(doelen.size >= 9, `De omzetting kent ${doelen.size} doelfases`);

  for (const doel of [...doelen].sort()) {
    const bestaat = await een(
      db,
      `select count(*)::int as n from public.crm_pipeline_stages
       where brand = 'skool_workshop' and key = '${doel}'`
    );
    check(bestaat.n === 1, `Fase ${doel} bestaat in de pijplijn van Skool Workshop`);
  }

  const gewonnen = await een(
    db,
    `select is_won from public.crm_pipeline_stages
     where brand = 'skool_workshop' and key = 'opvolging'`
  );
  check(
    gewonnen.is_won === false,
    "Opvolging telt niet als gewonnen, dus Herinnering uit HubSpot komt niet als succes binnen"
  );

  console.log(
    fouten === 0
      ? "\n  Alles in orde. De herkomstkolom ligt klaar.\n"
      : `\n  ${fouten} punt(en) niet in orde.\n`
  );
  process.exitCode = fouten === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
