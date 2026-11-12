import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Wie mag welke databasefunctie aanroepen?
 *
 * WAAROM DEZE TEST ER IS
 *
 *   Een functie met verhoogde rechten (security definer) doet zijn werk als
 *   eigenaar van de database, voorbij Row Level Security. Controleert zo'n
 *   functie zelf niet wie er vraagt, dan mag alleen de server hem aanroepen.
 *
 *   Supabase geeft elke nieuwe functie standaard aan iedereen: via "public",
 *   en nog eens apart aan "anon" en "authenticated". Wie maar één van die
 *   routes intrekt, laat de andere open. Dat is een paar keer gebeurd.
 *
 *   Deze test bouwt de database op zoals Supabase dat doet, mét die
 *   standaardrechten, en legt daarna vast welke functies een bezoeker en een
 *   ingelogde klant mogen aanroepen. Komt er een functie bij, dan moet iemand
 *   hier bewust kiezen in welke lijst hij hoort.
 */

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

-- Zo richt Supabase het schema public in: alles wat erbij komt is standaard
-- bruikbaar voor deze drie rollen.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

/**
 * Functies met verhoogde rechten die een ingelogde klant mag aanroepen. Elk
 * daarvan controleert zelf de toegang, of geeft alleen iets terug over de
 * aanroeper zelf.
 */
const VOOR_INGELOGDE_KLANT = [
  // Inwisselen: controleren zelf het lidmaatschap van de locatie.
  "request_redemption(uuid,integer,uuid,text,text)",
  "cancel_redemption(uuid,text)",
  "loyalty_available_points(uuid)",
  // Nodig om Row Level Security te kunnen beoordelen.
  "is_admin(uuid)",
  "is_super_admin(uuid)",
  "has_organization_access(uuid,uuid)",
  "is_organization_beheerder(uuid,uuid)",
  "user_organization_ids(uuid)",
  // Instellingen lezen.
  "get_setting(text)",
  "get_setting_int(text,integer)",
  "get_setting_bool(text,boolean)",
].sort();

/** Functies die uitsluitend de server mag aanroepen. */
const ALLEEN_SERVER = [
  "ensure_loyalty_account(uuid,uuid)",
  "release_points_for_invoice(uuid)",
  "expire_loyalty_points()",
  "loyalty_location_points(uuid)",
  "confirm_cjp_parking(uuid,uuid,text)",
  "spend_cjp_credit(uuid,integer,uuid,text,uuid,text)",
  "enrollment_poging(uuid,text,integer,integer)",
  "enrollment_choose(uuid,uuid,text)",
];

interface Functie {
  naam: string;
  bezoeker: boolean;
  klant: boolean;
  server: boolean;
}

let functies: Functie[];
let db: PGlite;

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);
  const map = path.join(process.cwd(), "supabase", "migrations");
  for (const bestand of (await readdir(map)).filter((naam) => naam.endsWith(".sql")).sort()) {
    await db.exec(await readFile(path.join(map, bestand), "utf8"));
  }

  // Triggerfuncties tellen niet mee: die zijn niet rechtstreeks aan te roepen.
  const { rows } = await db.query<Functie>(`
    select replace(p.oid::regprocedure::text, 'public.', '') as naam,
           has_function_privilege('anon', p.oid, 'execute') as bezoeker,
           has_function_privilege('authenticated', p.oid, 'execute') as klant,
           has_function_privilege('service_role', p.oid, 'execute') as server
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.prosecdef
       and p.prorettype <> 'trigger'::regtype
     order by 1
  `);
  functies = rows;
}, 120_000);

describe("functies met verhoogde rechten", () => {
  it("is geen enkele aan te roepen door een bezoeker zonder account", () => {
    expect(functies.filter((functie) => functie.bezoeker).map((functie) => functie.naam)).toEqual([]);
  });

  it("zijn voor een ingelogde klant precies de bedoelde functies beschikbaar", () => {
    expect(functies.filter((functie) => functie.klant).map((functie) => functie.naam).sort()).toEqual(
      VOOR_INGELOGDE_KLANT,
    );
  });

  it("zijn de serverfuncties dicht voor klanten en open voor de server", () => {
    for (const naam of ALLEEN_SERVER) {
      const functie = functies.find((kandidaat) => kandidaat.naam === naam);
      expect(functie, `functie ${naam} bestaat niet meer`).toBeTruthy();
      expect(functie!.klant, `${naam} is aan te roepen door een klant`).toBe(false);
      expect(functie!.bezoeker, `${naam} is aan te roepen door een bezoeker`).toBe(false);
      expect(functie!.server, `${naam} is niet aan te roepen door de server`).toBe(true);
    }
  });

  it("staat elke functie in een van beide lijsten, zodat een nieuwe niet ongemerkt openstaat", () => {
    const bekend = new Set([...VOOR_INGELOGDE_KLANT, ...ALLEEN_SERVER]);
    expect(functies.map((functie) => functie.naam).filter((naam) => !bekend.has(naam))).toEqual([]);
  });
});

describe("tabellen", () => {
  it("heeft elke tabel Row Level Security aan, ook met de standaardrechten van Supabase", async () => {
    const { rows } = await db.query<{ relname: string }>(`
      select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    `);
    expect(rows.map((rij) => rij.relname)).toEqual([]);
  });

  it("kan een bezoeker zonder account nergens iets lezen", async () => {
    const { rows: tabellen } = await db.query<{ relname: string }>(`
      select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'v')
       order by 1
    `);

    const leesbaar: string[] = [];
    for (const { relname } of tabellen) {
      await db.exec("set role anon");
      try {
        const { rows } = await db.query(`select 1 from public."${relname}" limit 1`);
        if (rows.length > 0) leesbaar.push(relname);
      } catch {
        // Geweigerd is precies goed.
      } finally {
        await db.exec("reset role");
      }
    }
    expect(leesbaar).toEqual([]);
  });
});
