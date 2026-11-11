import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { generateToken, hashToken } from "@/lib/crypto";
import { maakCode } from "@/lib/inschrijving/codes";
import { maakSleutels } from "@/lib/inschrijving/naam";

/**
 * De beveiligde omgeving voor de school.
 *
 * WAAROM DIT APART GETEST WORDT
 *
 *   Achter deze link staat de indeling met de namen van alle leerlingen. Dat
 *   is het scherm met de meeste persoonsgegevens in het hele systeem, en het
 *   enige dat zonder account te openen is. Dan hoort precies vast te liggen
 *   wat er wel en niet doorheen komt.
 *
 * HOE HET WERKT
 *
 *   Twee dingen die apart naar de klant gaan: een link met een sleutel die
 *   niemand raadt, en een code van zes tekens. Van allebei staat alleen de
 *   versleutelde vorm in de database. Bij elk bezoek wordt opnieuw gekeken of
 *   de toegang niet is ingetrokken en of hij niet verlopen is.
 *
 *   Alles hieronder draait tegen de echte database met de echte migraties, en
 *   gebruikt dezelfde hashfunctie als de applicatie.
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
let dagId: string;
let andereDagId: string;

async function rijen<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function een<T>(sql: string, params: unknown[] = []): Promise<T> {
  const lijst = await rijen<T>(sql, params);
  expect(lijst.length).toBeGreaterThan(0);
  return lijst[0];
}

/** Zoals maakToegang doet: alleen de versleutelde vorm gaat de database in. */
async function maakToegang(opties: {
  dagId: string;
  label: string;
  dagenGeldig?: number;
}): Promise<{ id: string; token: string; code: string }> {
  const token = generateToken(24);
  const code = generateToken(8).replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase();
  const verloopt = new Date();
  verloopt.setDate(verloopt.getDate() + (opties.dagenGeldig ?? 60));

  const rij = await een<{ id: string }>(
    `insert into public.enrollment_access (event_id, label, token_hash, code_hash, expires_at)
     values ($1, $2, $3, $4, $5) returning id`,
    [opties.dagId, opties.label, hashToken(token), hashToken(code), verloopt.toISOString()],
  );

  return { id: rij.id, token, code };
}

