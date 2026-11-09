import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { maakCode } from "@/lib/inschrijving/codes";
import { maakIndeling, type IndelingInvoer } from "@/lib/inschrijving/indeling";
import {
  codesPdf,
  codesXlsx,
  klassenLijsten,
  klassenPdf,
  klassenXlsx,
  ontbrekendOverzicht,
  workshopLijsten,
  workshopsPdf,
  workshopsXlsx,
  type LijstGegevens,
} from "@/lib/inschrijving/lijsten";
import { maakBericht } from "@/lib/inschrijving/mail";
import { maakSleutels } from "@/lib/inschrijving/naam";

/**
 * Een hele cultuurdag, van lege dag tot verstuurde lijsten.
 *
 * WAAROM DIT ER IS
 *
 *   De losse onderdelen zijn elk apart getest. Wat die tests niet zien is het
 *   samenspel: honderden leerlingen die tegelijk kiezen, iemand die wisselt
 *   terwijl een plek net volloopt, een vrijstelling halverwege, en daarna het
 *   automatisch indelen van wie is blijven liggen.
 *
 *   Daarom draait deze test de echte migraties in een Postgres in het
 *   geheugen, en gaat alles langs enrollment_choose(): dezelfde functie die
 *   in productie de keuzes wegschrijft. De regels over vol, toegestane
 *   klassen, herhaling en gesloten dagen worden hier dus echt getoetst en niet
 *   nagebootst.
 *
 * DE FICTIEVE SCHOOL
 *
 *   Acht klassen, twaalf workshops, vier rondes. Verzonnen namen, verzonnen
 *   school. Er komt geen echte klant of echte leerling in voor.
 */

const KLASSEN = ["1A", "1B", "1C", "2A", "2B", "2C", "3A", "3B"];
const PER_KLAS = 26;
const WORKSHOPS = [
  "Workshop Ghetto Drums",
  "Workshop DJ Skills",
  "Workshop Hiphop",
  "Workshop Graffiti",
  "Workshop Breakdance",
  "Workshop Rap",
  "Workshop Beatbox",
  "Workshop Videoclip",
  "Workshop Fotografie",
  "Workshop Theatersport",
  "Workshop Circus",
  "Workshop Streetart",
];
const RONDES = [
  { label: "Workshopronde 1", begin: "09:15", eind: "10:15" },
  { label: "Workshopronde 2", begin: "10:45", eind: "11:45" },
  { label: "Workshopronde 3", begin: "13:00", eind: "14:00" },
  { label: "Workshopronde 4", begin: "14:15", eind: "15:15" },
];

const VOORNAMEN = [
  "Lissa", "Jan-Peter", "Ilse", "Youssef", "Fenna", "Daan", "Sanne", "Milan",
  "Noor", "Bram", "Esmée", "Tim", "Anne-Marie", "Joep", "Lotte", "Ravi",
  "Mees", "Jaleesa", "Thijs", "Amira", "Sem", "Nora", "Luuk", "Faya",
  "Olivier", "Mila",
];
const ACHTERNAMEN = [
  "van der Velde", "Bakker", "Mooren", "El Amrani", "de Jong", "Visser",
  "Smit", "van 't Hof", "Jansen", "Kuipers", "Verstegen", "Boonstra",
  "Nijveld", "Hagelaar", "van Dijk", "Ramdas", "de Wit", "Peters",
  "Vermeulen", "Hendriks", "Groot", "Mulder", "Bos", "Dekker",
  "Willemse", "Overmars",
];

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

interface Rij {
  [kolom: string]: unknown;
}

let db: PGlite;
let dagId: string;

/** Kolomwaarden van één rij ophalen, zonder het typegeklungel per query. */
async function rijen<T extends Rij>(sql: string, params: unknown[] = []): Promise<T[]> {
  const uitkomst = await db.query<T>(sql, params);
  return uitkomst.rows;
}

async function een<T extends Rij>(sql: string, params: unknown[] = []): Promise<T> {
  const lijst = await rijen<T>(sql, params);
  expect(lijst.length).toBeGreaterThan(0);
  return lijst[0];
}

