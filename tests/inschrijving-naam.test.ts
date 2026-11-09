import { describe, expect, it } from "vitest";

import {
  afstand,
  maakSleutels,
  naamSleutel,
  normaliseerNaam,
  platteNaamSleutel,
  platteVarianten,
  splitsNaam,
  zoekDeelnemer,
  type Kandidaat,
} from "@/lib/inschrijving/naam";

function kandidaat(id: string, naam: string): Kandidaat {
  return { id, naam, ...maakSleutels(naam) };
}

const klas = [
  kandidaat("1", "Lissa van der Velde"),
  kandidaat("2", "Anne-Marie de Jong"),
  kandidaat("3", "Jan-Peter Bakker"),
  kandidaat("4", "Hadassah Hollander"),
  kandidaat("5", "Ilse Mooren-Verstegen"),
  kandidaat("6", "Stefanie de Haas"),
];

describe("normaliseren", () => {
  it("haalt hoofdletters en accenten weg", () => {
    expect(normaliseerNaam("Stèfanie de HAAS")).toBe("stefanie de haas");
  });

  it("schrijft v/d, v.d. en vd uit naar van de", () => {
    expect(normaliseerNaam("Lissa v/d Velde")).toBe("lissa van de velde");
    expect(normaliseerNaam("Lissa v.d. Velde")).toBe("lissa van de velde");
    expect(normaliseerNaam("Lissa vd Velde")).toBe("lissa van de velde");
  });

  it("schrijft van 't uit naar van het", () => {
    expect(normaliseerNaam("Tim van 't Hof")).toBe("tim van het hof");
    expect(normaliseerNaam("Tim v/h Hof")).toBe("tim van het hof");
  });

  it("laat een apostrof in de naam zelf verbinden", () => {
    expect(normaliseerNaam("Lisa d'Hondt")).toBe("lisa dhondt");
  });

  it("maakt van streepjes en dubbele spaties gewone woorden", () => {
    expect(normaliseerNaam("  Anne-Marie   de  Jong ")).toBe("anne marie de jong");
  });

  it("ziet een losse v vooraan als voorletter en niet als van", () => {
    expect(normaliseerNaam("V. Jansen")).toBe("v jansen");
  });
});

describe("splitsen", () => {
  it("zet tussenvoegsels apart van de kern", () => {
    expect(splitsNaam("Lissa van der Velde")).toEqual({
      kern: ["lissa", "velde"],
      tussen: ["van", "der"],
    });
  });

  it("houdt een naam zonder tussenvoegsel heel", () => {
    expect(splitsNaam("Hadassah Hollander").kern).toEqual(["hadassah", "hollander"]);
  });
});

describe("sleutels", () => {
  it("komt op dezelfde sleutel uit, hoe het tussenvoegsel ook getypt is", () => {
    const verwacht = naamSleutel("Lissa van der Velde");
    for (const variant of [
      "lissa v/d velde",
      "LISSA VAN DER VELDE",
      "Lissa vd Velde",
      "Lissa v.d. Velde",
      "lissa velde",
      "  Lissa   van   der   Velde  ",
    ]) {
      expect(naamSleutel(variant)).toBe(verwacht);
    }
  });

  it("maakt de volgorde van voornaam en achternaam onbelangrijk", () => {
    expect(naamSleutel("Velde, Lissa van der")).toBe(naamSleutel("Lissa van der Velde"));
  });

  it("vangt een streepje in een dubbele naam", () => {
    const een = platteVarianten("Anne-Marie de Jong");
    const twee = platteVarianten("Annemarie de Jong");
    expect([...twee].some((v) => een.has(v))).toBe(true);
  });

  it("ziet een anagram niet als dezelfde naam", () => {
    const een = platteVarianten("Mark Siet");
    const twee = platteVarianten("Tim Kares");
    expect([...twee].some((v) => een.has(v))).toBe(false);
  });

  it("houdt de platte sleutel stabiel voor opslag", () => {
    expect(platteNaamSleutel("Jan-Peter Bakker")).toBe(platteNaamSleutel("Bakker Jan Peter"));
  });

  it("houdt twee verschillende personen apart", () => {
    expect(naamSleutel("Jan de Vries")).not.toBe(naamSleutel("Jan de Vree"));
    expect(naamSleutel("Lissa van der Velde")).not.toBe(naamSleutel("Lisa van der Velde"));
  });
});

