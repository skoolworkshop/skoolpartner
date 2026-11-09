import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Eén inschrijfdag leegmaken zonder de rest te raken.
 *
 * WAAROM DIT ER IS
 *
 *   Het script scripts/dag-leegmaken.mjs verwijdert echte gegevens. De twee
 *   dingen die daarbij mis kunnen gaan zijn: de verkeerde dag raken, en
 *   halverwege vastlopen op een verwijzing zodat je een half leeggemaakte dag
 *   overhoudt.
 *
 *   Deze test speelt dezelfde volgorde na op een echte Postgres met de echte
 *   migraties, met twee dagen naast elkaar. De ene wordt leeggemaakt, de
 *   andere moet er precies zo bij staan als ervoor.
 *
 *   Alle namen zijn verzonnen.
 */

const STUBS = `
create role anon; create role authenticated; create role service_role;
create schema if not exists auth; create schema if not exists extensions;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(), email text,
  raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz not null default now());
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
`;

/** Dezelfde volgorde als in het script. */
const ONDERDELEN = [
  "enrollment_choices",
  "enrollment_participants",
  "enrollment_session_groups",
  "enrollment_sessions",
  "enrollment_workshops",
  "enrollment_rounds",
  "enrollment_groups",
];

let db: PGlite;
let dagLeeg: string;
let dagBlijft: string;

async function telAlles(dagId: string): Promise<Record<string, number>> {
  const uit: Record<string, number> = {};
  for (const tabel of ONDERDELEN) {
    if (tabel === "enrollment_choices") {
      const rij = await db.query<{ n: number }>(
        `select count(*)::int as n from public.enrollment_choices c
         join public.enrollment_participants p on p.id = c.participant_id
         where p.event_id = $1`,
        [dagId],
      );
      uit[tabel] = Number(rij.rows[0].n);
      continue;
    }
    const rij = await db.query<{ n: number }>(
      `select count(*)::int as n from public.${tabel} where event_id = $1`,
      [dagId],
    );
    uit[tabel] = Number(rij.rows[0].n);
  }
  return uit;
}

