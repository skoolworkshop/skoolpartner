import { describe, expect, it } from "vitest";

import {
  draaiAchternaamOm,
  leesLijst,
  maakOverzicht,
  naarTekst,
  type KolomSoort,
} from "@/lib/inschrijving/lijst";

/**
 * De import van een leerlingenlijst.
 *
 * WAT HIER WORDT NAGESPEELD
 *
 *   De vorm van een echte lijst uit een leerlingvolgsysteem, met verzonnen
 *   namen: een lege eerste regel, de kopregel op regel twee, lege kolommen
 *   ertussen, en naast elkaar een kolom Leerjaar én een kolom Klas. Op zo'n
 *   bestand ging het mis: 353 leerlingen in negentien klassen kwamen binnen
 *   als twee klassen van 173 en 180, want het leerjaar werd voor de klas
 *   aangezien.
 *
 *   Er staan geen echte leerlingen in deze test. Alle namen zijn verzonnen.
 */

const KOP = ["", "Voornaam", "", "Achternaam", "Leerjaar", "", "Klas", "", "", "Mentoren", ""];

function regel(voornaam: string, achternaam: string, leerjaar: string, klas: string, mentor = ""): string[] {
  return ["", voornaam, "", achternaam, leerjaar, "", klas, "", "", mentor, ""];
}

const LIJST = [
  ["Overzicht leerlingen schooljaar 2026-2027"],
  KOP,
  regel("Sanne", "Bakker", "1", "A1BK1", "a1bk1"),
  regel("Daan", "Vloot, van der", "1", "A1BK1", "a1km1"),
  regel("Noor", "Visser", "1", "A1KM1", "a1km2"),
  regel("Bram", "Beek, van", "1", "A1KM1"),
  regel("Esmée", "Kuipers", "2", "B2K1"),
  regel("Tim", "Cohen, A", "2", "B2K1"),
  regel("Lotte", "Jong, de", "2", "B2K2"),
]
  .map((rij) => rij.join("\t"))
  .join("\n");

describe("een lijst met zowel leerjaar als klas", () => {
  it("gebruikt de kolom Klas en niet de kolom Leerjaar", () => {
    const lezing = leesLijst(LIJST);
    const overzicht = maakOverzicht(lezing);

    expect(overzicht.aantal).toBe(7);
    expect(overzicht.klassen.map((klas) => `${klas.naam}=${klas.aantal}`)).toEqual([
      "A1BK1=2",
      "A1KM1=2",
      "B2K1=2",
      "B2K2=1",
    ]);
    // Twee leerjaren, en die zijn dus iets anders dan de vier klassen.
    expect(overzicht.leerjaren.map((jaar) => `${jaar.naam}=${jaar.aantal}`)).toEqual(["1=4", "2=3"]);
  });

  it("vindt de kopregel ook als er een titel boven staat", () => {
    const lezing = leesLijst(LIJST);
    expect(lezing.kopregel).toBe(true);
    expect(lezing.kolommen[1]).toBe("voornaam");
    expect(lezing.kolommen[3]).toBe("achternaam");
    expect(lezing.kolommen[4]).toBe("leerjaar");
    expect(lezing.kolommen[6]).toBe("groep");
  });

  it("laat de kolom met mentoren met rust", () => {
    const lezing = leesLijst(LIJST);
    expect(lezing.kolommen[9]).toBe("onbekend");
    expect(lezing.regels.every((regel) => !regel.naam.includes("a1bk1"))).toBe(true);
  });

  it("bewaart het leerjaar bij de leerling", () => {
    const lezing = leesLijst(LIJST);
    const sanne = lezing.regels.find((regel) => regel.naam.startsWith("Sanne"));
    expect(sanne?.leerjaar).toBe("1");
    expect(sanne?.groep).toBe("A1BK1");
  });

  it("stuurt het leerjaar mee naar de server en leest het daar terug", () => {
    const heen = leesLijst(LIJST);
    const terug = leesLijst(naarTekst(heen.regels));

    expect(terug.regels.length).toBe(heen.regels.length);
    expect(terug.regels.map((regel) => regel.leerjaar)).toEqual(heen.regels.map((regel) => regel.leerjaar));
    expect(terug.regels.map((regel) => regel.groep)).toEqual(heen.regels.map((regel) => regel.groep));
  });

  it("laat de kolommen met de hand aanwijzen", () => {
    // Iemand wijst per ongeluk leerjaar aan als klas: dan moet dat ook gebeuren,
    // want de gebruiker weet soms meer dan wij.
    const eigen: KolomSoort[] = [
      "onbekend",
      "voornaam",
      "onbekend",
      "achternaam",
      "onbekend",
      "onbekend",
      "leerjaar",
      "onbekend",
      "onbekend",
      "onbekend",
      "onbekend",
    ];
    const lezing = leesLijst(LIJST, null, eigen);
    // Zonder klas blijft er niets over, en dat wordt netjes gemeld.
    expect(lezing.regels).toHaveLength(0);
    expect(lezing.problemen.every((probleem) => probleem.reden.includes("klas"))).toBe(true);
  });
});