describe("afstand", () => {
  it("is nul bij gelijk", () => {
    expect(afstand("velde", "velde", 2)).toBe(0);
  });

  it("telt een ontbrekende letter als één", () => {
    expect(afstand("velde", "vele", 2)).toBe(1);
  });

  it("telt twee omgewisselde letters als twee", () => {
    expect(afstand("velde", "vedle", 2)).toBe(2);
  });

  it("stopt boven de grens", () => {
    expect(afstand("velde", "hollander", 2)).toBe(3);
  });
});

describe("zoeken in een groep", () => {
  it("vindt de leerling bij een verkort tussenvoegsel", () => {
    const uitkomst = zoekDeelnemer("lissa v/d velde", klas);
    expect(uitkomst.soort).toBe("gevonden");
    if (uitkomst.soort === "gevonden") expect(uitkomst.kandidaat.id).toBe("1");
  });

  it("vindt de leerling zonder tussenvoegsel en in kleine letters", () => {
    const uitkomst = zoekDeelnemer("lissa velde", klas);
    expect(uitkomst.soort).toBe("gevonden");
    if (uitkomst.soort === "gevonden") expect(uitkomst.kandidaat.id).toBe("1");
  });

  it("vindt Annemarie zonder streepje", () => {
    const uitkomst = zoekDeelnemer("Annemarie de Jong", klas);
    expect(uitkomst.soort).toBe("gevonden");
    if (uitkomst.soort === "gevonden") expect(uitkomst.kandidaat.id).toBe("2");
  });

  it("vindt de leerling als achternaam en voornaam zijn omgedraaid", () => {
    const uitkomst = zoekDeelnemer("Bakker Jan-Peter", klas);
    expect(uitkomst.soort).toBe("gevonden");
    if (uitkomst.soort === "gevonden") expect(uitkomst.kandidaat.id).toBe("3");
  });

  it("vraagt om bevestiging bij een typefout", () => {
    const uitkomst = zoekDeelnemer("Hadasah Holander", klas);
    expect(uitkomst.soort).toBe("bijna");
    if (uitkomst.soort === "bijna") {
      expect(uitkomst.kandidaten.map((k) => k.id)).toEqual(["4"]);
    }
  });

  it("vraagt om bevestiging bij alleen een voornaam", () => {
    const uitkomst = zoekDeelnemer("Ilse", klas);
    expect(uitkomst.soort).toBe("bijna");
    if (uitkomst.soort === "bijna") expect(uitkomst.kandidaten.map((k) => k.id)).toEqual(["5"]);
  });

  it("vraagt om bevestiging bij een voorletter", () => {
    const uitkomst = zoekDeelnemer("L. van der Velde", klas);
    expect(uitkomst.soort).toBe("bijna");
    if (uitkomst.soort === "bijna") expect(uitkomst.kandidaten.map((k) => k.id)).toEqual(["1"]);
  });

  it("meldt het als twee leerlingen in de groep dezelfde naam hebben", () => {
    const dubbel = [...klas, kandidaat("7", "Lissa van der Velde")];
    const uitkomst = zoekDeelnemer("Lissa van der Velde", dubbel);
    expect(uitkomst.soort).toBe("meerdere");
    if (uitkomst.soort === "meerdere") {
      expect(uitkomst.kandidaten.map((k) => k.id)).toEqual(["1", "7"]);
    }
  });

  it("vindt niemand bij een naam die er niet op staat", () => {
    expect(zoekDeelnemer("Pieter Postma", klas).soort).toBe("niets");
  });

  it("vindt niemand bij een leeg veld", () => {
    expect(zoekDeelnemer("   ", klas).soort).toBe("niets");
    expect(zoekDeelnemer("!!!", klas).soort).toBe("niets");
  });

  it("vindt een naam die helemaal in hoofdletters is getypt", () => {
    const uitkomst = zoekDeelnemer("STEFANIE DE HAAS", klas);
    expect(uitkomst.soort).toBe("gevonden");
    if (uitkomst.soort === "gevonden") expect(uitkomst.kandidaat.id).toBe("6");
  });

  it("vindt een dubbele achternaam die zonder streepje is getypt", () => {
    const uitkomst = zoekDeelnemer("Ilse Mooren Verstegen", klas);
    expect(uitkomst.soort).toBe("gevonden");
    if (uitkomst.soort === "gevonden") expect(uitkomst.kandidaat.id).toBe("5");
  });

  it("raadt geen roepnamen", () => {
    expect(zoekDeelnemer("Han Bakker", klas).soort).not.toBe("gevonden");
  });
});
