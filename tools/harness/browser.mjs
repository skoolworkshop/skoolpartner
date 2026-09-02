import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

/**
 * Een browser starten, waar je ook werkt.
 *
 * Hier stond eerst een vast pad naar /opt/pw-browsers/chromium. Dat werkt in
 * de Linux-omgeving waarin ik draai, en nergens anders. Op Windows levert het
 * "Failed to launch chromium because executable doesn't exist" op.
 *
 * Deze functie probeert een aantal manieren op volgorde en meldt welke het
 * werd. De volgorde is niet willekeurig:
 *
 *   1. Een pad dat jij zelf opgeeft, want dat hoort altijd te winnen.
 *   2. De Chromium van Playwright zelf. Dit is de nette weg: geen aannames
 *      over waar iets staat.
 *   3. Een browser die al op de computer staat, via een kanaal. Op Windows is
 *      dat de gewone route: Edge staat er standaard op, dus dit werkt zonder
 *      dat er iets gedownload hoeft te worden. Dit project gebruikt
 *      playwright-core, en dat pakket haalt zelf geen browsers op.
 *   4. Bekende paden die daadwerkelijk bestaan. Alleen als vangnet.
 *
 * Er wordt bewust niets geïnstalleerd. Een script dat ongevraagd honderden
 * megabytes downloadt omdat het toevallig ergens anders draait, is geen
 * script dat je vertrouwt.
 */

/** Paden die het proberen waard zijn, maar alleen als ze echt bestaan. */
const BEKENDE_PADEN = [
  // De Linux-omgeving waarin ik werk.
  "/opt/pw-browsers/chromium",
  // Standaardinstallaties op Windows.
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  // macOS.
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

function pogingen() {
  const lijst = [];

  const eigenPad = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (eigenPad) {
    lijst.push({
      naam: `PLAYWRIGHT_CHROMIUM_PATH (${eigenPad})`,
      opties: { executablePath: eigenPad },
    });
  }

  lijst.push({ naam: "de Chromium van Playwright", opties: {} });
  lijst.push({ naam: "Chrome op deze computer", opties: { channel: "chrome" } });
  lijst.push({ naam: "Edge op deze computer", opties: { channel: "msedge" } });

  for (const pad of BEKENDE_PADEN) {
    if (existsSync(pad)) {
      lijst.push({ naam: `browser op ${pad}`, opties: { executablePath: pad } });
    }
  }

  return lijst;
}

function eersteRegel(fout) {
  return String(fout?.message ?? fout)
    .split("\n")
    .find((regel) => regel.trim().length > 0)
    ?.trim()
    .slice(0, 160);
}

export async function startBrowser() {
  const mislukt = [];

  for (const poging of pogingen()) {
    try {
      const browser = await chromium.launch({ headless: true, ...poging.opties });
      console.log(`Browser: ${poging.naam}`);
      return browser;
    } catch (error) {
      mislukt.push(`  - ${poging.naam}: ${eersteRegel(error)}`);
    }
  }

  throw new Error(
    [
      "Er is geen browser gevonden om de schermafbeeldingen mee te maken.",
      "",
      "Geprobeerd:",
      ...mislukt,
      "",
      "Kies een van deze oplossingen:",
      "  1. Installeer Google Chrome of Microsoft Edge. Het script vindt die vanzelf.",
      "  2. Draai eenmalig: npx playwright install chromium",
      "  3. Wijs zelf een browser aan, bijvoorbeeld:",
      '     Windows:  set PLAYWRIGHT_CHROMIUM_PATH=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      "     macOS/Linux:  export PLAYWRIGHT_CHROMIUM_PATH=/pad/naar/chrome",
      "",
      "De rest van de controles (typecheck, lint, test, build) heeft hier geen browser voor nodig.",
    ].join("\n")
  );
}
