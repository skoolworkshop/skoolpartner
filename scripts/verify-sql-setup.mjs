/**
 * Controleert de twee SQL-bestanden die je in de Supabase SQL Editor plakt:
 *
 *   supabase/setup-alles.sql   alle migraties in één bestand
 *   supabase/demo-data.sql     demodata en jezelf beheerder maken
 *
 * Ze draaien hier tegen een tijdelijke Postgres in het geheugen, inclusief een
 * nagebootst auth-schema, zodat je zeker weet dat ze foutloos draaien voordat
 * je ze op je echte project loslaat.
 *
 *   node scripts/verify-sql-setup.mjs
 */

import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

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
`;

const TEST_EMAIL = "skoolworkshop@gmail.com";

async function main() {
  const db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);

  // 1. Volledige installatie
  await db.exec(await readFile("supabase/setup-alles.sql", "utf8"));
  console.log("  ok   setup-alles.sql");

  // 2. Demodata zonder account moet een duidelijke fout geven
  await db.exec(`insert into auth.users (email) values ('iemand.anders@voorbeeld.nl');`);
  let refused = false;
  try {
    await db.exec(await readFile("supabase/demo-data.sql", "utf8"));
  } catch (error) {
    refused = /Geen account gevonden/.test(error.message);
  }
  console.log(
    refused
      ? "  ok   demo-data.sql weigert netjes zolang het account nog niet bestaat"
      : "  FOUT demo-data.sql had moeten stoppen zonder account"
  );
  if (!refused) {
    process.exitCode = 1;
    return;
  }

  // 3. Account aanmaken en demodata draaien
  await db.exec(`insert into auth.users (email) values ('${TEST_EMAIL}');`);
  await db.exec(await readFile("supabase/demo-data.sql", "utf8"));
  console.log("  ok   demo-data.sql");

  // 4. Twee keer draaien mag niets stukmaken
  await db.exec(await readFile("supabase/demo-data.sql", "utf8"));
  console.log("  ok   demo-data.sql is herhaalbaar");

  // 5. Uitkomst controleren
  const balance = (
    await db.query(`
      select b.available_points, b.pending_points, b.lifetime_earned_points
      from public.loyalty_balances b
      join public.organizations o on o.id = b.organization_id
      where o.slug = 'de-goudse-waarden'
    `)
  ).rows[0];

  const profile = (
    await db.query(
      `select is_admin, is_super_admin from public.profiles where lower(email) = '${TEST_EMAIL}'`
    )
  ).rows[0];

  const counts = (
    await db.query(`
      select
        (select count(*) from public.bookings)::int as boekingen,
        (select count(*) from public.invoices)::int as facturen,
        (select count(*) from public.messages)::int as berichten,
        (select count(*) from public.organization_members where status = 'active')::int as leden,
        (select count(*) from public.workshop_results)::int as resultaten
    `)
  ).rows[0];

  console.log(
    `\n  saldo         ${balance.available_points} beschikbaar, ${balance.pending_points} in behandeling, ${balance.lifetime_earned_points} totaal`
  );
  console.log(
    `  demodata      ${counts.boekingen} boekingen, ${counts.facturen} facturen, ${counts.berichten} berichten, ${counts.leden} actief lid, ${counts.resultaten} resultatensets`
  );
  console.log(`  beheerder     is_admin=${profile.is_admin} is_super_admin=${profile.is_super_admin}`);

  // 6. Tweede account als gewone klant koppelen
  await db.exec(`insert into auth.users (email) values ('skoolworkshop+klant@gmail.com');`);
  await db.exec(await readFile("supabase/tweede-account-als-klant.sql", "utf8"));
  const klant = (
    await db.query(`
      select p.is_admin, m.role, m.status
      from public.profiles p
      join public.organization_members m on m.user_id = p.id
      where lower(p.email) = 'skoolworkshop+klant@gmail.com'
    `)
  ).rows[0];
  const klantOk =
    klant && klant.is_admin === false && klant.role === "lid" && klant.status === "active";
  console.log(
    klantOk
      ? "  ok   tweede-account-als-klant.sql koppelt zonder beheerrechten"
      : "  FOUT tweede-account-als-klant.sql klopt niet"
  );

  // 7. Opruimen moet de demodata weghalen en het account laten staan
  await db.exec(await readFile("supabase/demo-data-verwijderen.sql", "utf8"));
  const na = (
    await db.query(`
      select
        (select count(*) from public.organizations)::int as orgs,
        (select count(*) from public.bookings)::int as boekingen,
        (select count(*) from public.loyalty_transactions)::int as transacties,
        (select count(*) from public.messages)::int as berichten,
        (select count(*) from public.booking_sources)::int as bronnen,
        (select count(*) from public.workshop_results)::int as resultaten,
        (select count(*) from public.profiles)::int as profielen
    `)
  ).rows[0];
  const opgeruimd =
    na.orgs === 0 &&
    na.boekingen === 0 &&
    na.transacties === 0 &&
    na.berichten === 0 &&
    na.bronnen === 0 &&
    na.resultaten === 0 &&
    na.profielen > 0;
  console.log(
    opgeruimd
      ? "  ok   demo-data-verwijderen.sql ruimt alles op en laat je account staan"
      : "  FOUT demo-data-verwijderen.sql heeft niet alles opgeruimd"
  );

  const ok =
    opgeruimd &&
    klantOk &&
    balance.available_points === 350 &&
    balance.pending_points === 300 &&
    balance.lifetime_earned_points === 1200 &&
    counts.boekingen === 8 &&
    counts.facturen === 5 &&
    counts.berichten === 6 &&
    counts.leden === 3 &&
    counts.resultaten === 2 &&
    profile.is_admin === true;

  await db.close();

  if (!ok) {
    console.error("\n  FOUT: de uitkomst klopt niet met wat verwacht werd.\n");
    process.exitCode = 1;
    return;
  }
  console.log("\n  Beide SQL-bestanden draaien foutloos en leveren het juiste resultaat.\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
