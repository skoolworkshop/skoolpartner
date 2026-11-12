/**
 * Nakijken of alles klaarstaat voor productie.
 *
 * ============================================================================
 * DIT SCRIPT LEEST ALLEEN. HET VERANDERT NIETS, NERGENS.
 * ============================================================================
 *
 *   node scripts/check-productie.mjs
 *
 * Het kijkt naar de omgevingsvariabelen die er moeten zijn, of ze er
 * plausibel uitzien, en of de Supabase-verbinding het doet. Van geheimen
 * wordt nooit de waarde getoond, alleen of ze er zijn en hoe ze beginnen.
 *
 * Draai hem lokaal met je .env.local, en op Vercel kun je dezelfde controle
 * doen door de variabelen in je shell te zetten.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

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

let fouten = 0;
let waarschuwingen = 0;

function toon(naam, waarde, soort) {
  if (!waarde) return "ontbreekt";
  if (soort === "geheim") return `aanwezig (${waarde.length} tekens, begint met ${waarde.slice(0, 11)}…)`;
  if (soort === "url" && /^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(waarde)) {
    return "https://<projectref>.supabase.co";
  }
  return waarde;
}

function regel(status, naam, tekst) {
  const merk = status === "ok" ? "  ok  " : status === "fout" ? " FOUT " : "let op";
  console.log(`${merk} ${naam.padEnd(32)} ${tekst}`);
  if (status === "fout") fouten += 1;
  if (status === "letop") waarschuwingen += 1;
}

console.log("\nOMGEVINGSVARIABELEN\n");

// ---------------------------------------------------------------------------
// Verplicht
// ---------------------------------------------------------------------------
const url = env.NEXT_PUBLIC_SUPABASE_URL;
if (!url) {
  regel("fout", "NEXT_PUBLIC_SUPABASE_URL", "ontbreekt");
} else if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(url)) {
  regel("fout", "NEXT_PUBLIC_SUPABASE_URL", `ziet er niet uit als een projectadres: ${url}`);
} else {
  regel("ok", "NEXT_PUBLIC_SUPABASE_URL", toon("", url, "url"));
}

const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!anon) {
  regel("fout", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "ontbreekt");
} else if (anon.startsWith("sb_secret_") || anon.includes("service_role")) {
  regel("fout", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "hier staat een GEHEIME sleutel. Die hoort nooit publiek.");
} else if (!anon.startsWith("sb_publishable_") && !anon.startsWith("eyJ")) {
  regel("fout", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "hoort met sb_publishable_ of eyJ te beginnen");
} else {
  regel("ok", "NEXT_PUBLIC_SUPABASE_ANON_KEY", toon("", anon, "geheim"));
}

const service = env.SUPABASE_SERVICE_ROLE_KEY;
if (!service) {
  regel("fout", "SUPABASE_SERVICE_ROLE_KEY", "ontbreekt");
} else if (!service.startsWith("sb_secret_") && !service.startsWith("eyJ")) {
  regel("letop", "SUPABASE_SERVICE_ROLE_KEY", "onbekende vorm, kijk hem na");
} else {
  regel("ok", "SUPABASE_SERVICE_ROLE_KEY", toon("", service, "geheim"));
}

const site = env.NEXT_PUBLIC_SITE_URL;
if (!site) {
  regel(
    "letop",
    "NEXT_PUBLIC_SITE_URL",
    "ontbreekt. Lokaal prima, in productie nodig voor inloglinks, het logo in de mail en de inschrijflink.",
  );
} else if (!/^https:\/\/[^\s/]+$/.test(site.replace(/\/+$/, ""))) {
  regel("fout", "NEXT_PUBLIC_SITE_URL", `moet een https-adres zonder slash op het eind zijn: ${site}`);
} else {
  regel("ok", "NEXT_PUBLIC_SITE_URL", site);
}

// ---------------------------------------------------------------------------
// Nodig voor losse onderdelen
// ---------------------------------------------------------------------------
console.log("");

const cron = env.CRON_SECRET;
regel(
  cron ? "ok" : "letop",
  "CRON_SECRET",
  cron ? toon("", cron, "geheim") : "ontbreekt: de vier dagelijkse taken geven dan 503",
);

const sleutel = env.APP_ENCRYPTION_KEY;
regel(
  sleutel ? "ok" : "letop",
  "APP_ENCRYPTION_KEY",
  sleutel ? toon("", sleutel, "geheim") : "ontbreekt: Gmail-tokens kunnen niet versleuteld bewaard worden",
);

for (const naam of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"]) {
  const waarde = env[naam];
  regel(
    waarde ? "ok" : "letop",
    naam,
    waarde
      ? naam === "GOOGLE_REDIRECT_URI"
        ? waarde
        : toon("", waarde, "geheim")
      : "ontbreekt: Gmail draait dan in mockmodus en er gaat geen mail de deur uit",
  );
}

if (env.GOOGLE_REDIRECT_URI && site) {
  const hoort = `${site.replace(/\/+$/, "")}/api/integrations/google/callback`;
  regel(
    env.GOOGLE_REDIRECT_URI === hoort ? "ok" : "letop",
    "Google redirect klopt",
    env.GOOGLE_REDIRECT_URI === hoort ? "ja" : `verwacht ${hoort}`,
  );
}

const mailbox = env.GMAIL_MAILBOX ?? "boekingen@skoolworkshop.nl (standaard)";
regel("ok", "GMAIL_MAILBOX", mailbox);

// ---------------------------------------------------------------------------
// De schakelaar voor de leerlingenpagina
// ---------------------------------------------------------------------------
console.log("");
const publiek = (env.PUBLIEKE_INSCHRIJVING ?? "").toLowerCase();
const uit = publiek === "" || ["uit", "off", "false", "0", "nee"].includes(publiek);
regel(
  "ok",
  "PUBLIEKE_INSCHRIJVING",
  uit
    ? publiek === ""
      ? "niet ingevuld: in productie betekent dat DICHT. Zet hem op 'aan' als leerlingen erin mogen."
      : "uit: leerlingen komen niet op /inschrijven, ook niet met een geldige link"
    : "aan: leerlingen kunnen zich inschrijven zodra een dag open staat",
);

// ---------------------------------------------------------------------------
// Doet de verbinding het?
// ---------------------------------------------------------------------------
if (url && service && /^https:\/\//.test(url)) {
  console.log("\nVERBINDING\n");
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { count, error } = await supabase
      .from("app_settings")
      .select("key", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    regel("ok", "Supabase bereikbaar", `${count ?? 0} instellingen gelezen`);

    const tabellen = [
      "enrollment_events",
      "enrollment_participants",
      "enrollment_rounds",
      "enrollment_workshops",
      "enrollment_choices",
    ];
    for (const tabel of tabellen) {
      const { count: aantal, error: fout } = await supabase
        .from(tabel)
        .select("id", { count: "exact", head: true });
      regel(fout ? "fout" : "ok", tabel, fout ? fout.message : `${aantal ?? 0} rijen`);
    }

    const { count: beheerders, error: beheerFout } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("is_admin", true);
    regel(
      beheerFout ? "fout" : (beheerders ?? 0) > 0 ? "ok" : "fout",
      "Beheerders",
      beheerFout ? beheerFout.message : `${beheerders ?? 0} account(s) met beheerrechten`,
    );

    // Staat er een migratie klaar die nog niet is gedraaid?
    const { error: leerjaarFout } = await supabase
      .from("enrollment_participants")
      .select("year_level")
      .limit(1);
    regel(
      leerjaarFout ? "fout" : "ok",
      "Migratie 042 (leerjaar)",
      leerjaarFout ? "kolom year_level ontbreekt, draai npm run db:push" : "uitgevoerd",
    );

    const { error: toegangFout } = await supabase
      .from("enrollment_events")
      .select("shared_code, shared_code_active")
      .limit(1);
    regel(
      toegangFout ? "fout" : "ok",
      "Migratie 043 (toegangscode)",
      toegangFout ? "kolom shared_code ontbreekt, draai npm run db:push" : "uitgevoerd",
    );

    if (!toegangFout) {
      // Een dag die open staat zonder werkende toegangscode is een dag waar
      // geen leerling binnenkomt. Dat wil je weten voordat de school belt.
      const { data: open } = await supabase
        .from("enrollment_events")
        .select("name, event_date, shared_code, shared_code_active")
        .eq("status", "open");

      const zonder = (open ?? []).filter((dag) => !dag.shared_code || dag.shared_code_active === false);
      regel(
        zonder.length === 0 ? "ok" : "letop",
        "Toegangscodes",
        zonder.length === 0
          ? `${(open ?? []).length} open dag(en), allemaal met werkende code`
          : `${zonder.length} open dag(en) zonder werkende code: ${zonder
              .map((dag) => `${dag.name} (${dag.event_date})`)
              .join(", ")}`,
      );

      const { error: verificatieFout } = await supabase
        .from("enrollment_verifications")
        .select("id", { count: "exact", head: true });
      regel(
        verificatieFout ? "fout" : "ok",
        "enrollment_verifications",
        verificatieFout ? verificatieFout.message : "bereikbaar",
      );
    }

    // ---------------------------------------------------------------------
    // Migratie 044 en 045: Moneybird-contact per locatie, punten per locatie
    // ---------------------------------------------------------------------
    // Eerst wat de migraties tegen zou houden. Dat wil je weten vóór db:push.
    const { data: gekoppeld, error: koppelFout } = await supabase
      .from("organization_contacts")
      .select("moneybird_contact_id, organization_id")
      .not("moneybird_contact_id", "is", null);
    if (koppelFout) {
      regel("fout", "Moneybird-koppelingen", koppelFout.message);
    } else {
      const perContact = new Map();
      for (const rij of gekoppeld ?? []) {
        perContact.set(rij.moneybird_contact_id, (perContact.get(rij.moneybird_contact_id) ?? 0) + 1);
      }
      const dubbel = [...perContact.entries()].filter(([, aantal]) => aantal > 1);
      regel(
        dubbel.length === 0 ? "ok" : "fout",
        "Moneybird-koppelingen",
        dubbel.length === 0
          ? `${(gekoppeld ?? []).length} koppeling(en), geen enkel contact bij twee locaties. Migratie 044 kan veilig.`
          : `${dubbel.length} Moneybird-contact(en) staan bij meer dan één locatie: ${dubbel
              .map(([contact]) => contact)
              .join(", ")}. Migratie 044 weigert tot dit is opgelost.`,
      );
    }

    const { data: toekenningen, error: toekenFout } = await supabase
      .from("loyalty_transactions")
      .select("organization_id, type, external_reference")
      .not("external_reference", "is", null)
      .order("id")
      .limit(10000);
    if (toekenFout) {
      regel("fout", "Dubbele toekenningen", toekenFout.message);
    } else {
      const perBron = new Map();
      for (const rij of toekenningen ?? []) {
        const sleutel = `${rij.organization_id}|${rij.type}|${rij.external_reference}`;
        perBron.set(sleutel, (perBron.get(sleutel) ?? 0) + 1);
      }
      const dubbel = [...perBron.values()].filter((aantal) => aantal > 1).length;
      regel(
        dubbel === 0 ? "ok" : "fout",
        "Dubbele toekenningen",
        dubbel === 0
          ? `${(toekenningen ?? []).length} toekenning(en), geen enkele dubbel binnen één locatie. Migratie 045 kan veilig.`
          : `${dubbel} toekenning(en) staan dubbel binnen één locatie. Migratie 045 weigert tot dit is opgelost.`,
      );
    }

    // Is 045 al gedraaid? Daarna heeft de saldoweergave geen kolom user_id meer:
    // het saldo is dan van de locatie.
    const { error: perPersoon } = await supabase.from("loyalty_balances").select("user_id").limit(1);
    const { error: weergaveFout } = await supabase.from("loyalty_balances").select("organization_id").limit(1);
    regel(
      weergaveFout ? "fout" : perPersoon ? "ok" : "letop",
      "Migratie 045 (punten per locatie)",
      weergaveFout
        ? weergaveFout.message
        : perPersoon
          ? "uitgevoerd: één saldo per schoollocatie"
          : "nog niet uitgevoerd: het saldo rekent nog per persoon. Draai npm run db:push.",
    );

    // Losse facturen horen er niet te zijn: zonder locatie halen wij niets binnen.
    const { count: los, error: losFout } = await supabase
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .is("organization_id", null);
    regel(
      losFout ? "fout" : (los ?? 0) === 0 ? "ok" : "letop",
      "Facturen zonder locatie",
      losFout
        ? losFout.message
        : (los ?? 0) === 0
          ? "geen"
          : `${los} factuur/facturen zonder locatie. Opruimen met: node scripts/opschonen.mjs --ook-losse-facturen`,
    );

    // ---------------------------------------------------------------------
    // De bewaartermijn van leerlinggegevens
    // ---------------------------------------------------------------------
    const { data: alleDagen } = await supabase
      .from("enrollment_events")
      .select("name, event_date, purge_after");

    if (alleDagen) {
      const vandaag = new Date().toISOString().slice(0, 10);
      const bewaartTot = (dag) => {
        if (dag.purge_after) return String(dag.purge_after).slice(0, 10);
        const moment = new Date(`${String(dag.event_date).slice(0, 10)}T00:00:00Z`);
        moment.setUTCDate(moment.getUTCDate() + 30);
        return moment.toISOString().slice(0, 10);
      };

      const teLang = alleDagen.filter((dag) => bewaartTot(dag) < vandaag);
      regel(
        teLang.length === 0 ? "ok" : "letop",
        "Bewaartermijn leerlingen",
        teLang.length === 0
          ? `${alleDagen.length} dag(en), geen enkele over de termijn`
          : `${teLang.length} dag(en) over de bewaartermijn: ${teLang
              .map((dag) => `${dag.name} (${String(dag.event_date).slice(0, 10)})`)
              .join(", ")}. De nachtelijke taak ruimt die op zodra hij draait.`,
      );

      const zonderDatum = alleDagen.filter((dag) => !dag.purge_after).length;
      regel(
        zonderDatum === 0 ? "ok" : "letop",
        "purge_after ingevuld",
        zonderDatum === 0
          ? "op elke dag staat een bewaardatum"
          : `${zonderDatum} dag(en) zonder eigen datum; die rekenen op dagdatum plus 30 dagen`,
      );
    }
  } catch (fout) {
    regel("fout", "Supabase bereikbaar", fout.message);
  }
}

console.log("");
if (fouten > 0) {
  console.log(`${fouten} ding(en) moeten eerst opgelost worden.`);
  process.exitCode = 1;
} else if (waarschuwingen > 0) {
  console.log(`Klaar, met ${waarschuwingen} punt(en) om na te kijken.`);
} else {
  console.log("Alles staat klaar.");
}
console.log("");