/** Een keuze wegschrijven zoals de site dat doet. Geeft de foutcode terug. */
async function kies(
  deelnemerId: string,
  sessieId: string,
  bron: "deelnemer" | "automatisch" | "beheer" = "deelnemer",
): Promise<string | null> {
  try {
    await db.query("select public.enrollment_choose($1::uuid, $2::uuid, $3)", [deelnemerId, sessieId, bron]);
    return null;
  } catch (fout) {
    const tekst = String((fout as Error).message);
    const code = tekst.match(/enrollment_[a-z_]+/)?.[0];
    return code ?? tekst;
  }
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);

  const map = path.join(process.cwd(), "supabase", "migrations");
  const bestanden = (await readdir(map)).filter((naam) => naam.endsWith(".sql")).sort();
  for (const bestand of bestanden) {
    await db.exec(await readFile(path.join(map, bestand), "utf8"));
  }

  // ---------------------------------------------------------------------------
  // De school en de dag
  // ---------------------------------------------------------------------------
  const organisatie = await een<{ id: string }>(
    "insert into public.organizations (name, slug) values ($1, $2) returning id",
    ["Scholengemeenschap De Rotonde", "de-rotonde-test"],
  );

  const dag = await een<{ id: string }>(
    `insert into public.enrollment_events
       (organization_id, name, event_date, location, status, slug, contact_name, contact_email)
     values ($1, 'Cultuurdag', current_date + 21, 'Breda', 'open', 'cultuurdag-de-rotonde-test', 'Heleen Nijveld', 'heleen@voorbeeld.test')
     returning id`,
    [organisatie.id],
  );
  dagId = dag.id;

  for (const [positie, naam] of KLASSEN.entries()) {
    await db.query("insert into public.enrollment_groups (event_id, name, position) values ($1, $2, $3)", [
      dagId,
      naam,
      positie + 1,
    ]);
  }

  for (const [positie, ronde] of RONDES.entries()) {
    await db.query(
      "insert into public.enrollment_rounds (event_id, position, label, starts_at, ends_at) values ($1, $2, $3, $4, $5)",
      [dagId, positie + 1, ronde.label, ronde.begin, ronde.eind],
    );
  }

  // De lunchpauze hoort gewoon op het rooster. Hij mag nergens in meetellen:
  // geen uitvoeringen, geen keuzes, en niemand hoeft er iets te kiezen.
  await db.query(
    `insert into public.enrollment_rounds (event_id, position, label, starts_at, ends_at, kind)
     values ($1, 5, 'Pauze (lunch)', '11:45', '12:30', 'pauze')`,
    [dagId],
  );

  for (const [positie, naam] of WORKSHOPS.entries()) {
    await db.query(
      "insert into public.enrollment_workshops (event_id, name, position, default_capacity) values ($1, $2, $3, 20)",
      [dagId, naam, positie + 1],
    );
  }

  const groepen = await rijen<{ id: string; name: string }>(
    "select id, name from public.enrollment_groups where event_id = $1 order by position",
    [dagId],
  );
  // Alleen de workshoprondes krijgen uitvoeringen.
  const rondes = await rijen<{ id: string; label: string }>(
    "select id, label from public.enrollment_rounds where event_id = $1 and kind <> 'pauze' order by position",
    [dagId],
  );
  const workshops = await rijen<{ id: string; name: string }>(
    "select id, name from public.enrollment_workshops where event_id = $1 order by position",
    [dagId],
  );

  // Elke workshop draait in elke ronde. 12 × 20 = 240 plekken per ronde voor
  // 208 leerlingen: krap genoeg om echt vol te laten lopen.
  for (const ronde of rondes) {
    for (const [positie, workshop] of workshops.entries()) {
      await db.query(
        `insert into public.enrollment_sessions (event_id, workshop_id, round_id, capacity, position, room)
         values ($1, $2, $3, 20, $4, $5)`,
        [dagId, workshop.id, ronde.id, positie + 1, `Lokaal ${positie + 1}`],
      );
    }
  }

  // Twee echte beperkingen, zoals een school ze oplegt.
  //   Circus in ronde 1 mag alleen de eerste twee klassen.
  //   Streetart in ronde 4 staat uit, want dat is buiten en het wordt donker.
  const circus = workshops.find((workshop) => workshop.name === "Workshop Circus")!;
  const streetart = workshops.find((workshop) => workshop.name === "Workshop Streetart")!;

  const circusRonde1 = await een<{ id: string }>(
    "select id from public.enrollment_sessions where workshop_id = $1 and round_id = $2",
    [circus.id, rondes[0].id],
  );
  for (const groep of groepen.slice(0, 2)) {
    await db.query(
      "insert into public.enrollment_session_groups (session_id, group_id, event_id) values ($1, $2, $3)",
      [circusRonde1.id, groep.id, dagId],
    );
  }
  await db.query(
    "update public.enrollment_sessions set is_active = false where workshop_id = $1 and round_id = $2",
    [streetart.id, rondes[3].id],
  );

  // Een tweede uitvoering van Hiphop in ronde 2, met een eigen label.
  const hiphop = workshops.find((workshop) => workshop.name === "Workshop Hiphop")!;
  await db.query(
    `insert into public.enrollment_sessions (event_id, workshop_id, round_id, capacity, position, label, room)
     values ($1, $2, $3, 16, 99, 'Groep B', 'Danszaal')`,
    [dagId, hiphop.id, rondes[1].id],
  );

  // ---------------------------------------------------------------------------
  // De leerlingen
  // ---------------------------------------------------------------------------
  const codes = new Set<string>();
  for (const [klasNummer, groep] of groepen.entries()) {
    for (let nummer = 0; nummer < PER_KLAS; nummer += 1) {
      const naam = `${VOORNAMEN[(klasNummer * 7 + nummer) % VOORNAMEN.length]} ${
        ACHTERNAMEN[(klasNummer * 11 + nummer * 3) % ACHTERNAMEN.length]
      }`;
      const sleutels = maakSleutels(naam);

      let code = maakCode();
      while (codes.has(code)) code = maakCode();
      codes.add(code);

      await db.query(
        `insert into public.enrollment_participants
           (event_id, group_id, display_name, search_key, flat_key, claim_token, access_code, email)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          dagId,
          groep.id,
          naam,
          `${sleutels.sleutel} ${klasNummer}-${nummer}`,
          sleutels.platteSleutel,
          `token-${klasNummer}-${nummer}-${maakCode(12)}`,
          code,
          nummer % 4 === 0 ? `leerling${klasNummer}${nummer}@voorbeeld.test` : null,
        ],
      );
    }
  }
}, 120_000);

// -----------------------------------------------------------------------------
// Hulp bij het lezen van de stand
// -----------------------------------------------------------------------------

interface SessieRij extends Rij {
  id: string;
  round_id: string;
  workshop_id: string;
  label: string | null;
  capacity: number;
  room: string | null;
  teacher: string | null;
  is_active: boolean;
}

async function sessies(): Promise<SessieRij[]> {
  return rijen<SessieRij>(
    `select id, round_id, workshop_id, label, capacity, room, teacher, is_active
     from public.enrollment_sessions where event_id = $1 order by position, label nulls first`,
    [dagId],
  );
}

async function bezetting(): Promise<Map<string, number>> {
  const lijst = await rijen<{ session_id: string; bezet: number }>(
    `select s.id as session_id, count(c.id)::int as bezet
     from public.enrollment_sessions s
     left join public.enrollment_choices c on c.session_id = s.id
     where s.event_id = $1 group by s.id`,
    [dagId],
  );
  return new Map(lijst.map((regel) => [regel.session_id, Number(regel.bezet)]));
}

/** Alles wat de lijsten en de indeling nodig hebben, rechtstreeks uit de database. */
async function lijstGegevens(): Promise<LijstGegevens> {
  const [rondes, workshops, sessieLijst, deelnemers, keuzes] = await Promise.all([
    rijen<{ id: string; label: string; kind: string }>(
      "select id, label, kind from public.enrollment_rounds where event_id = $1 order by position",
      [dagId],
    ),
    rijen<{ id: string; name: string }>(
      "select id, name from public.enrollment_workshops where event_id = $1 order by position",
      [dagId],
    ),
    sessies(),
    rijen<{ id: string; display_name: string; exempt: boolean; access_code: string; groep: string }>(
      `select p.id, p.display_name, p.exempt, p.access_code, g.name as groep
       from public.enrollment_participants p
       join public.enrollment_groups g on g.id = p.group_id
       where p.event_id = $1 order by g.position, p.display_name`,
      [dagId],
    ),
    rijen<{ participant_id: string; round_id: string; session_id: string }>(
      `select c.participant_id, c.round_id, c.session_id
       from public.enrollment_choices c
       join public.enrollment_participants p on p.id = c.participant_id
       where p.event_id = $1`,
      [dagId],
    ),
  ]);

  const workshopNaam = new Map(workshops.map((workshop) => [workshop.id, workshop.name]));
  const perDeelnemer = new Map<string, Record<string, string>>();
  for (const keuze of keuzes) {
    const bestaand = perDeelnemer.get(keuze.participant_id) ?? {};
    bestaand[keuze.round_id] = keuze.session_id;
    perDeelnemer.set(keuze.participant_id, bestaand);
  }

  return {
    dag: {
      naam: "Cultuurdag",
      datumTekst: "woensdag 20 mei",
      organisatie: "Scholengemeenschap De Rotonde",
      locatie: "Breda",
    },
    rondes: rondes.map((ronde) => ({
      id: ronde.id,
      label: ronde.label,
      tijd: "09:15 tot 10:15",
      pauze: ronde.kind === "pauze",
    })),
    uitvoeringen: sessieLijst
      .filter((sessie) => sessie.is_active)
      .map((sessie) => ({
        id: sessie.id,
        rondeId: sessie.round_id,
        workshopNaam: workshopNaam.get(sessie.workshop_id) ?? "Workshop",
        label: sessie.label,
        ruimte: sessie.room,
        docent: sessie.teacher,
        maximum: sessie.capacity,
      })),
    deelnemers: deelnemers.map((deelnemer) => ({
      id: deelnemer.id,
      naam: deelnemer.display_name,
      groepNaam: deelnemer.groep,
      vrijgesteld: deelnemer.exempt,
      code: deelnemer.access_code,
      keuzes: perDeelnemer.get(deelnemer.id) ?? {},
    })),
  };
}

/** De invoer voor het automatisch indelen, in dezelfde vorm als de site hem maakt. */
async function indelingInvoer(): Promise<IndelingInvoer> {
  const gegevens = await lijstGegevens();
  const sessieLijst = await sessies();
  const bezet = await bezetting();

  const klasRegels = await rijen<{ session_id: string; group_id: string }>(
    "select session_id, group_id from public.enrollment_session_groups where event_id = $1",
    [dagId],
  );
  const deelnemers = await rijen<{ id: string; group_id: string }>(
    "select id, group_id from public.enrollment_participants where event_id = $1",
    [dagId],
  );
  const workshops = await rijen<{ id: string; name: string }>(
    "select id, name from public.enrollment_workshops where event_id = $1",
    [dagId],
  );

  const workshopNaam = new Map(workshops.map((workshop) => [workshop.id, workshop.name]));
  const groepVan = new Map(deelnemers.map((deelnemer) => [deelnemer.id, deelnemer.group_id]));

  const perSessie = new Map<string, string[]>();
  for (const regel of klasRegels) {
    perSessie.set(regel.session_id, [...(perSessie.get(regel.session_id) ?? []), regel.group_id]);
  }

  return {
    rondes: gegevens.rondes.map((ronde) => ({ id: ronde.id, label: ronde.label, pauze: ronde.pauze })),
    uitvoeringen: sessieLijst
      .filter((sessie) => sessie.is_active)
      .map((sessie) => ({
        id: sessie.id,
        rondeId: sessie.round_id,
        workshopId: sessie.workshop_id,
        workshopNaam: workshopNaam.get(sessie.workshop_id) ?? "Workshop",
        label: sessie.label,
        maximum: sessie.capacity,
        bezet: bezet.get(sessie.id) ?? 0,
        klassen: perSessie.get(sessie.id) ?? [],
      })),
    deelnemers: gegevens.deelnemers.map((deelnemer) => ({
      id: deelnemer.id,
      naam: deelnemer.naam,
      groepId: groepVan.get(deelnemer.id) ?? "",
      groepNaam: deelnemer.groepNaam,
      vrijgesteld: deelnemer.vrijgesteld,
      keuzes: deelnemer.keuzes,
    })),
    herhalingToegestaan: false,
  };
}

// -----------------------------------------------------------------------------
// De dag zelf
// -----------------------------------------------------------------------------

describe("een hele cultuurdag", () => {
  it("staat klaar met acht klassen, twaalf workshops en vier rondes", async () => {
    const telling = await een<{ klassen: number; workshops: number; rondes: number; uitvoeringen: number; deelnemers: number }>(
      `select
         (select count(*)::int from public.enrollment_groups where event_id = $1) as klassen,
         (select count(*)::int from public.enrollment_workshops where event_id = $1) as workshops,
         (select count(*)::int from public.enrollment_rounds where event_id = $1) as rondes,
         (select count(*)::int from public.enrollment_sessions where event_id = $1) as uitvoeringen,
         (select count(*)::int from public.enrollment_participants where event_id = $1) as deelnemers`,
      [dagId],
    );

    expect(Number(telling.klassen)).toBe(8);
    expect(Number(telling.workshops)).toBe(12);
    // Vier workshoprondes plus de lunchpauze.
    expect(Number(telling.rondes)).toBe(5);
    // 12 workshops × 4 rondes, plus de tweede uitvoering van Hiphop.
    expect(Number(telling.uitvoeringen)).toBe(49);
    expect(Number(telling.deelnemers)).toBe(KLASSEN.length * PER_KLAS);
  });

  it("geeft iedere leerling een eigen code", async () => {
    const telling = await een<{ totaal: number; verschillend: number; fout: number }>(
      `select count(*)::int as totaal,
              count(distinct access_code)::int as verschillend,
              count(*) filter (where access_code !~ '^[0-9A-HJKMNP-TV-Z]{6,12}$')::int as fout
       from public.enrollment_participants where event_id = $1`,
      [dagId],
    );

    expect(Number(telling.verschillend)).toBe(Number(telling.totaal));
    expect(Number(telling.fout)).toBe(0);
  });

  it("laat een volle uitvoering nooit over het maximum gaan, ook niet bij tegelijk kiezen", async () => {
    // Dertig leerlingen uit dezelfde klas duiken tegelijk op dezelfde workshop
    // met twintig plekken. Dat is de ochtend dat de inschrijving opengaat.
    const ronde = await een<{ id: string }>(
      "select id from public.enrollment_rounds where event_id = $1 and kind <> 'pauze' order by position limit 1",
      [dagId],
    );
    const drums = await een<{ id: string }>(
      `select s.id from public.enrollment_sessions s
       join public.enrollment_workshops w on w.id = s.workshop_id
       where s.event_id = $1 and s.round_id = $2 and w.name = 'Workshop Ghetto Drums'`,
      [dagId, ronde.id],
    );
    const kandidaten = await rijen<{ id: string }>(
      `select p.id from public.enrollment_participants p
       join public.enrollment_groups g on g.id = p.group_id
       where p.event_id = $1 and g.name in ('1A', '1B') order by p.display_name limit 30`,
      [dagId],
    );

    const uitkomsten = await Promise.all(kandidaten.map((kandidaat) => kies(kandidaat.id, drums.id)));

    const gelukt = uitkomsten.filter((fout) => fout === null).length;
    const vol = uitkomsten.filter((fout) => fout === "enrollment_full").length;

    expect(gelukt).toBe(20);
    expect(vol).toBe(10);

    const bezet = await een<{ bezet: number }>(
      "select bezet from public.enrollment_session_occupancy where session_id = $1",
      [drums.id],
    );
    expect(Number(bezet.bezet)).toBe(20);
  });

  it("houdt zich aan de klasbeperking en aan een uitvoering die uit staat", async () => {
    const rondeLijst = await rijen<{ id: string }>(
      "select id from public.enrollment_rounds where event_id = $1 and kind <> 'pauze' order by position",
      [dagId],
    );
    const circus = await een<{ id: string }>(
      `select s.id from public.enrollment_sessions s
       join public.enrollment_workshops w on w.id = s.workshop_id
       where s.event_id = $1 and s.round_id = $2 and w.name = 'Workshop Circus'`,
      [dagId, rondeLijst[0].id],
    );
    const streetart = await een<{ id: string }>(
      `select s.id from public.enrollment_sessions s
       join public.enrollment_workshops w on w.id = s.workshop_id
       where s.event_id = $1 and s.round_id = $2 and w.name = 'Workshop Streetart'`,
      [dagId, rondeLijst[3].id],
    );

    const uit3A = await een<{ id: string }>(
      `select p.id from public.enrollment_participants p
       join public.enrollment_groups g on g.id = p.group_id
       where p.event_id = $1 and g.name = '3A' limit 1`,
      [dagId],
    );
    const uit1A = await een<{ id: string }>(
      `select p.id from public.enrollment_participants p
       join public.enrollment_groups g on g.id = p.group_id
       where p.event_id = $1 and g.name = '1A' limit 1`,
      [dagId],
    );

    expect(await kies(uit3A.id, circus.id)).toBe("enrollment_not_allowed");
    expect(await kies(uit1A.id, circus.id)).toBe(null);
    expect(await kies(uit1A.id, streetart.id)).toBe("enrollment_unavailable");
  });

  it("wisselt een keuze om in plaats van er een tweede bij te zetten", async () => {
    const ronde = await een<{ id: string }>(
      "select id from public.enrollment_rounds where event_id = $1 and kind <> 'pauze' order by position offset 1 limit 1",
      [dagId],
    );
    const [eerste, tweede] = await rijen<{ id: string }>(
      `select s.id from public.enrollment_sessions s
       join public.enrollment_workshops w on w.id = s.workshop_id
       where s.event_id = $1 and s.round_id = $2 and w.name in ('Workshop Rap', 'Workshop Beatbox')
       order by w.name`,
      [dagId, ronde.id],
    );
    const leerling = await een<{ id: string }>(
      `select p.id from public.enrollment_participants p
       join public.enrollment_groups g on g.id = p.group_id
       where p.event_id = $1 and g.name = '2C' limit 1`,
      [dagId],
    );

    expect(await kies(leerling.id, eerste.id)).toBe(null);
    const naEerste = await bezetting();

    expect(await kies(leerling.id, tweede.id)).toBe(null);
    const naTweede = await bezetting();

    const keuzes = await rijen<{ session_id: string; source: string }>(
      "select session_id, source from public.enrollment_choices where participant_id = $1 and round_id = $2",
      [leerling.id, ronde.id],
    );

    expect(keuzes).toHaveLength(1);
    expect(keuzes[0].session_id).toBe(tweede.id);
    expect(keuzes[0].source).toBe("deelnemer");
    // De oude plek is weer vrij.
    expect(naTweede.get(eerste.id)).toBe((naEerste.get(eerste.id) ?? 0) - 1);
  });

  it("weigert een herhaling van dezelfde workshop in een andere ronde", async () => {
    const rondeLijst = await rijen<{ id: string }>(
      "select id from public.enrollment_rounds where event_id = $1 and kind <> 'pauze' order by position",
      [dagId],
    );
    const fotografie = await rijen<{ id: string; round_id: string }>(
      `select s.id, s.round_id from public.enrollment_sessions s
       join public.enrollment_workshops w on w.id = s.workshop_id
       where s.event_id = $1 and w.name = 'Workshop Fotografie'`,
      [dagId],
    );
    const inRonde = (rondeId: string) => fotografie.find((sessie) => sessie.round_id === rondeId)!.id;

    const leerling = await een<{ id: string }>(
      `select p.id from public.enrollment_participants p
       join public.enrollment_groups g on g.id = p.group_id
       where p.event_id = $1 and g.name = '3B' limit 1`,
      [dagId],
    );

    expect(await kies(leerling.id, inRonde(rondeLijst[0].id))).toBe(null);
    expect(await kies(leerling.id, inRonde(rondeLijst[1].id))).toBe("enrollment_repeat");
  });

  it("laat een vrijgestelde leerling niets meer kiezen", async () => {
    const leerling = await een<{ id: string }>(
      `select p.id from public.enrollment_participants p
       join public.enrollment_groups g on g.id = p.group_id
       where p.event_id = $1 and g.name = '2B' order by p.display_name limit 1`,
      [dagId],
    );
    const sessie = await een<{ id: string }>(
      `select s.id from public.enrollment_sessions s
       join public.enrollment_workshops w on w.id = s.workshop_id
       where s.event_id = $1 and w.name = 'Workshop Videoclip' limit 1`,
      [dagId],
    );

    // Vrijstellen gebeurt zoals in de beheeromgeving: keuzes eerst weg.
    await db.query("delete from public.enrollment_choices where participant_id = $1", [leerling.id]);
    await db.query("update public.enrollment_participants set exempt = true where id = $1", [leerling.id]);

    expect(await kies(leerling.id, sessie.id)).toBe("enrollment_exempt");
  });

  it("laat vijftig leerlingen door elkaar kiezen zonder dubbele of te volle uitvoeringen", async () => {
    const rondeLijst = await rijen<{ id: string }>(
      "select id from public.enrollment_rounds where event_id = $1 and kind <> 'pauze' order by position",
      [dagId],
    );
    const sessieLijst = await sessies();
    const deelnemers = await rijen<{ id: string }>(
      `select id from public.enrollment_participants
       where event_id = $1 and exempt = false order by display_name limit 50`,
      [dagId],
    );

    // Iedereen kiest in elke ronde iets, allemaal tegelijk. Welke keuzes
    // sneuvelen op vol of herhaling maakt niet uit; wat telt is dat de stand
    // achteraf klopt.
    const pogingen: Promise<string | null>[] = [];
    for (const [nummer, deelnemer] of deelnemers.entries()) {
      for (const [rondeNummer, ronde] of rondeLijst.entries()) {
        const kandidaten = sessieLijst.filter((sessie) => sessie.round_id === ronde.id && sessie.is_active);
        const sessie = kandidaten[(nummer + rondeNummer * 5) % kandidaten.length];
        pogingen.push(kies(deelnemer.id, sessie.id));
      }
    }
    const uitkomsten = await Promise.all(pogingen);

    // Geen onverwachte fouten: alleen de regels die we kennen.
    const onbekend = uitkomsten.filter(
      (fout) =>
        fout !== null &&
        !["enrollment_full", "enrollment_repeat", "enrollment_not_allowed", "enrollment_unavailable"].includes(fout),
    );
    expect(onbekend).toEqual([]);

    const dubbel = await rijen<{ aantal: number }>(
      `select count(*)::int as aantal from (
         select participant_id, round_id from public.enrollment_choices
         group by participant_id, round_id having count(*) > 1
       ) as dubbelen`,
      [],
    );
    expect(Number(dubbel[0].aantal)).toBe(0);

    const teVol = await rijen<{ session_id: string }>(
      "select session_id from public.enrollment_session_occupancy where bezet > capacity",
      [],
    );
    expect(teVol).toEqual([]);
  });

  it("sluit de inschrijving: de leerling kan niets meer, het indelen wel", async () => {
    await db.query("update public.enrollment_events set status = 'gesloten' where id = $1", [dagId]);

    const sessie = await een<{ id: string }>(
      `select s.id from public.enrollment_sessions s
       join public.enrollment_workshops w on w.id = s.workshop_id
       where s.event_id = $1 and w.name = 'Workshop Theatersport' and s.is_active limit 1`,
      [dagId],
    );
    const leerling = await een<{ id: string }>(
      `select p.id from public.enrollment_participants p
       where p.event_id = $1 and p.exempt = false
         and not exists (
           select 1 from public.enrollment_choices c
           where c.participant_id = p.id and c.round_id = (select round_id from public.enrollment_sessions where id = $2)
         )
       limit 1`,
      [dagId, sessie.id],
    );

    expect(await kies(leerling.id, sessie.id, "deelnemer")).toBe("enrollment_closed");
    expect(await kies(leerling.id, sessie.id, "automatisch")).toBe(null);

    const bron = await een<{ source: string }>(
      "select source from public.enrollment_choices where participant_id = $1 and session_id = $2",
      [leerling.id, sessie.id],
    );
    expect(bron.source).toBe("automatisch");
  });

  it("deelt de rest automatisch in, en het voorstel is precies wat er gebeurt", async () => {
    const invoer = await indelingInvoer();
    const voorstel = maakIndeling(invoer);

    expect(voorstel.aantalMetGat).toBeGreaterThan(0);
    expect(voorstel.toewijzingen.length).toBeGreaterThan(0);

    // Tweemaal rekenen op dezelfde stand geeft hetzelfde voorstel. Daarom mag
    // het scherm tonen wat er gaat gebeuren.
    expect(maakIndeling(await indelingInvoer()).toewijzingen).toEqual(voorstel.toewijzingen);

    // Wat het voorstel niet kan plaatsen moet een uitzondering zijn en geen
    // regel. Lukt dat niet, dan is er iets mis met het rooster of met het
    // algoritme, en dan wil je dat hier zien en niet op de dag zelf.
    expect(voorstel.nietGelukt.length).toBeLessThan(voorstel.toewijzingen.length * 0.02);


    const mislukt: string[] = [];
    for (const toewijzing of voorstel.toewijzingen) {
      const fout = await kies(toewijzing.deelnemerId, toewijzing.sessieId, "automatisch");
      if (fout) mislukt.push(`${toewijzing.naam}: ${fout}`);
    }
    expect(mislukt).toEqual([]);

    // Op deze dag lukt het voor iedereen: 625 toewijzingen, niets blijft
    // liggen. Daarmee is ook iedereen die meedoet helemaal rond.
    expect(voorstel.nietGelukt).toEqual([]);
    expect(voorstel.aantalCompleet).toBe(KLASSEN.length * PER_KLAS - 1);

    // Niemand heeft nog een gat, behalve wie het voorstel al niet kon plaatsen.
    const na = await lijstGegevens();
    const ontbrekend = ontbrekendOverzicht(na);
    expect(ontbrekend.nietIngedeeld.length).toBe(voorstel.nietGelukt.length);
    expect(ontbrekend.teVol).toEqual([]);

    // De vrijgestelde leerling is overgeslagen.
    expect(ontbrekend.vrijgesteld.length).toBe(1);

    const teVol = await rijen<{ session_id: string }>(
      "select session_id from public.enrollment_session_occupancy where bezet > capacity",
      [],
    );
    expect(teVol).toEqual([]);
  });

  it("houdt bij waar elke keuze vandaan komt", async () => {
    const bronnen = await rijen<{ source: string; aantal: number }>(
      `select c.source, count(*)::int as aantal
       from public.enrollment_choices c
       join public.enrollment_participants p on p.id = c.participant_id
       where p.event_id = $1 group by c.source order by c.source`,
      [dagId],
    );

    const perBron = new Map(bronnen.map((regel) => [regel.source, Number(regel.aantal)]));
    expect(perBron.get("deelnemer")).toBeGreaterThan(0);
    expect(perBron.get("automatisch")).toBeGreaterThan(0);
    // Niets met een onbekende herkomst.
    expect([...perBron.keys()].every((bron) => ["deelnemer", "automatisch", "beheer"].includes(bron))).toBe(true);
  });

  it("maakt klassenlijsten, workshoplijsten en codelijsten die kloppen", async () => {
    const gegevens = await lijstGegevens();

    const klassen = klassenLijsten(gegevens);
    expect(klassen.map((lijst) => lijst.klas)).toEqual(KLASSEN);
    expect(klassen.every((lijst) => lijst.regels.length === PER_KLAS)).toBe(true);

    // De pauze staat als eigen kolom op de klassenlijst, met "Pauze" eronder.
    const pauzeKolom = klassen[0].rondes.findIndex((ronde) => ronde.pauze);
    expect(pauzeKolom).toBeGreaterThanOrEqual(0);
    expect(klassen.every((lijst) => lijst.regels.every((regel) => regel.perRonde[pauzeKolom] === "Pauze"))).toBe(
      true,
    );

    // Precies één leerling is vrijgesteld. Die staat in elke workshopronde op
    // "Vrijgesteld", en in de pauze gewoon op "Pauze".
    const vrijgesteld = klassen
      .flatMap((lijst) => lijst.regels)
      .filter((regel) =>
        regel.perRonde.every((tekst, positie) =>
          positie === pauzeKolom ? tekst === "Pauze" : tekst === "Vrijgesteld",
        ),
      );
    expect(vrijgesteld).toHaveLength(1);

    const workshops = workshopLijsten(gegevens);
    expect(workshops.every((lijst) => lijst.deelnemers.length <= lijst.maximum)).toBe(true);
    // Iedere ingedeelde leerling staat precies zo vaak op een workshoplijst
    // als hij keuzes heeft.
    const opLijsten = workshops.reduce((totaal, lijst) => totaal + lijst.deelnemers.length, 0);
    const keuzes = await een<{ aantal: number }>(
      `select count(*)::int as aantal from public.enrollment_choices c
       join public.enrollment_participants p on p.id = c.participant_id
       where p.event_id = $1 and p.exempt = false`,
      [dagId],
    );
    expect(opLijsten).toBe(Number(keuzes.aantal));

    // De bestanden zelf: een xlsx is een zip (PK), een pdf begint met %PDF.
    const bestanden = [klassenXlsx(gegevens), workshopsXlsx(gegevens), codesXlsx(gegevens)];
    for (const bestand of bestanden) {
      expect(bestand.length).toBeGreaterThan(2000);
      expect(String.fromCharCode(bestand[0], bestand[1])).toBe("PK");
    }

    const pdfs = [klassenPdf(gegevens), workshopsPdf(gegevens), codesPdf(gegevens)];
    for (const pdf of pdfs) {
      expect(pdf.length).toBeGreaterThan(2000);
      expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    }
  });

  it("behandelt de lunchpauze nergens als workshopronde", async () => {
    // Geen uitvoering in de pauze.
    const inPauze = await een<{ aantal: number }>(
      `select count(*)::int as aantal from public.enrollment_sessions s
       join public.enrollment_rounds r on r.id = s.round_id
       where s.event_id = $1 and r.kind = 'pauze'`,
      [dagId],
    );
    expect(Number(inPauze.aantal)).toBe(0);

    // Geen enkele keuze in de pauze.
    const keuzesInPauze = await een<{ aantal: number }>(
      `select count(*)::int as aantal from public.enrollment_choices c
       join public.enrollment_rounds r on r.id = c.round_id
       where r.event_id = $1 and r.kind = 'pauze'`,
      [dagId],
    );
    expect(Number(keuzesInPauze.aantal)).toBe(0);

    // Het indelen slaat de pauze over: niemand krijgt er een plek.
    const voorstel = maakIndeling(await indelingInvoer());
    expect(voorstel.toewijzingen.filter((regel) => regel.rondeLabel.toLowerCase().includes("pauze"))).toEqual([]);

    // En niemand mist iets doordat hij in de pauze niets heeft gekozen.
    const ontbrekend = ontbrekendOverzicht(await lijstGegevens());
    expect(
      ontbrekend.nietIngedeeld.some((regel) => regel.rondes.some((label) => label.toLowerCase().includes("pauze"))),
    ).toBe(false);

    // Iedereen die meedoet is klaar: vier keuzes voor vier workshoprondes.
    const compleet = await een<{ aantal: number }>(
      `select count(*)::int as aantal from (
         select p.id from public.enrollment_participants p
         join public.enrollment_choices c on c.participant_id = p.id
         where p.event_id = $1 and p.exempt = false
         group by p.id having count(c.id) = 4
       ) as klaar`,
      [dagId],
    );
    expect(Number(compleet.aantal)).toBe(KLASSEN.length * PER_KLAS - 1);
  });

  it("zet geen codes in de lijsten die naar de klant gaan", async () => {
    const gegevens = await lijstGegevens();
    const eenCode = gegevens.deelnemers[0].code!;

    // Een xlsx is gecomprimeerd, dus zoeken in de bytes zegt niets. De
    // leesbare lijsten zijn de echte toets.
    const klassen = JSON.stringify(klassenLijsten(gegevens));
    const workshops = JSON.stringify(workshopLijsten(gegevens));

    expect(klassen).not.toContain(eenCode);
    expect(workshops).not.toContain(eenCode);
  });

  it("bouwt een mail met de vier lijsten als bijlage", async () => {
    const gegevens = await lijstGegevens();

    const bericht = maakBericht({
      van: "info@skoolworkshop.test",
      naar: ["heleen@voorbeeld.test"],
      onderwerp: "Indeling Cultuurdag · Scholengemeenschap De Rotonde",
      tekst: "Beste Heleen,\n\nHierbij de indeling van de cultuurdag.",
      bijlagen: [
        {
          naam: "De Rotonde - Klassenlijsten.xlsx",
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          data: klassenXlsx(gegevens),
        },
        {
          naam: "De Rotonde - Workshoplijsten.xlsx",
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          data: workshopsXlsx(gegevens),
        },
        { naam: "De Rotonde - Klassenlijsten.pdf", type: "application/pdf", data: klassenPdf(gegevens) },
        { naam: "De Rotonde - Workshoplijsten.pdf", type: "application/pdf", data: workshopsPdf(gegevens) },
      ],
    });

    const ruw = Buffer.from(bericht, "base64url").toString("utf8");
    expect(ruw).toContain("To: heleen@voorbeeld.test");
    expect(ruw).toContain("multipart/mixed");
    expect(ruw.match(/Content-Disposition: attachment/g)).toHaveLength(4);
    expect(ruw).toContain('filename="De Rotonde - Klassenlijsten.xlsx"');
    // Geen enkele code in de mail.
    expect(ruw).not.toContain(gegevens.deelnemers[0].code!);
  });
});
