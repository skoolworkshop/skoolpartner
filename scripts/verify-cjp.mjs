/**
 * Controleert het voorstel supabase/voorstel-cjp-tegoed.sql tegen een echte
 * Postgres in het geheugen (PGlite), voordat er ook maar iets naar de live
 * database gaat.
 *
 * Wat hier bewezen wordt:
 *   1. Het voorstel draait bovenop alle bestaande migraties.
 *   2. Twee keer draaien verandert niets (herhaalbaar).
 *   3. Twee keer bevestigen levert precies één keer tegoed en één keer bonus op.
 *   4. Meer afboeken dan er staat wordt geweigerd.
 *   5. Een tweede aanvraag binnen de wachttijd geeft wel tegoed, geen tweede bonus.
 *   6. Euro's en punten blijven volledig gescheiden.
 *
 *   node scripts/verify-cjp-voorstel.mjs
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const VOORSTEL = path.join(process.cwd(), "supabase", "migrations", "20260826120600_cjp_tegoed.sql");

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

const ORG = "22222222-2222-2222-2222-222222222222";
const ANDERE_ORG = "33333333-3333-3333-3333-333333333333";
const USER = "11111111-1111-1111-1111-111111111111";

let fouten = 0;

function check(goed, tekst) {
  console.log(`  ${goed ? "ok  " : "FOUT"} ${tekst}`);
  if (!goed) fouten += 1;
}

async function faalt(db, sql) {
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
  for (const file of files) {
    await db.exec(await readFile(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  console.log(`\n  ${files.length} bestaande migraties geladen\n`);

  const voorstel = await readFile(VOORSTEL, "utf8");

  // 1. Draait het voorstel?
  try {
    await db.exec(voorstel);
    check(true, "Het voorstel draait zonder fouten");
  } catch (error) {
    check(false, `Het voorstel draait niet: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  // 2. Herhaalbaar: twee keer draaien mag niets stukmaken of verdubbelen.
  try {
    await db.exec(voorstel);
    check(true, "Twee keer draaien geeft geen fouten");
  } catch (error) {
    check(false, `Tweede keer draaien mislukt: ${error.message}`);
  }

  const instellingen = (
    await db.query(`select count(*)::int as n from public.app_settings where key like 'cjp\\_%'`)
  ).rows[0].n;
  check(instellingen === 6, `Zes CJP-instellingen aanwezig, niet gedupliceerd (gevonden: ${instellingen})`);

  // Row Level Security moet ook op de nieuwe tabellen aan staan.
  const zonderRls = (
    await db.query(`
      select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
    `)
  ).rows;
  check(zonderRls.length === 0, `Row Level Security staat op alle tabellen aan`);

  // -------------------------------------------------------------------------
  // Testdata
  // -------------------------------------------------------------------------
  await db.exec(`
    insert into auth.users (id, email) values ('${USER}', 'beheerder@voorbeeld.nl');
    insert into public.organizations (id, name, slug) values
      ('${ORG}', 'Testschool', 'testschool'),
      ('${ANDERE_ORG}', 'Andere school', 'andere-school');
    select public.ensure_loyalty_account('${ORG}'::uuid, null);
    select public.ensure_loyalty_account('${ANDERE_ORG}'::uuid, null);
    insert into public.bookings (id, organization_id, workshop_name, status, scheduled_date)
    values ('44444444-4444-4444-4444-444444444444', '${ORG}', 'Workshop Techniek', 'confirmed', current_date + 20),
           ('55555555-5555-5555-5555-555555555555', '${ANDERE_ORG}', 'Workshop Koken', 'confirmed', current_date + 20);
  `);

  async function nieuweAanvraag(bedrag) {
    return (
      await db.query(`
        insert into public.cjp_parking_requests
          (organization_id, school_name, cjp_school_number, holder_name, holder_email, amount_cents, requested_by)
        values ('${ORG}', 'Testschool', '123456', 'Jan Jansen', 'jan@testschool.nl', ${bedrag}, '${USER}')
        returning id
      `)
    ).rows[0].id;
  }

  async function saldo(org = ORG) {
    return (
      await db.query(
        `select available_cents, added_cents, spent_cents from public.cjp_credit_balances where organization_id = '${org}'`
      )
    ).rows[0];
  }

  async function punten(org = ORG) {
    return (
      await db.query(
        `select available_points, lifetime_earned_points from public.loyalty_balances where organization_id = '${org}'`
      )
    ).rows[0];
  }

  // -------------------------------------------------------------------------
  // 3. Aanvragen levert nog niets op
  // -------------------------------------------------------------------------
  const aanvraag1 = await nieuweAanvraag(50000); // 500 euro
  let s = await saldo();
  let p = await punten();
  check(
    s.available_cents === 0 && p.available_points === 0,
    "Een nieuwe aanvraag geeft nog geen tegoed en nog geen punten"
  );

  // -------------------------------------------------------------------------
  // 4. Bevestigen, en daarna nog drie keer bevestigen
  // -------------------------------------------------------------------------
  await db.exec(`select public.confirm_cjp_parking('${aanvraag1}'::uuid, '${USER}'::uuid, 'Bedrag ontvangen');`);
  await db.exec(`select public.confirm_cjp_parking('${aanvraag1}'::uuid, '${USER}'::uuid, null);`);
  await db.exec(`select public.confirm_cjp_parking('${aanvraag1}'::uuid, null, null);`);
  await db.exec(`select public.confirm_cjp_parking('${aanvraag1}'::uuid, '${USER}'::uuid, null);`);

  const credits = (
    await db.query(
      `select count(*)::int as n, coalesce(sum(amount_cents),0)::int as som
       from public.cjp_credit_transactions where organization_id = '${ORG}' and type = 'parking'`
    )
  ).rows[0];
  check(
    credits.n === 1 && credits.som === 50000,
    `Vier keer bevestigen geeft precies één bijschrijving van 500,00 euro (gevonden: ${credits.n} regels, ${credits.som} cent)`
  );

  const bonussen = (
    await db.query(
      `select count(*)::int as n, coalesce(sum(points),0)::int as punten
       from public.loyalty_transactions where organization_id = '${ORG}' and type = 'cjp_bonus'`
    )
  ).rows[0];
  check(
    bonussen.n === 1 && bonussen.punten === 1000,
    `Vier keer bevestigen geeft precies één bonus van 1.000 punten (gevonden: ${bonussen.n} regels, ${bonussen.punten} punten)`
  );

  const status = (
    await db.query(
      `select status, credit_transaction_id is not null as heeft_credit, bonus_transaction_id is not null as heeft_bonus
       from public.cjp_parking_requests where id = '${aanvraag1}'`
    )
  ).rows[0];
  check(
    status.status === "confirmed" && status.heeft_credit && status.heeft_bonus,
    "De aanvraag staat op bevestigd en verwijst naar beide boekingen"
  );

  s = await saldo();
  check(s.available_cents === 50000 && s.added_cents === 50000, "Het saldo in de view klopt");

  // -------------------------------------------------------------------------
  // 5. Tweede aanvraag binnen de wachttijd: wel tegoed, geen tweede bonus
  // -------------------------------------------------------------------------
  const aanvraag2 = await nieuweAanvraag(25000);
  await db.exec(`select public.confirm_cjp_parking('${aanvraag2}'::uuid, '${USER}'::uuid, null);`);

  s = await saldo();
  const bonussen2 = (
    await db.query(
      `select count(*)::int as n from public.loyalty_transactions where organization_id = '${ORG}' and type = 'cjp_bonus'`
    )
  ).rows[0].n;
  check(
    s.available_cents === 75000,
    `Een tweede bevestigde aanvraag schrijft het tegoed gewoon bij (saldo: ${s.available_cents} cent)`
  );
  check(bonussen2 === 1, `Binnen de wachttijd komt er geen tweede bonus bij (bonussen: ${bonussen2})`);

  // -------------------------------------------------------------------------
  // 6. Een afgewezen aanvraag kan niet alsnog bevestigd worden
  // -------------------------------------------------------------------------
  const aanvraag3 = await nieuweAanvraag(10000);
  await db.exec(`update public.cjp_parking_requests set status = 'rejected' where id = '${aanvraag3}';`);
  let fout = await faalt(db, `select public.confirm_cjp_parking('${aanvraag3}'::uuid, null, null);`);
  check(fout !== null, "Een afgewezen aanvraag kan niet meer worden bevestigd");

  fout = await faalt(db, `select public.confirm_cjp_parking('66666666-6666-6666-6666-666666666666'::uuid, null, null);`);
  check(fout !== null, "Een onbekende aanvraag geeft een nette fout");

  // -------------------------------------------------------------------------
  // 7. Afboeken
  // -------------------------------------------------------------------------
  fout = await faalt(db, `select public.spend_cjp_credit('${ORG}'::uuid, 80000, null, null, null, null);`);
  check(
    fout !== null && fout.includes("Onvoldoende tegoed"),
    `Meer afboeken dan er staat wordt geweigerd (${fout ?? "werd toegestaan"})`
  );

  fout = await faalt(db, `select public.spend_cjp_credit('${ORG}'::uuid, 0, null, null, null, null);`);
  check(fout !== null, "Een bedrag van nul wordt geweigerd");

  fout = await faalt(db, `select public.spend_cjp_credit('${ORG}'::uuid, -5000, null, null, null, null);`);
  check(fout !== null, "Een negatief bedrag wordt geweigerd");

  fout = await faalt(
    db,
    `select public.spend_cjp_credit('${ORG}'::uuid, 5000, '55555555-5555-5555-5555-555555555555'::uuid, null, null, null);`
  );
  check(fout !== null, "Afboeken op een boeking van een andere organisatie wordt geweigerd");

  await db.exec(
    `select public.spend_cjp_credit('${ORG}'::uuid, 30000, '44444444-4444-4444-4444-444444444444'::uuid, 'SW-2026-0501', '${USER}'::uuid, 'Verrekend met factuur');`
  );
  s = await saldo();
  check(
    s.available_cents === 45000 && s.spent_cents === 30000,
    `Na afboeken van 300,00 euro blijft 450,00 euro over (saldo: ${s.available_cents}, gebruikt: ${s.spent_cents})`
  );

  // Precies het restant afboeken moet nog net kunnen, één cent meer niet.
  fout = await faalt(db, `select public.spend_cjp_credit('${ORG}'::uuid, 45001, null, null, null, null);`);
  check(fout !== null, "Eén cent meer dan het restant wordt geweigerd");
  await db.exec(`select public.spend_cjp_credit('${ORG}'::uuid, 45000, null, null, null, null);`);
  s = await saldo();
  check(s.available_cents === 0, "Precies het restant afboeken mag, en het saldo komt op nul");

  fout = await faalt(db, `select public.spend_cjp_credit('${ORG}'::uuid, 1, null, null, null, null);`);
  check(fout !== null, "Met een saldo van nul kan er niets meer af");

  // -------------------------------------------------------------------------
  // 8. Euro's en punten blijven gescheiden
  // -------------------------------------------------------------------------
  p = await punten();
  check(
    p.available_points === 1000,
    `Afboeken van euro's raakt de punten niet aan (punten: ${p.available_points})`
  );

  const andere = await saldo(ANDERE_ORG);
  check(
    andere.available_cents === 0,
    "Het tegoed van de ene school komt niet terecht bij de andere"
  );

  // -------------------------------------------------------------------------
  // 9. De boekhoudkundige regels in de tabel zelf
  // -------------------------------------------------------------------------
  fout = await faalt(
    db,
    `insert into public.cjp_credit_transactions (organization_id, amount_cents, type, description)
     values ('${ORG}', -1000, 'parking', 'stiekem eraf');`
  );
  check(fout !== null, "Een bijschrijving met een negatief bedrag wordt geweigerd");

  fout = await faalt(
    db,
    `insert into public.cjp_credit_transactions (organization_id, amount_cents, type, description)
     values ('${ORG}', 1000, 'spend', 'stiekem erbij');`
  );
  check(fout !== null, "Een afboeking met een positief bedrag wordt geweigerd");

  fout = await faalt(
    db,
    `insert into public.cjp_credit_transactions (organization_id, amount_cents, type, description)
     values ('${ORG}', 1000, 'correction', 'zonder uitleg');`
  );
  check(fout !== null, "Een correctie zonder uitleg wordt geweigerd");

  fout = await faalt(
    db,
    `insert into public.cjp_credit_transactions (organization_id, amount_cents, type, description, external_reference)
     values ('${ORG}', 50000, 'parking', 'dubbel', 'request:${aanvraag1}');`
  );
  check(fout !== null, "Dezelfde bron kan geen tweede keer tegoed opleveren");

  fout = await faalt(
    db,
    `insert into public.cjp_parking_requests
       (organization_id, school_name, cjp_school_number, holder_name, holder_email, amount_cents)
     values ('${ORG}', 'Testschool', '12', 'Jan', 'jan@testschool.nl', 10000);`
  );
  check(fout !== null, "Een aanvraag zonder geldig CJP-schoolnummer wordt geweigerd");

  fout = await faalt(
    db,
    `insert into public.cjp_parking_requests
       (organization_id, school_name, cjp_school_number, holder_name, holder_email, amount_cents)
     values ('${ORG}', 'Testschool', '123456', 'Jan', 'geen-adres', 10000);`
  );
  check(fout !== null, "Een aanvraag zonder e-mailadres van de budgethouder wordt geweigerd");

  // -------------------------------------------------------------------------
  // 10. Bonus uitzetten werkt
  // -------------------------------------------------------------------------
  await db.exec(`update public.app_settings set value = 'false'::jsonb where key = 'cjp_bonus_enabled';`);
  await db.exec(`update public.app_settings set value = '0'::jsonb where key = 'cjp_bonus_cooldown_days';`);
  const aanvraag4 = await nieuweAanvraag(20000);
  await db.exec(`select public.confirm_cjp_parking('${aanvraag4}'::uuid, null, null);`);
  const naUit = (
    await db.query(
      `select count(*)::int as n from public.loyalty_transactions where organization_id = '${ORG}' and type = 'cjp_bonus'`
    )
  ).rows[0].n;
  s = await saldo();
  check(naUit === 1, "Met de bonus uit komen er geen bonuspunten bij");
  check(s.available_cents === 20000, "Met de bonus uit wordt het tegoed nog wel gewoon bijgeschreven");

  // Wachttijd op nul en bonus weer aan: dan levert elke aanvraag wel de bonus op.
  await db.exec(`update public.app_settings set value = 'true'::jsonb where key = 'cjp_bonus_enabled';`);
  const aanvraag5 = await nieuweAanvraag(15000);
  await db.exec(`select public.confirm_cjp_parking('${aanvraag5}'::uuid, null, null);`);
  const naAan = (
    await db.query(
      `select count(*)::int as n from public.loyalty_transactions where organization_id = '${ORG}' and type = 'cjp_bonus'`
    )
  ).rows[0].n;
  check(naAan === 2, `Met wachttijd nul levert een volgende aanvraag wel weer de bonus op (${naAan})`);

  await db.close();

  if (fouten > 0) {
    console.error(`\n  ${fouten} controle(s) mislukt.\n`);
    process.exitCode = 1;
    return;
  }
  console.log("\n  Alle controles op het CJP-voorstel zijn geslaagd.\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
