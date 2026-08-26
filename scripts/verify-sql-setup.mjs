/**
 * Controleert de twee SQL-bestanden die je in de Supabase SQL Editor plakt:
 *
 *   supabase/setup-alles.sql        alle migraties in één bestand
 *   supabase/opnieuw-beginnen.sql   alles leegmaken en twee accounts klaarzetten
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
  instance_id uuid,
  id uuid primary key default gen_random_uuid(),
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  identity_data jsonb not null,
  provider text not null,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
);

create or replace function auth.uid() returns uuid
language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

const BEHEERDER = "contact@skoolworkshop.nl";
const KLANT = "planning@skoolworkshop.nl";

async function main() {
  const db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);

  const q = async (sql) => (await db.query(sql)).rows;

  // 1. Volledige installatie
  await db.exec(await readFile("supabase/setup-alles.sql", "utf8"));
  console.log("  ok   setup-alles.sql");

  // 2. Oude rommel neerzetten, zodat we zien dat het opruimen echt werkt
  await db.exec(`insert into auth.users (email) values ('oude-klant@voorbeeld.nl');`);
  await db.exec(`
    insert into public.organizations (name, slug, kind, status)
    values ('Oude School', 'oude-school', 'school', 'active');
  `);

  // 3. Opnieuw beginnen
  await db.exec(await readFile("supabase/opnieuw-beginnen.sql", "utf8"));
  console.log("  ok   opnieuw-beginnen.sql");

  // 4. Twee keer draaien mag niets stukmaken
  await db.exec(await readFile("supabase/opnieuw-beginnen.sql", "utf8"));
  console.log("  ok   opnieuw-beginnen.sql is herhaalbaar");

  // 5. Uitkomst controleren
  const accounts = (await q(`select email from auth.users order by email`)).map((r) => r.email);

  const beheerder = (
    await q(`
      select is_admin, is_super_admin, phone,
        (select count(*) from public.organization_members m where m.user_id = p.id)::int as leden
      from public.profiles p where lower(email) = '${BEHEERDER}'
    `)
  )[0];

  const klant = (
    await q(`
      select is_admin, phone,
        (select count(*) from public.organization_members m
          where m.user_id = p.id and m.status = 'active')::int as leden
      from public.profiles p where lower(email) = '${KLANT}'
    `)
  )[0];

  const balance = (
    await q(`
      select b.available_points, b.pending_points, b.lifetime_earned_points
      from public.loyalty_balances b
      join public.organizations o on o.id = b.organization_id
      where o.slug = 'de-goudse-waarden'
    `)
  )[0];

  const periode = (
    await q(`
      select
        count(*) filter (where b.booked_at < a.enrolled_at)::int as voor_deelname,
        count(*) filter (where b.booked_at >= a.enrolled_at)::int as na_deelname
      from public.bookings b
      join public.loyalty_accounts a on a.organization_id = b.organization_id
    `)
  )[0];

  const counts = (
    await q(`
      select
        (select count(*) from public.organizations)::int as organisaties,
        (select count(*) from public.bookings)::int as boekingen,
        (select count(*) from public.bookings where status = 'confirmed')::int as bevestigd,
        (select count(*) from public.invoices)::int as facturen,
        (select count(*) from public.messages)::int as berichten,
        (select count(*) from public.workshop_results)::int as resultaten,
        (select count(*) from auth.identities)::int as identiteiten
    `)
  )[0];

  console.log(`\n  accounts      ${accounts.join(", ")}`);
  console.log(
    `  beheerder     is_admin=${beheerder.is_admin} is_super_admin=${beheerder.is_super_admin}, lid van ${beheerder.leden} organisaties`
  );
  console.log(`  klant         is_admin=${klant.is_admin}, lid van ${klant.leden} organisatie`);
  console.log(
    `  saldo         ${balance.available_points} beschikbaar, ${balance.pending_points} in behandeling, ${balance.lifetime_earned_points} totaal`
  );
  console.log(
    `  testdata      ${counts.organisaties} organisaties, ${counts.boekingen} boekingen (${counts.bevestigd} bevestigd), ${counts.facturen} facturen, ${counts.berichten} berichten, ${counts.resultaten} resultatensets`
  );
  console.log(
    `  startmoment   ${periode.voor_deelname} boeking van vóór de deelname, ${periode.na_deelname} van erna`
  );

  const ok =
    accounts.length === 2 &&
    accounts.includes(BEHEERDER) &&
    accounts.includes(KLANT) &&
    counts.identiteiten === 2 &&
    beheerder.is_admin === true &&
    beheerder.is_super_admin === true &&
    beheerder.phone !== null &&
    // De beheerder werkt via /admin en hoort bij geen enkele organisatie.
    beheerder.leden === 0 &&
    klant.is_admin === false &&
    klant.phone !== null &&
    klant.leden === 1 &&
    counts.organisaties === 3 &&
    balance.available_points === 350 &&
    balance.pending_points === 300 &&
    balance.lifetime_earned_points === 1200 &&
    counts.boekingen === 10 &&
    counts.bevestigd === 4 &&
    // De demonstratie van de belangrijkste regel: één boeking van vóór de
    // deelname en één van erna.
    periode.voor_deelname === 1 &&
    periode.na_deelname === 9 &&
    counts.facturen === 5 &&
    counts.berichten === 6 &&
    counts.resultaten === 2;

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
