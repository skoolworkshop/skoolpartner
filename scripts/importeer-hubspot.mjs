/**
 * Haalt contacten, deals en afspraken uit HubSpot en zet ze in SkoolPartner.
 *
 * ============================================================================
 * DIT SCRIPT SCHRIJFT NIETS TENZIJ JE DAT ZEGT
 * ============================================================================
 *
 *   node scripts/importeer-hubspot.mjs              proefdraaien, alleen lezen
 *   node scripts/importeer-hubspot.mjs --schrijf    daadwerkelijk wegschrijven
 *
 * Zonder --schrijf gebeurt er niets in de database. Het script haalt dan wel
 * alles op, doet de volledige omzetting en schrijft het plan naar
 * .hubspot-import/plan.json plus een leesbare samenvatting op het scherm. Dat
 * plan is bedoeld om te lezen voordat je de tweede keer draait.
 *
 * Extra schakelaars:
 *   --evaluaties=laten   laat de oude evaluatiedeals open staan in plaats van
 *                        ze op Afgerond te zetten.
 *   --zzp=overslaan      laat de ZZP-ers in HubSpot achter. Let op: daarmee
 *                        blijven ook hun 38 afspraken daar.
 *   --max=50             stop na dit aantal records per soort. Handig om eerst
 *                        een kleine partij te bekijken.
 *
 * ============================================================================
 * WAT ER NODIG IS
 * ============================================================================
 *
 * In .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL       of SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY      de sleutel die langs RLS mag
 *   HUBSPOT_PRIVATE_APP_TOKEN      een private app met leesrechten op
 *                                  contacten, deals en engagements
 *
 * De HubSpot-sleutel wordt alleen hier gebruikt, in een script dat je zelf
 * start. Hij komt niet in de applicatie, niet in de browser en niet in een
 * omgevingsvariabele die met NEXT_PUBLIC begint.
 *
 * ============================================================================
 * HERHAALBAAR
 * ============================================================================
 *
 * Elke rij krijgt zijn HubSpot-nummer mee in hubspot_id. Twee keer draaien
 * werkt de bestaande rij bij in plaats van er een tweede naast te zetten. De
 * unieke index in migratie 037 bewaakt dat in de database zelf, dus ook als
 * dit script een fout zou bevatten.
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
const args = process.argv.slice(2);
const SCHRIJVEN = args.includes("--schrijf");
const EVALUATIES = args.includes("--evaluaties=laten") ? "laten" : "sluiten";
const MAX = Number(args.find((a) => a.startsWith("--max="))?.split("=")[1] ?? 0) || Infinity;
// ZZP-ers komen mee als leverancier. Met --zzp=overslaan blijven ze in HubSpot,
// en dan blijven hun afspraken daar ook.
const ZZP = args.includes("--zzp=overslaan") ? "overslaan" : "leverancier";

/* -------------------------------------------------------------------------- */
/* Omgeving                                                                    */
/* -------------------------------------------------------------------------- */

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
const HUBSPOT_TOKEN = env.HUBSPOT_PRIVATE_APP_TOKEN;

for (const [naam, waarde] of [
  ["NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL],
  ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY],
  ["HUBSPOT_PRIVATE_APP_TOKEN", HUBSPOT_TOKEN],
]) {
  if (!waarde) {
    console.error(`Ontbrekende instelling: ${naam}. Zet hem in .env.local en probeer opnieuw.`);
    process.exit(1);
  }
}

/* -------------------------------------------------------------------------- */
/* De omzetting binnenhalen                                                    */
/* -------------------------------------------------------------------------- */
// De regels staan in TypeScript zodat ze getest kunnen worden. Hier bundelen
// wij dat bestand even, in plaats van de logica een tweede keer te schrijven.
// Twee versies van dezelfde beslissing is precies hoe een import misgaat.

const cache = path.join(root, ".hubspot-import");
mkdirSync(cache, { recursive: true });

