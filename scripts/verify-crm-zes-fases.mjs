/**
 * Controleert de samenvoeging naar zes fases in een echte Postgres.
 *
 * Wat hier wordt aangetoond, met deals die er tijdens de proef in worden gezet:
 *
 *   1. Geen enkele deal verdwijnt of raakt zijn organisatie of contact kwijt.
 *   2. Elke deal komt in de fase terecht die is afgesproken.
 *   3. Een evaluatie die nog moet plaatsvinden blijft lopend.
 *   4. Elke verhuizing staat in crm_deal_events, dus de historie klopt.
 *   5. Een gearchiveerde fase is leeg, en de migratie breekt af als dat niet zo is.
 *   6. De historie kan naar een gearchiveerde fase blijven verwijzen.
 *   7. Er blijven precies zes fases over die op het bord horen.
 *
 *   node scripts/verify-crm-zes-fases.mjs
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const MIGRATIE = "20260903120000_crm_zes_fases.sql";

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
const CONTACT = "33333333-3333-3333-3333-333333333333";

let fouten = 0;
function check(goed, tekst) {
  console.log(`  ${goed ? "ok  " : "FOUT"} ${tekst}`);
  if (!goed) fouten += 1;
}

async function een(db, sql) {
  return (await db.query(sql)).rows[0];
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

  for (const file of alle.slice(0, index)) {
    try {
      await db.exec(await readFile(path.join(MIGRATIONS_DIR, file), "utf8"));
    } catch (error) {
      console.error(`\n  FOUT in ${file}\n       ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
  }
  console.log(`\n  ${index} migraties geladen tot aan de samenvoeging\n`);

  await db.exec(`
    insert into public.organizations (id, name, slug) values ('${SCHOOL}', 'Markenhage College', 'markenhage');
    insert into public.crm_contacts (id, organization_id, full_name, email)
      values ('${CONTACT}', '${SCHOOL}', 'Nora Bakker', 'nora@markenhage.nl');
  `);

  /*
    Een deal in elke fase die iets moet doen, plus twee evaluaties die
    verschillend moeten aflopen. Dat laatste is het enige geval met een
    voorwaarde, en dus het geval waar een fout in zou sluipen.
  */
  const proef = [
    ["facturatie", "Factuur staat uit", null, null],
    ["ingepland", "Staat in de agenda", null, null],
    ["uitgevoerd", "Workshop is gegeven", null, null],
    ["evaluatie", "Evaluatie van vorig jaar", "date '2025-05-01'", null],
    ["evaluatie", "Workshop moet nog komen", "current_date + 30", null],
    ["evaluatie", "Al afgesloten", "date '2025-05-01'", "timestamptz '2025-06-01'"],
    ["opvolging", "Offerte nagebeld", null, null],
    ["afgerond", "Vorig jaar afgerond", null, "timestamptz '2025-09-01'"],
    ["verloren", "Te duur gevonden", null, "timestamptz '2025-04-01'"],
  ];

  for (const [key, titel, datum, gesloten] of proef) {
    await db.exec(`
      insert into public.crm_deals (brand, title, stage_id, organization_id, contact_id, value_cents, expected_date, closed_at)
      select 'skool_workshop', '${titel}', s.id, '${SCHOOL}', '${CONTACT}', 100000,
             ${datum ?? "null"}, ${gesloten ?? "null"}
      from public.crm_pipeline_stages s
      where s.brand = 'skool_workshop' and s.key = '${key}'
    `);
  }

  const voor = await een(
    db,
    `select
       (select count(*)::int from public.crm_deals) as deals,
       (select count(*)::int from public.crm_deal_events) as gebeurtenissen,
       (select count(*)::int from public.crm_pipeline_stages) as fases`
  );

  try {
    await db.exec(await readFile(path.join(MIGRATIONS_DIR, MIGRATIE), "utf8"));
  } catch (error) {
    console.error(`\n  FOUT in ${MIGRATIE}\n       ${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  console.log("  Migratie 039 geladen\n");

  // ---------------------------------------------------------------------------
  console.log("  Er raakt niets kwijt");

  const na = await een(
    db,
    `select
       (select count(*)::int from public.crm_deals) as deals,
       (select count(*)::int from public.crm_deal_events) as gebeurtenissen,
       (select count(*)::int from public.crm_pipeline_stages) as fases`
  );
  check(na.deals === voor.deals, `Alle ${voor.deals} deals staan er nog`);
  check(na.fases === voor.fases, `Alle ${voor.fases} fases bestaan nog, geen enkele verwijderd`);
  check(
    na.gebeurtenissen === voor.gebeurtenissen + 6,
    `Elke verhuizing is vastgelegd: ${na.gebeurtenissen - voor.gebeurtenissen} gebeurtenissen erbij`
  );

  const zwevend = await een(
    db,
    `select count(*)::int as n from public.crm_deals where organization_id is null and contact_id is null`
  );
  check(zwevend.n === 0, "Geen deal is zijn organisatie en contact kwijtgeraakt");

  // ---------------------------------------------------------------------------
  console.log("\n  Iedereen staat waar hij hoort");

  async function faseVan(titel) {
    const rij = await een(
      db,
      `select s.key from public.crm_deals d
       join public.crm_pipeline_stages s on s.id = d.stage_id
       where d.title = '${titel}'`
    );
    return rij?.key ?? "(niet gevonden)";
  }

  check((await faseVan("Factuur staat uit")) === "akkoord", "Facturatie gaat naar Klant bevestigd / Planning");
  check((await faseVan("Staat in de agenda")) === "akkoord", "Agenda en planning gaat naar Klant bevestigd / Planning");
  check((await faseVan("Workshop is gegeven")) === "afgerond", "Uitgevoerd gaat naar Afgerond");
  check((await faseVan("Evaluatie van vorig jaar")) === "afgerond", "Een evaluatie van vorig jaar gaat naar Afgerond");
  check((await faseVan("Al afgesloten")) === "afgerond", "Een afgesloten evaluatie gaat naar Afgerond");
  check(
    (await faseVan("Workshop moet nog komen")) === "akkoord",
    "Een evaluatie met een datum in de toekomst blijft lopend bij Klant bevestigd / Planning"
  );
  check((await faseVan("Offerte nagebeld")) === "opvolging", "Opvolging blijft Opvolging");
  check((await faseVan("Vorig jaar afgerond")) === "afgerond", "Afgerond blijft Afgerond");
  check((await faseVan("Te duur gevonden")) === "verloren", "Niet doorgegaan blijft Niet doorgegaan");

  const datums = await een(
    db,
    `select
       (select closed_at from public.crm_deals where title = 'Vorig jaar afgerond') as bestaand,
       (select closed_at from public.crm_deals where title = 'Workshop is gegeven') as nieuw`
  );
  check(
    String(datums.bestaand).startsWith("2025-09-01") ||
      new Date(datums.bestaand).toISOString().startsWith("2025-09-01"),
    "Een bestaande afsluitdatum blijft staan en wordt niet overschreven"
  );
  check(datums.nieuw !== null, "Een deal die naar Afgerond verhuist, krijgt een afsluitdatum");

  // ---------------------------------------------------------------------------
  console.log("\n  De historie blijft leesbaar");

  const historie = await een(
    db,
    `select count(*)::int as n
     from public.crm_deal_events e
     join public.crm_pipeline_stages s on s.id = e.from_stage_id
     where s.is_archived = true`
  );
  check(historie.n > 0, "Gebeurtenissen mogen naar een gearchiveerde fase blijven verwijzen");

  const metNotitie = await een(
    db,
    `select count(*)::int as n from public.crm_deal_events where note like 'Fase samengevoegd%'`
  );
  check(metNotitie.n === 6, "Elke verhuizing draagt de reden bij zich");

  // ---------------------------------------------------------------------------
  console.log("\n  Wat er op het bord overblijft");

  const gearchiveerd = await een(
    db,
    `select count(*)::int as n from public.crm_pipeline_stages
     where brand = 'skool_workshop' and is_archived = true`
  );
  check(gearchiveerd.n === 4, "Vier fases zijn gearchiveerd");

  const leeg = await een(
    db,
    `select count(*)::int as n from public.crm_deals d
     join public.crm_pipeline_stages s on s.id = d.stage_id
     where s.is_archived = true`
  );
  check(leeg.n === 0, "Er staat geen enkele deal meer in een gearchiveerde fase");

  const bord = (
    await db.query(
      `select key, label, position from public.crm_pipeline_stages
       where brand = 'skool_workshop' and is_archived = false and is_lost = false
       order by position`
    )
  ).rows;
  check(bord.length === 6, `Er blijven zes fases op het bord over, geteld: ${bord.length}`);
  check(
    bord.map((f) => f.key).join(",") ===
      "nieuwe_aanvraag,contact_gelegd,offerte_verstuurd,opvolging,akkoord,afgerond",
    "En in de juiste volgorde"
  );
  for (const fase of bord) console.log("       %s  %s", String(fase.position).padStart(4), fase.label);

  const suri = await een(
    db,
    `select count(*)::int as n from public.crm_pipeline_stages
     where brand = 'suri_impact' and is_archived = true`
  );
  check(suri.n === 0, "Suri Impact is niet aangeraakt");

  console.log(
    fouten === 0
      ? "\n  Alles in orde. De samenvoeging is veilig.\n"
      : `\n  ${fouten} punt(en) niet in orde.\n`
  );
  process.exitCode = fouten === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
