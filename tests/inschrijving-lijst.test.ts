import { describe, expect, it } from "vitest";

import { leesLijst, leesTabel, lijktOpGroep, naarTekst, raadScheidteken } from "@/lib/inschrijving/lijst";

describe("scheidingsteken raden", () => {
  it("herkent de puntkomma van een Nederlandse Excel", () => {
    expect(raadScheidteken("Naam;Klas\nLissa van der Velde;Groep 3/4")).toBe(";");
  });

  it("herkent een tab, zoals bij plakken uit Excel", () => {
    expect(raadScheidteken("Naam\tKlas\nLissa van der Velde\tGroep 3/4")).toBe("\t");
  });

  it("herkent de komma", () => {
    expect(raadScheidteken("Naam,Klas\nLissa,Groep 3/4")).toBe(",");
  });
});

describe("tabel lezen", () => {
  it("houdt een veld tussen aanhalingstekens heel", () => {
    expect(leesTabel('"Velde, Lissa van der";Groep 3/4', ";")).toEqual([["Velde, Lissa van der", "Groep 3/4"]]);
  });

  it("leest twee aanhalingstekens als één", () => {
    expect(leesTabel('"Zoon van ""Jan""";Groep 5', ";")).toEqual([['Zoon van "Jan"', "Groep 5"]]);
  });

  it("negeert een byte order mark van Excel", () => {
    expect(leesTabel("﻿Naam;Klas", ";")).toEqual([["Naam", "Klas"]]);
  });
});

describe("herkennen van een klas", () => {
  it("ziet schoolklassen", () => {
    for (const waarde of ["Groep 3/4", "K3E", "3A", "8", "4havo", "klas 1b"]) {
      expect(lijktOpGroep(waarde), waarde).toBe(true);
    }
  });

  it("ziet een achternaam niet als klas", () => {
    for (const waarde of ["van der Velde", "Bakker", "Mooren-Verstegen"]) {
      expect(lijktOpGroep(waarde), waarde).toBe(false);
    }
  });
});

describe("lijst met kopregel", () => {
  it("leest voornaam, tussenvoegsel, achternaam en klas", () => {
    const lezing = leesLijst(
      [
        "Voornaam;Tussenvoegsel;Achternaam;Klas",
        "Lissa;van der;Velde;Groep 3/4",
        "Jan-Peter;;Bakker;Groep 5",
      ].join("\n"),
    );

    expect(lezing.kopregel).toBe(true);
    expect(lezing.problemen).toEqual([]);
    expect(lezing.regels.map((regel) => regel.naam)).toEqual(["Lissa van der Velde", "Jan-Peter Bakker"]);
    expect(lezing.regels.map((regel) => regel.groep)).toEqual(["Groep 3/4", "Groep 5"]);
  });

  it("leest een kolom Naam met een e-mailadres erbij", () => {
    const lezing = leesLijst("Naam,Klas,E-mail\nIlse Mooren-Verstegen,8,ouder@voorbeeld.nl");
    expect(lezing.regels[0]).toMatchObject({
      naam: "Ilse Mooren-Verstegen",
      groep: "8",
      email: "ouder@voorbeeld.nl",
    });
  });

  it("meldt een onbruikbaar e-mailadres maar houdt de leerling", () => {
    const lezing = leesLijst("Naam;Klas;E-mail\nTim van 't Hof;Groep 6;geenadres");
    expect(lezing.regels).toHaveLength(1);
    expect(lezing.problemen[0].reden).toContain("e-mailadres klopt niet");
  });
});

describe("lijst zonder kopregel", () => {
  it("raadt naam en klas bij twee kolommen", () => {
    const lezing = leesLijst("Lissa van der Velde;Groep 3/4\nJan-Peter Bakker;Groep 5");
    expect(lezing.kopregel).toBe(false);
    expect(lezing.kolommen).toEqual(["naam", "groep"]);
    expect(lezing.regels).toHaveLength(2);
  });

  it("raadt voornaam en achternaam als de tweede kolom geen klas is", () => {
    const lezing = leesLijst("Lissa;Velde\nJan;Bakker", "Groep 3/4");
    expect(lezing.kolommen).toEqual(["voornaam", "achternaam"]);
    expect(lezing.regels.map((regel) => regel.naam)).toEqual(["Lissa Velde", "Jan Bakker"]);
    expect(lezing.regels.every((regel) => regel.groep === "Groep 3/4")).toBe(true);
  });

  it("gebruikt de meegegeven klas als er geen klaskolom is", () => {
    const lezing = leesLijst("Lissa van der Velde\nJan-Peter Bakker", "K3E");
    expect(lezing.regels.map((regel) => regel.groep)).toEqual(["K3E", "K3E"]);
  });

  it("meldt regels zonder klas in plaats van ze stil weg te gooien", () => {
    const lezing = leesLijst("Lissa van der Velde\nJan-Peter Bakker");
    expect(lezing.regels).toHaveLength(0);
    expect(lezing.problemen).toHaveLength(2);
    expect(lezing.problemen[0]).toMatchObject({ regel: 1, reden: "geen klas of groep" });
  });
});

describe("rommel in de lijst", () => {
  it("slaat lege regels over zonder te klagen", () => {
    const lezing = leesLijst("Naam;Klas\nLissa van der Velde;Groep 3/4\n\n\nJan-Peter Bakker;Groep 5\n");
    expect(lezing.regels).toHaveLength(2);
    expect(lezing.problemen).toEqual([]);
  });

  it("meldt een dubbele leerling met het regelnummer erbij", () => {
    const lezing = leesLijst(
      ["Naam;Klas", "Lissa van der Velde;Groep 3/4", "Lissa v/d Velde;Groep 3/4"].join("\n"),
    );
    expect(lezing.regels).toHaveLength(1);
    expect(lezing.problemen[0].reden).toBe("staat ook al op regel 2");
  });

  it("ziet dezelfde naam in een andere klas als een andere leerling", () => {
    const lezing = leesLijst(
      ["Naam;Klas", "Lissa van der Velde;Groep 3/4", "Lissa van der Velde;Groep 5"].join("\n"),
    );
    expect(lezing.regels).toHaveLength(2);
    expect(lezing.problemen).toEqual([]);
  });

  it("meldt een regel zonder naam", () => {
    const lezing = leesLijst("Naam;Klas\n;Groep 3/4");
    expect(lezing.regels).toHaveLength(0);
    expect(lezing.problemen[0].reden).toBe("geen naam gevonden");
  });

  it("geeft niets terug bij een leeg bestand", () => {
    const lezing = leesLijst("   \n\n");
    expect(lezing.regels).toEqual([]);
    expect(lezing.problemen).toEqual([]);
  });
});

describe("terug naar tekst", () => {
  it("levert iets op dat de server weer kan inlezen", () => {
    const eerst = leesLijst("Naam;Klas;E-mail\nLissa van der Velde;Groep 3/4;ouder@voorbeeld.nl");
    const opnieuw = leesLijst(naarTekst(eerst.regels));
    expect(opnieuw.regels).toMatchObject([
      { naam: "Lissa van der Velde", groep: "Groep 3/4", email: "ouder@voorbeeld.nl" },
    ]);
  });
});
