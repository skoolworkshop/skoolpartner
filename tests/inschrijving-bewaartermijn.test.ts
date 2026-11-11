import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { maakCode } from "@/lib/inschrijving/codes";
import { maakSleutels } from "@/lib/inschrijving/naam";
import {
  BEWAARDAGEN,
  bewaarUitleg,
  bewaartTot,
  dagenTeGaan,
  isVerlopen,
  standaardBewaardatum,
} from "@/lib/inschrijving/bewaartermijn";

/**
 * De bewaartermijn van leerlinggegevens.
 *
 * WAT HIER BEWEZEN MOET WORDEN
 *
 *   1. Elke dag heeft een moment waarop de leerlinggegevens weggaan, ook een
 *      dag waar niemand een datum bij heeft gezet.
 *   2. Een afspraak met een school gaat voor op de standaard.
 *   3. Het opruimen haalt de leerlingen weg en laat het werk van de dag staan.
 *   4. Het raakt nooit een andere dag, en nooit een dag waarvan de termijn nog
 *      loopt.
 *   5. De toegang van de school gaat op hetzelfde moment dicht, want daar
 *      staan de namen achter.
 */

describe("tot wanneer we bewaren", () => {
  it("rekent standaard dertig dagen na de cultuurdag", () => {
    expect(BEWAARDAGEN).toBe(30);
    expect(standaardBewaardatum("2026-11-12")).toBe("2026-12-12");
    expect(bewaartTot({ event_date: "2026-11-12" })).toBe("2026-12-12");
    expect(bewaartTot({ event_date: "2026-11-12", purge_after: null })).toBe("2026-12-12");
  });

  it("rekent over een maandgrens en over een jaargrens heen", () => {
    expect(standaardBewaardatum("2026-12-20")).toBe("2027-01-19");
    expect(standaardBewaardatum("2028-02-10")).toBe("2028-03-11"); // schrikkeljaar
    expect(standaardBewaardatum("2027-02-10")).toBe("2027-03-12");
  });

  it("laat een afspraak met een school voorgaan", () => {
    expect(bewaartTot({ event_date: "2026-11-12", purge_after: "2027-03-01" })).toBe("2027-03-01");
    // Ook een kortere termijn dan de standaard mag.
    expect(bewaartTot({ event_date: "2026-11-12", purge_after: "2026-11-20" })).toBe("2026-11-20");
  });

  it("weet wanneer de termijn voorbij is", () => {
    const dag = { event_date: "2026-11-12" };
    expect(isVerlopen(dag, "2026-12-11")).toBe(false);
    expect(isVerlopen(dag, "2026-12-12")).toBe(false);
    expect(isVerlopen(dag, "2026-12-13")).toBe(true);

    // Met een eigen afspraak schuift dat mee.
    const metAfspraak = { event_date: "2026-11-12", purge_after: "2027-03-01" };
    expect(isVerlopen(metAfspraak, "2026-12-13")).toBe(false);
    expect(isVerlopen(metAfspraak, "2027-03-02")).toBe(true);
  });

  it("telt de dagen die er nog zijn", () => {
    expect(dagenTeGaan({ event_date: "2026-11-12" }, "2026-12-12")).toBe(0);
    expect(dagenTeGaan({ event_date: "2026-11-12" }, "2026-12-10")).toBe(2);
    expect(dagenTeGaan({ event_date: "2026-11-12" }, "2026-12-20")).toBe(-8);
  });

  it("legt in gewone taal uit wat er gaat gebeuren", () => {
    expect(bewaarUitleg({ event_date: "2026-11-12" }, "2026-11-20")).toContain("12 december 2026");
    expect(bewaarUitleg({ event_date: "2026-11-12" }, "2026-12-12")).toContain("vannacht");
    expect(bewaarUitleg({ event_date: "2026-11-12" }, "2026-12-11")).toContain("morgen");
    expect(bewaarUitleg({ event_date: "2026-11-12" }, "2026-12-20")).toContain("hadden");
  });
});

// =============================================================================
// Het opruimen zelf, met de echte database
// =============================================================================

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
const dagen: Record<string, string> = {};

async function rijen<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function een<T>(sql: string, params: unknown[] = []): Promise<T> {
  const lijst = await rijen<T>(sql, params);
  expect(lijst.length).toBeGreaterThan(0);
  return lijst[0];
}

