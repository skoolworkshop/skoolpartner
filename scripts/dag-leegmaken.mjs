/**
 * Eén inschrijfdag leegmaken, met een back-up vooraf.
 *
 * ============================================================================
 * DIT SCRIPT VERWIJDERT GEGEVENS. ALLEEN VAN DE DAG DIE JIJ AANWIJST.
 * ============================================================================
 *
 * WAT HET DOET
 *
 *   Alle leerlingen, klassen, rondes, pauzes, workshops, uitvoeringen en
 *   gemaakte keuzes van één inschrijfdag. De dag zelf blijft staan, met zijn
 *   naam, datum, locatie en de koppeling met de school, en gaat terug naar
 *   concept zodat je opnieuw kunt beginnen.
 *
 * WAT HET NOOIT DOET
 *
 *   Iets aan een andere inschrijfdag, aan boekingen, facturen, organisaties,
 *   accounts of SkoolPoints. Er staat nergens een "delete from" zonder dat de
 *   dag erin staat, en voor het verwijderen wordt geteld of elke rij ook echt
 *   bij deze dag hoort.
 *
 * ZO GEBRUIK JE HEM
 *
 *   1. node scripts/dag-leegmaken.mjs
 *      Laat alle inschrijfdagen zien met hun aantallen. Verwijdert niets.
 *
 *   2. node scripts/dag-leegmaken.mjs --dag <id of slug>
 *      Laat precies zien wat er aan die dag hangt en schrijft de back-up weg
 *      naar _backup/. Verwijdert niets.
 *
 *   3. node scripts/dag-leegmaken.mjs --dag <id of slug> --verwijder --zeker
 *      Maakt de back-up opnieuw, verwijdert, en telt daarna na of alles op 0
 *      staat. Zonder --zeker gebeurt er niets.
 */

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();

