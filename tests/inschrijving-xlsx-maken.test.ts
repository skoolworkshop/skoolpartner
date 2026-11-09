import { describe, expect, it } from "vitest";

import { kolomLetter, maakXlsx, tabNaam } from "@/lib/inschrijving/xlsx-maken";
import { leesWerkbladen } from "@/lib/inschrijving/xlsx";

/**
 * De maker wordt getest met de lezer ernaast: schrijven, terugleren, en kijken
 * of er precies uitkomt wat erin ging. Een bestand dat de eigen lezer niet
 * begrijpt, begrijpt Excel ook niet.
 */
async function heenEnWeer(bladen: Parameters<typeof maakXlsx>[0]) {
  const bytes = maakXlsx(bladen);
  const kopie = new Uint8Array(bytes);
  return leesWerkbladen(kopie.buffer.slice(kopie.byteOffset, kopie.byteOffset + kopie.byteLength) as ArrayBuffer);
}

describe("kolomletters", () => {
  it("telt door zoals Excel", () => {
    expect(kolomLetter(0)).toBe("A");
    expect(kolomLetter(25)).toBe("Z");
    expect(kolomLetter(26)).toBe("AA");
    expect(kolomLetter(27)).toBe("AB");
  });
});

describe("tabnamen", () => {
  it("haalt tekens weg die Excel niet accepteert", () => {
    expect(tabNaam("Groep 3/4")).toBe("Groep 3-4");
    expect(tabNaam("Ronde 1: Graffiti")).toBe("Ronde 1- Graffiti");
  });

  it("kort een te lange naam af", () => {
    expect(tabNaam("Workshop Smartphone Fotografie voor bovenbouw").length).toBeLessThanOrEqual(31);
  });

  it("maakt een dubbele naam uniek", () => {
    expect(tabNaam("Groep 5", ["Groep 5"])).toBe("Groep 5 (2)");
    expect(tabNaam("Groep 5", ["Groep 5", "Groep 5 (2)"])).toBe("Groep 5 (3)");
  });
});

describe("een werkmap maken", () => {
  it("levert een bestand dat de eigen lezer begrijpt", async () => {
    const bladen = await heenEnWeer([
      {
        naam: "1 HAVO",
        rijen: [
          ["Leerling", "Ronde 1", "Ronde 2"],
          ["Lissa van der Velde", "Ghetto Drums", "Graffiti"],
          ["Jan-Peter Bakker", "Hiphop", "DJ Skills"],
        ],
      },
    ]);

    expect(bladen).toHaveLength(1);
    expect(bladen[0].naam).toBe("1 HAVO");
    expect(bladen[0].rijen[0]).toEqual(["Leerling", "Ronde 1", "Ronde 2"]);
    expect(bladen[0].rijen[1]).toEqual(["Lissa van der Velde", "Ghetto Drums", "Graffiti"]);
  });

  it("zet elk tabblad apart neer, met de goede naam", async () => {
    const bladen = await heenEnWeer([
      { naam: "Groep 3/4", rijen: [["Naam"], ["Lissa"]] },
      { naam: "Groep 5", rijen: [["Naam"], ["Jan-Peter"]] },
      { naam: "Groep 6", rijen: [["Naam"], ["Ilse"]] },
    ]);

    expect(bladen.map((blad) => blad.naam)).toEqual(["Groep 3-4", "Groep 5", "Groep 6"]);
    expect(bladen[2].rijen[1][0]).toBe("Ilse");
  });

  it("houdt accenten, apostrofs en ampersands heel", async () => {
    const bladen = await heenEnWeer([
      {
        naam: "Test",
        rijen: [["Naam"], ["Stèfanie de Haas"], ["Tim van 't Hof"], ["Kbs Petrus & Paulus"], ["<niet> een tag"]],
      },
    ]);

    const namen = bladen[0].rijen.slice(1).map((rij) => rij[0]);
    expect(namen).toEqual(["Stèfanie de Haas", "Tim van 't Hof", "Kbs Petrus & Paulus", "<niet> een tag"]);
  });

  it("schrijft getallen als getal", async () => {
    const bladen = await heenEnWeer([{ naam: "Test", rijen: [["Workshop", "Aantal"], ["Graffiti", 23]] }]);
    expect(bladen[0].rijen[1]).toEqual(["Graffiti", "23"]);
  });

  it("laat lege cellen leeg", async () => {
    const bladen = await heenEnWeer([{ naam: "Test", rijen: [["A", "B", "C"], ["een", null, "drie"]] }]);
    expect(bladen[0].rijen[1][0]).toBe("een");
    expect(bladen[0].rijen[1][1]).toBe("");
    expect(bladen[0].rijen[1][2]).toBe("drie");
  });

  it("kan een hele cultuurdag aan", async () => {
    const klassen = Array.from({ length: 8 }, (_, i) => ({
      naam: `Klas ${i + 1}`,
      rijen: [
        ["Leerling", "Ronde 1", "Ronde 2", "Ronde 3", "Ronde 4"],
        ...Array.from({ length: 25 }, (_, n) => [
          `Leerling ${i + 1}-${n + 1}`,
          "Ghetto Drums",
          "DJ Skills",
          "Hiphop",
          "Graffiti",
        ]),
      ],
    }));

    const bladen = await heenEnWeer(klassen);
    expect(bladen).toHaveLength(8);
    expect(bladen[7].rijen).toHaveLength(26);
    expect(bladen[7].rijen[25][0]).toBe("Leerling 8-25");
  });

  it("weigert een werkmap zonder tabbladen", () => {
    expect(() => maakXlsx([])).toThrow(/tabblad/i);
  });
});
