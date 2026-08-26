import { chromium } from "playwright-core";
import path from "node:path";

const url = "file://" + path.join(process.cwd(), ".harness/index.html");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

for (const [naam, breedte] of [["desktop", 1280], ["mobiel", 390]]) {
  const page = await browser.newPage({ viewport: { width: breedte, height: 900 } });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.screenshot({ path: `.harness/diagnose-${naam}.png`, fullPage: true });

  // Loopt er iets buiten het scherm? Dat is op mobiel de klassieke fout.
  const overloop = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  console.log(`${naam} (${breedte}px): horizontale overloop ${overloop}px`);
  await page.close();
}

await browser.close();
