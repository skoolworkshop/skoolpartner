import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Elke ingesloten tabel in een select moet eenduidig te vinden zijn.
 *
 * WAAROM DEZE TEST ER IS
 *
 *   Supabase haalt in één query ook gegevens uit een gekoppelde tabel op,
 *   bijvoorbeeld `profiles(email)` bij een lidmaatschap. Lopen er van de ene
 *   tabel twee of meer verwijzingen naar de andere, dan weet Supabase niet
 *   welke bedoeld is en weigert het de hele query. De code krijgt dan geen
 *   gegevens terug en toont een lege lijst.
 *
 *   Zo stond in het beheer bij elke organisatie "Nog geen gebruikers
 *   gekoppeld", ook als er gebruikers waren, en bleef de lijst "Wachten op
 *   goedkeuring" altijd leeg. organization_members verwijst drie keer naar
 *   profiles: de gebruiker, wie uitnodigde en wie goedkeurde.
 *
 *   Deze test leest alle selects uit de broncode, kijkt in de echte
 *   migraties hoeveel verwijzingen er tussen de twee tabellen lopen, en eist
 *   een expliciete sleutel (`profiles!..._fkey(...)`) zodra het er meer dan
 *   één zijn.
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

interface Insluiting {
  bestand: string;
  regel: number;
  tabel: string;
  doel: string;
  sleutel: string | null;
}

async function bronbestanden(map: string): Promise<string[]> {
  const gevonden: string[] = [];
  for (const item of await readdir(map, { withFileTypes: true })) {
    const pad = path.join(map, item.name);
    if (item.isDirectory()) gevonden.push(...(await bronbestanden(pad)));
    else if (/\.(ts|tsx)$/.test(item.name)) gevonden.push(pad);
  }
  return gevonden;
}

/** De ingesloten tabellen op het bovenste niveau van een select. */
function bovensteInsluitingen(select: string): { doel: string; sleutel: string | null }[] {
  const uit: { doel: string; sleutel: string | null }[] = [];
  let diepte = 0;
  let stuk = "";
  for (const teken of select) {
    if (teken === "(") {
      if (diepte === 0) {
        const naam = stuk.split(",").pop()!.trim();
        // naam, alias:naam, naam!sleutel, naam!inner, naam!sleutel!inner
        const treffer = naam.match(/^(?:[a-z_]+:)?([a-z_]+)((?:![a-z_]+)*)$/);
        if (treffer) {
          const delen = treffer[2].split("!").filter((deel) => deel && deel !== "inner" && deel !== "left");
          uit.push({ doel: treffer[1], sleutel: delen[0] ?? null });
        }
        stuk = "";
      }
      diepte += 1;
    } else if (teken === ")") {
      diepte -= 1;
    } else if (diepte === 0) {
      stuk += teken;
    }
  }
  return uit;
}

async function alleInsluitingen(): Promise<Insluiting[]> {
  const uit: Insluiting[] = [];
  for (const bestand of await bronbestanden(path.join(process.cwd(), "src"))) {
    const tekst = await readFile(bestand, "utf8");
    for (const treffer of tekst.matchAll(/\.select\(\s*"([^"]*\([^"]*)"/g)) {
      const voor = tekst.slice(0, treffer.index);
      const tabel = [...voor.matchAll(/\.from\("([a-z_]+)"\)/g)].at(-1)?.[1];
      if (!tabel) continue;
      for (const insluiting of bovensteInsluitingen(treffer[1])) {
        uit.push({
          bestand: path.relative(process.cwd(), bestand),
          regel: voor.split("\n").length,
          tabel,
          ...insluiting,
        });
      }
    }
  }
  return uit;
}

let db: PGlite;
let insluitingen: Insluiting[];

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);
  const map = path.join(process.cwd(), "supabase", "migrations");
  for (const bestand of (await readdir(map)).filter((naam) => naam.endsWith(".sql")).sort()) {
    await db.exec(await readFile(path.join(map, bestand), "utf8"));
  }
  insluitingen = await alleInsluitingen();
}, 120_000);

async function verwijzingen(van: string, naar: string): Promise<string[]> {
  const { rows } = await db.query<{ conname: string }>(
    `select conname from pg_constraint
      where contype = 'f'
        and ((conrelid = $1::regclass and confrelid = $2::regclass)
          or (conrelid = $2::regclass and confrelid = $1::regclass))`,
    [`public.${van}`, `public.${naar}`],
  );
  return rows.map((rij) => rij.conname);
}

async function bestaat(tabel: string): Promise<boolean> {
  const { rows } = await db.query("select to_regclass($1) is not null as er", [`public.${tabel}`]);
  return (rows[0] as { er: boolean }).er;
}

describe("ingesloten tabellen in de selects", () => {
  it("vindt de selects met een ingesloten tabel", () => {
    expect(insluitingen.length).toBeGreaterThan(5);
  });

  it("zijn eenduidig: bij meer dan één verwijzing staat de sleutel erbij, en die sleutel bestaat", async () => {
    const fouten: string[] = [];
    for (const insluiting of insluitingen) {
      if (!(await bestaat(insluiting.tabel)) || !(await bestaat(insluiting.doel))) continue;
      const lijst = await verwijzingen(insluiting.tabel, insluiting.doel);
      const plek = `${insluiting.bestand}:${insluiting.regel} ${insluiting.tabel} → ${insluiting.doel}`;

      if (insluiting.sleutel) {
        if (!lijst.includes(insluiting.sleutel)) fouten.push(`${plek}: sleutel ${insluiting.sleutel} bestaat niet`);
      } else if (lijst.length > 1) {
        fouten.push(`${plek}: ${lijst.length} verwijzingen (${lijst.join(", ")}), geef de sleutel op`);
      }
    }
    expect(fouten, fouten.join("\n")).toEqual([]);
  });

  it("haalt bij een lid het profiel van de gebruiker zelf op", () => {
    const leden = insluitingen.filter((i) => i.tabel === "organization_members" && i.doel === "profiles");
    expect(leden.length).toBeGreaterThan(0);
    for (const lid of leden) expect(lid.sleutel).toBe("organization_members_user_id_fkey");
  });
});
