/**
 * Draait alle migraties tegen een tijdelijke Postgres in het geheugen (PGlite).
 *
 * Zo weet je zeker dat het SQL-schema klopt voordat je `supabase db push` doet.
 * De Supabase-specifieke onderdelen (schema auth, auth.uid(), de rollen
 * anon/authenticated/service_role) worden hier nagebootst.
 *
 *   node scripts/verify-migrations.mjs
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
`;

async function main() {
  const db = await PGlite.create();

  await db.exec(SUPABASE_STUBS);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) {
    throw new Error("Geen migraties gevonden");
  }

  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
      console.log(`  ok   ${file}`);
    } catch (error) {
      console.error(`  FOUT ${file}`);
      console.error(`       ${error.message}`);
      process.exitCode = 1;
      return;
    }
  }

  // Controles op het eindresultaat.
  const tables = await db.query(`
    select tablename from pg_tables where schemaname = 'public' order by tablename
  `);
  const withoutRls = await db.query(`
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
    order by c.relname
  `);
  const policies = await db.query(`select count(*)::int as total from pg_policies where schemaname = 'public'`);
  const settings = await db.query(`select count(*)::int as total from public.app_settings`);

  console.log(`\n  ${tables.rows.length} tabellen aangemaakt`);
  console.log(`  ${policies.rows[0].total} RLS-policies actief`);
  console.log(`  ${settings.rows[0].total} instellingen geladen`);

  if (withoutRls.rows.length > 0) {
    console.error(
      `\n  FOUT: deze tabellen hebben geen Row Level Security: ${withoutRls.rows
        .map((r) => r.relname)
        .join(", ")}`
    );
    process.exitCode = 1;
    return;
  }
  console.log("  Row Level Security staat op alle tabellen aan");

  // Rekenregels controleren met echte data.
  await db.exec(`
    insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'test@voorbeeld.nl');
    insert into public.organizations (id, name, slug)
      values ('22222222-2222-2222-2222-222222222222', 'Testschool', 'testschool');
    insert into public.organization_members (organization_id, user_id, role, status, source)
      values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'beheerder', 'active', 'admin_manual');
  `);
  const accountId = (
    await db.query(
      `select public.ensure_loyalty_account('22222222-2222-2222-2222-222222222222'::uuid, '11111111-1111-1111-1111-111111111111'::uuid) as id`
    )
  ).rows[0].id;

  await db.exec(`
    insert into public.loyalty_transactions
      (organization_id, user_id, account_id, type, status, points, point_value_cents_per_100, description, external_reference)
    values
      ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '${accountId}', 'earn_workshop', 'available', 600, 250, '4 x 90 minuten', 'booking:test-1'),
      ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '${accountId}', 'redemption_reserve', 'reserved', -500, 250, 'Gereserveerd', 'red:test-1');
  `);

  const balance = (
    await db.query(
      `select available_points, pending_points, reserved_points, lifetime_earned_points
       from public.loyalty_balances where organization_id = '22222222-2222-2222-2222-222222222222'`
    )
  ).rows[0];

  const expected = { available_points: 100, pending_points: 0, reserved_points: 500, lifetime_earned_points: 600 };
  const matches = Object.entries(expected).every(([key, value]) => balance[key] === value);
  console.log(
    `  Saldoberekening: beschikbaar ${balance.available_points}, gereserveerd ${balance.reserved_points}, totaal gespaard ${balance.lifetime_earned_points}`
  );
  if (!matches) {
    console.error(`  FOUT: saldo klopt niet, verwacht ${JSON.stringify(expected)}`);
    process.exitCode = 1;
    return;
  }

  // Idempotency: dezelfde bron mag geen tweede keer punten opleveren.
  let duplicateBlocked = false;
  try {
    await db.exec(`
      insert into public.loyalty_transactions
        (organization_id, user_id, account_id, type, status, points, point_value_cents_per_100, description, external_reference)
      values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '${accountId}', 'earn_workshop', 'available', 600, 250, 'dubbel', 'booking:test-1');
    `);
  } catch {
    duplicateBlocked = true;
  }
  console.log(
    duplicateBlocked
      ? "  Idempotency: dubbele toekenning wordt door de database geweigerd"
      : "  FOUT: dubbele toekenning werd toegestaan"
  );
  if (!duplicateBlocked) {
    process.exitCode = 1;
    return;
  }

  // Publieke domeinen mogen nooit aan een organisatie hangen.
  let publicDomainBlocked = false;
  try {
    await db.exec(`
      insert into public.organization_domains (organization_id, domain)
      values ('22222222-2222-2222-2222-222222222222', 'gmail.com');
    `);
  } catch {
    publicDomainBlocked = true;
  }
  console.log(
    publicDomainBlocked
      ? "  Publieke e-maildomeinen worden geweigerd"
      : "  FOUT: gmail.com kon aan een organisatie worden gekoppeld"
  );
  if (!publicDomainBlocked) {
    process.exitCode = 1;
    return;
  }

  // De welkomstbonus: precies één per gebruiker, hoe vaak je het ook probeert.
  const bonus = `
    insert into public.loyalty_transactions
      (organization_id, user_id, account_id, type, status, points, point_value_cents_per_100,
       description, source, external_reference, available_at)
    values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '${accountId}', 'welcome_bonus', 'available',
            100, 250, 'Welkomstbonus SkoolPartner', 'portal', 'welcome', now())
    on conflict (organization_id, user_id, type, external_reference) where external_reference is not null
    do nothing;
  `;
  // Vier pogingen: opnieuw registreren, opnieuw verifiëren, opnieuw inloggen,
  // en een herhaalde callback.
  await db.exec(bonus);
  await db.exec(bonus);
  await db.exec(bonus);
  await db.exec(bonus);

  const bonusRows = (
    await db.query(`
      select count(*)::int as aantal, coalesce(sum(points), 0)::int as punten
      from public.loyalty_transactions
      where organization_id = '22222222-2222-2222-2222-222222222222' and type = 'welcome_bonus'
    `)
  ).rows[0];

  const bonusOk = bonusRows.aantal === 1 && bonusRows.punten === 100;
  console.log(
    bonusOk
      ? "  Welkomstbonus: vier pogingen leveren per gebruiker precies één bonus op"
      : `  FOUT: welkomstbonus gaf ${bonusRows.aantal} transacties met ${bonusRows.punten} punten`
  );
  if (!bonusOk) {
    process.exitCode = 1;
    return;
  }

  // Een correctie zonder reden mag niet.
  let reasonRequired = false;
  try {
    await db.exec(`
      insert into public.loyalty_transactions
        (organization_id, user_id, account_id, type, status, points, point_value_cents_per_100, description)
      values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '${accountId}', 'manual_adjustment', 'available', 50, 250, 'zonder reden');
    `);
  } catch {
    reasonRequired = true;
  }
  console.log(
    reasonRequired
      ? "  Handmatige correctie zonder reden wordt geweigerd"
      : "  FOUT: correctie zonder reden werd toegestaan"
  );
  if (!reasonRequired) process.exitCode = 1;

  // ---------------------------------------------------------------------------
  // Inschrijvingen: capaciteit, klastoegang, herhaling en een keuze per ronde
  // ---------------------------------------------------------------------------
  await db.exec(`
    insert into public.enrollment_events (id, organization_id, name, event_date, status, slug)
    values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222',
            'Cultuurdag', current_date + 14, 'open', 'cultuurdag-test');

    insert into public.enrollment_groups (id, event_id, name) values
      ('44444444-4444-4444-4444-444444444441', '33333333-3333-3333-3333-333333333333', '1 HAVO'),
      ('44444444-4444-4444-4444-444444444442', '33333333-3333-3333-3333-333333333333', '2 HAVO');

    insert into public.enrollment_rounds (id, event_id, position, label, starts_at, ends_at) values
      ('55555555-5555-5555-5555-555555555551', '33333333-3333-3333-3333-333333333333', 1, 'Workshopronde 1', '09:15', '10:15'),
      ('55555555-5555-5555-5555-555555555552', '33333333-3333-3333-3333-333333333333', 2, 'Workshopronde 2', '10:45', '11:45');

    insert into public.enrollment_workshops (id, event_id, name) values
      ('66666666-6666-6666-6666-666666666661', '33333333-3333-3333-3333-333333333333', 'Workshop Graffiti'),
      ('66666666-6666-6666-6666-666666666662', '33333333-3333-3333-3333-333333333333', 'Workshop Hiphop');

    -- Graffiti ronde 1: één plek, alleen 1 HAVO. Graffiti ronde 2: open.
    insert into public.enrollment_sessions (id, event_id, workshop_id, round_id, capacity) values
      ('77777777-7777-7777-7777-777777777771', '33333333-3333-3333-3333-333333333333',
       '66666666-6666-6666-6666-666666666661', '55555555-5555-5555-5555-555555555551', 1),
      ('77777777-7777-7777-7777-777777777772', '33333333-3333-3333-3333-333333333333',
       '66666666-6666-6666-6666-666666666661', '55555555-5555-5555-5555-555555555552', 25),
      ('77777777-7777-7777-7777-777777777773', '33333333-3333-3333-3333-333333333333',
       '66666666-6666-6666-6666-666666666662', '55555555-5555-5555-5555-555555555551', 25);

    insert into public.enrollment_session_groups (session_id, group_id, event_id) values
      ('77777777-7777-7777-7777-777777777771', '44444444-4444-4444-4444-444444444441',
       '33333333-3333-3333-3333-333333333333');

    insert into public.enrollment_participants
      (id, event_id, group_id, display_name, search_key, flat_key, claim_token, access_code) values
      ('88888888-8888-8888-8888-888888888881', '33333333-3333-3333-3333-333333333333',
       '44444444-4444-4444-4444-444444444441', 'Lissa van der Velde', 'lissa velde', 'lissavelde', 'token-lissa-0001', 'AAAA2222'),
      ('88888888-8888-8888-8888-888888888882', '33333333-3333-3333-3333-333333333333',
       '44444444-4444-4444-4444-444444444441', 'Jan-Peter Bakker', 'bakker jan peter', 'bakkerjanpeter', 'token-janpeter01', 'BBBB3333'),
      ('88888888-8888-8888-8888-888888888883', '33333333-3333-3333-3333-333333333333',
       '44444444-4444-4444-4444-444444444442', 'Ilse Mooren', 'ilse mooren', 'ilsemooren', 'token-ilse-00001', 'CCCC4444');
  `);

  const kies = (deelnemer, uitvoering) =>
    db.query(`select public.enrollment_choose('${deelnemer}'::uuid, '${uitvoering}'::uuid) as rij`);

  const weigering = async (deelnemer, uitvoering) => {
    try {
      await kies(deelnemer, uitvoering);
      return null;
    } catch (error) {
      return String(error.message);
    }
  };

  const graffiti1 = '77777777-7777-7777-7777-777777777771';
  const graffiti2 = '77777777-7777-7777-7777-777777777772';
  const hiphop1 = '77777777-7777-7777-7777-777777777773';
  const lissa = '88888888-8888-8888-8888-888888888881';
  const janpeter = '88888888-8888-8888-8888-888888888882';
  const ilse = '88888888-8888-8888-8888-888888888883';

  const controles = [];

  await kies(lissa, graffiti1);

  controles.push([
    (await weigering(janpeter, graffiti1))?.includes('enrollment_full'),
    'een volle uitvoering wordt geweigerd',
  ]);
  controles.push([
    (await weigering(ilse, graffiti1))?.includes('enrollment_not_allowed'),
    'een klas die niet is aangevinkt wordt geweigerd',
  ]);
  controles.push([
    (await weigering(lissa, graffiti2))?.includes('enrollment_repeat'),
    'dezelfde workshop in een tweede ronde wordt geweigerd',
  ]);

  // Hiphop heeft geen klassen aangevinkt, dus iedereen mag erin.
  await kies(ilse, hiphop1);
  controles.push([
    (await db.query(`select count(*)::int as n from public.enrollment_choices where participant_id = '${ilse}'`)).rows[0]
      .n === 1,
    'zonder aangevinkte klassen mag iedereen erin',
  ]);

  // Wisselen binnen een ronde laat de oude plek vrij en voegt niets toe.
  await kies(lissa, hiphop1);
  const na = (
    await db.query(`
      select (select count(*)::int from public.enrollment_choices where participant_id = '${lissa}') as keuzes,
             (select bezet from public.enrollment_session_occupancy where session_id = '${graffiti1}') as oud
    `)
  ).rows[0];
  controles.push([na.keuzes === 1 && na.oud === 0, 'een keuze per ronde, wisselen laat de oude plek vrij']);

  // Met herhaling aan mag dezelfde workshop wel twee keer.
  await db.exec(`update public.enrollment_events set allow_repeat = true where id = '33333333-3333-3333-3333-333333333333'`);
  await kies(janpeter, graffiti1);
  controles.push([(await weigering(janpeter, graffiti2)) === null, 'met herhaling aan mag dezelfde workshop twee keer']);
  await db.exec(`update public.enrollment_events set allow_repeat = false where id = '33333333-3333-3333-3333-333333333333'`);

  // Een uitvoering die niet draait neemt niemand aan.
  await db.exec(`update public.enrollment_sessions set is_active = false where id = '${hiphop1}'`);
  controles.push([
    (await weigering(ilse, hiphop1))?.includes('enrollment_unavailable'),
    'een uitvoering die uit staat neemt geen keuzes aan',
  ]);
  await db.exec(`update public.enrollment_sessions set is_active = true where id = '${hiphop1}'`);

  // De database laat niet toe dat een keuze naar een andere ronde wijst.
  let verkeerdeRonde = false;
  try {
    await db.exec(`
      insert into public.enrollment_choices (participant_id, round_id, session_id)
      values ('${ilse}', '55555555-5555-5555-5555-555555555552', '${hiphop1}');
    `);
  } catch {
    verkeerdeRonde = true;
  }
  controles.push([verkeerdeRonde, 'een keuze kan niet naar een uitvoering uit een andere ronde wijzen']);

  // En niet dat een uitvoering een workshop en een ronde van twee dagen mengt.
  let gemengdeDag = false;
  try {
    await db.exec(`
      insert into public.enrollment_events (id, organization_id, name, event_date, slug)
      values ('33333333-3333-3333-3333-333333333334', '22222222-2222-2222-2222-222222222222',
              'Andere dag', current_date + 21, 'andere-dag-test');
      insert into public.enrollment_rounds (id, event_id, position, label, starts_at, ends_at)
      values ('55555555-5555-5555-5555-555555555559', '33333333-3333-3333-3333-333333333334', 1, 'Ronde 1', '09:00', '10:00');
      insert into public.enrollment_sessions (event_id, workshop_id, round_id)
      values ('33333333-3333-3333-3333-333333333333', '66666666-6666-6666-6666-666666666661',
              '55555555-5555-5555-5555-555555555559');
    `);
  } catch {
    gemengdeDag = true;
  }
  controles.push([gemengdeDag, 'een uitvoering kan geen ronde van een andere dag gebruiken']);

  // Een gesloten inschrijving neemt niets meer aan.
  await db.exec(`update public.enrollment_events set status = 'gesloten' where id = '33333333-3333-3333-3333-333333333333'`);
  controles.push([
    (await weigering(ilse, hiphop1))?.includes('enrollment_closed'),
    'een gesloten inschrijfdag neemt geen keuzes meer aan',
  ]);

  // Automatisch indelen mag juist wel als de inschrijving gesloten is.
  const automatisch = (deelnemer, uitvoering) =>
    db.query(`select public.enrollment_choose('${deelnemer}'::uuid, '${uitvoering}'::uuid, 'automatisch') as rij`);

  let automatischGelukt = true;
  try {
    await automatisch(ilse, hiphop1);
  } catch {
    automatischGelukt = false;
  }
  controles.push([automatischGelukt, 'automatisch indelen mag ook als de inschrijving gesloten is']);
  controles.push([
    (await db.query(`select source from public.enrollment_choices where participant_id = '${ilse}'`)).rows[0]
      ?.source === 'automatisch',
    'van elke keuze staat vast of hij van de deelnemer of van ons komt',
  ]);

  // Een vrijgestelde leerling doet niet mee.
  await db.exec(`update public.enrollment_participants set exempt = true where id = '${ilse}'`);
  let vrijgesteldGeweigerd = false;
  try {
    await automatisch(ilse, hiphop1);
  } catch (error) {
    vrijgesteldGeweigerd = String(error.message).includes('enrollment_exempt');
  }
  controles.push([vrijgesteldGeweigerd, 'een vrijgestelde deelnemer wordt niet ingedeeld']);

  // Een app-link die niet van de officiele winkel komt, gaat de database niet in.
  let nepLinkGeweigerd = false;
  try {
    await db.exec(`
      insert into public.enrollment_workshops (event_id, name, app_required, app_name, app_android_url)
      values ('33333333-3333-3333-3333-333333333333', 'Workshop Vloggen', true, 'CapCut',
              'https://download-nu.example.com/capcut.apk');
    `);
  } catch {
    nepLinkGeweigerd = true;
  }
  controles.push([nepLinkGeweigerd, 'een app-link buiten de officiele winkels wordt geweigerd']);

  let alleGoed = true;
  for (const [goed, tekst] of controles) {
    console.log(goed ? `  Inschrijvingen: ${tekst}` : `  FOUT: ${tekst} ging niet goed`);
    if (!goed) alleGoed = false;
  }
  if (!alleGoed) process.exitCode = 1;


  await db.close();
  console.log("\n  Alle migraties en databaseregels zijn in orde.\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
