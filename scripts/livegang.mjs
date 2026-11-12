#!/usr/bin/env node
/**
 * Livegang: back-up, controles, migraties, publiceren. In die volgorde.
 *
 *   npm run livegang
 *
 * WAAROM DIT EEN SCRIPT IS
 *
 *   De stappen horen in een vaste volgorde, en elke stap mag alleen als de
 *   vorige is gelukt: eerst een verse back-up, dan nakijken of de database er
 *   klaar voor is, dan pas de migraties, en pas als die erin staan de nieuwe
 *   code. Met de hand gaat dat goed tot het een keer niet goed gaat.
 *
 * WAT HET DOET
 *
 *   1. Kijkt of de werkmap schoon is en op main staat.
 *   2. Maakt een verse back-up en controleert dat die er echt staat.
 *   3. Kijkt of er iets in de database staat dat een migratie zou tegenhouden.
 *   4. Laat zien welke migraties er klaarstaan, en stopt als dat andere zijn
 *      dan verwacht.
 *   5. Voert de migraties uit. De Supabase-CLI vraagt daar zelf nog om een
 *      bevestiging.
 *   6. Controleert dat ze erin staan.
 *   7. Zet de commits op GitHub. Vercel publiceert daarna vanzelf.
 *
 * WAT HET NIET DOET
 *
 *   Het verwijdert niets, en het raakt geen gegevens aan. Gaat een stap mis,
 *   dan stopt het daar en staat er wat er aan de hand is. Opnieuw draaien mag
 *   altijd: wat al gedaan is, wordt overgeslagen.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
const VERWACHT = ["20261112120000", "20261112130000"];
const VORIGE = "20261110120000";

function kop(tekst) {
  console.log(`\n── ${tekst} ${"─".repeat(Math.max(4, 68 - tekst.length))}`);
}

function stop(tekst) {
  console.error(`\n  GESTOPT: ${tekst}\n  Er is vanaf dit punt niets meer gewijzigd.\n`);
  process.exit(1);
}

function draai(opdracht, { tonen = true } = {}) {
  const uitkomst = spawnSync(opdracht, {
    cwd: root,
    shell: true,
    encoding: "utf8",
    stdio: tonen ? "inherit" : ["inherit", "pipe", "pipe"],
  });
  return {
    code: uitkomst.status ?? 1,
    uit: `${uitkomst.stdout ?? ""}${uitkomst.stderr ?? ""}`,
  };
}

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

/** Welke migraties staan lokaal klaar en nog niet in de database? */
function openstaand(cli) {
  const { code, uit } = draai(`${cli} migration list`, { tonen: false });
  if (code !== 0) return { ok: false, mislukt: true, uit };

  const lokaal = new Set();
  const opDeDatabase = new Set();
  for (const regel of uit.split(/\r?\n/)) {
    const delen = regel.split(/[│|]/).map((deel) => deel.trim());
    if (delen.length < 2) continue;
    if (/^\d{14}$/.test(delen[0])) lokaal.add(delen[0]);
    if (/^\d{14}$/.test(delen[1])) opDeDatabase.add(delen[1]);
  }
  if (lokaal.size === 0) return { ok: false, uit };

  return {
    ok: true,
    uit,
    opDeDatabase,
    wachtend: [...lokaal].filter((versie) => !opDeDatabase.has(versie)).sort(),
    alleenOpDatabase: [...opDeDatabase].filter((versie) => !lokaal.has(versie)).sort(),
  };
}

// ---------------------------------------------------------------------------
// 1. De werkmap
// ---------------------------------------------------------------------------
kop("1. Werkmap");

const tak = draai("git rev-parse --abbrev-ref HEAD", { tonen: false }).uit.trim();
if (tak !== "main") stop(`de werkmap staat op "${tak}", niet op main.`);

const vuil = draai("git status --porcelain", { tonen: false }).uit.trim();
if (vuil) stop(`er staan wijzigingen die niet zijn vastgelegd:\n${vuil}`);

