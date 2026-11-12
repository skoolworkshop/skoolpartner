/**
 * SkoolPartner opschonen: alles van één of meer organisaties weghalen.
 *
 * ============================================================================
 * DIT SCRIPT VERWIJDERT GEGEVENS. ALLEEN VAN DE ORGANISATIES DIE JIJ AANWIJST.
 * ============================================================================
 *
 * WAT HET DOET
 *
 *   Van elke organisatie die je noemt: de cultuurdagen met alles eraan, de
 *   boekingen, de lokale facturen, de spaarpunten, de inwisselverzoeken, de
 *   reviews, de workshopresultaten, de gesprekken, de contactpersonen, de
 *   uitnodigingen, de leden en ten slotte de organisatie zelf.
 *
 * WAT HET NOOIT DOET
 *
 *   Iets aan een organisatie die je niet hebt genoemd. Iets aan accounts in
 *   Supabase. Iets aan de instellingen, de koppelingen, de opgeslagen
 *   credentials of het logboek. En het verwijdert nooit iets in Moneybird,
 *   Gmail of HubSpot: dit raakt uitsluitend de kopie in SkoolPartner.
 *
 * ZO GEBRUIK JE HEM
 *
 *   1. node scripts/opschonen.mjs
 *      Laat zien wat erin zit, per organisatie. Verwijdert niets.
 *
 *   2. node scripts/opschonen.mjs --org <slug of id> [--org <nog een>]
 *      Laat precies zien wat er van die organisaties weg zou gaan.
 *      Verwijdert nog steeds niets.
 *
 *   3. node scripts/opschonen.mjs --org <slug> --verwijder --zeker
 *      Doet het echt. Zonder allebei die vlaggen gebeurt er niets.
 *
 *   Losse gegevens die bij geen enkele organisatie horen, gaan alleen mee als
 *   je daar apart om vraagt:
 *
 *      --ook-losse-facturen     facturen zonder organisatie, met hun regels
 *      --ook-ingelezen-mails    booking_sources: de ingelezen mails
 *
 * VOORAF
 *
 *   Maak eerst een back-up met `npm run backup:data`. Dit script weigert te
 *   verwijderen als er vandaag geen back-upmap is.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
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
      /* bestaat niet */
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
const gevraagdeOrgs = argumenten.reduce((lijst, waarde, index) => {
  if (waarde === "--org" && argumenten[index + 1]) lijst.push(argumenten[index + 1]);
  return lijst;
}, []);
const wilVerwijderen = argumenten.includes("--verwijder");
const isZeker = argumenten.includes("--zeker");
const ookLosseFacturen = argumenten.includes("--ook-losse-facturen");
const ookIngelezenMails = argumenten.includes("--ook-ingelezen-mails");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * De volgorde waarin het weg moet.
 *
 * Boekingen en cultuurdagen staan op RESTRICT: die blokkeren het verwijderen
 * van een organisatie zolang ze er zijn. De rest hangt met CASCADE aan de
 * organisatie en zou vanzelf meegaan, maar we halen het bewust zelf weg zodat
 * we kunnen tellen wat er gebeurt en zodat er niets onbedoelds meelift.
 */
const PER_ORGANISATIE = [
  { tabel: "enrollment_events", label: "cultuurdagen (met klassen, leerlingen en keuzes)" },
  { tabel: "workshop_results", label: "workshopresultaten" },
  { tabel: "redemption_requests", label: "inwisselverzoeken" },
  { tabel: "reviews", label: "reviews" },
  { tabel: "loyalty_transactions", label: "puntentransacties" },
  { tabel: "loyalty_accounts", label: "spaaraccounts" },
  { tabel: "invoices", label: "lokale facturen (met regels)" },
  { tabel: "bookings", label: "boekingen" },
  { tabel: "message_threads", label: "gesprekken (met berichten)" },
  { tabel: "outbound_messages", label: "uitgaande berichten" },
  { tabel: "organization_invites", label: "uitnodigingen" },
  { tabel: "organization_contacts", label: "contactpersonen" },
  { tabel: "organization_domains", label: "domeinen" },
  { tabel: "organization_members", label: "lidmaatschappen" },
  { tabel: "cjp_parking_requests", label: "CJP-aanvragen" },
  { tabel: "cjp_credit_transactions", label: "CJP-tegoed" },
  { tabel: "cjp_bonus_awards", label: "CJP-bonussen" },
];