function leesEnv() {
  const waarden = { ...process.env };
  for (const bestand of [".env.local", ".env"]) {
    try {
      const tekst = readFileSync(path.join(root, bestand), "utf8");
      for (const regel of tekst.split(/\r?\n/)) {
        const gelijk = regel.indexOf("=");
        if (regel.trim().startsWith("#") || gelijk < 1) continue;
        const sleutel = regel.slice(0, gelijk).trim();
        if (waarden[sleutel]) continue;
        waarden[sleutel] = regel.slice(gelijk + 1).trim().replace(/^["']|["']$/g, "");
      }
    } catch {
      // Bestaat niet, geen probleem.
    }
  }
  return waarden;
}

const env = leesEnv();
const SUPABASE_URL = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY moeten in .env.local staan.");
  process.exit(1);
}

const argumenten = process.argv.slice(2);
function argument(naam) {
  const index = argumenten.indexOf(naam);
  return index >= 0 ? argumenten[index + 1] : null;
}
const gevraagdeDag = argument("--dag");
const wilVerwijderen = argumenten.includes("--verwijder");
const isZeker = argumenten.includes("--zeker");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Alles wat aan een dag hangt, in de volgorde waarin het verwijderd moet worden. */
const ONDERDELEN = [
  { naam: "enrollment_choices", label: "workshopkeuzes", viaDeelnemer: true },
  { naam: "enrollment_participants", label: "leerlingen" },
  { naam: "enrollment_session_groups", label: "klasbeperkingen" },
  { naam: "enrollment_sessions", label: "uitvoeringen" },
  { naam: "enrollment_workshops", label: "workshops" },
  { naam: "enrollment_rounds", label: "rondes en pauzes" },
  { naam: "enrollment_groups", label: "klassen" },
];

/** Wat blijft staan: dit is geschiedenis en hoort niet bij het opnieuw inrichten. */
const BLIJFT = [
  { naam: "enrollment_access", label: "online inzage voor de school" },
  { naam: "enrollment_deliveries", label: "verstuurde mails" },
];

/** Alle rijen van een tabel die bij deze dag horen, in stukken van duizend. */
async function haalPerDag(tabel, dagId) {
  const rijen = [];
  let vanaf = 0;
  const stap = 1000;

  for (;;) {
    const { data, error } = await supabase
      .from(tabel)
      .select("*")
      .eq("event_id", dagId)
      .range(vanaf, vanaf + stap - 1);
    if (error) throw new Error(`${tabel}: ${error.message}`);
    rijen.push(...(data ?? []));
    if (!data || data.length < stap) break;
    vanaf += stap;
  }

  return rijen;
}

/**
 * De keuzes van deze deelnemers.
 *
 * enrollment_choices heeft geen event_id: een keuze hoort bij een deelnemer.
 * Daarom wordt er per tweehonderd deelnemers gevraagd. Dat houdt de URL kort
 * genoeg en zorgt ervoor dat er nooit een keuze van een andere dag in beeld
 * komt.
 */
async function haalKeuzes(deelnemerIds) {
  const rijen = [];
  for (let i = 0; i < deelnemerIds.length; i += 200) {
    const { data, error } = await supabase
      .from("enrollment_choices")
      .select("*")
      .in("participant_id", deelnemerIds.slice(i, i + 200));
    if (error) throw new Error(`enrollment_choices: ${error.message}`);
    rijen.push(...(data ?? []));
  }
  return rijen;
}

/** Hoeveel keuzes er nog staan voor deze deelnemers. Hoort 0 te zijn. */
async function telKeuzes(deelnemerIds) {
  let totaal = 0;
  for (let i = 0; i < deelnemerIds.length; i += 200) {
    const { count, error } = await supabase
      .from("enrollment_choices")
      .select("id", { count: "exact", head: true })
      .in("participant_id", deelnemerIds.slice(i, i + 200));
    if (error) throw new Error(`enrollment_choices: ${error.message}`);
    totaal += count ?? 0;
  }
  return totaal;
}

async function toonDagen() {
  const { data: dagen, error } = await supabase
    .from("enrollment_events")
    .select("id, name, event_date, status, slug, organizations ( name )")
    .order("event_date", { ascending: false });

  if (error) throw new Error(error.message);
  if (!dagen || dagen.length === 0) {
    console.log("Er staan nog geen inschrijfdagen in het systeem.");
    return;
  }

  console.log("Inschrijfdagen:\n");
  for (const dag of dagen) {
    const { count } = await supabase
      .from("enrollment_participants")
      .select("id", { count: "exact", head: true })
      .eq("event_id", dag.id);

    console.log(`  ${dag.event_date}  ${dag.name}`);
    console.log(`    school    ${dag.organizations?.name ?? "onbekend"}`);
    console.log(`    status    ${dag.status}`);
    console.log(`    id        ${dag.id}`);
    console.log(`    slug      ${dag.slug}`);
    console.log(`    leerlingen ${count ?? 0}`);
    console.log("");
  }
  console.log("Kies er een met:  node scripts/dag-leegmaken.mjs --dag <id of slug>");
}

async function zoekDag(aanduiding) {
  const opId = /^[0-9a-f-]{36}$/i.test(aanduiding);
  const { data, error } = await supabase
    .from("enrollment_events")
    .select("*, organizations ( id, name )")
    .eq(opId ? "id" : "slug", aanduiding);

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return null;
  if (data.length > 1) throw new Error("Er zijn meerdere dagen met deze aanduiding. Gebruik het id.");
  return data[0];
}

async function main() {
  if (!gevraagdeDag) {
    await toonDagen();
    return;
  }

  const dag = await zoekDag(gevraagdeDag);
  if (!dag) {
    console.error(`Geen inschrijfdag gevonden met '${gevraagdeDag}'.`);
    process.exitCode = 1;
    return;
  }

  console.log("=".repeat(72));
  console.log("DE DAG DIE JE HEBT AANGEWEZEN");
  console.log("=".repeat(72));
  console.log(`  Naam      ${dag.name}`);
  console.log(`  Datum     ${dag.event_date}`);
  console.log(`  School    ${dag.organizations?.name ?? "onbekend"}`);
  console.log(`  Locatie   ${dag.location ?? "-"}`);
  console.log(`  Status    ${dag.status}`);
  console.log(`  Id        ${dag.id}`);
  console.log(`  Slug      ${dag.slug}`);
  console.log("");

  // Eerst de deelnemers, want de keuzes hangen daaraan.
  const deelnemers = await haalPerDag("enrollment_participants", dag.id);
  const deelnemerIds = deelnemers.map((rij) => rij.id);

  const inhoud = {};
  for (const onderdeel of ONDERDELEN) {
    if (onderdeel.naam === "enrollment_participants") {
      inhoud[onderdeel.naam] = deelnemers;
    } else if (onderdeel.viaDeelnemer) {
      inhoud[onderdeel.naam] = await haalKeuzes(deelnemerIds);
    } else {
      inhoud[onderdeel.naam] = await haalPerDag(onderdeel.naam, dag.id);
    }
  }

  console.log("WAT ERAAN HANGT");
  for (const onderdeel of ONDERDELEN) {
    console.log(`  ${String(inhoud[onderdeel.naam].length).padStart(6)}  ${onderdeel.label}`);
  }

  // De klassen bij naam, zodat je ziet of de foutieve er echt tussen staan.
  const klassen = inhoud.enrollment_groups.map((groep) => groep.name).sort();
  if (klassen.length > 0) console.log(`\n  Klassen: ${klassen.join(", ")}`);

  console.log("\nWAT BLIJFT STAAN");
  console.log(`  De inschrijfdag zelf, met naam, datum, locatie en de koppeling met de school.`);
  for (const onderdeel of BLIJFT) {
    const { count } = await supabase
      .from(onderdeel.naam)
      .select("id", { count: "exact", head: true })
      .eq("event_id", dag.id);
    console.log(`  ${String(count ?? 0).padStart(6)}  ${onderdeel.label} (geschiedenis, blijft)`);
  }

  // ---------------------------------------------------------------------------
  // De back-up
  // ---------------------------------------------------------------------------
  const stempel = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const map = path.join(root, "_backup", `inschrijfdag-${dag.slug}-${stempel}`);
  mkdirSync(map, { recursive: true });

  writeFileSync(path.join(map, "enrollment_events.json"), `${JSON.stringify([dag], null, 2)}\n`, "utf8");
  for (const onderdeel of ONDERDELEN) {
    writeFileSync(
      path.join(map, `${onderdeel.naam}.json`),
      `${JSON.stringify(inhoud[onderdeel.naam], null, 2)}\n`,
      "utf8",
    );
  }

  const overzicht = {
    gemaakt: new Date().toISOString(),
    dag: { id: dag.id, naam: dag.name, datum: dag.event_date, school: dag.organizations?.name ?? null },
    aantallen: Object.fromEntries(ONDERDELEN.map((o) => [o.naam, inhoud[o.naam].length])),
    terugzetten:
      "De bestanden staan in de volgorde waarin ze terug moeten: eerst enrollment_groups, dan rounds, workshops, sessions, session_groups, participants en als laatste choices. De ids in de bestanden zijn de originele, dus de onderlinge verwijzingen kloppen nog.",
  };
  writeFileSync(path.join(map, "_overzicht.json"), `${JSON.stringify(overzicht, null, 2)}\n`, "utf8");

  console.log(`\nBack-up geschreven naar:\n  ${map}`);

  if (!wilVerwijderen) {
    console.log("\nEr is niets verwijderd. Klopt bovenstaande dag, draai dan:");
    console.log(`  node scripts/dag-leegmaken.mjs --dag ${dag.id} --verwijder --zeker`);
    return;
  }

  if (!isZeker) {
    console.log("\nEr is niets verwijderd: --zeker ontbreekt.");
    return;
  }

  // ---------------------------------------------------------------------------
  // Verwijderen
  // ---------------------------------------------------------------------------
  console.log("\n" + "=".repeat(72));
  console.log("VERWIJDEREN");
  console.log("=".repeat(72));

  for (const onderdeel of ONDERDELEN) {
    const rijen = inhoud[onderdeel.naam];
    if (rijen.length === 0) {
      console.log(`  ${String(0).padStart(6)}  ${onderdeel.label}`);
      continue;
    }

    // Altijd op id's die we zelf hebben opgehaald bij deze dag. Nooit een
    // delete op een kolom die ook rijen van een andere dag kan raken.
    const ids = rijen.map((rij) => rij.id).filter(Boolean);
    let weg = 0;

    if (ids.length > 0) {
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await supabase.from(onderdeel.naam).delete().in("id", ids.slice(i, i + 200));
        if (error) throw new Error(`${onderdeel.naam}: ${error.message}`);
        weg += ids.slice(i, i + 200).length;
      }
    } else {
      // enrollment_session_groups heeft geen eigen id-kolom.
      const { error } = await supabase
        .from(onderdeel.naam)
        .delete()
        .eq("event_id", dag.id);
      if (error) throw new Error(`${onderdeel.naam}: ${error.message}`);
      weg = rijen.length;
    }

    console.log(`  ${String(weg).padStart(6)}  ${onderdeel.label} verwijderd`);
  }

  // ---------------------------------------------------------------------------
  // Natellen
  // ---------------------------------------------------------------------------
  console.log("\nNATELLEN");
  let allesLeeg = true;
  for (const onderdeel of ONDERDELEN) {
    if (onderdeel.viaDeelnemer) continue;
    const { count } = await supabase
      .from(onderdeel.naam)
      .select(onderdeel.naam === "enrollment_session_groups" ? "session_id" : "id", {
        count: "exact",
        head: true,
      })
      .eq("event_id", dag.id);
    const aantal = count ?? 0;
    if (aantal !== 0) allesLeeg = false;
    console.log(`  ${String(aantal).padStart(6)}  ${onderdeel.label}`);
  }

  const keuzesOver = deelnemerIds.length > 0 ? await telKeuzes(deelnemerIds) : 0;
  if (keuzesOver !== 0) allesLeeg = false;
  console.log(`  ${String(keuzesOver).padStart(6)}  workshopkeuzes`);

  if (!allesLeeg) {
    console.error("\nLET OP: er staat nog iets. Kijk hierboven welke regel niet op 0 staat.");
    process.exitCode = 1;
    return;
  }

  // ---------------------------------------------------------------------------
  // Terug naar concept
  // ---------------------------------------------------------------------------
  const { error: statusFout } = await supabase
    .from("enrollment_events")
    .update({ status: "concept" })
    .eq("id", dag.id);
  if (statusFout) throw new Error(`status: ${statusFout.message}`);

  const { data: na } = await supabase
    .from("enrollment_events")
    .select("name, event_date, status, slug, organizations ( name )")
    .eq("id", dag.id)
    .maybeSingle();

  console.log("\nDE DAG STAAT ER NOG, LEEG EN OP CONCEPT");
  console.log(`  ${na?.name} · ${na?.event_date} · ${na?.organizations?.name ?? "?"} · status ${na?.status}`);
  console.log(`  De link naar de inschrijfpagina blijft: ${na?.slug}`);
  console.log(`\nDe back-up staat in:\n  ${map}`);
}

main().catch((fout) => {
  console.error(`\nFOUT: ${fout.message}`);
  console.error("Er is mogelijk niets of maar een deel verwijderd. De back-up staat in _backup/.");
  process.exitCode = 1;
});