/*
  Twee wegen naar hetzelfde bestand.

  Node kan sinds versie 22.18 zelf de types uit een .ts-bestand halen, en dan
  is een import genoeg. Kan het dat niet, dan bundelen wij het alsnog met
  esbuild. Die tweede weg werkt niet in elke omgeving: node_modules die op
  Windows is geinstalleerd bevat de Windows-versie van esbuild, en dezelfde map
  vanuit een Linux-schil gebruiken loopt daarop stuk. Vandaar de volgorde.
*/
let omzetting;
/* Als esbuild eraan te pas komt, start dat een apart proces dat later weer uit
   moet; zie ruimOp hieronder. */
let stopEsbuild = null;
try {
  omzetting = await import(pathToFileURL(path.join(root, "src/lib/crm/hubspot-import.ts")).href);
} catch (eersteFout) {
  try {
    const esbuild = await import("esbuild");
    const { build } = esbuild;
    stopEsbuild = esbuild.stop ?? null;
    await build({
      entryPoints: [path.join(root, "src/lib/crm/hubspot-import.ts")],
      bundle: true,
      format: "cjs",
      platform: "node",
      target: "node20",
      outfile: path.join(cache, "omzetting.cjs"),
      tsconfig: path.join(root, "tsconfig.json"),
    });
    omzetting = createRequire(import.meta.url)(path.join(cache, "omzetting.cjs"));
  } catch (tweedeFout) {
    console.error("Kon de omzetregels niet laden.");
    console.error("  Rechtstreeks inlezen:", eersteFout.message);
    console.error("  Via esbuild:", tweedeFout.message);
    process.exit(1);
  }
}

/* -------------------------------------------------------------------------- */
/* HubSpot lezen                                                               */
/* -------------------------------------------------------------------------- */

