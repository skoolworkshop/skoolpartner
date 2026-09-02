/**
 * Bewijst de belangrijkste regel van het CRM: een contact is geen gebruiker.
 *
 * Wat hier wordt aangetoond, tegen een echte Postgres:
 *
 *   1. Een contact kan bestaan zonder account, zonder organisatie, zonder
 *      e-mailadres en zonder wat dan ook uit het klantportaal.
 *   2. Een contact aanmaken raakt profiles, auth, organization_members en
 *      organization_contacts niet aan.
 *   3. Een organisatie kan meerdere contacten hebben, waarvan er hooguit een
 *      een account heeft.
 *   4. Een deal kan aan een organisatie en een contactpersoon tegelijk hangen,
 *      en een organisatie kan meerdere deals hebben.
 *   5. Het klantportaal kan bij niets van dit alles.
 *
 *   node scripts/verify-crm-contacten.mjs
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

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

/** Een foto van alles wat met het klantportaal te maken heeft. */
async function portaalFoto(db) {
  return een(
    db,
    `select
       (select count(*)::int from auth.users)                                as gebruikers,
       (select count(*)::int from public.profiles)                           as profielen,
       (select count(*)::int from public.organization_members)               as leden,
       (select count(*)::int from public.organization_contacts)              as mailcontacten,
       (select count(*)::int from public.organization_contacts where is_verified) as geverifieerd,
       (select count(*)::int from public.organizations)                      as organisaties`
  );
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
  // Uitgangssituatie: een school met een echte gebruiker
  // ---------------------------------------------------------------------------
  await db.exec(`
    insert into auth.users (id, email) values ('${GEBRUIKER}', 'directie@markenhage.nl');
    insert into public.organizations (id, name, slug) values ('${SCHOOL}', 'Markenhage College', 'markenhage');
    insert into public.organization_members (organization_id, user_id, role, status)
      values ('${SCHOOL}', '${GEBRUIKER}', 'beheerder', 'active');
    insert into public.organization_contacts (organization_id, email, is_verified, user_id)
      values ('${SCHOOL}', 'directie@markenhage.nl', true, '${GEBRUIKER}');
  `);

  const voor = await portaalFoto(db);

  // ---------------------------------------------------------------------------
  console.log("  Een contact is geen gebruiker");

  const kaal = await moetFalen(
    db,
    `insert into public.crm_contacts (full_name) values ('Iemand die ooit belde')`
  );
  check(!kaal, "Een contact zonder e-mail, zonder telefoon en zonder organisatie kan bestaan");

  const zonderAccount = await moetFalen(
    db,
    `insert into public.crm_contacts (organization_id, full_name, contact_type, email, job_title)
     values
       ('${SCHOOL}', 'Nora Bakker',  'cultuurcoordinator', 'n.bakker@markenhage.nl',  'Cultuurcoördinator'),
       ('${SCHOOL}', 'Peter Jansen', 'decaan',             'p.jansen@markenhage.nl',  'Decaan'),
       ('${SCHOOL}', 'Wil de Groot', 'administratie',      'administratie@markenhage.nl', 'Administratie')`
  );
  check(!zonderAccount, "Drie collega's van dezelfde school, geen van allen met een account");

  const na = await portaalFoto(db);
  check(
    JSON.stringify(voor) === JSON.stringify(na),
    "Er is niets veranderd aan gebruikers, profielen, lidmaatschappen of geverifieerde mailcontacten"
  );

  const aantalContacten = await een(
    db,
    `select count(*)::int as n from public.crm_contacts where organization_id = '${SCHOOL}'`
  );
  check(aantalContacten.n === 3, `De school heeft drie contactpersonen (${aantalContacten.n})`);

  // ---------------------------------------------------------------------------
  console.log("\n  Een account koppelen is een aparte, bewuste handeling");

  const gekoppeld = await een(
    db,
    `select count(*)::int as n from public.crm_contacts where portal_user_id is not null`
  );
  check(gekoppeld.n === 0, "Niemand is automatisch aan een account gekoppeld");

  await db.exec(`
    insert into public.crm_contacts (organization_id, full_name, contact_type, email, portal_user_id)
    values ('${SCHOOL}', 'Rector Markenhage', 'directie', 'directie@markenhage.nl', '${GEBRUIKER}')
  `);
  const naKoppeling = await een(
    db,
    `select count(*)::int as n from public.crm_contacts where portal_user_id is not null`
  );
  check(naKoppeling.n === 1, "Een koppeling leggen kan wel, en dan precies bij die ene persoon");

  const naKoppelingFoto = await portaalFoto(db);
  check(
    JSON.stringify(voor) === JSON.stringify(naKoppelingFoto),
    "Ook het koppelen zelf verandert niets aan de toegang"
  );

  /*
    Een gebruiker verwijderen mag het contact niet meeslepen.

    Hiervoor gebruik ik bewust een tweede, wegwerpbare gebruiker. De eerste
    laat ik staan, want anders zou dit script zelf het lidmaatschap opruimen
    en zou de laatste controle van dit bestand niets meer bewijzen.
  */
  const WEG = "33333333-3333-3333-3333-333333333333";
  await db.exec(`
    insert into auth.users (id, email) values ('${WEG}', 'tijdelijk@markenhage.nl');
    insert into public.crm_contacts (organization_id, full_name, contact_type, portal_user_id)
      values ('${SCHOOL}', 'Tijdelijke Kracht', 'administratie', '${WEG}');
    delete from public.profiles where id = '${WEG}';
  `);

  const wegwerp = await een(
    db,
    `select count(*)::int as n from public.crm_contacts
     where full_name = 'Tijdelijke Kracht' and portal_user_id is null`
  );
  check(
    wegwerp.n === 1,
    "Een verwijderde gebruiker laat het contact staan en haalt alleen de koppeling weg"
  );

  // ---------------------------------------------------------------------------
  console.log("\n  Soorten contacten");

  const gekkeSoort = await moetFalen(
    db,
    `insert into public.crm_contacts (full_name, contact_type) values ('Onbekend soort', 'conciërge')`
  );
  check(Boolean(gekkeSoort), "Een onbekend soort contact wordt geweigerd");

  const soorten = (
    await db.query(
      `select distinct contact_type from public.crm_contacts where contact_type is not null order by 1`
    )
  ).rows.map((r) => r.contact_type);
  check(
    soorten.includes("cultuurcoordinator") && soorten.includes("decaan"),
    `De rollen staan erin (${soorten.join(", ")})`
  );

  // ---------------------------------------------------------------------------
  console.log("\n  Een organisatie kan meerdere deals hebben");

  const fase = await een(
    db,
    `select id from public.crm_pipeline_stages where brand = 'skool_workshop' and key = 'nieuwe_aanvraag'`
  );
  const nora = await een(
    db,
    `select id from public.crm_contacts where full_name = 'Nora Bakker'`
  );

  const tweeDeals = await moetFalen(
    db,
    `insert into public.crm_deals (brand, title, stage_id, organization_id, contact_id, value_cents)
     values ('skool_workshop', 'Cultuurdag 2026', '${fase.id}', '${SCHOOL}', '${nora.id}', 145000),
            ('skool_workshop', 'Introductiedag 2027', '${fase.id}', '${SCHOOL}', '${nora.id}', 387176)`
  );
  check(!tweeDeals, "Twee losse deals bij dezelfde school en dezelfde persoon");

  const dealsVanSchool = await een(
    db,
    `select count(*)::int as n from public.crm_deals where organization_id = '${SCHOOL}'`
  );
  check(dealsVanSchool.n === 2, `De school heeft twee deals (${dealsVanSchool.n})`);

  const dealsVanContact = await een(
    db,
    `select count(*)::int as n from public.crm_deals where contact_id = '${nora.id}'`
  );
  check(dealsVanContact.n === 2, `Dezelfde persoon hangt aan allebei (${dealsVanContact.n})`);

  // En ze bewegen los van elkaar door de pijplijn.
  const offerte = await een(
    db,
    `select id from public.crm_pipeline_stages where brand = 'skool_workshop' and key = 'offerte_verstuurd'`
  );
  await db.exec(
    `update public.crm_deals set stage_id = '${offerte.id}' where title = 'Cultuurdag 2026'`
  );
  const verdeling = (
    await db.query(
      `select s.key, count(*)::int as n from public.crm_deals d
       join public.crm_pipeline_stages s on s.id = d.stage_id
       where d.organization_id = '${SCHOOL}' group by s.key order by s.key`
    )
  ).rows;
  check(
    verdeling.length === 2,
    `De twee deals staan nu in verschillende fases (${verdeling.map((v) => `${v.key}: ${v.n}`).join(", ")})`
  );

  // ---------------------------------------------------------------------------
  console.log("\n  Het klantportaal kan er niet bij");

  for (const rol of ["anon", "authenticated"]) {
    const rechten = await een(
      db,
      `select bool_or(has_table_privilege($1, 'public.crm_contacts', p)) as iets
       from unnest(array['select','insert','update','delete']) p`,
      [rol]
    );
    check(rechten.iets === false, `${rol} heeft nul rechten op crm_contacts`);
  }

  const policies = await een(
    db,
    `select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = 'crm_contacts'`
  );
  check(policies.n === 0, "Er staat geen enkele policy op crm_contacts");

  // ---------------------------------------------------------------------------
  console.log("\n  Bestaande klantportaalgegevens");

  const eind = await een(
    db,
    `select
       (select count(*)::int from public.organizations)         as organisaties,
       (select count(*)::int from public.organization_members)  as leden,
       (select count(*)::int from public.organization_contacts) as mailcontacten`
  );
  check(eind.organisaties === 1, "De organisatie bestaat nog");
  check(eind.leden === 1, "Het lidmaatschap bestaat nog");
  check(eind.mailcontacten === 1, "Het geverifieerde mailcontact bestaat nog, en er is er geen bij gekomen");

  await db.close();

  if (fouten > 0) {
    console.error(`\n  ${fouten} controle(s) mislukt.\n`);
    process.exitCode = 1;
    return;
  }
  console.log("\n  Contacten, organisaties, deals en gebruikers staan los van elkaar.\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
