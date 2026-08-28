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

  await db.close();
  console.log("\n  Alle migraties en databaseregels zijn in orde.\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
