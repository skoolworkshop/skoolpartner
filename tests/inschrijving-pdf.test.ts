import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { leesLijst } from "@/lib/inschrijving/lijst";
import { leesPdf } from "@/lib/inschrijving/pdf";

function bestand(naam: string): ArrayBuffer {
  const buffer = readFileSync(path.join(process.cwd(), "tests", "stubs", naam));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

/**
 * Twee PDF's, want er zijn twee soorten.
 *
 * De ene gebruikt een standaardlettertype en gewone letters, zoals een
 * eenvoudige export. De andere heeft het lettertype in het bestand gestopt en
 * de tekens hernummerd, zoals Word en de meeste leerlingvolgsystemen doen.
 * Die tweede is de lastige: zonder de vertaaltabel erbij wordt "Stèfanie"
 * onleesbaar.
 */
describe.each([
  ["leerlingen-standaard.pdf", "standaardlettertype"],
  ["leerlingen-ingesloten.pdf", "ingesloten lettertype"],
])("tekst uit een PDF met %s", (naam) => {
  it("leest de regels met tabs tussen de kolommen", async () => {
    const tekst = await leesPdf(bestand(naam));
    const regels = tekst.split("\n");

    expect(regels[0]).toBe("Klassenlijst Basisschool De Meent");
    expect(regels[1]).toBe("Naam\tKlas\tE-mail");
    expect(regels[2]).toBe("Lissa van der Velde\tGroep 3/4\touder1@voorbeeld.nl");
  });

  it("houdt accenten en apostrofs heel", async () => {
    const tekst = await leesPdf(bestand(naam));
    expect(tekst).toContain("Stèfanie de Haas");
    expect(tekst).toContain("Tim van 't Hof");
  });

  it("levert een lijst op die het systeem verder kan verwerken", async () => {
    const lezing = leesLijst(await leesPdf(bestand(naam)));

    expect(lezing.kopregel).toBe(true);
    expect(lezing.regels).toHaveLength(6);
    expect(lezing.regels[0]).toMatchObject({
      naam: "Lissa van der Velde",
      groep: "Groep 3/4",
      email: "ouder1@voorbeeld.nl",
    });
    // De titelregel erboven telt niet als ontbrekende leerling.
    expect(lezing.problemen).toEqual([]);
  });
});

describe("wat er niet in zit", () => {
  it("zegt het eerlijk als het geen PDF is", async () => {
    const rommel = new TextEncoder().encode("gewoon tekst").buffer;
    await expect(leesPdf(rommel as ArrayBuffer)).rejects.toThrow(/geen PDF/i);
  });

  it("wijst op een scan als er geen letters in staan", async () => {
    const leeg = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<< >>\nendobj\n").buffer;
    await expect(leesPdf(leeg as ArrayBuffer)).rejects.toThrow(/scan of een foto/i);
  });
});