for (const versie of VERWACHT) {
  const bestand = readdirSync(path.join(root, "supabase", "migrations")).find((naam) => naam.startsWith(versie));
  if (!bestand) stop(`migratie ${versie} staat niet in supabase/migrations.`);
}
console.log("  Op main, niets openstaand, beide migraties aanwezig.");

// ---------------------------------------------------------------------------
// 2. De back-up
// ---------------------------------------------------------------------------
kop("2. Verse back-up");

if (draai("node scripts/backup-data.mjs").code !== 0) stop("de back-up is niet gelukt.");

const mappen = existsSync(path.join(root, "_backup"))
  ? readdirSync(path.join(root, "_backup")).filter((naam) => /^data-\d{4}-\d{2}-\d{2}$/.test(naam)).sort()
  : [];
const nieuwste = mappen.at(-1);
if (!nieuwste) stop("er is geen back-upmap gevonden in _backup.");

let overzicht;
try {
  overzicht = JSON.parse(readFileSync(path.join(root, "_backup", nieuwste, "_overzicht.json"), "utf8"));
} catch {
  stop(`het overzicht van de back-up in _backup/${nieuwste} is niet te lezen.`);
}

const leeftijd = Date.now() - new Date(overzicht.gemaakt).getTime();
if (!(leeftijd >= 0 && leeftijd < 10 * 60 * 1000)) {
  stop(`de nieuwste back-up (_backup/${nieuwste}) is niet van zojuist.`);
}
const rijen = overzicht.tabellen.reduce((totaal, tabel) => totaal + (tabel.rijen ?? 0), 0);
const ontbreekt = overzicht.tabellen.filter((tabel) => !existsSync(path.join(root, "_backup", nieuwste, `${tabel.tabel}.json`)));
if (ontbreekt.length > 0) stop(`in de back-up ontbreken bestanden: ${ontbreekt.map((t) => t.tabel).join(", ")}`);
console.log(`  Gecontroleerd: ${rijen} rijen uit ${overzicht.tabellen.length} tabellen in _backup/${nieuwste}.`);

// ---------------------------------------------------------------------------
// 3. Staat er iets in de weg?
// ---------------------------------------------------------------------------
kop("3. Controle vooraf");

const env = leesEnv();
const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const sleutel = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !sleutel) stop("NEXT_PUBLIC_SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY moeten in .env.local staan.");

const supabase = createClient(url, sleutel, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: gekoppeld, error: koppelFout } = await supabase
  .from("organization_contacts")
  .select("moneybird_contact_id")
  .not("moneybird_contact_id", "is", null);
if (koppelFout) stop(`de contactpersonen zijn niet te lezen: ${koppelFout.message}`);

const perContact = new Map();
for (const rij of gekoppeld ?? []) {
  perContact.set(rij.moneybird_contact_id, (perContact.get(rij.moneybird_contact_id) ?? 0) + 1);
}
const dubbelContact = [...perContact.entries()].filter(([, aantal]) => aantal > 1).map(([contact]) => contact);
if (dubbelContact.length > 0) {
  stop(`deze Moneybird-contacten staan bij meer dan één locatie: ${dubbelContact.join(", ")}. Migratie 044 zou weigeren.`);
}
console.log(`  Moneybird-koppelingen: ${(gekoppeld ?? []).length}, geen enkel contact bij twee locaties.`);

const { data: toekenningen, error: toekenFout } = await supabase
  .from("loyalty_transactions")
  .select("organization_id, type, external_reference")
  .not("external_reference", "is", null)
  .order("id")
  .limit(10000);
if (toekenFout) stop(`de puntenregels zijn niet te lezen: ${toekenFout.message}`);

const perBron = new Map();
for (const rij of toekenningen ?? []) {
  const bron = `${rij.organization_id}|${rij.type}|${rij.external_reference}`;
  perBron.set(bron, (perBron.get(bron) ?? 0) + 1);
}
const dubbelBron = [...perBron.values()].filter((aantal) => aantal > 1).length;
if (dubbelBron > 0) {
  stop(`${dubbelBron} toekenning(en) staan dubbel binnen één locatie. Migratie 045 zou weigeren.`);
}
console.log(`  Puntentoekenningen: ${(toekenningen ?? []).length}, geen enkele dubbel binnen één locatie.`);

