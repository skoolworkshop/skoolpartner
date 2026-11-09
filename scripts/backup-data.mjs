/**
 * Zet alle tabellen uit Supabase in losse JSON-bestanden, zodat je een
 * volledige datakopie op je eigen schijf hebt.
 *
 * ============================================================================
 * DIT SCRIPT SCHRIJFT NIETS IN DE DATABASE. HET LEEST ALLEEN.
 * ============================================================================
 *
 *   node scripts/backup-data.mjs
 *
 * De bestanden komen in _backup/data-JJJJ-MM-DD/ te staan, een map per datum.
 * Draai hem zo vaak als je wilt; een tweede keer op dezelfde dag overschrijft
 * de bestanden van die dag.
 *
 * GEHEIMEN
 *
 *   integration_credentials bevat tokens (Google, Moneybird, HubSpot). Die
 *   worden niet geexporteerd: elk veld met token, secret, key, refresh of
 *   password in de naam wordt vervangen door "<verborgen>". Je krijgt dus wel
 *   te zien welke koppelingen er stonden, maar niet de sleutels zelf.
 *
 *   Zet _backup/ nooit in git en deel de map niet. Hij staat in .gitignore.
 */

import { mkdirSync, writeFileSync } from "node:fs";
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
  process.exitCode = 1;
} else {
  await maakBackup();
}

async function maakBackup() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const tabellen = [
    "app_settings",
    "audit_logs",
    "booking_invoices",
    "booking_sources",
    "bookings",
    "cjp_bonus_awards",
    "cjp_credit_transactions",
    "cjp_parking_requests",
    "crm_activities",
    "crm_booking_availability",
    "crm_booking_links",
    "crm_contacts",
    "crm_deal_events",
    "crm_deals",
    "crm_meetings",
    "crm_organization_profiles",
    "crm_pipeline_stages",
    "crm_sequence_enrollments",
    "crm_sequence_steps",
    "crm_sequences",
    "crm_snippet_uses",
    "crm_snippets",
    "crm_suri_editions",
    "crm_suri_payments",
    "crm_suri_profiles",
    "crm_tasks",
    "crm_templates",
    "external_record_mappings",
    "integration_credentials",
    "integration_sync_state",
    "invoice_lines",
    "invoices",
    "loyalty_accounts",
    "loyalty_transaction_events",
    "loyalty_transactions",
    "message_threads",
    "messages",
    "organization_contacts",
    "organization_domains",
    "organization_invites",
    "organization_members",
    "organizations",
    "outbound_messages",
    "profiles",
    "public_email_domains",
    "redemption_requests",
    "reviews",
    "webhook_events",
    "workshop_result_files",
    "workshop_results",
  ];

  const vandaag = new Date().toISOString().slice(0, 10);
  const map = path.join(root, "_backup", `data-${vandaag}`);
  mkdirSync(map, { recursive: true });

  const geheimVeld = /token|secret|key|refresh|password|wachtwoord/i;
  const overzicht = [];
  let mislukt = 0;

  for (const tabel of tabellen) {
    const rijen = [];
    let vanaf = 0;
    const stap = 1000;
    let fout = null;

    for (;;) {
      const { data, error } = await supabase
        .from(tabel)
        .select("*")
        .range(vanaf, vanaf + stap - 1);
      if (error) {
        fout = error.message;
        break;
      }
      rijen.push(...(data ?? []));
      if (!data || data.length < stap) break;
      vanaf += stap;
    }

    if (fout && /does not exist|schema cache|could not find the table/i.test(fout)) {
      overzicht.push({ tabel, rijen: null, overgeslagen: "tabel bestaat niet meer" });
      console.log(`${tabel.padEnd(32)} overgeslagen, bestaat niet meer`);
      continue;
    }

    if (fout) {
      mislukt += 1;
      overzicht.push({ tabel, rijen: null, fout });
      console.log(`${tabel.padEnd(32)} MISLUKT  ${fout}`);
      continue;
    }

    const schoon =
      tabel === "integration_credentials"
        ? rijen.map((rij) => {
            const kopie = { ...rij };
            for (const veld of Object.keys(kopie)) {
              if (geheimVeld.test(veld) && kopie[veld] != null) kopie[veld] = "<verborgen>";
            }
            return kopie;
          })
        : rijen;

    writeFileSync(path.join(map, `${tabel}.json`), `${JSON.stringify(schoon, null, 2)}\n`, "utf8");
    overzicht.push({ tabel, rijen: rijen.length });
    console.log(`${tabel.padEnd(32)} ${String(rijen.length).padStart(7)} rijen`);
  }

  writeFileSync(
    path.join(map, "_overzicht.json"),
    `${JSON.stringify({ gemaakt: new Date().toISOString(), tabellen: overzicht }, null, 2)}\n`,
    "utf8",
  );

  const totaal = overzicht.reduce((som, item) => som + (item.rijen ?? 0), 0);
  console.log("");
  console.log(`Klaar. ${totaal} rijen uit ${overzicht.length - mislukt} tabellen in ${map}`);
  if (mislukt > 0) {
    console.log(`LET OP: ${mislukt} tabel(len) konden niet gelezen worden. Zie hierboven.`);
    process.exitCode = 1;
  }
}
