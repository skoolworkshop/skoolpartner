import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ALLE_SOORTEN, KLANT_SOORTEN } from "@/lib/inschrijving/afronden";

/**
 * Elke downloadknop op het dagscherm moet een bestand opleveren.
 *
 * WAAROM DEZE TEST ER IS
 *
 *   Bij de acceptatietest op de live omgeving gaven "Inschrijfcodes (PDF)" en
 *   "Inschrijfcodes (Excel)" een 404. De knoppen bestonden, de bestanden konden
 *   gemaakt worden, maar de downloadroute had een eigen lijstje toegestane
 *   soorten waar de codelijsten in ontbraken. Niemand merkte het, want de
 *   tests maakten de bestanden rechtstreeks en gingen niet langs de route.
 *
 *   Deze test legt de knoppen naast de routes. En hij bewaakt de andere kant:
 *   de codelijsten mogen nooit in de klantomgeving te downloaden zijn.
 */

const root = process.cwd();

async function bron(pad: string): Promise<string> {
  return readFile(path.join(root, pad), "utf8");
}

describe("downloadknoppen op het dagscherm", () => {
  it("leveren voor elke soort een bestand op via de beheerroute", async () => {
    const scherm = await bron("src/app/admin/inschrijvingen/[id]/dag-scherm.tsx");
    const knoppen = [...scherm.matchAll(/soort:\s*"([a-z-]+)"/g)].map((treffer) => treffer[1]);
    expect(knoppen.length).toBeGreaterThanOrEqual(6);

    const route = await bron("src/app/admin/inschrijvingen/[id]/bestand/[soort]/route.ts");
    expect(route).toMatch(/const SOORTEN: Soort\[\] = ALLE_SOORTEN;/);

    for (const knop of knoppen) {
      expect(ALLE_SOORTEN, `de knop "${knop}" heeft geen bestand`).toContain(knop);
    }
  });

  it("geven de beheerder ook de codelijsten voor de mentoren", () => {
    expect(ALLE_SOORTEN).toContain("codes-pdf");
    expect(ALLE_SOORTEN).toContain("codes-xlsx");
  });
});

describe("de klantomgeving", () => {
  it("geeft nooit de codelijsten vrij", async () => {
    expect(KLANT_SOORTEN).not.toContain("codes-pdf");
    expect(KLANT_SOORTEN).not.toContain("codes-xlsx");

    const route = await bron("src/app/indeling/[token]/bestand/[soort]/route.ts");
    const regel = route.match(/const SOORTEN: Soort\[\] = \[([^\]]*)\]/);
    expect(regel, "de klantroute heeft geen eigen lijst meer; controleer of codes er niet in staan").not.toBeNull();
    expect(regel![1]).not.toMatch(/codes/);
  });
});