/** Een complete dag klaarzetten, met leerlingen, keuzes en een toegangslink. */
async function maakDag(opties: {
  naam: string;
  datum: string;
  bewaarTot?: string | null;
  leerlingen: number;
}): Promise<string> {
  const org = await een<{ id: string }>(
    "insert into public.organizations (name, slug) values ($1, $2) returning id",
    [`School ${opties.naam}`, `school-${opties.naam.toLowerCase().replace(/\s/g, "-")}`],
  );

  const dag = await een<{ id: string }>(
    `insert into public.enrollment_events
       (organization_id, name, event_date, status, slug, purge_after, shared_code, shared_code_active)
     values ($1, $2, $3, 'gesloten', $4, $5, $6, true) returning id`,
    [org.id, opties.naam, opties.datum, `slug-${opties.naam.toLowerCase().replace(/\s/g, "-")}`,
     opties.bewaarTot ?? null, maakCode(8)],
  );

  const klas = await een<{ id: string }>(
    "insert into public.enrollment_groups (event_id, name, position) values ($1, '1A', 1) returning id",
    [dag.id],
  );
  const ronde = await een<{ id: string }>(
    `insert into public.enrollment_rounds (event_id, position, label, starts_at, ends_at)
     values ($1, 1, 'Workshopronde 1', '09:15', '10:15') returning id`,
    [dag.id],
  );
  const workshop = await een<{ id: string }>(
    "insert into public.enrollment_workshops (event_id, name, position) values ($1, 'Workshop Hiphop', 1) returning id",
    [dag.id],
  );
  const sessie = await een<{ id: string }>(
    `insert into public.enrollment_sessions (event_id, workshop_id, round_id, capacity, position)
     values ($1, $2, $3, 100, 1) returning id`,
    [dag.id, workshop.id, ronde.id],
  );

  for (let i = 0; i < opties.leerlingen; i += 1) {
    const naam = `${opties.naam} Leerling ${i + 1}`;
    const sleutels = maakSleutels(naam);
    const deelnemer = await een<{ id: string }>(
      `insert into public.enrollment_participants
         (event_id, group_id, display_name, search_key, flat_key, email, claim_token, access_code)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [dag.id, klas.id, naam, sleutels.sleutel, sleutels.platteSleutel,
       `leerling${i}@voorbeeld.test`, maakCode(24), maakCode(8)],
    );
    // De dag is al geweest en dus gesloten; dan loopt indelen via 'automatisch'.
    await db.query("select public.enrollment_choose($1::uuid, $2::uuid, 'automatisch')", [deelnemer.id, sessie.id]);
    await db.query(
      `insert into public.enrollment_verifications (participant_id, code_hash, sent_to, expires_at)
       values ($1, 'hash', $2, now() + interval '10 minutes')`,
      [deelnemer.id, `leerling${i}@voorbeeld.test`],
    );
  }

  await db.query(
    `insert into public.enrollment_access (event_id, label, token_hash, code_hash, expires_at)
     values ($1, 'Contactpersoon', $2, $3, now() + interval '90 days')`,
    [dag.id, `token-${opties.naam}`, `code-${opties.naam}`],
  );
  await db.query("select public.enrollment_poging($1::uuid, 'gedeeld:test', 10, 600)", [dag.id]);

  return dag.id;
}

/** Het opruimen van één dag, precies zoals ruimInschrijvingenOp het doet. */
async function ruimOp(dagId: string): Promise<void> {
  const deelnemers = await rijen<{ id: string }>(
    "select id from public.enrollment_participants where event_id = $1",
    [dagId],
  );
  const ids = deelnemers.map((r) => r.id);

  if (ids.length > 0) {
    await db.query("delete from public.enrollment_choices where participant_id = any($1::uuid[])", [ids]);
    await db.query("delete from public.enrollment_participants where id = any($1::uuid[])", [ids]);
  }
  await db.query(
    "update public.enrollment_access set revoked_at = now() where event_id = $1 and revoked_at is null",
    [dagId],
  );
  await db.query("update public.enrollment_events set shared_code_active = false where id = $1", [dagId]);
  await db.query("delete from public.enrollment_attempts where event_id = $1", [dagId]);
}

async function tel(dagId: string) {
  const deelnemers = await rijen<{ id: string }>(
    "select id from public.enrollment_participants where event_id = $1",
    [dagId],
  );
  const ids = deelnemers.map((r) => r.id);
  const keuzes = ids.length
    ? (await een<{ n: number }>(
        "select count(*)::int as n from public.enrollment_choices where participant_id = any($1::uuid[])",
        [ids],
      )).n
    : 0;

  return {
    leerlingen: deelnemers.length,
    keuzes,
    klassen: (await een<{ n: number }>("select count(*)::int as n from public.enrollment_groups where event_id = $1", [dagId])).n,
    rondes: (await een<{ n: number }>("select count(*)::int as n from public.enrollment_rounds where event_id = $1", [dagId])).n,
    workshops: (await een<{ n: number }>("select count(*)::int as n from public.enrollment_workshops where event_id = $1", [dagId])).n,
    uitvoeringen: (await een<{ n: number }>("select count(*)::int as n from public.enrollment_sessions where event_id = $1", [dagId])).n,
    verificaties: (await een<{ n: number }>(
      `select count(*)::int as n from public.enrollment_verifications v
         join public.enrollment_participants p on p.id = v.participant_id where p.event_id = $1`,
      [dagId],
    )).n,
    openToegang: (await een<{ n: number }>(
      "select count(*)::int as n from public.enrollment_access where event_id = $1 and revoked_at is null",
      [dagId],
    )).n,
    pogingen: (await een<{ n: number }>("select count(*)::int as n from public.enrollment_attempts where event_id = $1", [dagId])).n,
    codeActief: (await een<{ a: boolean }>("select shared_code_active as a from public.enrollment_events where id = $1", [dagId])).a,
  };
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);

  const map = path.join(process.cwd(), "supabase", "migrations");
  for (const bestand of (await readdir(map)).filter((n) => n.endsWith(".sql")).sort()) {
    await db.exec(await readFile(path.join(map, bestand), "utf8"));
  }

  // Een dag van lang geleden, een dag van vorige maand met een afspraak, en
  // een dag die net geweest is.
  dagen.oud = await maakDag({ naam: "Oude Dag", datum: "2026-01-15", leerlingen: 12 });
  dagen.afspraak = await maakDag({
    naam: "Dag Met Afspraak",
    datum: "2026-01-15",
    bewaarTot: "2027-06-30",
    leerlingen: 8,
  });
  dagen.recent = await maakDag({ naam: "Recente Dag", datum: "2026-11-12", leerlingen: 10 });
}, 60_000);

describe("welke dagen aan de beurt zijn", () => {
  it("kiest alleen de dagen waarvan de termijn echt voorbij is", async () => {
    const lijst = await rijen<{ id: string; name: string; event_date: string; purge_after: string | null }>(
      "select id, name, event_date, purge_after from public.enrollment_events order by name",
    );
    const vandaag = "2026-11-10";
    const aanDeBeurt = lijst.filter((dag) => isVerlopen(dag, vandaag)).map((dag) => dag.name);

    expect(aanDeBeurt).toEqual(["Oude Dag"]);
  });

  it("laat een dag met een langere afspraak met rust", async () => {
    const dag = await een<{ event_date: string; purge_after: string | null }>(
      "select event_date, purge_after from public.enrollment_events where name = 'Dag Met Afspraak'",
    );
    expect(isVerlopen(dag, "2026-11-10")).toBe(false);
    expect(isVerlopen(dag, "2027-07-01")).toBe(true);
  });
});

describe("het opruimen zelf", () => {
  it("haalt de leerlingen weg en laat het werk van de dag staan", async () => {
    const voor = await tel(dagen.oud);
    expect(voor.leerlingen).toBe(12);
    expect(voor.keuzes).toBe(12);
    expect(voor.verificaties).toBe(12);

    await ruimOp(dagen.oud);

    const na = await tel(dagen.oud);
    expect(na.leerlingen).toBe(0);
    expect(na.keuzes).toBe(0);
    // Verificatiecodes verdwijnen vanzelf met de leerling.
    expect(na.verificaties).toBe(0);
    // Het rooster en de workshops blijven: dat is ons eigen werk.
    expect(na.klassen).toBe(voor.klassen);
    expect(na.rondes).toBe(voor.rondes);
    expect(na.workshops).toBe(voor.workshops);
    expect(na.uitvoeringen).toBe(voor.uitvoeringen);
  });

  it("sluit de toegang van de school en zet de toegangscode uit", async () => {
    const na = await tel(dagen.oud);
    expect(na.openToegang).toBe(0);
    expect(na.codeActief).toBe(false);
    expect(na.pogingen).toBe(0);
  });

  it("laat de dag zelf staan, met naam, datum en school", async () => {
    const dag = await een<{ name: string; event_date: string; organization_id: string }>(
      "select name, to_char(event_date, 'YYYY-MM-DD') as event_date, organization_id from public.enrollment_events where id = $1",
      [dagen.oud],
    );
    expect(dag.name).toBe("Oude Dag");
    expect(dag.event_date).toBe("2026-01-15");
    expect(dag.organization_id).not.toBeNull();
  });

  it("raakt geen enkele andere dag aan", async () => {
    const afspraak = await tel(dagen.afspraak);
    expect(afspraak.leerlingen).toBe(8);
    expect(afspraak.keuzes).toBe(8);
    expect(afspraak.openToegang).toBe(1);
    expect(afspraak.codeActief).toBe(true);

    const recent = await tel(dagen.recent);
    expect(recent.leerlingen).toBe(10);
    expect(recent.keuzes).toBe(10);
    expect(recent.openToegang).toBe(1);
    expect(recent.codeActief).toBe(true);
  });

  it("kan twee keer achter elkaar zonder dat er iets misgaat", async () => {
    await ruimOp(dagen.oud);
    const na = await tel(dagen.oud);
    expect(na.leerlingen).toBe(0);
    expect(na.klassen).toBeGreaterThan(0);
  });

  it("laat de bezettingsweergave gewoon werken na het opruimen", async () => {
    const bezet = await rijen<{ bezet: number }>(
      "select bezet from public.enrollment_session_occupancy where event_id = $1",
      [dagen.oud],
    );
    expect(bezet.length).toBeGreaterThan(0);
    expect(bezet.every((rij) => rij.bezet === 0)).toBe(true);
  });
});
