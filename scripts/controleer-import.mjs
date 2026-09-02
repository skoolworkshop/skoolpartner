/**
 * Controleert wat er van HubSpot in SkoolPartner terecht is gekomen.
 *
 * ============================================================================
 * DIT SCRIPT SCHRIJFT NIETS. HET LEEST ALLEEN.
 * ============================================================================
 *
 *   node scripts/controleer-import.mjs
 *
 * Er staat geen enkele insert, update of delete in. Je kunt hem zo vaak draaien
 * als je wilt, ook tijdens gebruik.
 *
 * WAAROM DIT NODIG IS
 *
 *   De proefdraai vertelde wat er zou gebeuren. Dit vertelt wat er is gebeurd.
 *   Dat zijn twee verschillende dingen: tussen het plan en de database zit een
 *   netwerkverbinding, een reeks batches en een handvol constraints, en pas als
 *   je in de database kijkt weet je of alles is aangekomen.
 *
 *   Elke controle hieronder heeft een verwachting. Klopt die niet, dan staat er
 *   LET OP met het verschil erbij. Alles wat geen verwachting kan hebben, zoals
 *   een verdeling over fases, wordt gewoon getoond zodat je er zelf naar kijkt.
 */

import { readFileSync } from "node:fs";
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

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let waarschuwingen = 0;

function toon(regel, waarde, verwacht) {
  if (verwacht === undefined) {
    console.log("  %s %s", String(waarde).padStart(7), regel);
    return;
  }
  const goed = waarde === verwacht;
  if (!goed) waarschuwingen += 1;
  console.log(
    "  %s %s %s",
    String(waarde).padStart(7),
    regel,
    goed ? "" : `LET OP, verwacht ${verwacht}`
  );
}

/** Alleen tellen, geen rijen ophalen. Scheelt tijd en geheugen bij 2243 rijen. */
async function tel(tabel, bouw = (q) => q) {
  const { count, error } = await bouw(supabase.from(tabel).select("*", { count: "exact", head: true }));
  if (error) throw new Error(`${tabel}: ${error.message}`);
  return count ?? 0;
}

