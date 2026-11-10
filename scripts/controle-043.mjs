/**
 * Controle: wat doet migratie 043 met gegevens die er al stonden?
 *
 * Werkwijze
 *
 *   1. Alle migraties behalve 043 draaien in een Postgres in het geheugen.
 *   2. Een volle cultuurdag vullen: 19 klassen, 353 leerlingen, vier rondes
 *      met een pauze, twaalf workshops, keuzes, plus een tweede dag die al
 *      afgerond is, en wat gegevens buiten de inschrijvingen.
 *   3. Van elke tabel een vingerafdruk nemen over de kolommen zoals ze nu zijn.
 *   4. Migratie 043 draaien.
 *   5. Diezelfde vingerafdruk opnieuw nemen, over dezelfde kolommen, en
 *      vergelijken. Alles wat verandert moet verklaarbaar zijn.
 *   6. Daarna: de dag weggooien zoals dag-leegmaken dat doet, en hem
 *      terugzetten uit de back-up. Klopt alles weer?
 *
 * Dit script raakt geen enkele echte database aan. Alles gebeurt in het
 * geheugen en is na afloop weg.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIES = path.join(process.cwd(), "supabase", "migrations");
const DRIEENVEERTIG = "20261110120000_gedeelde_toegangscode.sql";

const STUBS = `
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

const db = await PGlite.create();
await db.exec(STUBS);

const bestanden = (await readdir(MIGRATIES)).filter((n) => n.endsWith(".sql")).sort();
for (const bestand of bestanden) {
  if (bestand === DRIEENVEERTIG) continue;
  await db.exec(await readFile(path.join(MIGRATIES, bestand), "utf8"));
}
console.log(`Migraties gedraaid: ${bestanden.length - 1} (043 nog niet)\n`);

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const een = async (sql, params = []) => (await q(sql, params))[0];

// ---------------------------------------------------------------------------
// Gegevens die er al staan
// ---------------------------------------------------------------------------
const org = await een(
  "insert into public.organizations (name, slug) values ('Scholengemeenschap De Rotonde', 'rotonde-controle') returning id",
);

const dag = await een(
  `insert into public.enrollment_events
     (organization_id, name, event_date, location, status, slug, access_mode, contact_name, contact_email, note, allow_repeat, opens_at, closes_at)
   values ($1, 'CKV Dag', current_date + 30, 'Gouda', 'open', 'ckv-dag-controle', 'code', 'Heleen Nijveld',
           'heleen@voorbeeld.test', 'Twee ruimtes buiten', false, now() - interval '2 days', now() + interval '20 days')
   returning id`,
  [org.id],
);

const afgerond = await een(
  `insert into public.enrollment_events
     (organization_id, name, event_date, status, slug, access_mode)
   values ($1, 'Cultuurdag vorig jaar', current_date - 200, 'afgerond', 'cultuurdag-vorig-jaar-controle', 'naam')
   returning id`,
  [org.id],
);

const klassen = [];
for (let i = 1; i <= 19; i += 1) {
  const naam = `${1 + Math.floor((i - 1) / 10)}${String.fromCharCode(64 + ((i - 1) % 10) + 1)}`;
  klassen.push(
    await een("insert into public.enrollment_groups (event_id, name, position) values ($1, $2, $3) returning id", [
      dag.id,
      naam,
      i,
    ]),
  );
}

const rondes = [];
for (const [i, r] of [
  ["Workshopronde 1", "09:15", "10:15", "workshop"],
  ["Workshopronde 2", "10:45", "11:45", "workshop"],
  ["Pauze (lunch)", "11:45", "12:30", "pauze"],
  ["Workshopronde 3", "13:00", "14:00", "workshop"],
].entries()) {
  rondes.push(
    await een(
      `insert into public.enrollment_rounds (event_id, position, label, starts_at, ends_at, kind)
       values ($1, $2, $3, $4, $5, $6) returning id, kind`,
      [dag.id, i + 1, r[0], r[1], r[2], r[3]],
    ),
  );
}

const workshops = [];
for (let i = 1; i <= 12; i += 1) {
  workshops.push(
    await een(
      "insert into public.enrollment_workshops (event_id, name, position, default_capacity) values ($1, $2, $3, 25) returning id",
      [dag.id, `Workshop ${i}`, i],
    ),
  );
}

const sessies = [];
for (const ronde of rondes.filter((r) => r.kind !== "pauze")) {
  for (const [i, workshop] of workshops.entries()) {
    sessies.push(
      await een(
        `insert into public.enrollment_sessions (event_id, workshop_id, round_id, capacity, position, room)
         values ($1, $2, $3, 25, $4, $5) returning id, round_id`,
        [dag.id, workshop.id, ronde.id, i + 1, `Lokaal ${i + 1}`],
      ),
    );
  }
}

// Een klasbeperking, zoals een school die oplegt.
await db.query("insert into public.enrollment_session_groups (session_id, group_id, event_id) values ($1, $2, $3)", [
  sessies[0].id,
  klassen[0].id,
  dag.id,
]);

const deelnemers = [];
for (let i = 0; i < 353; i += 1) {
  const klas = klassen[i % klassen.length];
  const naam = `Leerling ${String(i + 1).padStart(3, "0")}`;
  deelnemers.push(
    await een(
      `insert into public.enrollment_participants
         (event_id, group_id, display_name, search_key, flat_key, email, claim_token, access_code, year_level, exempt)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [
        dag.id,
        klas.id,
        naam,
        naam.toLowerCase(),
        naam.toLowerCase().replace(/\s/g, ""),
        i % 3 === 0 ? `leerling${i}@voorbeeld.test` : null,
        `token-${String(i).padStart(16, "0")}`,
        `CD${String(i).padStart(6, "0")}`,
        i % 2 === 0 ? "1" : "2",
        i === 7,
      ],
    ),
  );
}

// Keuzes via de echte functie, zodat capaciteit en regels meedoen.
let gekozen = 0;
for (const [i, deelnemer] of deelnemers.entries()) {
  if (deelnemer === deelnemers[7]) continue; // vrijgesteld
  for (const ronde of rondes.filter((r) => r.kind !== "pauze")) {
    const mogelijk = sessies.filter((s) => s.round_id === ronde.id);
    const keuze = mogelijk[(i + mogelijk.indexOf(mogelijk[0])) % mogelijk.length];
    try {
      await db.query("select public.enrollment_choose($1::uuid, $2::uuid, 'deelnemer')", [deelnemer.id, keuze.id]);
      gekozen += 1;
    } catch {
      // vol of al gekozen: dat hoort erbij
    }
  }
}

await db.query(
  `insert into public.enrollment_access (event_id, label, token_hash, code_hash, expires_at)
   values ($1, 'Heleen Nijveld', 'hash-voor-de-controle', 'code-hash-controle', now() + interval '60 days')`,
  [dag.id],
);
await db.query(
  `insert into public.enrollment_deliveries (event_id, to_email, to_name, formats)
   values ($1, 'heleen@voorbeeld.test', 'Heleen Nijveld', array['klassen-xlsx','workshops-xlsx'])`,
  [dag.id],
);

// En iets buiten de inschrijvingen, om te zien dat daar niets gebeurt.
const gebruiker = await een(
  "insert into auth.users (email) values ('info@voorbeeld.test') returning id",
);
await db.query(
  "insert into public.organization_members (organization_id, user_id, role, status, source) values ($1, $2, 'beheerder', 'active', 'admin_manual')",
  [org.id, gebruiker.id],
);
const account = await een("select public.ensure_loyalty_account($1::uuid, $2::uuid) as id", [org.id, gebruiker.id]);
await db.query(
  `insert into public.loyalty_transactions
     (organization_id, user_id, account_id, type, status, points, point_value_cents_per_100, description, external_reference)
   values ($1, $2, $3, 'earn_workshop', 'available', 600, 250, '4 x 90 minuten', 'booking:controle-1')`,
  [org.id, gebruiker.id, account.id],
);

console.log(`Klaargezet: 2 dagen, 19 klassen, 353 leerlingen, ${gekozen} keuzes, 12 workshops, 36 uitvoeringen\n`);

// ---------------------------------------------------------------------------
// Vingerafdruk per tabel
// ---------------------------------------------------------------------------
async function kolommenVan(tabel) {
  const rijen = await q(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1 order by ordinal_position`,
    [tabel],
  );
  return rijen.map((r) => r.column_name);
}

async function vingerafdruk(tabel, kolommen) {
  const lijst = kolommen.map((k) => `t."${k}"::text`).join(" || '~' || ");
  const rij = await een(
    `select count(*)::int as aantal,
            coalesce(md5(string_agg(x, '|' order by x)), 'leeg') as afdruk
       from (select coalesce(${lijst}, '') as x from public."${tabel}" t) s`,
  );
  return rij;
}

const tabellen = (await q("select tablename from pg_tables where schemaname = 'public' order by tablename")).map(
  (r) => r.tablename,
);

const voor = {};
for (const tabel of tabellen) {
  const kolommen = await kolommenVan(tabel);
  voor[tabel] = { kolommen, ...(await vingerafdruk(tabel, kolommen)) };
}

// ---------------------------------------------------------------------------
// Migratie 043
// ---------------------------------------------------------------------------
await db.exec(await readFile(path.join(MIGRATIES, DRIEENVEERTIG), "utf8"));
console.log("Migratie 043 uitgevoerd.\n");

const naTabellen = (await q("select tablename from pg_tables where schemaname = 'public' order by tablename")).map(
  (r) => r.tablename,
);

console.log("=".repeat(74));
console.log("WAT ER VERANDERDE AAN GEGEVENS DIE ER AL STONDEN");
console.log("=".repeat(74));

let onverwacht = 0;
for (const tabel of tabellen) {
  const na = await vingerafdruk(tabel, voor[tabel].kolommen);
  const zelfde = na.aantal === voor[tabel].aantal && na.afdruk === voor[tabel].afdruk;
  if (zelfde) continue;

  const verwacht = tabel === "app_settings" && na.aantal === voor[tabel].aantal + 2;
  console.log(
    `  ${verwacht ? "verwacht" : "LET OP  "}  ${tabel.padEnd(34)} ${voor[tabel].aantal} rijen -> ${na.aantal} rijen` +
      (na.afdruk === voor[tabel].afdruk ? "" : ", inhoud gewijzigd"),
  );
  if (!verwacht) onverwacht += 1;
}
console.log(
  onverwacht === 0
    ? "  Geen enkele bestaande kolom van geen enkele tabel is veranderd.\n"
    : `\n  ${onverwacht} tabel(len) onverwacht gewijzigd.\n`,
);

const nieuweTabellen = naTabellen.filter((t) => !tabellen.includes(t));
console.log(`  Nieuwe tabellen: ${nieuweTabellen.join(", ") || "geen"}`);

for (const tabel of ["enrollment_events", "enrollment_participants"]) {
  const nu = await kolommenVan(tabel);
  const erbij = nu.filter((k) => !voor[tabel].kolommen.includes(k));
  console.log(`  Nieuwe kolommen in ${tabel}: ${erbij.join(", ") || "geen"}`);
}

const codes = await q("select name, shared_code, shared_code_active from public.enrollment_events order by name");
console.log("\n  Toegangscodes na de migratie:");
for (const rij of codes) {
  console.log(
    `    ${rij.name.padEnd(28)} ${rij.shared_code}  ${rij.shared_code_active ? "actief" : "uit"}  ${
      /^[0-9A-HJKMNP-TV-Z]{6,12}$/.test(rij.shared_code ?? "") ? "geldige vorm" : "ONGELDIG"
    }`,
  );
}

// ---------------------------------------------------------------------------
// Blijft de dag werken? Kiezen, capaciteit, klasbeperking
// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(74));
console.log("WERKT DE BESTAANDE DAG NOG?");
console.log("=".repeat(74));

const keuzesVoorDeDag = await een(
  `select count(*)::int as n from public.enrollment_choices c
     join public.enrollment_participants p on p.id = c.participant_id where p.event_id = $1`,
  [dag.id],
);
console.log(`  ${keuzesVoorDeDag.n} keuzes staan er nog (waren er ${gekozen})`);

// Iemand laten wisselen van workshop, met de echte functie.
const wisselaar = deelnemers[20];
const ronde1 = rondes[0];
// Een uitvoering zonder klasbeperking, met een plek erbij zodat er echt
// gewisseld kan worden. Een maximum verhogen is gewoon beheerwerk.
const vrijeSessie = await een(
  `select s.id from public.enrollment_sessions s
    where s.round_id = $1
      and not exists (select 1 from public.enrollment_session_groups g where g.session_id = s.id)
    order by s.position limit 1`,
  [ronde1.id],
);
await db.query("update public.enrollment_sessions set capacity = capacity + 2 where id = $1", [vrijeSessie.id]);
const andereSessie = { id: vrijeSessie.id };
let wisselOk = true;
try {
  await db.query("select public.enrollment_choose($1::uuid, $2::uuid, 'deelnemer')", [wisselaar.id, andereSessie.id]);
} catch (fout) {
  wisselOk = String(fout.message);
}
console.log(`  Wisselen van workshop na de migratie: ${wisselOk === true ? "lukt" : `MISLUKT (${wisselOk})`}`);

const vrijgesteld = deelnemers[7];
let vrijstellingWerkt = false;
try {
  await db.query("select public.enrollment_choose($1::uuid, $2::uuid, 'deelnemer')", [vrijgesteld.id, andereSessie.id]);
} catch (fout) {
  vrijstellingWerkt = String(fout.message).includes("enrollment_exempt");
}
console.log(`  Vrijstelling werkt nog: ${vrijstellingWerkt ? "ja" : "NEE"}`);

const beperkt = sessies[0];
const buitenKlas = deelnemers.find((_, i) => klassen[i % klassen.length].id !== klassen[0].id);
let beperkingWerkt = false;
try {
  await db.query("select public.enrollment_choose($1::uuid, $2::uuid, 'deelnemer')", [buitenKlas.id, beperkt.id]);
} catch (fout) {
  beperkingWerkt = String(fout.message).includes("enrollment_not_allowed");
}
console.log(`  Klasbeperking werkt nog: ${beperkingWerkt ? "ja" : "NEE"}`);

const bezetting = await een(
  "select count(*)::int as n from public.enrollment_session_occupancy where event_id = $1",
  [dag.id],
);
console.log(`  De bezettingsweergave doet het nog: ${bezetting.n} uitvoeringen geteld`);

// ---------------------------------------------------------------------------
// Back-up en herstel
// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(74));
console.log("BACK-UP EN HERSTEL VAN EEN HELE DAG");
console.log("=".repeat(74));

const VOLGORDE = [
  "enrollment_groups",
  "enrollment_rounds",
  "enrollment_workshops",
  "enrollment_sessions",
  "enrollment_session_groups",
  "enrollment_participants",
];

const backup = {};
for (const tabel of VOLGORDE) {
  backup[tabel] = await q(`select * from public."${tabel}" where event_id = $1`, [dag.id]);
}
const deelnemerIds = backup.enrollment_participants.map((r) => r.id);
backup.enrollment_choices = await q("select * from public.enrollment_choices where participant_id = any($1::uuid[])", [
  deelnemerIds,
]);
backup.enrollment_events = await q("select * from public.enrollment_events where id = $1", [dag.id]);

const totaalVoor = Object.fromEntries(Object.entries(backup).map(([t, r]) => [t, r.length]));
console.log(`  Back-up: ${Object.entries(totaalVoor).map(([t, n]) => `${t.replace("enrollment_", "")} ${n}`).join(", ")}`);

// De vingerafdruk van de dag, om na herstel mee te vergelijken.
const afdrukVoor = JSON.stringify(backup);

// Leegmaken zoals het script dat doet: per id, nooit over de dag heen.
await db.query("delete from public.enrollment_choices where participant_id = any($1::uuid[])", [deelnemerIds]);
for (const tabel of [...VOLGORDE].reverse()) {
  const ids = backup[tabel].map((r) => r.id).filter(Boolean);
  if (ids.length > 0) await db.query(`delete from public."${tabel}" where id = any($1::uuid[])`, [ids]);
  else await db.query(`delete from public."${tabel}" where event_id = $1`, [dag.id]);
}
await db.query("update public.enrollment_events set status = 'concept' where id = $1", [dag.id]);

const naLeeg = await een(
  "select (select count(*)::int from public.enrollment_participants where event_id = $1) as leerlingen," +
    " (select count(*)::int from public.enrollment_groups where event_id = $1) as klassen",
  [dag.id],
);
const andereDagHeel = await een("select count(*)::int as n from public.enrollment_events where id = $1", [afgerond.id]);
const loyaltyHeel = await een("select count(*)::int as n from public.loyalty_transactions");
console.log(
  `  Na leegmaken: ${naLeeg.leerlingen} leerlingen, ${naLeeg.klassen} klassen. ` +
    `Andere dag nog aanwezig: ${andereDagHeel.n === 1 ? "ja" : "NEE"}. Spaarpunten ongemoeid: ${loyaltyHeel.n === 1 ? "ja" : "NEE"}`,
);

// Terugzetten in de volgorde uit de back-up.
async function zetTerug(tabel, rijen) {
  for (const rij of rijen) {
    const kolommen = Object.keys(rij);
    const waarden = kolommen.map((k) => rij[k]);
    const plaatsen = kolommen.map((_, i) => `$${i + 1}`).join(", ");
    await db.query(
      `insert into public."${tabel}" (${kolommen.map((k) => `"${k}"`).join(", ")}) values (${plaatsen})`,
      waarden,
    );
  }
}

for (const tabel of VOLGORDE) await zetTerug(tabel, backup[tabel]);
await zetTerug("enrollment_choices", backup.enrollment_choices);
await db.query("update public.enrollment_events set status = $2 where id = $1", [dag.id, backup.enrollment_events[0].status]);

const hersteld = {};
for (const tabel of VOLGORDE) {
  hersteld[tabel] = await q(`select * from public."${tabel}" where event_id = $1`, [dag.id]);
}
hersteld.enrollment_choices = await q(
  "select * from public.enrollment_choices where participant_id = any($1::uuid[])",
  [deelnemerIds],
);
hersteld.enrollment_events = await q("select * from public.enrollment_events where id = $1", [dag.id]);

const zonderTijd = (o) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(o).map(([t, rijen]) => [
        t,
        rijen
          .map((r) => {
            const kopie = { ...r };
            delete kopie.updated_at;
            return kopie;
          })
          .sort((a, b) => String(a.id ?? JSON.stringify(a)).localeCompare(String(b.id ?? JSON.stringify(b)))),
      ]),
    ),
  );
const gelijk = zonderTijd(hersteld) === zonderTijd(JSON.parse(afdrukVoor));
console.log(
  `  Na herstel: ${hersteld.enrollment_participants.length} leerlingen, ${hersteld.enrollment_choices.length} keuzes, ` +
    `${hersteld.enrollment_groups.length} klassen`,
);
console.log(`  Precies gelijk aan de back-up: ${gelijk ? "ja" : "NEE"}`);

if (!gelijk) {
  for (const tabel of Object.keys(hersteld)) {
    if (zonderTijd({ x: hersteld[tabel] }) !== zonderTijd({ x: backup[tabel] })) {
      console.log(`    verschil in ${tabel}: ${backup[tabel].length} -> ${hersteld[tabel].length}`);
    }
  }
}

// Kan er na herstel nog gewoon gekozen worden?
let naHerstelKiezen = true;
try {
  await db.query("select public.enrollment_choose($1::uuid, $2::uuid, 'deelnemer')", [deelnemers[30].id, andereSessie.id]);
} catch (fout) {
  naHerstelKiezen = String(fout.message);
}
console.log(`  Kiezen na herstel: ${naHerstelKiezen === true ? "lukt" : `MISLUKT (${naHerstelKiezen})`}`);

await db.close();
console.log("");
