import path from "node:path";
import { pathToFileURL } from "node:url";

import { startBrowser } from "./browser.mjs";

/**
 * Maakt schermafbeeldingen van de gerenderde harness, op desktop en mobiel.
 *
 *   node tools/harness/shoot.mjs [naam]
 *
 * Welke browser hiervoor gebruikt wordt, zoekt tools/harness/browser.mjs uit.
 * Dat werkt op Windows, macOS en Linux.
 */

// pathToFileURL in plaats van "file://" + pad: op Windows levert dat anders
// een adres met backslashes op, en dat is geen geldige URL.
const url = pathToFileURL(path.join(process.cwd(), ".harness", "index.html")).href;
const keuze = process.argv[2] ?? "diagnose";

const browser = await startBrowser();

let overloopGevonden = false;

for (const [naam, breedte] of [
  ["desktop", 1280],
  ["mobiel", 390],
]) {
  const page = await browser.newPage({ viewport: { width: breedte, height: 900 } });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.screenshot({
    path: path.join(".harness", `${keuze}-${naam}.png`),
    fullPage: true,
  });

  // Loopt er iets buiten het scherm? Dat is op mobiel de klassieke fout.
  /*
    Twee metingen, en de tweede is de belangrijke.

    documentElement staat in dit project op overflow-x: clip. Een element dat
    te breed is, duwt dan wel de body op maar niet het documentElement, en de
    eerste meting geeft dan netjes nul terwijl de pagina toch niet klopt.
    Vandaar dat ook de body wordt gemeten.
  */
  const overloop = await page.evaluate(() =>
    Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      document.body.scrollWidth - document.body.clientWidth
    )
  );
  if (overloop > 0) overloopGevonden = true;
  console.log(`${naam} (${breedte}px): horizontale overloop ${overloop}px`);
  await page.close();
}

await browser.close();

if (overloopGevonden) {
  console.error("\nEr loopt iets buiten het scherm. Bekijk de afbeeldingen in .harness/.\n");
  process.exitCode = 1;
}