async function maakDag(naam: string, slug: string, organisatie: string): Promise<string> {
  const dag = await db.query<{ id: string }>(
    `insert into public.enrollment_events (organization_id, name, event_date, status, slug)
     values ($1, $2, current_date + 30, 'open', $3) returning id`,
    [organisatie, naam, slug],
  );
  const dagId = dag.rows[0].id;

  for (const [positie, klas] of ["1A", "1B", "2A"].entries()) {
    await db.query("insert into public.enrollment_groups (event_id, name, position) values ($1, $2, $3)", [
      dagId,
      klas,
      positie + 1,
    ]);
  }

  // Twee workshoprondes met een pauze ertussen, zoals de roostergenerator maakt.
  await db.query(
    `insert into public.enrollment_rounds (event_id, position, label, starts_at, ends_at, kind) values
       ($1, 1, 'Workshopronde 1', '09:15', '10:15', 'workshop'),
       ($1, 2, 'Pauze', '10:15', '10:30', 'pauze'),
       ($1, 3, 'Workshopronde 2', '10:30', '11:30', 'workshop')`,
    [dagId],
  );

  for (const [positie, naamWorkshop] of ["Workshop Graffiti", "Workshop Rap"].entries()) {
    await db.query(
      "insert into public.enrollment_workshops (event_id, name, position, default_capacity) values ($1, $2, $3, 25)",
      [dagId, naamWorkshop, positie + 1],
    );
  }

  const rondes = await db.query<{ id: string }>(
    "select id from public.enrollment_rounds where event_id = $1 and kind <> 'pauze' order by position",
    [dagId],
  );
  const workshops = await db.query<{ id: string }>(
    "select id from public.enrollment_workshops where event_id = $1 order by position",
    [dagId],
  );

  for (const ronde of rondes.rows) {
    for (const [positie, workshop] of workshops.rows.entries()) {
      await db.query(
        `insert into public.enrollment_sessions (event_id, workshop_id, round_id, capacity, position)
         values ($1, $2, $3, 25, $4)`,
        [dagId, workshop.id, ronde.id, positie + 1],
      );
    }
  }

  // Eén klasbeperking, zodat ook die tabel gevuld is.
  const eersteSessie = await db.query<{ id: string }>(
    "select id from public.enrollment_sessions where event_id = $1 limit 1",
    [dagId],
  );
  const eersteGroep = await db.query<{ id: string }>(
    "select id from public.enrollment_groups where event_id = $1 limit 1",
    [dagId],
  );
  await db.query(
    "insert into public.enrollment_session_groups (session_id, group_id, event_id) values ($1, $2, $3)",
    [eersteSessie.rows[0].id, eersteGroep.rows[0].id, dagId],
  );

  const groepen = await db.query<{ id: string }>(
    "select id from public.enrollment_groups where event_id = $1 order by position",
    [dagId],
  );

  for (let nummer = 0; nummer < 12; nummer += 1) {
    const groep = groepen.rows[nummer % groepen.rows.length];
    await db.query(
      `insert into public.enrollment_participants
         (event_id, group_id, display_name, search_key, flat_key, claim_token, access_code)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        dagId,
        groep.id,
        `Leerling ${nummer + 1} van ${slug}`,
        `leerling ${nummer} ${slug}`,
        `leerling${nummer}${slug}`,
        `token-${slug}-${nummer}-abcdefghijkl`,
        `${slug.slice(0, 2).toUpperCase()}${String(nummer).padStart(4, "0")}`.slice(0, 8).toUpperCase().replace(/[^0-9A-HJKMNP-TV-Z]/g, "2"),
      ],
    );
  }

  // Iedereen kiest iets in de eerste ronde.
  const deelnemers = await db.query<{ id: string }>(
    "select id from public.enrollment_participants where event_id = $1",
    [dagId],
  );
  // Een uitvoering zonder klasbeperking, anders mag niet iedereen erin.
  const sessie = await db.query<{ id: string }>(
    `select s.id from public.enrollment_sessions s
     join public.enrollment_rounds r on r.id = s.round_id
     where s.event_id = $1 and r.position = 1
       and not exists (select 1 from public.enrollment_session_groups g where g.session_id = s.id)
     limit 1`,
    [dagId],
  );
  for (const deelnemer of deelnemers.rows.slice(0, 8)) {
    await db.query("select public.enrollment_choose($1::uuid, $2::uuid, 'beheer')", [
      deelnemer.id,
      sessie.rows[0].id,
    ]);
  }

  // En er is al een mail verstuurd en een online inzage aangemaakt.
  await db.query(
    `insert into public.enrollment_access (event_id, label, token_hash, code_hash, expires_at)
     values ($1, 'Contactpersoon', $2, $3, now() + interval '30 days')`,
    [dagId, `hash-${slug}-token`, `hash-${slug}-code`],
  );
  await db.query(
    `insert into public.enrollment_deliveries (event_id, to_email, formats)
     values ($1, 'contact@voorbeeld.test', array['klassen-xlsx'])`,
    [dagId],
  );

  return dagId;
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(STUBS);

  const map = path.join(process.cwd(), "supabase", "migrations");
  for (const bestand of (await readdir(map)).filter((naam) => naam.endsWith(".sql")).sort()) {
    await db.exec(await readFile(path.join(map, bestand), "utf8"));
  }

  const organisatie = await db.query<{ id: string }>(
    "insert into public.organizations (name, slug) values ('Testschool', 'testschool-leegmaken') returning id",
  );

  dagLeeg = await maakDag("CKV Dag", "ckv-dag-test", organisatie.rows[0].id);
  dagBlijft = await maakDag("Cultuurdag", "cultuurdag-test", organisatie.rows[0].id);
}, 120_000);

describe("een dag leegmaken", () => {
  it("heeft om te beginnen twee gevulde dagen", async () => {
    const voor = await telAlles(dagLeeg);
    expect(voor.enrollment_participants).toBe(12);
    expect(voor.enrollment_choices).toBe(8);
    expect(voor.enrollment_groups).toBe(3);
    expect(voor.enrollment_rounds).toBe(3);
    expect(voor.enrollment_workshops).toBe(2);
    expect(voor.enrollment_sessions).toBe(4);
    expect(voor.enrollment_session_groups).toBe(1);

    expect(await telAlles(dagBlijft)).toEqual(voor);
  });

  it("verwijdert in de volgorde van het script, zonder vast te lopen", async () => {
    // Precies wat scripts/dag-leegmaken.mjs doet: per onderdeel de rijen van
    // deze dag, en niets anders.
    await db.query(
      `delete from public.enrollment_choices
       where participant_id in (select id from public.enrollment_participants where event_id = $1)`,
      [dagLeeg],
    );
    for (const tabel of ONDERDELEN.slice(1)) {
      await db.query(`delete from public.${tabel} where event_id = $1`, [dagLeeg]);
    }

    const na = await telAlles(dagLeeg);
    expect(na).toEqual({
      enrollment_choices: 0,
      enrollment_participants: 0,
      enrollment_session_groups: 0,
      enrollment_sessions: 0,
      enrollment_workshops: 0,
      enrollment_rounds: 0,
      enrollment_groups: 0,
    });
  });

  it("laat de andere dag volledig met rust", async () => {
    expect(await telAlles(dagBlijft)).toEqual({
      enrollment_choices: 8,
      enrollment_participants: 12,
      enrollment_session_groups: 1,
      enrollment_sessions: 4,
      enrollment_workshops: 2,
      enrollment_rounds: 3,
      enrollment_groups: 3,
    });
  });

  it("laat de dag zelf staan, met school, naam, datum en link", async () => {
    const dag = await db.query<{
      name: string;
      slug: string;
      organization_id: string;
      event_date: string;
    }>("select name, slug, organization_id, event_date from public.enrollment_events where id = $1", [dagLeeg]);

    expect(dag.rows).toHaveLength(1);
    expect(dag.rows[0].name).toBe("CKV Dag");
    expect(dag.rows[0].slug).toBe("ckv-dag-test");
    expect(dag.rows[0].organization_id).toBeTruthy();
  });

  it("laat de geschiedenis van deze dag staan", async () => {
    const toegang = await db.query<{ n: number }>(
      "select count(*)::int as n from public.enrollment_access where event_id = $1",
      [dagLeeg],
    );
    const verzonden = await db.query<{ n: number }>(
      "select count(*)::int as n from public.enrollment_deliveries where event_id = $1",
      [dagLeeg],
    );
    expect(Number(toegang.rows[0].n)).toBe(1);
    expect(Number(verzonden.rows[0].n)).toBe(1);
  });

  it("kan daarna terug naar concept en opnieuw gevuld worden", async () => {
    await db.query("update public.enrollment_events set status = 'concept' where id = $1", [dagLeeg]);

    const status = await db.query<{ status: string }>(
      "select status from public.enrollment_events where id = $1",
      [dagLeeg],
    );
    expect(status.rows[0].status).toBe("concept");

    // Opnieuw beginnen moet gewoon kunnen: een klas met dezelfde naam als
    // daarnet mag er weer in.
    await db.query("insert into public.enrollment_groups (event_id, name, position) values ($1, '1A', 1)", [
      dagLeeg,
    ]);
    const na = await telAlles(dagLeeg);
    expect(na.enrollment_groups).toBe(1);
  });

  it("raakt de organisatie en de andere tabellen niet", async () => {
    const organisaties = await db.query<{ n: number }>(
      "select count(*)::int as n from public.organizations",
    );
    const dagen = await db.query<{ n: number }>(
      "select count(*)::int as n from public.enrollment_events",
    );
    expect(Number(organisaties.rows[0].n)).toBe(1);
    expect(Number(dagen.rows[0].n)).toBe(2);
  });
});