async function haalOp(soort, eigenschappen, associatie) {
  const rijen = [];
  let na = null;

  do {
    const url = new URL(`https://api.hubapi.com/crm/v3/objects/${soort}`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("properties", eigenschappen.join(","));
    if (associatie) url.searchParams.set("associations", associatie);
    if (na) url.searchParams.set("after", na);

    const antwoord = await fetch(url, {
      headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
    });

    if (!antwoord.ok) {
      throw new Error(`HubSpot gaf ${antwoord.status} bij ${soort}: ${await antwoord.text()}`);
    }

    const body = await antwoord.json();
    for (const record of body.results ?? []) {
      rijen.push({
        id: String(record.id),
        ...record.properties,
        contactIds: (record.associations?.contacts?.results ?? []).map((r) => String(r.id)),
      });
    }
    na = body.paging?.next?.after ?? null;
    process.stdout.write(`\r${soort}: ${rijen.length} opgehaald`);
  } while (na && rijen.length < MAX);

  process.stdout.write("\n");
  return rijen.slice(0, MAX === Infinity ? undefined : MAX);
}

/* -------------------------------------------------------------------------- */
/* Ophalen en omzetten                                                         */
/* -------------------------------------------------------------------------- */

const nu = new Date();
const opties = { nu, oudeEvaluaties: EVALUATIES };

const bronContacten = await haalOp(
  "contacts",
  [
    "firstname", "lastname", "email", "phone", "mobilephone", "jobtitle", "city",
    "lifecyclestage", "hs_email_optout", "createdate", "notes_last_contacted",
  ],
  null
);

const bronDeals = await haalOp(
  "deals",
  ["dealname", "dealstage", "amount", "closedate", "createdate", "hs_lastmodifieddate", "description"],
  "contacts"
);

const bronAfspraken = await haalOp(
  "meetings",
  [
    "hs_meeting_title", "hs_meeting_body", "hs_meeting_location",
    "hs_meeting_start_time", "hs_meeting_end_time", "hs_meeting_outcome",
  ],
  "contacts"
);

const bronNotities = await haalOp("notes", ["hs_note_body", "hs_timestamp"], "contacts");

const contactUitkomsten = bronContacten.map((r) => omzetting.leesContact(r, { zzp: ZZP }));
const { uniek: contacten, dubbel } = omzetting.ontdubbelContacten(
  contactUitkomsten.filter((u) => u.ok).map((u) => u.rij)
);

const dealUitkomsten = bronDeals.map((r) => omzetting.leesDeal(r, opties));
const deals = dealUitkomsten.filter((u) => u.ok).map((u) => u.rij);

const afspraakUitkomsten = bronAfspraken.map((r) => omzetting.leesAfspraak(r, nu));
const afspraken = afspraakUitkomsten.filter((u) => u.ok).map((u) => u.rij);

const notitieUitkomsten = bronNotities.map((r) => omzetting.leesNotitie(r));
const notities = notitieUitkomsten.filter((u) => u.ok).map((u) => u.rij);

/* -------------------------------------------------------------------------- */
/* Koppelen, tellen en verantwoorden                                           */
/* -------------------------------------------------------------------------- */

/*
  ELK RECORD KRIJGT ZIJN CONTACT, EN ANDERS EEN REDEN

  Een deal, afspraak of notitie hangt in SkoolPartner aan een contact. HubSpot
  koppelt er soms meerdere; wij nemen de eerste die ook echt meekomt, niet
  simpelweg de eerste uit de lijst. Blijft er geen enkele over, dan telt dat als
  een eigen uitsluitreden en niet als een stil verlies.
*/
const bekend = new Set(contacten.map((c) => c.hubspot_id));

function koppel(rijen, uitkomsten) {
  const mee = [];
  const zonder = [];
  for (const rij of rijen) {
    const gekozen = omzetting.kiesContact(rij.contact_hubspot_ids, bekend);
    if (gekozen) mee.push({ ...rij, contact_hubspot_id: gekozen });
    else zonder.push(rij);
  }
  const redenen = omzetting.tellRedenen(uitkomsten);
  if (zonder.length) {
    redenen.push({ reden: "gekoppeld contact komt zelf niet mee", aantal: zonder.length });
  }
  return { mee, zonder, redenen };
}

const dealsGekoppeld = koppel(deals, dealUitkomsten);
const afsprakenGekoppeld = koppel(afspraken, afspraakUitkomsten);
const notitiesGekoppeld = koppel(notities, notitieUitkomsten);

// Deze drie zijn vanaf hier de enige lijsten die nog worden gebruikt. Er is
// geen tweede telling meer die iets anders kan beweren.
const dealsMee = dealsGekoppeld.mee;
const afsprakenMee = afsprakenGekoppeld.mee;
const notitiesMee = notitiesGekoppeld.mee;

// De fases worden geteld over wat er daadwerkelijk in gaat.
const perFase = {};
for (const deal of dealsMee) perFase[deal.stage_key] = (perFase[deal.stage_key] ?? 0) + 1;

/*
  WAT HANGT ER AAN EEN CONTACT DAT NIET MEEKOMT

  Zonder dit blijft een uitsluiting een getal. Met dit weet je of er iets
  waardevols achterblijft, en dat is precies de vraag die telt.
*/
const heeftDeal = new Set();
for (const d of bronDeals) for (const id of d.contactIds ?? []) heeftDeal.add(String(id));
const heeftAfspraak = new Set();
for (const a of bronAfspraken) for (const id of a.contactIds ?? []) heeftAfspraak.add(String(id));
const heeftNotitie = new Set();
for (const n of bronNotities) for (const id of n.contactIds ?? []) heeftNotitie.add(String(id));

const uitgeslotenContacten = [];
bronContacten.forEach((bron, i) => {
  const uitkomst = contactUitkomsten[i];
  if (uitkomst.ok) return;
  const id = String(bron.id);
  uitgeslotenContacten.push({
    hubspot_id: id,
    reden: uitkomst.reden,
    heeftEmail: Boolean(omzetting.leesEmail(bron.email)),
    heeftTelefoon: Boolean(omzetting.leesTelefoon(bron.phone) ?? omzetting.leesTelefoon(bron.mobilephone)),
    heeftDeal: heeftDeal.has(id),
    heeftAfspraak: heeftAfspraak.has(id),
    heeftNotitie: heeftNotitie.has(id),
  });
});

const metHistorie = uitgeslotenContacten.filter(
  (c) => c.heeftDeal || c.heeftAfspraak || c.heeftNotitie
);

// Hoeveel contacten dragen hun e-mailadres als naam, omdat er geen naam was.
const naamUitEmail = contactUitkomsten.filter((u) => u.ok && u.naamUitEmail).length;

// Deals die aan meer dan een contact hangen. Daar kiest het script er een van,
// en dat is precies het soort keuze dat je wilt kunnen nakijken.
const meerdereContacten = deals.filter((d) => d.contact_hubspot_ids.length > 1);

const tellingen = [
  omzetting.maakTelling("contacten", bronContacten.length, contacten.length, [
    ...omzetting.tellRedenen(contactUitkomsten),
    ...(dubbel.length ? [{ reden: "dubbel op e-mailadres, samengevoegd", aantal: dubbel.length }] : []),
  ]),
  omzetting.maakTelling("deals", bronDeals.length, dealsMee.length, dealsGekoppeld.redenen),
  omzetting.maakTelling("afspraken", bronAfspraken.length, afsprakenMee.length, afsprakenGekoppeld.redenen),
  omzetting.maakTelling("notities", bronNotities.length, notitiesMee.length, notitiesGekoppeld.redenen),
];

const plan = {
  gedraaidOp: nu.toISOString(),
  keuzes: { oudeEvaluaties: EVALUATIES, zzp: ZZP, schrijven: SCHRIJVEN },
  tellingen,
  perFase,
  contacten: {
    naamUitEmailadres: naamUitEmail,
    samengevoegdOpAdres: dubbel,
    uitgeslotenMetHistorie: metHistorie,
  },
  koppelingen: {
    dealsMetMeerdereContacten: meerdereContacten.length,
    voorbeelden: meerdereContacten.slice(0, 20).map((d) => ({
      hubspot_id: d.hubspot_id,
      title: d.title,
      contacten: d.contact_hubspot_ids,
      gekozen: omzetting.kiesContact(d.contact_hubspot_ids, bekend),
    })),
  },
};

writeFileSync(path.join(cache, "plan.json"), JSON.stringify(plan, null, 2), "utf8");

// Puntkomma's, aanhalingstekens en regeleindes komen in dealnamen echt voor.
// Zonder aanhalingstekens eromheen schuift een tabel dan een kolom op, en dan
// klopt precies het bestand niet dat je gebruikt om te controleren.
function veld(waarde) {
  const tekst = String(waarde ?? "");
  return /[";\r\n]/.test(tekst) ? `"${tekst.replace(/"/g, '""')}"` : tekst;
}

function csv(rijen) {
  if (!rijen.length) return "";
  const kolommen = Object.keys(rijen[0]);
  const regels = [kolommen.join(";")];
  for (const rij of rijen) regels.push(kolommen.map((k) => veld(rij[k])).join(";"));
  return regels.join("\r\n");
}

writeFileSync(path.join(cache, "uitgesloten-contacten.csv"), csv(uitgeslotenContacten), "utf8");

/*
  DE UITGESLOTEN RECORDS, MET NAAM EN TOENAAM

  De eerste versie schreef hier alleen de records waarvan het contact niet
  meekwam. Zodra dat was opgelost bleven de bestanden leeg, terwijl er nog
  steeds elf deals afvielen om een andere reden. Een leeg bestand naast een
  rapport dat elf uitsluitingen meldt, is erger dan geen bestand: het suggereert
  dat er niets te zien is.

  Nu staat elk record dat niet meekomt erin, met de reden erbij, ongeacht waar
  in de omzetting het is afgevallen.
*/
function uitgeslotenLijst(bron, uitkomsten, velden) {
  const rijen = [];
  bron.forEach((record, i) => {
    const uitkomst = uitkomsten[i];
    if (uitkomst.ok) return;
    rijen.push({ hubspot_id: String(record.id), reden: uitkomst.reden, ...velden(record) });
  });
  return rijen;
}

const uitgeslotenDeals = [
  ...uitgeslotenLijst(bronDeals, dealUitkomsten, (d) => ({
    titel: omzetting.schoon(omzetting.naarPlatteTekst(d.dealname)),
    fase: omzetting.HUBSPOT_FASES[omzetting.schoon(d.dealstage)]?.label ?? omzetting.schoon(d.dealstage),
    bedrag: omzetting.leesBedrag(d.amount) / 100,
    sluitdatum: omzetting.leesMoment(d.closedate)?.slice(0, 10) ?? "",
  })),
  ...dealsGekoppeld.zonder.map((d) => ({
    hubspot_id: d.hubspot_id,
    reden: "gekoppeld contact komt zelf niet mee",
    titel: d.title,
    fase: d.stage_key,
    bedrag: d.value_cents / 100,
    sluitdatum: d.expected_date ?? "",
  })),
];

const uitgeslotenAfspraken = [
  ...uitgeslotenLijst(bronAfspraken, afspraakUitkomsten, (a) => ({
    titel: omzetting.schoon(omzetting.naarPlatteTekst(a.hs_meeting_title)),
    start: omzetting.leesMoment(a.hs_meeting_start_time) ?? "",
  })),
  ...afsprakenGekoppeld.zonder.map((a) => ({
    hubspot_id: a.hubspot_id,
    reden: "gekoppeld contact komt zelf niet mee",
    titel: a.title,
    start: a.starts_at,
  })),
];

const uitgeslotenNotities = [
  ...uitgeslotenLijst(bronNotities, notitieUitkomsten, (n) => ({
    tekst: omzetting.samenvatting(omzetting.naarPlatteTekst(n.hs_note_body)),
    wanneer: omzetting.leesMoment(n.hs_timestamp) ?? "",
  })),
  ...notitiesGekoppeld.zonder.map((n) => ({
    hubspot_id: n.hubspot_id,
    reden: "gekoppeld contact komt zelf niet mee",
    tekst: n.summary,
    wanneer: n.occurred_at,
  })),
];

writeFileSync(path.join(cache, "uitgesloten-deals.csv"), csv(uitgeslotenDeals), "utf8");
writeFileSync(path.join(cache, "uitgesloten-afspraken.csv"), csv(uitgeslotenAfspraken), "utf8");
writeFileSync(path.join(cache, "uitgesloten-notities.csv"), csv(uitgeslotenNotities), "utf8");

/* -------------------------------------------------------------------------- */
/* Op het scherm                                                               */
/* -------------------------------------------------------------------------- */

console.log("");
console.log("  soort        in HubSpot   gaat mee   valt af");
console.log("  ---------------------------------------------");
for (const t of tellingen) {
  console.log(
    "  %s %s %s %s %s",
    t.soort.padEnd(12),
    String(t.inHubSpot).padStart(10),
    String(t.geimporteerd).padStart(10),
    String(t.uitgesloten).padStart(9),
    t.klopt ? "" : "  TELLING KLOPT NIET"
  );
  for (const r of t.redenen) console.log("      %s %s", String(r.aantal).padStart(6), r.reden);
}

console.log("");
console.log("  Deals per fase, geteld over wat er in gaat:");
for (const [fase, aantal] of Object.entries(perFase).sort((a, b) => b[1] - a[1])) {
  console.log("      %s %s", String(aantal).padStart(6), fase);
}
console.log("      %s TOTAAL", String(Object.values(perFase).reduce((a, b) => a + b, 0)).padStart(6));

console.log("");
console.log("  %d contacten dragen hun e-mailadres als naam, omdat HubSpot er geen had.", naamUitEmail);
console.log("  %d uitgesloten contacten hebben toch een deal, afspraak of notitie.", metHistorie.length);
console.log("  %d deals hangen aan meer dan een contact; er wordt er een gekozen.", meerdereContacten.length);

const sluitNiet = tellingen.filter((t) => !t.klopt);
if (sluitNiet.length) {
  console.log("");
  console.log("  LET OP: de telling van %s sluit niet. Niet importeren.", sluitNiet.map((t) => t.soort).join(", "));
}

console.log("");
console.log("Plan geschreven naar .hubspot-import/plan.json");

/*
  Afsluiten zonder process.exit.

  Dat trekt het proces onderuit terwijl de verbindingen van supabase-js en het
  losse proces van esbuild nog openstaan, en op Windows valt libuv daarover met
  "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)". Dat gebeurt nadat al
  het werk klaar is, dus het zegt niets over de gegevens, maar het ziet er
  alarmerend uit en dat hoort niet aan het eind van een geslaagde draai.
*/
async function ruimOp() {
  if (stopEsbuild) {
    try {
      await stopEsbuild();
    } catch {
      // Al gestopt, of nooit gestart.
    }
  }
}

if (!SCHRIJVEN) {
  console.log("Proefdraai: er is niets in de database veranderd. Draai met --schrijf als dit klopt.");
  await ruimOp();
  process.exitCode = 0;
} else {

/* -------------------------------------------------------------------------- */
/* Wegschrijven                                                                */
/* -------------------------------------------------------------------------- */

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// De fases van Skool Workshop. Een deal zonder geldige fase wordt niet
// geschreven; die stille aanname wil je hier niet.
const { data: fases, error: faseFout } = await supabase
  .from("crm_pipeline_stages")
  .select("id, key")
  .eq("brand", "skool_workshop");

if (faseFout) {
  console.error("Kon de pijplijnfases niet lezen:", faseFout.message);
  process.exit(1);
}
const faseId = new Map(fases.map((f) => [f.key, f.id]));

async function inStukken(rijen, omvang, doe) {
  for (let i = 0; i < rijen.length; i += omvang) {
    const stuk = rijen.slice(i, i + omvang);
    await doe(stuk);
    process.stdout.write(`\r  ${Math.min(i + omvang, rijen.length)} / ${rijen.length}`);
  }
  process.stdout.write("\n");
}

/*
  Eerst kijken wie er al staat.

  Een contact dat in SkoolPartner al bestaat, is hier het gevoeligste geval.
  Blind invoegen loopt stuk op de unieke index op het e-mailadres, en blind
  bijwerken zou een met de hand ingevoerd contact overschrijven met oudere
  gegevens uit HubSpot. Geen van beide is goed.

  Wat er wel gebeurt: de bestaande rij blijft zoals hij is en krijgt alleen
  zijn HubSpot-nummer erbij, zodat de deals en afspraken eraan kunnen hangen.
  Wat al goed staat, blijft goed staan.
*/
console.log("Kijken wie er al in SkoolPartner staat...");
// De hele tabel in een keer, in stukken van duizend. Dat kan, want het CRM is
// nog jong. Vergelijken op het adres in kleine letters, want "Anne@school.nl"
// en "anne@school.nl" zijn dezelfde persoon en een in-filter op de database
// zou dat onderscheid wel maken.
const bestaandOpEmail = new Map();
for (let van = 0; ; van += 1000) {
  const { data, error } = await supabase
    .from("crm_contacts")
    .select("id, email, hubspot_id, organization_id")
    .range(van, van + 999);
  if (error) throw new Error(`bestaande contacten lezen: ${error.message}`);
  for (const rij of data ?? []) if (rij.email) bestaandOpEmail.set(rij.email.toLowerCase(), rij);
  if (!data || data.length < 1000) break;
}

const nieuw = [];
const bijwerken = [];
const botsingen = [];
const contactId = new Map();

for (const contact of contacten) {
  const bestaand = contact.email ? bestaandOpEmail.get(contact.email) : null;
  if (!bestaand) {
    nieuw.push(contact);
    continue;
  }
  if (bestaand.hubspot_id && bestaand.hubspot_id !== contact.hubspot_id) {
    botsingen.push({ email: contact.email, inSkoolPartner: bestaand.hubspot_id, inHubSpot: contact.hubspot_id });
    continue;
  }
  contactId.set(contact.hubspot_id, bestaand);
  if (!bestaand.hubspot_id) bijwerken.push({ id: bestaand.id, hubspot_id: contact.hubspot_id });
}

console.log("  %d nieuw, %d bestaan al, %d botsingen", nieuw.length, bijwerken.length, botsingen.length);
if (botsingen.length) {
  console.log("  Botsingen staan in .hubspot-import/botsingen.json en zijn overgeslagen.");
  writeFileSync(path.join(cache, "botsingen.json"), JSON.stringify(botsingen, null, 2), "utf8");
}

console.log("Bestaande contacten hun HubSpot-nummer geven...");
for (const rij of bijwerken) {
  const { error } = await supabase
    .from("crm_contacts")
    .update({ hubspot_id: rij.hubspot_id })
    .eq("id", rij.id);
  if (error) throw new Error(`nummer koppelen: ${error.message}`);
}

console.log("Nieuwe contacten wegschrijven...");
await inStukken(nieuw, 200, async (stuk) => {
  const { data, error } = await supabase
    .from("crm_contacts")
    .upsert(stuk, { onConflict: "hubspot_id" })
    .select("id, hubspot_id, organization_id");
  if (error) throw new Error(`contacten: ${error.message}`);
  for (const rij of data ?? []) contactId.set(rij.hubspot_id, rij);
});

console.log("Deals wegschrijven...");
const dealRijen = dealsMee
  .filter((d) => contactId.has(d.contact_hubspot_id) && faseId.has(d.stage_key))
  .map((d) => {
    const contact = contactId.get(d.contact_hubspot_id);
    return {
      hubspot_id: d.hubspot_id,
      brand: "skool_workshop",
      title: d.title,
      stage_id: faseId.get(d.stage_key),
      stage_since: d.stage_since,
      contact_id: contact.id,
      // Alleen als het contact al aan een school hangt. Nooit raden op een
      // domeinnaam: bedrijven gaan in deze ronde niet mee.
      organization_id: contact.organization_id ?? null,
      value_cents: d.value_cents,
      expected_date: d.expected_date,
      closed_at: d.closed_at,
      note: d.note,
      source: "hubspot",
    };
  });

await inStukken(dealRijen, 200, async (stuk) => {
  const { error } = await supabase.from("crm_deals").upsert(stuk, { onConflict: "hubspot_id" });
  if (error) throw new Error(`deals: ${error.message}`);
});

console.log("Afspraken wegschrijven...");
const afspraakRijen = afsprakenMee
  .filter((a) => contactId.has(a.contact_hubspot_id))
  .map((a) => {
    const contact = contactId.get(a.contact_hubspot_id);
    return {
      hubspot_id: a.hubspot_id,
      title: a.title,
      kind: "overig",
      form: "op_locatie",
      starts_at: a.starts_at,
      ends_at: a.ends_at,
      status: a.status,
      location: a.location,
      note: a.note,
      outcome: a.outcome,
      contact_id: contact.id,
      organization_id: contact.organization_id ?? null,
      source: "handmatig",
    };
  });

await inStukken(afspraakRijen, 200, async (stuk) => {
  const { error } = await supabase.from("crm_meetings").upsert(stuk, { onConflict: "hubspot_id" });
  if (error) throw new Error(`afspraken: ${error.message}`);
});

console.log("Notities wegschrijven...");
const notitieRijen = notitiesMee
  .filter((n) => contactId.has(n.contact_hubspot_id))
  .map((n) => {
    const contact = contactId.get(n.contact_hubspot_id);
    return {
      hubspot_id: n.hubspot_id,
      kind: n.kind,
      summary: n.summary,
      body: n.body,
      occurred_at: n.occurred_at,
      contact_id: contact.id,
      organization_id: contact.organization_id ?? null,
      // Met de hand geschreven door een mens, niet door een systeem gemaakt.
      is_system: false,
    };
  });

await inStukken(notitieRijen, 200, async (stuk) => {
  const { error } = await supabase.from("crm_activities").upsert(stuk, { onConflict: "hubspot_id" });
  if (error) throw new Error(`notities: ${error.message}`);
});

console.log("");
console.log(
  "Klaar. %d contacten, %d deals, %d afspraken, %d notities.",
  contacten.length,
  dealRijen.length,
  afspraakRijen.length,
  notitieRijen.length
);
console.log("HubSpot is niet aangepast en niet uitgezet. Controleer eerst in SkoolPartner of alles klopt.");

await ruimOp();
}
