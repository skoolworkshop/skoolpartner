import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { leesLijst } from "@/lib/inschrijving/lijst";
import { kolomNummer, leesXlsx, naarTabTekst } from "@/lib/inschrijving/xlsx";

function bestand(naam: string): ArrayBuffer {
  const buffer = readFileSync(path.join(process.cwd(), "tests", "stubs", naam));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

describe("kolomletters", () => {
  it("rekent letters om naar een nummer", () => {
    expect(kolomNummer("A1")).toBe(0);
    expect(kolomNummer("B12")).toBe(1);
    expect(kolomNummer("Z3")).toBe(25);
    expect(kolomNummer("AA1")).toBe(26);
    expect(kolomNummer("AB1")).toBe(27);
  });
});

describe("een echt Excel-bestand lezen", () => {
  it("leest de cellen van het eerste werkblad", async () => {
    const rijen = await leesXlsx(bestand("leerlingen.xlsx"));

    expect(rijen[0]).toEqual(["Voornaam", "Tussenvoegsel", "Achternaam", "Klas", "E-mail"]);
    expect(rijen[1]).toEqual(["Lissa", "van der", "Velde", "Groep 3/4", "ouder1@voorbeeld.nl"]);
  });

  it("houdt accenten en apostrofs heel", async () => {
    const rijen = await leesXlsx(bestand("leerlingen.xlsx"));
    const namen = rijen.map((rij) => rij.slice(0, 3).filter(Boolean).join(" "));
    expect(namen).toContain("Stèfanie de Haas");
    expect(namen).toContain("Tim van 't Hof");
  });

  it("geeft een getal gewoon als tekst terug", async () => {
    const rijen = await leesXlsx(bestand("leerlingen.xlsx"));
    expect(rijen[2][5]).toBe("2026");
  });

  it("weigert een bestand dat geen Excel is", async () => {
    const rommel = new TextEncoder().encode("dit is gewoon tekst").buffer;
    await expect(leesXlsx(rommel as ArrayBuffer)).rejects.toThrow(/geen Excel/i);
  });
});

describe("van Excel naar een leerlingenlijst", () => {
  it("levert de leerlingen op met hun klas", async () => {
    const rijen = await leesXlsx(bestand("leerlingen.xlsx"));
    const lezing = leesLijst(naarTabTekst(rijen));

    expect(lezing.kopregel).toBe(true);
    expect(lezing.regels.map((regel) => regel.naam)).toEqual([
      "Lissa van der Velde",
      "Jan-Peter Bakker",
      "Anne-Marie de Jong",
      "Stèfanie de Haas",
      "Tim van 't Hof",
      "Ilse Mooren-Verstegen",
    ]);
    expect(lezing.regels[0].email).toBe("ouder1@voorbeeld.nl");
    expect(lezing.regels.map((regel) => regel.groep)).toEqual([
      "Groep 3/4",
      "Groep 5",
      "Groep 3/4",
      "Groep 5",
      "Groep 6",
      "Groep 6",
    ]);
  });

  it("klaagt niet over de lege regel ertussen", async () => {
    const rijen = await leesXlsx(bestand("leerlingen.xlsx"));
    expect(leesLijst(naarTabTekst(rijen)).problemen).toEqual([]);
  });
});