async function haalAlles(tabel, kolommen, bouw = (q) => q) {
  const rijen = [];
  for (let van = 0; ; van += 1000) {
    const { data, error } = await bouw(supabase.from(tabel).select(kolommen)).range(van, van + 999);
    if (error) throw new Error(`${tabel}: ${error.message}`);
    rijen.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rijen;
}

console.log("\n  Aantallen uit HubSpot\n");

const uitHubSpot = {
  contacten: await tel("crm_contacts", (q) => q.not("hubspot_id", "is", null)),
  deals: await tel("crm_deals", (q) => q.not("hubspot_id", "is", null)),
  afspraken: await tel("crm_meetings", (q) => q.not("hubspot_id", "is", null)),
  notities: await tel("crm_activities", (q) => q.not("hubspot_id", "is", null)),
};

toon("contacten met een HubSpot-nummer", uitHubSpot.contacten, 2243);
toon("deals met een HubSpot-nummer", uitHubSpot.deals, 654);
toon("afspraken met een HubSpot-nummer", uitHubSpot.afspraken, 72);
toon("notities met een HubSpot-nummer", uitHubSpot.notities, 1);

console.log("\n  Wat er al stond, en dus niet uit HubSpot komt\n");

toon("contacten zonder HubSpot-nummer", await tel("crm_contacts", (q) => q.is("hubspot_id", null)));
toon("deals zonder HubSpot-nummer", await tel("crm_deals", (q) => q.is("hubspot_id", null)));
toon("afspraken zonder HubSpot-nummer", await tel("crm_meetings", (q) => q.is("hubspot_id", null)));
toon(
  "tijdlijnregels zonder HubSpot-nummer",
  await tel("crm_activities", (q) => q.is("hubspot_id", null))
);

console.log("\n  Hangt alles ergens aan\n");

/*
  De database eist al dat een deal een organisatie of een contact heeft, en een
  afspraak minstens een van de drie. Toch tellen wij het hier na. Een controle
  die alleen bevestigt wat de database afdwingt is niet overbodig: hij bewijst
  dat je naar dezelfde database kijkt als waar je op vertrouwt.
*/
toon(
  "geimporteerde deals zonder contact",
  await tel("crm_deals", (q) => q.not("hubspot_id", "is", null).is("contact_id", null)),
  0
);
toon(
  "geimporteerde afspraken zonder contact",
  await tel("crm_meetings", (q) => q.not("hubspot_id", "is", null).is("contact_id", null)),
  0
);
toon(
  "deals die ook aan een school hangen",
  await tel("crm_deals", (q) => q.not("hubspot_id", "is", null).not("organization_id", "is", null))
);
toon(
  "contacten die aan een school hangen",
  await tel("crm_contacts", (q) => q.not("hubspot_id", "is", null).not("organization_id", "is", null))
);

console.log("\n  De contacten\n");

const contacten = await haalAlles("crm_contacts", "id, full_name, email, contact_type, lifecycle, hubspot_id");
const geimporteerd = contacten.filter((c) => c.hubspot_id);

const naamIsAdres = geimporteerd.filter(
  (c) => c.email && c.full_name.toLowerCase() === c.email.toLowerCase()
).length;
toon("dragen hun e-mailadres als naam", naamIsAdres, 517);
toon(
  "leveranciers (de ZZP-ers)",
  geimporteerd.filter((c) => c.contact_type === "leverancier").length,
  22
);
toon("zonder e-mailadres", geimporteerd.filter((c) => !c.email).length, 0);
toon("met levensfase klant", geimporteerd.filter((c) => c.lifecycle === "klant").length);
toon("met levensfase lead", geimporteerd.filter((c) => c.lifecycle === "lead").length);
toon("met levensfase prospect", geimporteerd.filter((c) => c.lifecycle === "prospect").length);
toon("zonder levensfase", geimporteerd.filter((c) => !c.lifecycle).length);

// Dubbele adressen die de unieke index niet vangt, bijvoorbeeld door verschil in
// hoofdletters of doordat de een wel en de ander geen organisatie heeft.
const perAdres = new Map();
for (const c of contacten) {
  if (!c.email) continue;
  const sleutel = c.email.toLowerCase();
  perAdres.set(sleutel, (perAdres.get(sleutel) ?? 0) + 1);
}
const dubbeleAdressen = [...perAdres.entries()].filter(([, n]) => n > 1);
toon("e-mailadressen die meer dan een keer voorkomen", dubbeleAdressen.length, 0);
for (const [adres, aantal] of dubbeleAdressen.slice(0, 10)) {
  console.log("          %s komt %d keer voor", adres, aantal);
}

console.log("\n  De deals per fase\n");

const [{ data: fases }, deals] = await Promise.all([
  supabase.from("crm_pipeline_stages").select("id, key, label, is_won, is_lost"),
  haalAlles("crm_deals", "id, title, stage_id, value_cents, closed_at, expected_date, hubspot_id", (q) =>
    q.not("hubspot_id", "is", null)
  ),
]);

const fasePerId = new Map((fases ?? []).map((f) => [f.id, f]));
const perFase = new Map();
for (const deal of deals) {
  const fase = fasePerId.get(deal.stage_id);
  const naam = fase?.label ?? "onbekende fase";
  const stand = perFase.get(naam) ?? { aantal: 0, waarde: 0 };
  stand.aantal += 1;
  stand.waarde += deal.value_cents;
  perFase.set(naam, stand);
}
for (const [naam, stand] of [...perFase.entries()].sort((a, b) => b[1].aantal - a[1].aantal)) {
  console.log(
    "  %s %s (%s)",
    String(stand.aantal).padStart(7),
    naam,
    new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(stand.waarde / 100)
  );
}

console.log("\n  Kloppen de afsluitingen\n");

const dicht = deals.filter((d) => {
  const fase = fasePerId.get(d.stage_id);
  return fase?.is_won || fase?.is_lost;
});
toon("deals in een afgesloten fase", dicht.length);
toon("daarvan zonder afsluitdatum", dicht.filter((d) => !d.closed_at).length, 0);

const open = deals.filter((d) => {
  const fase = fasePerId.get(d.stage_id);
  return !fase?.is_won && !fase?.is_lost;
});
toon("nog lopende deals", open.length);
toon("daarvan met een afsluitdatum", open.filter((d) => d.closed_at).length, 0);
toon("lopende deals zonder bedrag", open.filter((d) => d.value_cents === 0).length);

// De opschoning van HTML-entiteiten. Staat hier een getal boven nul, dan is er
// met een oudere versie van het script geimporteerd.
const metEntiteiten = deals.filter((d) => /&amp;|&nbsp;|&lt;|&gt;|&#39;/.test(d.title));
toon("dealnamen met HTML-resten erin", metEntiteiten.length, 0);
for (const deal of metEntiteiten.slice(0, 5)) console.log("          %s", deal.title);

console.log("\n  De afspraken\n");

const afspraken = await haalAlles("crm_meetings", "id, title, starts_at, ends_at, status, hubspot_id", (q) =>
  q.not("hubspot_id", "is", null)
);
const nu = new Date().toISOString();
const standen = new Map();
for (const a of afspraken) standen.set(a.status, (standen.get(a.status) ?? 0) + 1);
for (const [stand, aantal] of [...standen.entries()].sort((a, b) => b[1] - a[1])) {
  toon(`met stand ${stand}`, aantal);
}
toon(
  "die nog moeten komen en gepland staan",
  afspraken.filter((a) => a.starts_at > nu && a.status === "gepland").length
);
toon(
  "uit het verleden die nog op gepland staan",
  afspraken.filter((a) => a.starts_at < nu && a.status === "gepland").length,
  0
);

console.log("\n  De tijdlijn\n");

const activiteiten = await haalAlles("crm_activities", "id, kind, summary, occurred_at, hubspot_id", (q) =>
  q.not("hubspot_id", "is", null)
);
for (const a of activiteiten) {
  console.log("  %s  %s", a.occurred_at.slice(0, 10), a.summary.slice(0, 70));
}

console.log("");
if (waarschuwingen === 0) {
  console.log("  Alles klopt met wat de proefdraai voorspelde.\n");
} else {
  console.log("  %d punt(en) wijken af. Kijk daar eerst naar.\n", waarschuwingen);
}
process.exitCode = waarschuwingen === 0 ? 0 : 1;
