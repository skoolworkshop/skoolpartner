/**
 * Zet alle migraties in supabase/migrations op volgorde achter elkaar in
 * supabase/setup-alles.sql. Dat bestand plak je in de Supabase SQL Editor.
 *
 *   node scripts/build-setup-sql.mjs
 */

import { readdir, readFile, writeFile } from "node:fs/promises";

const DIR = "supabase/migrations";

const files = (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort();

const parts = [
  "-- =============================================================================",
  "-- SkoolPartner - volledige database-installatie",
  "-- =============================================================================",
  "-- Dit bestand is samengesteld uit supabase/migrations. Niet met de hand",
  "-- aanpassen: pas de migratie aan en draai `node scripts/build-setup-sql.mjs`.",
  "-- Plak de volledige inhoud in Supabase > SQL Editor en klik op Run.",
  "-- Opnieuw draaien is veilig.",
  "-- =============================================================================",
  "",
];

for (const file of files) {
  parts.push(`-- >>> ${file}`, "");
  parts.push((await readFile(`${DIR}/${file}`, "utf8")).trimEnd(), "");
}

await writeFile("supabase/setup-alles.sql", parts.join("\n") + "\n");
console.log(`  setup-alles.sql opgebouwd uit ${files.length} migraties`);
