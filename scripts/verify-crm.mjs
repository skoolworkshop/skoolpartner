/**
 * Controleert het CRM-fundament tegen een echte Postgres in het geheugen.
 *
 * Er worden drie dingen bewezen:
 *
 *   1. De migratie draait, is herhaalbaar en verandert niets aan bestaande
 *      tabellen.
 *   2. Een klant kan geen enkele CRM-rij opvragen, zelfs niet als Supabase de
 *      standaardrechten weer uitdeelt.
 *   3. Een persoon kan bestaan zonder organisatie, want dat is wat een
 *      Suri-deelnemer nodig heeft.
 *
 *   node scripts/verify-crm.mjs
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const CRM_MIGRATIE = "20260901120000_crm_fundament.sql";
const CRM_TABELLEN = ["crm_pipeline_stages", "crm_contacts", "crm_organization_profiles"];

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

/*
  Dit is de valstrik die deze test moet afvangen.

  Supabase deelt in het schema public standaardrechten uit aan anon en
  authenticated voor elke NIEUWE tabel. Een nieuwe tabel is daar dus meteen
  leesbaar voor iedere ingelogde klant, tenzij de migratie die rechten
  expliciet intrekt. Door dat hier na te bootsen, testen wij de echte situatie
  en niet een schoongewassen versie ervan.
*/
alter default privileges in schema public grant all on tables to anon, authenticated;
`;

const ORG = "22222222-2222-2222-2222-222222222222";
const ORG2 = "33333333-3333-3333-3333-333333333333";
const USER = "11111111-1111-1111-1111-111111111111";

let fouten = 0;
function check(goed, tekst) {
  console.log(`  ${goed ? "ok  " : "FOUT"} ${tekst}`);
  if (!goed) fouten += 1;
}

/** Draait iets wat MOET mislukken en geeft terug of het inderdaad misging. */
async function moetFalen(db, sql) {
  try {
    await db.exec(sql);
    return null;
  } catch (error) {
    return error.message;
  }
}

async function main() {
  const db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

  /*
    Eerst alles behalve het CRM. Zo kunnen wij een foto maken van het schema
    zoals het vandaag in productie staat, en daarna kijken wat de CRM-migratie
    daar precies aan verandert. Dat is sterker dan een lijstje kolomnamen die
    er niet mogen zijn: dit valt ook op wat ik niet had bedacht.
  */
  // Alles wat VOOR het CRM komt. Latere CRM-migraties leunen op deze, dus die
  // mogen hier nog niet meedraaien.
  const ervoor = files.filter((f) => f < CRM_MIGRATIE);
  const erna = files.filter((f) => f > CRM_MIGRATIE);

  for (const file of ervoor) {
    try {
      await db.exec(await readFile(path.join(MIGRATIONS_DIR, file), "utf8"));
    } catch (error) {
      console.error(`\n  FOUT in ${file}\n       ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
  }

  const schemaFoto = async () =>
    (
      await db.query(`
        select table_name || '.' || column_name || ' ' || data_type ||
               ' null=' || is_nullable || ' default=' || coalesce(column_default, '-') as regel
        from information_schema.columns
        where table_schema = 'public'
        order by table_name, column_name
      `)
    ).rows.map((r) => r.regel);

  const policyFoto = async () =>
    (
      await db.query(`
        select tablename || '.' || policyname || ' ' || cmd || ' roles=' || roles::text as regel
        from pg_policies where schemaname = 'public' order by tablename, policyname
      `)
    ).rows.map((r) => r.regel);

  const voorFoto = await schemaFoto();
  const voorPolicies = await policyFoto();

  try {
    await db.exec(await readFile(path.join(MIGRATIONS_DIR, CRM_MIGRATIE), "utf8"));
  } catch (error) {
    console.error(`\n  FOUT in ${CRM_MIGRATIE}\n       ${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  const naFoto = await schemaFoto();
  const naPolicies = await policyFoto();

  // En daarna de rest, zodat de database er verder uitziet zoals in productie.
  for (const file of erna) {
    try {
      await db.exec(await readFile(path.join(MIGRATIONS_DIR, file), "utf8"));
    } catch (error) {
      console.error(`\n  FOUT in ${file}\n       ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
  }

  console.log(`\n  ${files.length} migraties geladen, inclusief het CRM-fundament\n`);

  // ---------------------------------------------------------------------------
  // 1. De tabellen bestaan en staan op slot
  // ---------------------------------------------------------------------------
  console.log("  De tabellen en hun beveiliging");

  for (const tabel of CRM_TABELLEN) {
    const rij = (
      await db.query(
        `select c.relrowsecurity as rls, c.relforcerowsecurity as geforceerd
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = $1`,
        [tabel]
      )
    ).rows[0];
    check(Boolean(rij), `${tabel} bestaat`);
    check(rij?.rls === true, `${tabel}: RLS staat aan`);
    check(rij?.geforceerd === true, `${tabel}: RLS geldt ook voor de tabeleigenaar`);
  }

  // Dit is de kern van de privacygrens.
  for (const tabel of CRM_TABELLEN) {
    for (const rol of ["anon", "authenticated"]) {
      const rechten = (
        await db.query(
          `select
             has_table_privilege($1, 'public.' || $2, 'select') as lezen,
             has_table_privilege($1, 'public.' || $2, 'insert') as schrijven,
             has_table_privilege($1, 'public.' || $2, 'update') as wijzigen,
             has_table_privilege($1, 'public.' || $2, 'delete') as verwijderen`,
          [rol, tabel]
        )
      ).rows[0];
      const dicht =
        !rechten.lezen && !rechten.schrijven && !rechten.wijzigen && !rechten.verwijderen;
      check(dicht, `${tabel}: ${rol} heeft nul rechten`);
    }

    const kanService = (
      await db.query(`select has_table_privilege('service_role', 'public.' || $1, 'select') as ja`, [tabel])
    ).rows[0].ja;
    check(kanService === true, `${tabel}: service_role kan er wel bij`);
  }

  const policies = (
    await db.query(
      `select count(*)::int as n from pg_policies
       where schemaname = 'public' and tablename = any($1)`,
      [CRM_TABELLEN]
    )
  ).rows[0].n;
  check(policies === 0, `Er is geen enkele policy op de CRM-tabellen (gevonden: ${policies})`);

  // ---------------------------------------------------------------------------
  // 2. Er is niets veranderd aan wat er al stond
  // ---------------------------------------------------------------------------
  console.log("\n  Bestaande tabellen zijn niet aangeraakt");

  // Alles wat er voor de migratie stond, moet er daarna nog letterlijk zo
  // staan. Dus geen kolom weg, geen kolom van type veranderd, geen default
  // stilletjes gewijzigd.
  const verdwenen = voorFoto.filter((regel) => !naFoto.includes(regel));
  check(
    verdwenen.length === 0,
    verdwenen.length === 0
      ? `Alle ${voorFoto.length} bestaande kolommen zijn onveranderd`
      : `Er is iets veranderd aan bestaande kolommen: ${verdwenen.slice(0, 5).join(" | ")}`
  );

  // En wat erbij komt, hoort uitsluitend in de nieuwe tabellen te zitten.
  const bijgekomen = naFoto.filter((regel) => !voorFoto.includes(regel));
  const buitenCrm = bijgekomen.filter((regel) => !CRM_TABELLEN.some((t) => regel.startsWith(`${t}.`)));
  check(
    buitenCrm.length === 0,
    buitenCrm.length === 0
      ? `De ${bijgekomen.length} nieuwe kolommen zitten allemaal in de drie CRM-tabellen`
      : `Er zijn kolommen toegevoegd buiten het CRM: ${buitenCrm.join(" | ")}`
  );

  // En aan de bestaande RLS-policies mag al helemaal niets zijn veranderd.
  const policyVerschil = [
    ...voorPolicies.filter((r) => !naPolicies.includes(r)),
    ...naPolicies.filter((r) => !voorPolicies.includes(r)),
  ];
  check(
    policyVerschil.length === 0,
    policyVerschil.length === 0
      ? `Alle ${voorPolicies.length} bestaande RLS-policies zijn ongewijzigd`
      : `Er is aan RLS-policies gesleuteld: ${policyVerschil.join(" | ")}`
  );

  // ---------------------------------------------------------------------------
  // 3. De fases van beide merken
  // ---------------------------------------------------------------------------
  console.log("\n  De pijplijnfases");

  for (const merk of ["skool_workshop", "suri_impact"]) {
    const rijen = (
      await db.query(
        `select key, is_won, is_lost from public.crm_pipeline_stages
         where brand = $1 order by position`,
        [merk]
      )
    ).rows;
    check(rijen.length >= 5, `${merk} heeft ${rijen.length} fases`);
    check(
      rijen.filter((r) => r.is_won).length === 1,
      `${merk} heeft precies een fase die telt als gewonnen`
    );
    check(
      rijen.filter((r) => r.is_lost).length === 1,
      `${merk} heeft precies een fase die telt als verloren`
    );
  }

  const beide = await moetFalen(
    db,
    `insert into public.crm_pipeline_stages (brand, key, label, is_won, is_lost)
     values ('skool_workshop', 'onmogelijk', 'Onmogelijk', true, true)`
  );
  check(Boolean(beide), "Een fase kan niet tegelijk gewonnen en verloren zijn");

  const dubbel = await moetFalen(
    db,
    `insert into public.crm_pipeline_stages (brand, key, label) values ('skool_workshop', 'akkoord', 'Nog een keer')`
  );
  check(Boolean(dubbel), "Dezelfde fasesleutel kan niet twee keer binnen een merk");

  const zelfdeSleutelAnderMerk = await moetFalen(
    db,
    `insert into public.crm_pipeline_stages (brand, key, label) values ('suri_impact', 'akkoord', 'Akkoord')`
  );
  check(!zelfdeSleutelAnderMerk, "Maar bij het andere merk mag diezelfde sleutel wel");

  // ---------------------------------------------------------------------------
  // 4. Personen, met en zonder organisatie
  // ---------------------------------------------------------------------------
  console.log("\n  Personen");

  await db.exec(`
    insert into auth.users (id, email) values ('${USER}', 'beheer@skoolworkshop.nl');
    insert into public.organizations (id, name, slug) values
      ('${ORG}',  'Testschool',  'testschool'),
      ('${ORG2}', 'Tweede school', 'tweede-school');
  `);

  const deelnemer = await moetFalen(
    db,
    `insert into public.crm_contacts (full_name, email, phone)
     values ('Jayden Refos', 'jayden@voorbeeld.nl', '0612345678')`
  );
  check(!deelnemer, "Een deelnemer zonder organisatie kan bestaan");

  const metSchool = await moetFalen(
    db,
    `insert into public.crm_contacts (organization_id, full_name, email)
     values ('${ORG}', 'Sanne de Vries', 'sanne@testschool.nl')`
  );
  check(!metSchool, "Een contactpersoon met organisatie kan bestaan");

  const dubbelInSchool = await moetFalen(
    db,
    `insert into public.crm_contacts (organization_id, full_name, email)
     values ('${ORG}', 'Sanne anders geschreven', 'SANNE@testschool.nl')`
  );
  check(Boolean(dubbelInSchool), "Hetzelfde adres kan niet twee keer binnen een school");

  const zelfdeAdresAndereSchool = await moetFalen(
    db,
    `insert into public.crm_contacts (organization_id, full_name, email)
     values ('${ORG2}', 'Sanne de Vries', 'sanne@testschool.nl')`
  );
  check(!zelfdeAdresAndereSchool, "Bij een andere school mag datzelfde adres wel");

  const dubbeleDeelnemer = await moetFalen(
    db,
    `insert into public.crm_contacts (full_name, email) values ('Jayden R.', 'Jayden@Voorbeeld.nl')`
  );
  check(
    Boolean(dubbeleDeelnemer),
    "Een persoon zonder organisatie kan zich niet twee keer met hetzelfde adres aanmelden"
  );

  const zonderMail = await moetFalen(
    db,
    `insert into public.crm_contacts (full_name, phone) values ('Alleen telefonisch', '0201234567')`
  );
  check(!zonderMail, "Een persoon zonder e-mailadres mag ook");

  const nogEenZonderMail = await moetFalen(
    db,
    `insert into public.crm_contacts (full_name, phone) values ('Ook alleen telefonisch', '0207654321')`
  );
  check(!nogEenZonderMail, "En twee personen zonder e-mailadres blokkeren elkaar niet");

  // ---------------------------------------------------------------------------
  // 5. De privacygrens: een CRM-contact opent geen e-mail
  // ---------------------------------------------------------------------------
  console.log("\n  De privacygrens rond e-mail");

  const voorContacten = (
    await db.query(`select count(*)::int as n from public.organization_contacts`)
  ).rows[0].n;

  await db.exec(`
    insert into public.crm_contacts (organization_id, full_name, email)
    values ('${ORG}', 'Nieuw uit het CRM', 'nieuw@testschool.nl')
  `);

  const naContacten = (
    await db.query(`select count(*)::int as n from public.organization_contacts`)
  ).rows[0].n;
  check(
    voorContacten === naContacten,
    `Een CRM-contact aanmaken maakt geen geverifieerd contact aan (${voorContacten} voor, ${naContacten} na)`
  );

  const geverifieerd = (
    await db.query(`select count(*)::int as n from public.organization_contacts where is_verified`)
  ).rows[0].n;
  check(geverifieerd === 0, "En er staat dus ook niets op geverifieerd");

  // ---------------------------------------------------------------------------
  // 6. Het organisatieprofiel
  // ---------------------------------------------------------------------------
  console.log("\n  Het organisatieprofiel");

  await db.exec(`
    insert into public.crm_organization_profiles (organization_id, lifecycle, note)
    values ('${ORG}', 'prospect', 'Nog nooit iets afgenomen')
  `);

  const profiel = (
    await db.query(`select lifecycle from public.crm_organization_profiles where organization_id = '${ORG}'`)
  ).rows[0];
  check(profiel?.lifecycle === "prospect", `De levensfase staat op prospect (${profiel?.lifecycle})`);

  const status = (
    await db.query(`select status::text as status from public.organizations where id = '${ORG}'`)
  ).rows[0].status;
  check(status === "active", "De toegangsstatus van de organisatie is daardoor niet veranderd");

  const tweeKeer = await moetFalen(
    db,
    `insert into public.crm_organization_profiles (organization_id) values ('${ORG}')`
  );
  check(Boolean(tweeKeer), "Een organisatie kan maar een profiel hebben");

  // Verwijder je een organisatie, dan gaat het profiel mee en blijft de rest heel.
  await db.exec(`delete from public.organizations where id = '${ORG2}'`);
  const wees = (
    await db.query(`select count(*)::int as n from public.crm_contacts where organization_id = '${ORG2}'`)
  ).rows[0].n;
  check(wees === 0, "Bij het verwijderen van een organisatie blijven er geen losse CRM-contacten achter");

  // ---------------------------------------------------------------------------
  // 7. De instelling
  // ---------------------------------------------------------------------------
  console.log("\n  Instellingen");

  const instelling = (
    await db.query(`select value, is_public from public.app_settings where key = 'crm_default_brand'`)
  ).rows[0];
  check(instelling?.value === "skool_workshop", `Het startmerk staat ingesteld (${instelling?.value})`);
  check(instelling?.is_public === false, "En die instelling is niet publiek");

  // ---------------------------------------------------------------------------
  // 8. Nog een keer draaien mag niets kapotmaken
  // ---------------------------------------------------------------------------
  console.log("\n  Herhaalbaarheid");

  const voorRijen = (await db.query(`select count(*)::int as n from public.crm_contacts`)).rows[0].n;
  const voorFases = (await db.query(`select count(*)::int as n from public.crm_pipeline_stages`)).rows[0].n;

  const opnieuw = await moetFalen(db, await readFile(path.join(MIGRATIONS_DIR, CRM_MIGRATIE), "utf8"));
  check(!opnieuw, `De migratie kan opnieuw draaien${opnieuw ? `: ${opnieuw}` : ""}`);

  const naRijen = (await db.query(`select count(*)::int as n from public.crm_contacts`)).rows[0].n;
  const naFases = (await db.query(`select count(*)::int as n from public.crm_pipeline_stages`)).rows[0].n;
  check(voorRijen === naRijen, `Er is geen persoon verdwenen of bijgekomen (${voorRijen} → ${naRijen})`);
  check(voorFases === naFases, `En er zijn geen dubbele fases ontstaan (${voorFases} → ${naFases})`);

  await db.close();

  if (fouten > 0) {
    console.error(`\n  ${fouten} controle(s) mislukt.\n`);
    process.exitCode = 1;
    return;
  }
  console.log("\n  Het CRM-fundament staat, en het klantportaal merkt er niets van.\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