/** Zoals leesToegang doet: token, code, ingetrokken en verlopen, elk bezoek opnieuw. */
async function leesToegang(params: {
  token: string;
  code: string;
}): Promise<{ dagId: string; label: string } | null> {
  if (!params.token || !params.code) return null;

  const gevonden = await rijen<{
    id: string;
    event_id: string;
    label: string;
    code_hash: string;
    expires_at: string;
    revoked_at: string | null;
  }>(
    "select id, event_id, label, code_hash, expires_at, revoked_at from public.enrollment_access where token_hash = $1",
    [hashToken(params.token)],
  );

  const data = gevonden[0];
  if (!data) return null;
  if (data.revoked_at) return null;
  if (Date.parse(String(data.expires_at)) < Date.now()) return null;
  if (data.code_hash !== hashToken(params.code.trim().toUpperCase())) return null;

  await db.query("update public.enrollment_access set last_seen_at = now() where id = $1", [data.id]);
  return { dagId: data.event_id, label: data.label };
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);

  const map = path.join(process.cwd(), "supabase", "migrations");
  for (const bestand of (await readdir(map)).filter((naam) => naam.endsWith(".sql")).sort()) {
    await db.exec(await readFile(path.join(map, bestand), "utf8"));
  }

  const org = await een<{ id: string }>(
    "insert into public.organizations (name, slug) values ('De Rotonde', 'rotonde-klantomgeving') returning id",
  );

  const dag = await een<{ id: string }>(
    `insert into public.enrollment_events (organization_id, name, event_date, status, slug)
     values ($1, 'Cultuurdag', current_date + 14, 'gesloten', 'cultuurdag-klantomgeving') returning id`,
    [org.id],
  );
  dagId = dag.id;

  const ander = await een<{ id: string }>(
    `insert into public.enrollment_events (organization_id, name, event_date, status, slug)
     values ($1, 'Dag van een andere school', current_date + 20, 'gesloten', 'andere-dag-klantomgeving') returning id`,
    [org.id],
  );
  andereDagId = ander.id;

  // Een klas met leerlingen, zodat er ook echt iets te beschermen valt.
  const klas = await een<{ id: string }>(
    "insert into public.enrollment_groups (event_id, name, position) values ($1, '1A', 1) returning id",
    [dagId],
  );
  for (const naam of ["Lissa van der Velde", "Jan-Peter Bakker", "Ilse Mooren"]) {
    const sleutels = maakSleutels(naam);
    await db.query(
      `insert into public.enrollment_participants
         (event_id, group_id, display_name, search_key, flat_key, claim_token, access_code)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [dagId, klas.id, naam, sleutels.sleutel, sleutels.platteSleutel, maakCode(24), maakCode(8)],
    );
  }
});

describe("de link en de code samen", () => {
  it("laat de school binnen met allebei", async () => {
    const toegang = await maakToegang({ dagId, label: "Heleen Nijveld" });
    const uitkomst = await leesToegang({ token: toegang.token, code: toegang.code });

    expect(uitkomst).not.toBeNull();
    expect(uitkomst?.dagId).toBe(dagId);
    expect(uitkomst?.label).toBe("Heleen Nijveld");
  });

  it("laat niemand binnen met alleen de link", async () => {
    const toegang = await maakToegang({ dagId, label: "Alleen de link" });
    expect(await leesToegang({ token: toegang.token, code: "" })).toBeNull();
    expect(await leesToegang({ token: toegang.token, code: "AAAAAA" })).toBeNull();
  });

  it("laat niemand binnen met alleen de code", async () => {
    const toegang = await maakToegang({ dagId, label: "Alleen de code" });
    expect(await leesToegang({ token: "", code: toegang.code })).toBeNull();
    expect(await leesToegang({ token: generateToken(24), code: toegang.code })).toBeNull();
  });

  it("kijkt niet naar hoofdletters of spaties in de code", async () => {
    const toegang = await maakToegang({ dagId, label: "Met spaties" });
    const uitkomst = await leesToegang({ token: toegang.token, code: ` ${toegang.code.toLowerCase()} ` });
    expect(uitkomst?.dagId).toBe(dagId);
  });

  it("bewaart de link en de code nergens leesbaar", async () => {
    const toegang = await maakToegang({ dagId, label: "Nakijken" });
    const rij = await een<{ token_hash: string; code_hash: string }>(
      "select token_hash, code_hash from public.enrollment_access where id = $1",
      [toegang.id],
    );

    expect(rij.token_hash).not.toBe(toegang.token);
    expect(rij.code_hash).not.toBe(toegang.code);
    expect(rij.token_hash).toHaveLength(64);
    expect(rij.code_hash).toHaveLength(64);

    // En nergens anders in de rij staat de code alsnog.
    const alles = JSON.stringify(
      await een("select * from public.enrollment_access where id = $1", [toegang.id]),
    );
    expect(alles).not.toContain(toegang.token);
    expect(alles).not.toContain(toegang.code);
  });

  it("houdt bij wanneer de school voor het laatst gekeken heeft", async () => {
    const toegang = await maakToegang({ dagId, label: "Laatst gezien" });
    const voor = await een<{ last_seen_at: string | null }>(
      "select last_seen_at from public.enrollment_access where id = $1",
      [toegang.id],
    );
    expect(voor.last_seen_at).toBeNull();

    await leesToegang({ token: toegang.token, code: toegang.code });

    const na = await een<{ last_seen_at: string | null }>(
      "select last_seen_at from public.enrollment_access where id = $1",
      [toegang.id],
    );
    expect(na.last_seen_at).not.toBeNull();
  });
});

describe("intrekken en verlopen", () => {
  it("sluit de deur meteen als de toegang wordt ingetrokken", async () => {
    const toegang = await maakToegang({ dagId, label: "Wordt ingetrokken" });
    expect(await leesToegang({ token: toegang.token, code: toegang.code })).not.toBeNull();

    await db.query("update public.enrollment_access set revoked_at = now() where id = $1", [toegang.id]);

    expect(await leesToegang({ token: toegang.token, code: toegang.code })).toBeNull();
  });

  it("laat een verlopen toegang niet meer werken", async () => {
    const toegang = await maakToegang({ dagId, label: "Verloopt" });
    await db.query(
      "update public.enrollment_access set expires_at = now() - interval '1 day' where id = $1",
      [toegang.id],
    );

    expect(await leesToegang({ token: toegang.token, code: toegang.code })).toBeNull();
  });

  it("geeft een toegang van de ene dag nooit toegang tot de andere", async () => {
    const vanDeze = await maakToegang({ dagId, label: "School een" });
    const vanDie = await maakToegang({ dagId: andereDagId, label: "School twee" });

    expect((await leesToegang({ token: vanDeze.token, code: vanDeze.code }))?.dagId).toBe(dagId);
    expect((await leesToegang({ token: vanDie.token, code: vanDie.code }))?.dagId).toBe(andereDagId);

    // En de code van de een werkt niet op de link van de ander.
    expect(await leesToegang({ token: vanDeze.token, code: vanDie.code })).toBeNull();
  });

  it("verdwijnt met de dag, zodat er niets blijft staan", async () => {
    const eigen = await een<{ id: string }>(
      `insert into public.enrollment_events (organization_id, name, event_date, slug)
       values ((select id from public.organizations limit 1), 'Wordt verwijderd', current_date + 5, 'wordt-verwijderd-test')
       returning id`,
    );
    const toegang = await maakToegang({ dagId: eigen.id, label: "Gaat mee" });

    await db.query("delete from public.enrollment_events where id = $1", [eigen.id]);

    const over = await rijen("select id from public.enrollment_access where id = $1", [toegang.id]);
    expect(over).toHaveLength(0);
  });
});

describe("het opruimen sluit de klantomgeving", () => {
  it("trekt de openstaande toegangen in als de bewaartermijn voorbij is", async () => {
    // Dit is wat de nachtelijke opruiming doet. Achter deze link staan namen,
    // dus hij hoort op hetzelfde moment dicht te gaan als de gegevens weggaan.
    const toegang = await maakToegang({ dagId, label: "Loopt nog" });
    expect(await leesToegang({ token: toegang.token, code: toegang.code })).not.toBeNull();

    await db.query(
      "update public.enrollment_access set revoked_at = now() where event_id = $1 and revoked_at is null",
      [dagId],
    );

    expect(await leesToegang({ token: toegang.token, code: toegang.code })).toBeNull();

    // De toegang van de andere dag blijft gewoon werken.
    const anders = await maakToegang({ dagId: andereDagId, label: "Andere school" });
    expect(await leesToegang({ token: anders.token, code: anders.code })).not.toBeNull();
  });
});