describe("achternamen met een komma", () => {
  it("draait een tussenvoegsel terug naar voren", () => {
    expect(draaiAchternaamOm("Vloot, van der")).toEqual({ tussenvoegsel: "van der", achternaam: "Vloot" });
    expect(draaiAchternaamOm("Beek, van")).toEqual({ tussenvoegsel: "van", achternaam: "Beek" });
    expect(draaiAchternaamOm("Jong, de")).toEqual({ tussenvoegsel: "de", achternaam: "Jong" });
  });

  it("laat een initiaal achter de komma staan waar hij hoort", () => {
    // "Cohen, A" is geen tussenvoegsel. Omdraaien zou "A Cohen" opleveren als
    // achternaam, en dat is een andere persoon.
    expect(draaiAchternaamOm("Cohen, A")).toEqual({ tussenvoegsel: "", achternaam: "Cohen A" });
  });

  it("laat een naam zonder komma met rust", () => {
    expect(draaiAchternaamOm("Bakker")).toEqual({ tussenvoegsel: "", achternaam: "Bakker" });
  });

  it("zet de hele naam goed in elkaar", () => {
    const lezing = leesLijst(LIJST);
    const namen = lezing.regels.map((regel) => regel.naam);
    expect(namen).toContain("Daan van der Vloot");
    expect(namen).toContain("Bram van Beek");
    expect(namen).toContain("Lotte de Jong");
    expect(namen).toContain("Tim Cohen A");
  });
});

describe("het voorbeeld voor het scherm", () => {
  it("meldt dubbele regels apart van overgeslagen regels", () => {
    const metDubbel = `${LIJST}\n${regel("Sanne", "Bakker", "1", "A1BK1").join("\t")}\n\t\t\t\t\t\t\t\t\t\t`;
    const overzicht = maakOverzicht(leesLijst(metDubbel));

    expect(overzicht.aantal).toBe(7);
    expect(overzicht.dubbel).toHaveLength(1);
    expect(overzicht.dubbel[0].naam).toBe("Sanne Bakker");
    expect(overzicht.dubbel[0].groep).toBe("A1BK1");
  });

  it("telt de kolommen waar niets mee gebeurt", () => {
    const overzicht = maakOverzicht(leesLijst(LIJST));
    // A, C, F, H, I en de mentorenkolom J blijven ongebruikt.
    expect(overzicht.ongebruikteKolommen).toEqual([1, 3, 6, 8, 9, 10, 11]);
  });

  it("werkt ook op een lijst zonder kopregel", () => {
    const zonderKop = ["Sanne Bakker\tGroep 3", "Daan van der Vloot\tGroep 3", "Noor Visser\tGroep 4"].join("\n");
    const overzicht = maakOverzicht(leesLijst(zonderKop));
    expect(overzicht.aantal).toBe(3);
    expect(overzicht.klassen.map((klas) => klas.naam)).toEqual(["Groep 3", "Groep 4"]);
  });
});