// ---------------------------------------------------------------------------
// 4. Welke migraties staan klaar?
// ---------------------------------------------------------------------------
kop("4. Migratiestatus");

const cli = draai("supabase --version", { tonen: false }).code === 0 ? "supabase" : "npx supabase";
let stand = openstaand(cli);
if (stand.mislukt) {
  console.log(stand.uit);
  stop("de migratiestatus is niet op te vragen. Kijk of de Supabase-CLI is ingelogd en gekoppeld (supabase link).");
}

if (!stand.ok) {
  // De lijst kwam wel, maar in een vorm die dit script niet herkent. Dan laten
  // we hem zien en beslist de mens: de CLI toont bij het uitvoeren zelf ook
  // nog welke migraties hij gaat draaien.
  console.log(stand.uit);
  console.log("  Deze lijst is niet automatisch te lezen. Ga hieronder alleen door als de CLI");
  console.log(`  precies deze twee migraties noemt: ${VERWACHT.join(" en ")}.`);
  stand = { ok: false, wachtend: VERWACHT };
} else {
  if (!stand.opDeDatabase.has(VORIGE)) {
    stop(`migratie ${VORIGE} (043) staat niet in de database. Dat hoort eerst te kloppen.`);
  }
  if (stand.alleenOpDatabase.length > 0) {
    stop(`in de database staan migraties die hier niet in de map staan: ${stand.alleenOpDatabase.join(", ")}.`);
  }
  const onverwacht = stand.wachtend.filter((versie) => !VERWACHT.includes(versie));
  if (onverwacht.length > 0) {
    stop(`er staan andere migraties klaar dan 044 en 045: ${onverwacht.join(", ")}.`);
  }
  console.log("  043 staat in de database.");
}

if (stand.wachtend.length === 0) {
  console.log("  044 en 045 staan er ook al in. Niets uit te voeren.");
} else {
  console.log(`  Klaar om uit te voeren: ${stand.wachtend.join(" en ")}.`);

  // -------------------------------------------------------------------------
  // 5. Uitvoeren
  // -------------------------------------------------------------------------
  kop("5. Migraties uitvoeren");
  console.log("  De Supabase-CLI vraagt hieronder om een bevestiging. Antwoord met Y.\n");
  if (draai(`${cli} db push`).code !== 0) {
    stop("de migraties zijn niet (volledig) uitgevoerd. Elke migratie is één geheel: wat mislukte, is teruggedraaid.");
  }
}

// ---------------------------------------------------------------------------
// 6. Staan ze erin?
// ---------------------------------------------------------------------------
kop("6. Controle achteraf");

stand = openstaand(cli);
if (stand.ok && stand.wachtend.length > 0) {
  stop(`niet alle migraties staan in de database: ${stand.wachtend.join(", ")} wacht nog.`);
}

const { error: perPersoon } = await supabase.from("loyalty_balances").select("user_id").limit(1);
const { error: perLocatie } = await supabase.from("loyalty_balances").select("organization_id").limit(1);
if (perLocatie || !perPersoon) {
  stop("de saldoweergave rekent nog niet per locatie, terwijl migratie 045 wel als uitgevoerd staat.");
}
console.log("  044 en 045 staan in de database. Het saldo rekent per schoollocatie.");

// ---------------------------------------------------------------------------
// 7. Publiceren
// ---------------------------------------------------------------------------
kop("7. Naar GitHub");

if (draai("git push origin main").code !== 0) {
  stop("pushen naar GitHub is niet gelukt. De database is al wel bijgewerkt; draai dit script gerust opnieuw.");
}

console.log(`
  Klaar. De migraties staan erin en de code staat op GitHub.
  Vercel publiceert nu vanzelf; dat duurt een paar minuten.

  Zeg tegen Claude: "livegang klaar".
`);
