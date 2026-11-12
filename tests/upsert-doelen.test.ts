import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Elke upsert in de code moet een doel hebben dat de database ook herkent.
 *
 * WAAROM DEZE TEST ER IS
 *
 *   Een upsert zegt: "bestaat deze combinatie al, werk hem dan bij". De
 *   database zoekt daar een unieke index bij op precies die kolommen. Is die
 *   index gedeeltelijk (met een where) of staat hij op een bewerking zoals
 *   lower(email), dan vindt PostgreSQL hem niet en weigert hij de hele
 *   opdracht: "no unique or exclusion constraint matching the ON CONFLICT
 *   specification".
 *
 *   Dat is twee keer misgegaan zonder dat iemand het zag. Punten toekennen liep
 *   vast op een gedeeltelijke index, en contactpersonen vastleggen op een index
 *   met lower(email). In beide gevallen werd het resultaat niet bekeken, dus er
 *   gebeurde simpelweg niets.
 *
 *   Deze test leest alle upserts uit de broncode en controleert elk doel tegen
 *   de echte indexen. Komt er een upsert bij die niet kan werken, dan faalt hij
 *   hier in plaats van stilletjes in productie.
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

interface Upsert {
  bestand: string;
  regel: number;
  tabel: string;
  kolommen: string[];
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

/** Zoekt bij elke onConflict de tabel uit de dichtstbijzijnde .from() erboven. */
async function alleUpserts(): Promise<Upsert[]> {
  const upserts: Upsert[] = [];
  for (const bestand of await bronbestanden(path.join(process.cwd(), "src"))) {
    const tekst = await readFile(bestand, "utf8");
    for (const treffer of tekst.matchAll(/onConflict:\s*"([^"]+)"/g)) {
      const voor = tekst.slice(0, treffer.index);
      const tabellen = [...voor.matchAll(/\.from\("([a-z_]+)"\)/g)];
      const tabel = tabellen.at(-1)?.[1];
      expect(tabel, `geen tabel gevonden bij upsert in ${bestand}`).toBeTruthy();
      upserts.push({
        bestand: path.relative(process.cwd(), bestand),
        regel: voor.split("\n").length,
        tabel: tabel!,
        kolommen: treffer[1].split(",").map((kolom) => kolom.trim()),
      });
    }
  }
  return upserts;
}

let db: PGlite;
let upserts: Upsert[];

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);
  const map = path.join(process.cwd(), "supabase", "migrations");
  for (const bestand of (await readdir(map)).filter((naam) => naam.endsWith(".sql")).sort()) {
    await db.exec(await readFile(path.join(map, bestand), "utf8"));
  }
  upserts = await alleUpserts();
}, 120_000);

describe("upserts en hun unieke index", () => {
  it("vindt de upserts in de broncode", () => {
    expect(upserts.length).toBeGreaterThan(10);
  });

  it("heeft voor elke upsert een volledige unieke index op precies die kolommen", async () => {
    const fouten: string[] = [];

    for (const upsert of upserts) {
      // Alleen indexen die een upsert kan gebruiken: uniek, niet gedeeltelijk
      // en op gewone kolommen (indkey bevat geen 0, dus geen bewerkingen).
      const { rows } = await db.query<{ kolommen: string[] }>(
        `select array_agg(a.attname::text order by k.positie) as kolommen
           from pg_index i
           join pg_class t on t.oid = i.indrelid
           join pg_namespace n on n.oid = t.relnamespace
           cross join lateral unnest(i.indkey::int[]) with ordinality as k(attnum, positie)
           join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
          where n.nspname = 'public'
            and t.relname = $1
            and i.indisunique
            and i.indpred is null
            and i.indexprs is null
          group by i.indexrelid`,
        [upsert.tabel],
      );

      const gezocht = [...upsert.kolommen].sort().join(",");
      const past = rows.some((rij) => [...rij.kolommen].sort().join(",") === gezocht);
      if (!past) {
        fouten.push(`${upsert.bestand}:${upsert.regel} upsert op ${upsert.tabel}(${upsert.kolommen.join(", ")})`);
      }
    }

    expect(fouten, `Deze upserts kan de database niet uitvoeren:\n${fouten.join("\n")}`).toEqual([]);
  });

  it("gebruikt geen upsert meer voor contactpersonen, want die index staat op lower(email)", () => {
    expect(upserts.filter((upsert) => upsert.tabel === "organization_contacts")).toEqual([]);
  });
});

describe("een contactpersoon vastleggen in twee stappen", () => {
  it("laat de Moneybird-koppeling staan als een contactpersoon opnieuw wordt bevestigd", async () => {
    const { wijzigingen } = await import("@/lib/organizations/contacten");
    const velden = wijzigingen({
      organizationId: "00000000-0000-0000-0000-000000000001",
      email: "Anna@School.test",
      fullName: "Anna de Vries",
    });
    expect(velden).toMatchObject({ is_verified: true, full_name: "Anna de Vries" });
    expect(Object.keys(velden)).not.toContain("moneybird_contact_id");
    expect(Object.keys(velden)).not.toContain("user_id");
  });

  it("vindt een bestaand adres ongeacht hoofdletters, zodat er geen tweede regel ontstaat", async () => {
    const organisatie = (
      await db.query<{ id: string }>(
        "insert into public.organizations (name, slug) values ('Locatie Contact', 'locatie-contact') returning id",
      )
    ).rows[0].id;
    await db.query(
      "insert into public.organization_contacts (organization_id, email, moneybird_contact_id) values ($1, 'anna@school.test', 'mb-123')",
      [organisatie],
    );

    // Een tweede regel met dezelfde letters in hoofdletters weigert de database.
    await expect(
      db.query("insert into public.organization_contacts (organization_id, email) values ($1, 'Anna@School.test')", [
        organisatie,
      ]),
    ).rejects.toThrow(/organization_contacts_unique/);

    // Bijwerken in plaats van toevoegen laat de koppeling staan.
    await db.query(
      "update public.organization_contacts set is_verified = true, verified_at = now(), full_name = 'Anna de Vries' where organization_id = $1 and email = 'anna@school.test'",
      [organisatie],
    );
    const regel = (
      await db.query<{ moneybird_contact_id: string; is_verified: boolean }>(
        "select moneybird_contact_id, is_verified from public.organization_contacts where organization_id = $1",
        [organisatie],
      )
    ).rows;
    expect(regel).toEqual([{ moneybird_contact_id: "mb-123", is_verified: true }]);
  });
});
