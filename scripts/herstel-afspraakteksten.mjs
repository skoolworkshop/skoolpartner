/**
 * Haalt de HTML uit de omschrijvingen van de geimporteerde afspraken.
 *
 * ============================================================================
 * WAT ER MIS IS GEGAAN
 * ============================================================================
 *
 * Bij de import zijn de titels van afspraken wel opgeschoond, maar de
 * omschrijvingen niet. Daardoor staat er in crm_meetings.note nu tekst als:
 *
 *   Join link for Google Meet : https://meet.google.com/... <br><b>Wil je
 *   wijzigingen aanbrengen?</b><br><ul><li>Opnieuw plannen:&nbsp;<a href=...
 *
 * Het scherm toont dat inmiddels netjes, want de opschoning gebeurt ook bij het
 * tonen. Maar de rommel staat nog wel in de database, en dat is de plek waar je
 * later zoekt, exporteert en rapporteert.
 *
 * ============================================================================
 * DIT SCRIPT SCHRIJFT ALLEEN ALS JE DAT ZEGT
 * ============================================================================
 *
 *   node scripts/herstel-afspraakteksten.mjs            laat zien wat er zou veranderen
 *   node scripts/herstel-afspraakteksten.mjs --schrijf  voert het uit
 *
 * Het raakt uitsluitend rijen aan die aan alle drie deze voorwaarden voldoen:
 *
 *   1. de afspraak komt uit HubSpot (hubspot_id is gevuld);
 *   2. de omschrijving bevat een HTML-tag of een entiteit;
 *   3. de opgeschoonde tekst is niet leeg.
 *
 * Een afspraak die je zelf hebt ingevoerd, wordt dus nooit aangeraakt. De
 * webadressen blijven in de tekst staan; alleen de opmaak gaat eruit. Wat het
 * scherm ermee doet, is een aparte keuze die je altijd kunt terugdraaien.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
const SCHRIJVEN = process.argv.includes("--schrijf");

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

// Dezelfde opschoonfunctie als het scherm gebruikt. Twee versies van deze regel
// zou betekenen dat de database en het scherm uit elkaar kunnen lopen.
const { platteTekst } = await import(
  pathToFileURL(path.join(root, "src/lib/crm/afspraak-tekst.ts")).href
);

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: afspraken, error } = await supabase
  .from("crm_meetings")
  .select("id, title, note, hubspot_id")
  .not("hubspot_id", "is", null)
  .not("note", "is", null);

if (error) {
  console.error("Kon de afspraken niet lezen:", error.message);
  process.exit(1);
}

const HTML = /<[a-z/!][^>]*>|&(nbsp|amp|lt|gt|quot|#39|apos|euro);/i;

const teDoen = [];
for (const afspraak of afspraken ?? []) {
  if (!HTML.test(afspraak.note)) continue;
  const schoon = platteTekst(afspraak.note);
  if (!schoon || schoon === afspraak.note) continue;
  teDoen.push({ id: afspraak.id, titel: afspraak.title, voor: afspraak.note, na: schoon });
}

console.log("");
console.log("  %d afspraken uit HubSpot met een omschrijving", (afspraken ?? []).length);
console.log("  %d daarvan bevatten HTML en worden opgeschoond", teDoen.length);
console.log("");

const map = path.join(root, ".hubspot-import");
mkdirSync(map, { recursive: true });
writeFileSync(path.join(map, "afspraakteksten.json"), JSON.stringify(teDoen, null, 2), "utf8");
console.log("  Het volledige voor en na staat in .hubspot-import/afspraakteksten.json");

for (const rij of teDoen.slice(0, 3)) {
  console.log("");
  console.log("  %s", rij.titel);
  console.log("    voor: %s", rij.voor.replace(/\s+/g, " ").slice(0, 120));
  console.log("    na:   %s", rij.na.replace(/\s+/g, " ").slice(0, 120));
}

if (!SCHRIJVEN) {
  console.log("");
  console.log("  Proefdraai: er is niets veranderd. Draai met --schrijf als dit klopt.");
  console.log("");
  process.exit(0);
}

console.log("");
let gedaan = 0;
for (const rij of teDoen) {
  const { error: schrijfFout } = await supabase
    .from("crm_meetings")
    .update({ note: rij.na })
    .eq("id", rij.id);
  if (schrijfFout) {
    console.error("  FOUT bij %s: %s", rij.titel, schrijfFout.message);
    process.exitCode = 1;
    break;
  }
  gedaan += 1;
  process.stdout.write(`\r  ${gedaan} / ${teDoen.length}`);
}

console.log("");
console.log("  Klaar. De oorspronkelijke teksten staan nog in het JSON-bestand hierboven.");
console.log("");
