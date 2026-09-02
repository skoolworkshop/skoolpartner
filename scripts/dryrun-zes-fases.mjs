/**
 * Laat zien wat migratie 039 met jouw echte gegevens zou doen.
 *
 * ============================================================================
 * DIT SCRIPT LEEST ALLEEN
 * ============================================================================
 *
 *   node scripts/dryrun-zes-fases.mjs
 *
 * Er staat geen insert, update of delete in. Het draait dezelfde indeling na
 * die in de migratie staat en telt hoeveel deals er zouden verhuizen, met de
 * namen erbij. De migratie zelf voer jij uit met supabase db push.
 *
 * De vraag die dit beantwoordt is niet "werkt de migratie", want dat bewijst
 * scripts/verify-crm-zes-fases.mjs in een echte Postgres. De vraag hier is:
 * welke deals van mij raakt dit, en klopt dat met wat ik verwacht.
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

const { data: fases, error: faseFout } = await supabase
  .from("crm_pipeline_stages")
  .select("id, key, label, is_won, is_lost")
  .eq("brand", "skool_workshop")
  .order("position");

if (faseFout) {
  console.error("Kon de fases niet lezen:", faseFout.message);
  process.exit(1);
}

const perId = new Map(fases.map((f) => [f.id, f]));

const deals = [];
for (let van = 0; ; van += 1000) {
  const { data, error } = await supabase
    .from("crm_deals")
    .select("id, title, stage_id, expected_date, closed_at, value_cents")
    .eq("brand", "skool_workshop")
    .range(van, van + 999);
  if (error) {
    console.error("Kon de deals niet lezen:", error.message);
    process.exit(1);
  }
  deals.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}

const vandaag = new Date().toISOString().slice(0, 10);

/** Exact dezelfde regel als in de migratie. */
function bestemming(deal) {
  const fase = perId.get(deal.stage_id);
  if (!fase) return null;
  if (fase.key === "facturatie" || fase.key === "ingepland") return "akkoord";
  if (fase.key === "uitgevoerd") return "afgerond";
  if (fase.key === "evaluatie") {
    const voorbij = deal.closed_at !== null || (deal.expected_date !== null && deal.expected_date < vandaag);
    return voorbij ? "afgerond" : "akkoord";
  }
  return null;
}

console.log("\n  Zo staat de pijplijn er nu bij\n");

const nu = new Map();
for (const deal of deals) {
  const fase = perId.get(deal.stage_id);
  const naam = fase?.label ?? "onbekende fase";
  nu.set(naam, (nu.get(naam) ?? 0) + 1);
}
for (const fase of fases) {
  const aantal = nu.get(fase.label) ?? 0;
  console.log("  %s  %s", String(aantal).padStart(5), fase.label);
}

const verhuizingen = deals
  .map((deal) => ({ deal, doel: bestemming(deal) }))
  .filter((rij) => rij.doel !== null);

console.log("\n  Wat er zou verhuizen\n");

if (verhuizingen.length === 0) {
  console.log("  Niets. Er staat geen enkele deal in een fase die verdwijnt.");
} else {
  const perRoute = new Map();
  for (const { deal, doel } of verhuizingen) {
    const route = `${perId.get(deal.stage_id)?.label} → ${doel === "akkoord" ? "Klant bevestigd / Planning" : "Afgerond"}`;
    if (!perRoute.has(route)) perRoute.set(route, []);
    perRoute.get(route).push(deal);
  }
  for (const [route, lijst] of perRoute) {
    console.log("  %s  %s", String(lijst.length).padStart(5), route);
    for (const deal of lijst.slice(0, 8)) {
      console.log("           %s", deal.title.slice(0, 70));
    }
    if (lijst.length > 8) console.log("           en nog %d andere", lijst.length - 8);
  }
}

console.log("\n  Zo zou de pijplijn er daarna uitzien\n");

const straks = new Map();
for (const deal of deals) {
  const doel = bestemming(deal);
  const fase = doel ? fases.find((f) => f.key === doel) : perId.get(deal.stage_id);
  const naam =
    fase?.key === "akkoord" ? "Klant bevestigd / Planning" : (fase?.label ?? "onbekende fase");
  straks.set(naam, (straks.get(naam) ?? 0) + 1);
}
const volgorde = [
  "Nieuwe aanvraag",
  "In behandeling",
  "Offerte verstuurd",
  "Opvolging",
  "Klant bevestigd / Planning",
  "Afgerond",
  "Niet doorgegaan",
];
for (const naam of volgorde) {
  console.log("  %s  %s", String(straks.get(naam) ?? 0).padStart(5), naam);
}

const totaalVoor = deals.length;
const totaalNa = [...straks.values()].reduce((a, b) => a + b, 0);
console.log("");
console.log("  %d deals voor, %d deals na. %s", totaalVoor, totaalNa,
  totaalVoor === totaalNa ? "Er raakt niets kwijt." : "LET OP: dit hoort gelijk te zijn.");
console.log("");
console.log("  Er is niets veranderd. De migratie draai je met supabase db push.");
console.log("");

process.exitCode = totaalVoor === totaalNa ? 0 : 1;
