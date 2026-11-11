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

  // ---------------------------------------------------------------------------
  // Migratie 043: de gedeelde toegangscode, de verificatiecodes en de teller
  // ---------------------------------------------------------------------------
  const dag = '33333333-3333-3333-3333-333333333333';

  const weigert = async (sql) => {
    try {
      await db.exec(sql);
      return false;
    } catch {
      return true;
    }
  };

  // De migratie geeft elke dag die al bestond een eigen code. Zonder dat zou
  // een dag die nu open staat na de migratie voor iedereen dicht zitten. De
  // dagen hierboven zijn ná de migratie aangemaakt, dus hier wordt dezelfde
  // regel nog een keer gedraaid om te zien wat hij doet.
  await db.exec(`
    update public.enrollment_events
       set shared_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
           shared_code_changed_at = now()
     where shared_code is null;
  `);
  const codes = await db.query(`
    select id, shared_code from public.enrollment_events order by created_at
  `);
  controles.push([
    codes.rows.every((rij) => /^[0-9A-HJKMNP-TV-Z]{6,12}$/.test(rij.shared_code ?? "")),
    'elke bestaande dag heeft een gedeelde code gekregen',
  ]);
  controles.push([
    new Set(codes.rows.map((rij) => rij.shared_code)).size === codes.rows.length,
    'elke dag heeft zijn eigen code, niet allemaal dezelfde',
  ]);

  // De vorm van de gedeelde code. Zonder I, L, O en U, want die worden aan de
  // telefoon verkeerd overgeschreven.
  controles.push([
    !(await weigert(`update public.enrollment_events set shared_code = 'KM7P4X2B' where id = '${dag}'`)),
    'een gedeelde code van acht tekens wordt geaccepteerd',
  ]);
  controles.push([
    await weigert(`update public.enrollment_events set shared_code = 'ABC' where id = '${dag}'`),
    'een te korte gedeelde code wordt geweigerd',
  ]);
  controles.push([
    await weigert(`update public.enrollment_events set shared_code = 'ABCDIJKL' where id = '${dag}'`),
    'een gedeelde code met een I of een L wordt geweigerd',
  ]);
  controles.push([
    await weigert(`update public.enrollment_events set shared_code = 'km7p4x2b' where id = '${dag}'`),
    'een gedeelde code in kleine letters wordt geweigerd',
  ]);

  // De drie manieren van bekendmaken, en niets anders.
  for (const wijze of ['code', 'schoolmail', 'naam']) {
    controles.push([
      !(await weigert(`update public.enrollment_events set access_mode = '${wijze}' where id = '${dag}'`)),
      `toegangswijze '${wijze}' wordt geaccepteerd`,
    ]);
  }
  controles.push([
    await weigert(`update public.enrollment_events set access_mode = 'open' where id = '${dag}'`),
    'een onbekende toegangswijze wordt geweigerd',
  ]);
  await db.exec(`update public.enrollment_events set access_mode = 'code' where id = '${dag}'`);

  // Het adres waarmee bevestigd is, moet een adres zijn.
  controles.push([
    await weigert(`update public.enrollment_participants set claim_email = 'geen adres' where id = '${lissa}'`),
    'een bevestigingsadres dat geen adres is wordt geweigerd',
  ]);
  controles.push([
    !(await weigert(
      `update public.enrollment_participants set claim_email = 'lissa@voorbeeld.test', claimed_at = now() where id = '${lissa}'`,
    )),
    'een geldig bevestigingsadres wordt bewaard',
  ]);

  // De pogingenteller: tien mogen er door, de elfde niet.
  const poging = async (bucket, max = 10, seconden = 600) =>
    (
      await db.query(`select public.enrollment_poging($1::uuid, $2, $3, $4) as mag`, [dag, bucket, max, seconden])
    ).rows[0].mag;

  let doorgelaten = 0;
  for (let i = 0; i < 12; i += 1) {
    if (await poging('gedeeld:aaa')) doorgelaten += 1;
  }
  controles.push([doorgelaten === 10, `de teller laat precies tien pogingen door (nu ${doorgelaten})`]);

  // Een andere bezoeker heeft zijn eigen teller: één die zit te raden sluit de
  // rest van de school niet buiten.
  controles.push([await poging('gedeeld:bbb'), 'een andere bezoeker heeft zijn eigen teller']);

  // En een ander soort poging telt apart, zodat een foute toegangscode geen
  // persoonlijke code opsnoept.
  controles.push([await poging('code:aaa'), 'een ander soort poging telt apart']);

  // Een nieuw tijdvak begint opnieuw te tellen.
  await poging('kort:ccc', 1, 1);
  const metenNa = await poging('kort:ccc', 1, 1);
  await new Promise((klaar) => setTimeout(klaar, 1100));
  const naWachten = await poging('kort:ccc', 1, 1);
  controles.push([metenNa === false && naWachten === true, 'na het tijdvak begint de telling opnieuw']);

  // Onzinnige grenzen moeten hard stuklopen, niet stilletjes alles doorlaten.
  let onzinGeweigerd = false;
  try {
    await db.query(`select public.enrollment_poging($1::uuid, 'x', 0, 60)`, [dag]);
  } catch {
    onzinGeweigerd = true;
  }
  controles.push([onzinGeweigerd, 'de teller weigert onzinnige grenzen']);

  // Verificatiecodes: niet meer dan tien pogingen per code, en de code zelf
  // staat er nooit in, alleen de versleutelde vorm.
  await db.exec(`
    insert into public.enrollment_verifications (participant_id, code_hash, sent_to, expires_at)
    values ('${lissa}', 'verzonnen-hash', 'lissa@voorbeeld.test', now() + interval '10 minutes');
  `);
  controles.push([
    await weigert(`update public.enrollment_verifications set attempts = 11 where participant_id = '${lissa}'`),
    'meer dan tien pogingen op één verificatiecode wordt geweigerd',
  ]);
  controles.push([
    await weigert(`
      insert into public.enrollment_verifications (participant_id, code_hash, sent_to, expires_at)
      values ('${lissa}', 'hash', 'geen adres', now() + interval '10 minutes');
    `),
    'een verificatiecode naar iets dat geen adres is wordt geweigerd',
  ]);

  // Alles van een dag die weggaat, gaat mee. Zodat er nooit resten van een
  // school blijven staan nadat de dag is opgeruimd.
  await db.exec(`
    insert into public.enrollment_events (id, organization_id, name, event_date, slug, shared_code)
    values ('39999999-9999-9999-9999-999999999999', '22222222-2222-2222-2222-222222222222',
            'Opruimdag', current_date + 30, 'opruimdag-test', 'ZZZZ9999');
    insert into public.enrollment_groups (id, event_id, name)
    values ('49999999-9999-9999-9999-999999999999', '39999999-9999-9999-9999-999999999999', '1A');
    insert into public.enrollment_participants
      (id, event_id, group_id, display_name, search_key, flat_key, claim_token, access_code)
    values ('89999999-9999-9999-9999-999999999999', '39999999-9999-9999-9999-999999999999',
            '49999999-9999-9999-9999-999999999999', 'Test Leerling', 'test leerling', 'testleerling',
            'token-opruimen-01', 'ZZZZ1111');
    insert into public.enrollment_verifications (participant_id, code_hash, sent_to, expires_at)
    values ('89999999-9999-9999-9999-999999999999', 'hash', 'test@voorbeeld.test', now() + interval '10 minutes');
  `);
  await db.query(`select public.enrollment_poging($1::uuid, 'gedeeld:zzz', 10, 600)`, [
    '39999999-9999-9999-9999-999999999999',
  ]);
  await db.exec(`delete from public.enrollment_events where id = '39999999-9999-9999-9999-999999999999'`);
  const resten = (
    await db.query(`
      select (select count(*)::int from public.enrollment_verifications
                where participant_id = '89999999-9999-9999-9999-999999999999') as codes,
             (select count(*)::int from public.enrollment_attempts
                where event_id = '39999999-9999-9999-9999-999999999999') as pogingen
    `)
  ).rows[0];
  controles.push([
    resten.codes === 0 && resten.pogingen === 0,
    'met een verwijderde dag verdwijnen ook de verificatiecodes en de pogingen',
  ]);

  // De twee nieuwe instellingen staan klaar.
  const nieuweInstellingen = (
    await db.query(`
      select count(*)::int as aantal from public.app_settings
      where key in ('enrollment_shared_attempts', 'enrollment_verify_minutes')
    `)
  ).rows[0].aantal;
  controles.push([nieuweInstellingen === 2, 'de instellingen voor pogingen en geldigheid staan klaar']);

  // ---------------------------------------------------------------------------
  // Wie mag wat: de rechten op de tabellen
  // ---------------------------------------------------------------------------
  // De inschrijvingstabellen horen voor niemand rechtstreeks leesbaar te zijn.
  // Alles loopt via serveracties met de serviceclient, die zelf controleren wie
  // wat mag. Gaat dat ooit per ongeluk open, dan hoort deze controle af te gaan.

  const anonRechten = await db.query(`
    select table_name from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'
  `);
  controles.push([anonRechten.rows.length === 0, 'de publieke sleutel (anon) heeft nergens rechten op']);

  const anonFuncties = await db.query(`
    select p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    join pg_roles r on r.oid = a.grantee
    where n.nspname = 'public' and r.rolname = 'anon' and a.privilege_type = 'EXECUTE'
  `);
  controles.push([anonFuncties.rows.length === 0, 'de publieke sleutel mag geen enkele functie aanroepen']);

  const inschrijvingRechten = await db.query(`
    select table_name, grantee from information_schema.role_table_grants
    where table_schema = 'public' and table_name like 'enrollment%'
      and grantee not in ('service_role', 'postgres')
  `);
  controles.push([
    inschrijvingRechten.rows.length === 0,
    'alleen de serviceclient komt bij de inschrijvingstabellen',
  ]);

  const zonderForce = await db.query(`
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'enrollment%'
      and (c.relrowsecurity = false or c.relforcerowsecurity = false)
  `);
  controles.push([
    zonderForce.rows.length === 0,
    'op elke inschrijvingstabel staat Row Level Security hard aan',
  ]);

  const inschrijvingPolicies = await db.query(`
    select policyname from pg_policies where schemaname = 'public' and tablename like 'enrollment%'
  `);
  controles.push([
    inschrijvingPolicies.rows.length === 0,
    'er staat geen enkele policy op de inschrijvingstabellen',
  ]);

  const zonderZoekpad = await db.query(`
    select p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.proconfig is null
  `);
  controles.push([
    zonderZoekpad.rows.length === 0,
    'elke functie met verhoogde rechten heeft een vast zoekpad',
  ]);

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
