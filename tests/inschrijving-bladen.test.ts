import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { leesBladen, lijktOpStandaardTabnaam } from "@/lib/inschrijving/lijst";
import { leesWerkbladen, naarTabTekst } from "@/lib/inschrijving/xlsx";

function bestand(naam: string): ArrayBuffer {
  const buffer = readFileSync(path.join(process.cwd(), "tests", "stubs", naam));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

async function lees(naam: string) {
  const bladen = await leesWerkbladen(bestand(naam));
  return { bladen, lezing: leesBladen(bladen.map((blad) => ({ naam: blad.naam, tekst: naarTabTekst(blad.rijen) }))) };
}

describe("een werkmap met een tabblad per klas", () => {
  it("vindt alle tabbladen met hun naam", async () => {
    const { bladen } = await lees("leerlingen-per-klas.xlsx");
    expect(bladen.map((blad) => blad.naam)).toEqual(["Groep 3-4", "Groep 5", "Groep 6"]);
  });

  it("gebruikt de naam van het tabblad als klas", async () => {
    const { lezing } = await lees("leerlingen-per-klas.xlsx");

    expect(lezing.regels).toHaveLength(6);
    expect(lezing.regels.map((regel) => `${regel.naam} (${regel.groep})`)).toEqual([
      "Lissa van der Velde (Groep 3-4)",
      "Anne-Marie de Jong (Groep 3-4)",
      "Jan-Peter Bakker (Groep 5)",
      "Stèfanie de Haas (Groep 5)",
      "Tim van 't Hof (Groep 6)",
      "Ilse Mooren-Verstegen (Groep 6)",
    ]);
  });

  it("struikelt niet over een titelregel boven de kopregel", async () => {
    const { lezing } = await lees("leerlingen-per-klas.xlsx");
    expect(lezing.problemen).toEqual([]);
  });

  it("telt per tabblad hoeveel er bruikbaar was", async () => {
    const { lezing } = await lees("leerlingen-per-klas.xlsx");
    expect(lezing.bladen).toEqual([
      { naam: "Groep 3-4", aantal: 2 },
      { naam: "Groep 5", aantal: 2 },
      { naam: "Groep 6", aantal: 2 },
    ]);
  });
});

describe("een werkmap met alles op één tabblad", () => {
  it("gebruikt de kolom Klas en niet de tabnaam", async () => {
    const { lezing } = await lees("leerlingen.xlsx");
    expect(lezing.regels.map((regel) => regel.groep)).toEqual([
      "Groep 3/4",
      "Groep 5",
      "Groep 3/4",
      "Groep 5",
      "Groep 6",
      "Groep 6",
    ]);
  });
});

describe("namen die Excel zelf verzint", () => {
  it("ziet Blad1 en Sheet2 niet als klas", () => {
    for (const naam of ["Blad1", "blad 2", "Sheet1", "Tabblad 3", "Werkblad"]) {
      expect(lijktOpStandaardTabnaam(naam), naam).toBe(true);
    }
    expect(lijktOpStandaardTabnaam("Groep 5")).toBe(false);
    expect(lijktOpStandaardTabnaam("K3E")).toBe(false);
  });

  it("laat een regel zonder klas staan in plaats van Blad1 te gebruiken", () => {
    const lezing = leesBladen([{ naam: "Blad1", tekst: "Naam\nLissa van der Velde" }]);
    expect(lezing.regels).toHaveLength(0);
    expect(lezing.problemen[0]).toMatchObject({ blad: "Blad1", reden: "geen klas of groep" });
  });
});

describe("dezelfde leerling op twee tabbladen", () => {
  it("meldt de tweede in plaats van hem dubbel op te slaan", () => {
    const lezing = leesBladen([
      { naam: "Groep 5", tekst: "Naam\nJan-Peter Bakker" },
      { naam: "Groep 5", tekst: "Naam\nJan-Peter Bakker" },
    ]);
    expect(lezing.regels).toHaveLength(1);
    expect(lezing.problemen[0].reden).toContain("staat ook al in Groep 5");
  });
});
