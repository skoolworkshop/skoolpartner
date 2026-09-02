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
import { build } from "esbuild";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
const args = process.argv.slice(2);
const SCHRIJVEN = args.includes("--schrijf");
const EVALUATIES = args.includes("--evaluaties=laten") ? "laten" : "sluiten";
const MAX = Number(args.find((a) => a.startsWith("--max="))?.split("=")[1] ?? 0) || Infinity;

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

await build({
  entryPoints: [path.join(root, "src/lib/crm/hubspot-import.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: path.join(cache, "omzetting.cjs"),
  tsconfig: path.join(root, "tsconfig.json"),
});

const require_ = createRequire(import.meta.url);
const omzetting = require_(path.join(cache, "omzetting.cjs"));

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

const contactUitkomsten = bronContacten.map((r) => omzetting.leesContact(r));
const { uniek: contacten, dubbel } = omzetting.ontdubbelContacten(
  contactUitkomsten.filter((u) => u.ok).map((u) => u.rij)
);

const dealUitkomsten = bronDeals.map((r) => omzetting.leesDeal(r, opties));
const deals = dealUitkomsten.filter((u) => u.ok).map((u) => u.rij);

const afspraakUitkomsten = bronAfspraken.map((r) => omzetting.leesAfspraak(r, nu));
const afspraken = afspraakUitkomsten.filter((u) => u.ok).map((u) => u.rij);

const notitieUitkomsten = bronNotities.map((r) => omzetting.leesNotitie(r));
const notities = notitieUitkomsten.filter((u) => u.ok).map((u) => u.rij);

// Deals en afspraken van contacten die niet meekomen, kunnen nergens aan
// hangen. Ze worden apart geteld en niet stil weggelaten.
const bekend = new Set(contacten.map((c) => c.hubspot_id));
const dealsZonderContact = deals.filter((d) => !bekend.has(d.contact_hubspot_id));
const afsprakenZonderContact = afspraken.filter((a) => !bekend.has(a.contact_hubspot_id));
const notitiesZonderContact = notities.filter((n) => !bekend.has(n.contact_hubspot_id));

const perFase = {};
for (const deal of deals) perFase[deal.stage_key] = (perFase[deal.stage_key] ?? 0) + 1;

const plan = {
  gedraaidOp: nu.toISOString(),
  keuzes: { oudeEvaluaties: EVALUATIES, schrijven: SCHRIJVEN },
  contacten: {
    inHubSpot: bronContacten.length,
    overgenomen: contacten.length,
    overgeslagen: omzetting.tellRedenen(contactUitkomsten),
    samengevoegdOpAdres: dubbel,
  },
  deals: {
    inHubSpot: bronDeals.length,
    overgenomen: deals.length - dealsZonderContact.length,
    perFase,
    overgeslagen: omzetting.tellRedenen(dealUitkomsten),
    contactKomtNietMee: dealsZonderContact.length,
  },
  afspraken: {
    inHubSpot: bronAfspraken.length,
    overgenomen: afspraken.length - afsprakenZonderContact.length,
    overgeslagen: omzetting.tellRedenen(afspraakUitkomsten),
    contactKomtNietMee: afsprakenZonderContact.length,
  },
  notities: {
    inHubSpot: bronNotities.length,
    overgenomen: notities.length - notitiesZonderContact.length,
    overgeslagen: omzetting.tellRedenen(notitieUitkomsten),
    contactKomtNietMee: notitiesZonderContact.length,
  },
};

writeFileSync(path.join(cache, "plan.json"), JSON.stringify(plan, null, 2), "utf8");

console.log("");
console.log("Contacten : %d in HubSpot, %d gaan mee", plan.contacten.inHubSpot, plan.contacten.overgenomen);
for (const r of plan.contacten.overgeslagen) console.log("            - %s: %d", r.reden, r.aantal);
console.log("            - dubbel op e-mailadres: %d", dubbel.length);
console.log("Deals     : %d in HubSpot, %d gaan mee", plan.deals.inHubSpot, plan.deals.overgenomen);
for (const r of plan.deals.overgeslagen) console.log("            - %s: %d", r.reden, r.aantal);
for (const [fase, aantal] of Object.entries(perFase)) console.log("            fase %s: %d", fase, aantal);
console.log("Afspraken : %d in HubSpot, %d gaan mee", plan.afspraken.inHubSpot, plan.afspraken.overgenomen);
for (const r of plan.afspraken.overgeslagen) console.log("            - %s: %d", r.reden, r.aantal);
console.log("Notities  : %d in HubSpot, %d gaan mee", plan.notities.inHubSpot, plan.notities.overgenomen);
for (const r of plan.notities.overgeslagen) console.log("            - %s: %d", r.reden, r.aantal);
console.log("");
console.log("Plan geschreven naar .hubspot-import/plan.json");

if (!SCHRIJVEN) {
  console.log("Proefdraai: er is niets in de database veranderd. Draai met --schrijf als dit klopt.");
  process.exit(0);
}

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
const dealRijen = deals
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
const afspraakRijen = afspraken
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
const notitieRijen = notities
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
