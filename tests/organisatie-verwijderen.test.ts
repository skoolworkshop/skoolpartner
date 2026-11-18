import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Een organisatie definitief verwijderen mag niet halverwege vastlopen.
 *
 * WAAROM DEZE TEST ER IS
 *
 *   Bij de acceptatietest op de live omgeving liep het verwijderen van een
 *   testlocatie met een cultuurdag vast: "violates foreign key constraint
 *   enrollment_events_organization_id_fkey". De punten, boekingen en
 *   contactpersonen waren toen al weg, de organisatie en de dag niet. Een
 *   inschrijfdag houdt zijn organisatie bewust vast (on delete restrict), en
 *   de verwijderfunctie wist dat niet.
 *
 *   Deze test zoekt in de echte migraties elke tabel die een organisatie zo
 *   vasthoudt, en eist dat de verwijderfunctie die tabel zelf leegmaakt
 *   voordat hij de organisatie verwijdert.
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
`;

let db: PGlite;
let bron: string;

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);
  const map = path.join(process.cwd(), "supabase", "migrations");
  for (const bestand of (await readdir(map)).filter((naam) => naam.endsWith(".sql")).sort()) {
    await db.exec(await readFile(path.join(map, bestand), "utf8"));
  }
  bron = await readFile(path.join(process.cwd(), "src", "lib", "admin", "delete.ts"), "utf8");
}, 120_000);

describe("organisatie definitief verwijderen", () => {
  it("maakt elke tabel leeg die een organisatie vasthoudt, vóór de organisatie zelf", async () => {
    const { rows } = await db.query<{ tabel: string }>(`
      select conrelid::regclass::text as tabel
        from pg_constraint
       where contype = 'f'
         and confrelid = 'public.organizations'::regclass
         and confdeltype in ('r', 'a')
    `);
    const vasthouders = rows.map((rij) => rij.tabel.replace(/^public\./, ""));
    expect(vasthouders).toContain("enrollment_events");

    const organisatieWeg = bron.indexOf('.from("organizations").delete()');
    expect(organisatieWeg).toBeGreaterThan(0);

    for (const tabel of vasthouders) {
      const plek = bron.search(new RegExp(`\\.from\\("${tabel}"\\)\\s*\\.delete\\(\\)`));
      expect(plek, `${tabel} wordt niet leeggemaakt`).toBeGreaterThan(0);
      expect(plek, `${tabel} wordt pas na de organisatie leeggemaakt`).toBeLessThan(organisatieWeg);
    }
  });

  it("neemt met een inschrijfdag ook de leerlingen en keuzes mee", async () => {
    const { rows } = await db.query<{ tabel: string; regel: string }>(`
      select conrelid::regclass::text as tabel, confdeltype as regel
        from pg_constraint
       where contype = 'f'
         and confrelid = 'public.enrollment_events'::regclass
    `);
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.filter((rij) => rij.regel !== "c")).toEqual([]);
  });
});