/** Alle id's van een tabel die bij deze organisatie horen. */
async function idsVan(tabel, orgId) {
  const sleutel = tabel === "cjp_bonus_awards" ? "organization_id" : "id";
  const ids = [];
  let vanaf = 0;
  const stap = 1000;

  for (;;) {
    const { data, error } = await supabase
      .from(tabel)
      .select(sleutel)
      .order(sleutel)
      .eq("organization_id", orgId)
      .range(vanaf, vanaf + stap - 1);
    if (error) throw new Error(`${tabel}: ${error.message}`);
    ids.push(...(data ?? []).map((rij) => rij[sleutel]));
    if (!data || data.length < stap) break;
    vanaf += stap;
  }

  return ids;
}

async function verwijderOpId(tabel, ids) {
  const sleutel = tabel === "cjp_bonus_awards" ? "organization_id" : "id";
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase.from(tabel).delete().in(sleutel, ids.slice(i, i + 200));
    if (error) throw new Error(`${tabel}: ${error.message}`);
  }
}

async function zoekOrganisatie(aanduiding) {
  const opId = /^[0-9a-f-]{36}$/i.test(aanduiding);
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, slug")
    .eq(opId ? "id" : "slug", aanduiding);
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

async function toonAlles() {
  const { data: orgs } = await supabase.from("organizations").select("id, name, slug, created_at").order("name");
  const { data: profielen } = await supabase.from("profiles").select("id, email, is_admin");

  console.log("\nACCOUNTS (deze blijven altijd staan)\n");
  for (const p of profielen ?? []) {
    console.log(`  ${String(p.email).padEnd(34)} beheerder=${p.is_admin ? "ja" : "nee"}`);
  }

  console.log("\nORGANISATIES\n");
  for (const org of orgs ?? []) {
    const aantallen = [];
    for (const onderdeel of PER_ORGANISATIE) {
      const { count } = await supabase
        .from(onderdeel.tabel)
        .select(onderdeel.tabel === "cjp_bonus_awards" ? "organization_id" : "id", {
          count: "exact",
          head: true,
        })
        .eq("organization_id", org.id);
      if ((count ?? 0) > 0) aantallen.push(`${count} ${onderdeel.label}`);
    }
    console.log(`  ${org.name}  (slug: ${org.slug})`);
    console.log(`     ${aantallen.length > 0 ? aantallen.join(", ") : "leeg"}`);
  }

  const { count: losseFacturen } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .is("organization_id", null);
  const { count: mails } = await supabase.from("booking_sources").select("id", { count: "exact", head: true });

  console.log("\nZONDER ORGANISATIE\n");
  console.log(`  ${losseFacturen ?? 0} facturen zonder organisatie (--ook-losse-facturen)`);
  console.log(`  ${mails ?? 0} ingelezen mails in booking_sources (--ook-ingelezen-mails)`);
  console.log("\nKies een organisatie met:  node scripts/opschonen.mjs --org <slug>\n");
}

async function main() {
  // Zonder --org en zonder losse onderdelen: alleen laten zien wat erin zit.
  if (gevraagdeOrgs.length === 0 && !ookLosseFacturen && !ookIngelezenMails) {
    await toonAlles();
    return;
  }

  const organisaties = [];
  for (const aanduiding of gevraagdeOrgs) {
    const org = await zoekOrganisatie(aanduiding);
    if (!org) {
      console.error(`Geen organisatie gevonden met '${aanduiding}'. Er is niets gedaan.`);
      process.exitCode = 1;
      return;
    }
    organisaties.push(org);
  }

  console.log("\n" + "=".repeat(72));
  console.log(wilVerwijderen && isZeker ? "DIT GAAT NU WEG" : "DIT ZOU ER WEGGAAN (er gebeurt nog niets)");
  console.log("=".repeat(72));

  const plan = [];
  if (organisaties.length === 0) {
    console.log("\n  Geen organisaties gekozen: alleen de losse onderdelen hieronder.");
  }
  for (const org of organisaties) {
    console.log(`\n  ${org.name}  (${org.slug})`);
    const onderdelen = [];
    for (const onderdeel of PER_ORGANISATIE) {
      const ids = await idsVan(onderdeel.tabel, org.id);
      if (ids.length > 0) {
        console.log(`     ${String(ids.length).padStart(5)}  ${onderdeel.label}`);
        onderdelen.push({ ...onderdeel, ids });
      }
    }
    console.log(`         1  de organisatie zelf`);
    plan.push({ org, onderdelen });
  }

  let losseFactuurIds = [];
  if (ookLosseFacturen) {
    const { data } = await supabase.from("invoices").select("id").is("organization_id", null).order("id");
    losseFactuurIds = (data ?? []).map((rij) => rij.id);
    console.log(`\n  ${String(losseFactuurIds.length).padStart(5)}  facturen zonder organisatie, met hun regels`);
  }

  let mailIds = [];
  if (ookIngelezenMails) {
    const { data } = await supabase.from("booking_sources").select("id").order("id");
    mailIds = (data ?? []).map((rij) => rij.id);
    console.log(`  ${String(mailIds.length).padStart(5)}  ingelezen mails`);
  }

  console.log("\nWAT BLIJFT STAAN");
  console.log("  alle accounts en beheerrechten");
  console.log("  de instellingen, de koppelingen en de opgeslagen credentials");
  console.log("  het logboek, de databasestructuur en de migratiehistorie");
  console.log("  elke organisatie die je niet hebt genoemd");
  console.log("  alles in Moneybird, Gmail en HubSpot: daar wordt niets aangeraakt");

  if (!wilVerwijderen || !isZeker) {
    console.log("\nEr is niets verwijderd. Voeg --verwijder --zeker toe als dit klopt.\n");
    return;
  }

  // Zonder verse back-up gebeurt er niets.
  const backupMap = path.join(root, "_backup");
  const vandaag = new Date().toISOString().slice(0, 10);
  const heeftBackup =
    existsSync(backupMap) && readdirSync(backupMap).some((naam) => naam.startsWith(`data-${vandaag}`));
  if (!heeftBackup) {
    console.error(`\nEr staat geen back-up van vandaag in _backup/data-${vandaag}.`);
    console.error("Draai eerst: npm run backup:data\n");
    process.exitCode = 1;
    return;
  }

  console.log("\n" + "=".repeat(72));
  console.log("VERWIJDEREN");
  console.log("=".repeat(72));

  for (const { org, onderdelen } of plan) {
    console.log(`\n  ${org.name}`);
    for (const onderdeel of onderdelen) {
      await verwijderOpId(onderdeel.tabel, onderdeel.ids);
      console.log(`     ${String(onderdeel.ids.length).padStart(5)}  ${onderdeel.label} weg`);
    }
    const { error } = await supabase.from("organizations").delete().eq("id", org.id);
    if (error) {
      console.error(`     de organisatie zelf kon niet weg: ${error.message}`);
      console.error("     Er hangt nog iets aan. Draai het script opnieuw zonder --verwijder.");
      process.exitCode = 1;
      return;
    }
    console.log(`         1  de organisatie zelf weg`);
  }

  if (losseFactuurIds.length > 0) {
    await verwijderOpId("invoices", losseFactuurIds);
    console.log(`\n  ${String(losseFactuurIds.length).padStart(5)}  losse facturen weg`);
  }
  if (mailIds.length > 0) {
    await verwijderOpId("booking_sources", mailIds);
    console.log(`  ${String(mailIds.length).padStart(5)}  ingelezen mails weg`);
  }

  console.log("\nNATELLEN");
  for (const { org } of plan) {
    const { data } = await supabase.from("organizations").select("id").eq("id", org.id);
    console.log(`  ${org.name}: ${data && data.length > 0 ? "STAAT ER NOG" : "weg"}`);
  }
  const { count: accounts } = await supabase.from("profiles").select("id", { count: "exact", head: true });
  const { count: beheerders } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("is_admin", true);
  console.log(`  accounts over: ${accounts ?? 0}, waarvan beheerder: ${beheerders ?? 0}`);
  console.log("");
}

main().catch((fout) => {
  console.error(`\nFOUT: ${fout.message}`);
  console.error("Er is mogelijk niets of maar een deel verwijderd. De back-up staat in _backup/.\n");
  process.exitCode = 1;
});
