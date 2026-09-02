/**
 * Controleert de databasekant van de boekingslinks.
 *
 * Dit is het eerste onderdeel van het CRM waar iemand van buiten iets kan
 * veroorzaken. Wat hier wordt aangetoond:
 *
 *   1. Migratie 035 raakt geen bestaande tabel aan, behalve dat crm_meetings
 *      er kolommen bij krijgt.
 *   2. De sleutel in het adres moet lang zijn en is uniek.
 *   3. Twee boekingen op hetzelfde moment via dezelfde link kunnen niet. Dat
 *      is de enige bescherming die werkt bij twee bezoekers tegelijk.
 *   4. Een afgezegde afspraak geeft het moment weer vrij.
 *   5. Werktijden hebben een geldige vorm.
 *   6. Anon heeft nul rechten. Dit is de belangrijkste controle van dit
 *      bestand: de pagina is openbaar, de database niet.
 *
 *   node scripts/verify-crm-boekingslinks.mjs
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const MIGRATIE = "20260902190000_crm_boekingslinks.sql";

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
const LINK = "55555555-5555-5555-5555-555555555555";

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
  return {
    kolommen: (
      await db.query(
        `select table_name, column_name, data_type, is_nullable, column_default
         from information_schema.columns
         where table_schema = 'public' ${uitzondering}
         order by table_name, column_name`
      )
    ).rows,
    policies: (
      await db.query(
        `select tablename, policyname, cmd, qual, with_check
         from pg_policies where schemaname = 'public' order by tablename, policyname`
      )
    ).rows,
  };
}

function boeking(startUur, extra = {}) {
  const velden = {
    title: "'Kennismaking'",
    starts_at: `timestamptz '2026-09-20 ${String(startUur).padStart(2, "0")}:00:00+02'`,
    ends_at: `timestamptz '2026-09-20 ${String(startUur + 1).padStart(2, "0")}:00:00+02'`,
    organization_id: `'${SCHOOL}'`,
    source: "'boekingslink'",
    booking_link_id: `'${LINK}'`,
    ...extra,
  };
  return `insert into public.crm_meetings (${Object.keys(velden).join(", ")}) values (${Object.values(velden).join(", ")})`;
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

  await draai(alle.slice(0, index));
  console.log(`\n  ${index} migraties geladen tot aan de boekingslinks\n`);

  await db.exec(`
    insert into auth.users (id, email) values ('${GEBRUIKER}', 'directie@markenhage.nl');
    insert into public.organizations (id, name, slug) values ('${SCHOOL}', 'Markenhage College', 'markenhage');
    insert into public.organization_members (organization_id, user_id, role, status)
      values ('${SCHOOL}', '${GEBRUIKER}', 'beheerder', 'active');
  `);

  const voor = await schemaFoto(db, ["crm_meetings"]);
  const voorRijen = await een(
    db,
    `select
       (select count(*)::int from public.organizations)        as organisaties,
       (select count(*)::int from public.organization_members) as leden,
       (select count(*)::int from public.crm_meetings)         as afspraken`
  );

  await draai([MIGRATIE]);
  console.log("  Migratie 035 geladen\n");

  // ---------------------------------------------------------------------------
  console.log("  Er verandert niets aan wat er al stond");

  const na = await schemaFoto(db, ["crm_meetings", "crm_booking_links", "crm_booking_availability"]);
  check(
    JSON.stringify(voor.kolommen) === JSON.stringify(na.kolommen),
    "Geen kolom veranderd buiten crm_meetings en de twee nieuwe tabellen"
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
       (select count(*)::int from public.crm_meetings)         as afspraken`
  );
  check(JSON.stringify(voorRijen) === JSON.stringify(naRijen), "Er is geen rij aangeraakt");

  const nieuweKolommen = await een(
    db,
    `select count(*)::int as n from information_schema.columns
     where table_schema = 'public' and table_name = 'crm_meetings'
       and column_name in ('booking_link_id', 'guest_name', 'guest_email', 'guest_phone', 'guest_company')`
  );
  check(nieuweKolommen.n === 5, "crm_meetings heeft de vijf nieuwe kolommen");

  // ---------------------------------------------------------------------------
  console.log("\n  De sleutel in het adres");

  const kort = await moetFalen(
    db,
    `insert into public.crm_booking_links (slug, name) values ('kort', 'Te kort')`
  );
  check(Boolean(kort), "Een korte sleutel wordt geweigerd, die is te raden");

  const hoofdletters = await moetFalen(
    db,
    `insert into public.crm_booking_links (slug, name) values ('MetHoofdletters123', 'Fout')`
  );
  check(Boolean(hoofdletters), "Hoofdletters in de sleutel worden geweigerd");

  await db.exec(
    `insert into public.crm_booking_links (id, slug, name, owner_id)
     values ('${LINK}', 'a1b2c3d4e5f6g7h8', 'Kennismakingsgesprek', '${GEBRUIKER}')`
  );

  const dubbel = await moetFalen(
    db,
    `insert into public.crm_booking_links (slug, name) values ('a1b2c3d4e5f6g7h8', 'Zelfde sleutel')`
  );
  check(Boolean(dubbel), "Twee links met dezelfde sleutel kunnen niet");

  const standaard = await een(
    db,
    `select duration_minutes, buffer_after_minutes, notice_hours, horizon_days, is_active, max_per_day, timezone
     from public.crm_booking_links where id = '${LINK}'`
  );
  check(
    standaard.duration_minutes === 30 && standaard.notice_hours === 24 && standaard.is_active === true,
    "De standaardwaarden zijn redelijk: 30 minuten, 24 uur vooraf, actief"
  );
  check(standaard.timezone === "Europe/Amsterdam", "De tijdzone staat standaard op Amsterdam");
  check(standaard.max_per_day > 0, `Er is een dagmaximum (${standaard.max_per_day})`);

  const gekkeDuur = await moetFalen(
    db,
    `update public.crm_booking_links set duration_minutes = 0 where id = '${LINK}'`
  );
  check(Boolean(gekkeDuur), "Een duur van nul minuten wordt geweigerd");

  // ---------------------------------------------------------------------------
  console.log("\n  Werktijden");

  const goedVenster = await moetFalen(
    db,
    `insert into public.crm_booking_availability (link_id, weekday, start_minute, end_minute)
     values ('${LINK}', 2, 540, 1020)`
  );
  check(!goedVenster, "Dinsdag negen tot vijf kan worden vastgelegd");

  const omgedraaid = await moetFalen(
    db,
    `insert into public.crm_booking_availability (link_id, weekday, start_minute, end_minute)
     values ('${LINK}', 3, 1020, 540)`
  );
  check(Boolean(omgedraaid), "Een venster dat eindigt voor het begint wordt geweigerd");

  const gekkeDag = await moetFalen(
    db,
    `insert into public.crm_booking_availability (link_id, weekday, start_minute, end_minute)
     values ('${LINK}', 9, 540, 1020)`
  );
  check(Boolean(gekkeDag), "Weekdag negen bestaat niet");

  const buitenDeDag = await moetFalen(
    db,
    `insert into public.crm_booking_availability (link_id, weekday, start_minute, end_minute)
     values ('${LINK}', 4, 540, 2000)`
  );
  check(Boolean(buitenDeDag), "Een eindtijd na middernacht wordt geweigerd");

  // ---------------------------------------------------------------------------
  console.log("\n  Twee keer hetzelfde moment kan niet");

  const eerste = await moetFalen(db, boeking(10, { guest_email: "'nora@markenhage.nl'" }));
  check(!eerste, "De eerste boeking gaat door");

  const tweede = await moetFalen(db, boeking(10, { guest_email: "'peter@markenhage.nl'" }));
  check(
    Boolean(tweede),
    "Een tweede boeking op hetzelfde moment via dezelfde link wordt geweigerd door de database"
  );

  const anderMoment = await moetFalen(db, boeking(13, { guest_email: "'wil@markenhage.nl'" }));
  check(!anderMoment, "Een ander moment kan gewoon");

  // Afzeggen geeft het moment weer vrij. Dat is precies de bedoeling van de
  // gedeeltelijke index: hij geldt alleen voor wat nog gepland staat.
  await db.exec(
    `update public.crm_meetings set status = 'geannuleerd'
     where booking_link_id = '${LINK}' and extract(hour from starts_at at time zone 'Europe/Amsterdam') = 10`
  );
  const opnieuw = await moetFalen(db, boeking(10, { guest_email: "'nieuw@markenhage.nl'" }));
  check(!opnieuw, "Na afzeggen kan hetzelfde moment opnieuw worden geboekt");

  // ---------------------------------------------------------------------------
  console.log("\n  Opruimen");

  const voorVerwijderen = await een(
    db,
    `select count(*)::int as n from public.crm_meetings where booking_link_id = '${LINK}'`
  );
  await db.exec(`delete from public.crm_booking_links where id = '${LINK}'`);

  const naVerwijderen = await een(
    db,
    `select
       (select count(*)::int from public.crm_meetings where booking_link_id is null and source = 'boekingslink') as losgekoppeld,
       (select count(*)::int from public.crm_booking_availability) as vensters`
  );
  check(
    naVerwijderen.losgekoppeld === voorVerwijderen.n,
    "Een verwijderde link laat de gemaakte afspraken staan en haalt alleen de verwijzing weg"
  );
  check(naVerwijderen.vensters === 0, "De werktijden van die link gaan wel mee");

  // ---------------------------------------------------------------------------
  console.log("\n  De pagina is openbaar, de database niet");

  for (const tabel of ["crm_booking_links", "crm_booking_availability", "crm_meetings"]) {
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
  console.log("\n  Een boeking maakt geen gebruiker");

  const naarAuth = await een(
    db,
    `select count(*)::int as n from information_schema.columns
     where table_schema = 'public'
       and table_name in ('crm_booking_links', 'crm_booking_availability')
       and column_name in ('user_id', 'portal_user_id', 'auth_user_id')`
  );
  check(naarAuth.n === 0, "Een boekingslink kent geen klantportaalaccount");

  const portaal = await een(
    db,
    `select
       (select count(*)::int from auth.users)                  as gebruikers,
       (select count(*)::int from public.organization_members) as leden`
  );
  check(
    portaal.gebruikers === 1 && portaal.leden === 1,
    "Er is door dit alles geen gebruiker of lidmaatschap bijgekomen"
  );

  // ---------------------------------------------------------------------------
  const erna = alle.slice(index + 1);
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
  console.log("\n  Boekingslinks werken, en de openbare pagina heeft geen enkel databaserecht.\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
