import { describe, expect, it } from "vitest";

import {
  blokkades,
  controleerRooster,
  geraaktDoorKlasbeperking,
  keuzesVoor,
  magErin,
  type Rooster,
  type RoosterUitvoering,
} from "@/lib/inschrijving/rooster";

function uitvoering(
  id: string,
  rondeId: string,
  workshopId: string,
  opties: Partial<RoosterUitvoering> = {},
): RoosterUitvoering {
  return {
    id,
    rondeId,
    workshopId,
    actief: true,
    maximum: 25,
    bezet: 0,
    klassen: [],
    ...opties,
  };
}

/** Een cultuurdag zoals er echt een is: drie rondes, vier workshops, twee klassen. */
function rooster(aanpassing: (basis: Rooster) => Rooster = (basis) => basis): Rooster {
  const rondes = [
    { id: "r1", label: "Ronde 1" },
    { id: "r2", label: "Ronde 2" },
    { id: "r3", label: "Ronde 3" },
  ];
  const workshops = ["drums", "dj", "hiphop", "graffiti"].map((id) => ({
    id,
    naam: id,
    uitvoeringen: rondes.map((ronde) => uitvoering(`${id}-${ronde.id}`, ronde.id, id)),
  }));

  return aanpassing({
    rondes,
    groepen: [
      { id: "h1", naam: "1 HAVO", aantal: 25 },
      { id: "v1", naam: "1 VWO", aantal: 25 },
    ],
    workshops,
    herhalingToegestaan: false,
  });
}

describe("mag deze klas erin", () => {
  it("laat iedereen toe als er niets is aangevinkt", () => {
    expect(magErin(uitvoering("a", "r1", "w"), "h1")).toBe(true);
  });

  it("laat alleen de aangevinkte klassen toe", () => {
    const beperkt = uitvoering("a", "r1", "w", { klassen: ["h1"] });
    expect(magErin(beperkt, "h1")).toBe(true);
    expect(magErin(beperkt, "v1")).toBe(false);
  });
});

describe("wat een klas kan kiezen", () => {
  it("toont alleen de workshops van die ronde waar de klas in mag", () => {
    const basis = rooster((r) => {
      r.workshops[3].uitvoeringen[0].klassen = ["v1"];
      return r;
    });

    expect(keuzesVoor(basis, "h1", "r1").map((u) => u.workshopId)).toEqual(["drums", "dj", "hiphop"]);
    expect(keuzesVoor(basis, "v1", "r1").map((u) => u.workshopId)).toEqual(["drums", "dj", "hiphop", "graffiti"]);
  });

  it("telt een uitvoering die uit staat niet mee", () => {
    const basis = rooster((r) => {
      r.workshops[0].uitvoeringen[1].actief = false;
      return r;
    });
    expect(keuzesVoor(basis, "h1", "r2").map((u) => u.workshopId)).toEqual(["dj", "hiphop", "graffiti"]);
  });
});

describe("een rooster dat klopt", () => {
  it("geeft geen enkele melding", () => {
    expect(controleerRooster(rooster())).toEqual([]);
  });

  it("vindt het goed als een workshop maar in één ronde draait", () => {
    const basis = rooster((r) => {
      r.workshops[3].uitvoeringen[0].actief = false;
      r.workshops[3].uitvoeringen[2].actief = false;
      return r;
    });
    expect(blokkades(basis)).toEqual([]);
  });
});

describe("blokkades", () => {
  it("merkt een ronde zonder workshops op", () => {
    const basis = rooster((r) => {
      for (const workshop of r.workshops) workshop.uitvoeringen[1].actief = false;
      return r;
    });
    expect(blokkades(basis).map((w) => w.tekst)).toContain("In Ronde 2 draait geen enkele workshop.");
  });

  it("merkt een klas op die in een ronde niets kan kiezen", () => {
    const basis = rooster((r) => {
      for (const workshop of r.workshops) workshop.uitvoeringen[0].klassen = ["v1"];
      return r;
    });
    expect(blokkades(basis).map((w) => w.tekst)).toContain("1 HAVO kan in Ronde 1 niets kiezen.");
  });

  it("rekent uit dat er te weinig plekken zijn", () => {
    const basis = rooster((r) => {
      r.groepen = [{ id: "h1", naam: "1 HAVO", aantal: 30 }];
      for (const workshop of r.workshops) {
        for (const u of workshop.uitvoeringen) u.klassen = ["h1"];
      }
      for (const workshop of r.workshops.slice(1)) {
        for (const u of workshop.uitvoeringen) u.actief = false;
      }
      r.workshops[0].uitvoeringen[0].maximum = 25;
      return r;
    });

    const tekst = blokkades(basis).map((w) => w.tekst);
    expect(tekst).toContain("1 HAVO heeft in Ronde 1 25 vrije plekken voor 30 leerlingen.");
  });

  it("merkt op dat er te weinig verschillende workshops zijn zonder herhaling", () => {
    const basis = rooster((r) => {
      for (const workshop of r.workshops.slice(2)) {
        for (const u of workshop.uitvoeringen) u.actief = false;
      }
      return r;
    });

    const tekst = blokkades(basis).map((w) => w.tekst);
    expect(tekst.some((regel) => regel.includes("2 verschillende workshops kiezen voor 3 rondes"))).toBe(true);
  });

  it("laat datzelfde rooster wel door als herhaling aan staat", () => {
    const basis = rooster((r) => {
      for (const workshop of r.workshops.slice(2)) {
        for (const u of workshop.uitvoeringen) u.actief = false;
      }
      r.herhalingToegestaan = true;
      return r;
    });
    expect(blokkades(basis)).toEqual([]);
  });

  it("zegt het als er nog geen rondes of klassen zijn", () => {
    expect(controleerRooster({ rondes: [], groepen: [], workshops: [], herhalingToegestaan: false })[0].tekst).toBe(
      "Er is nog geen enkele ronde.",
    );
  });
});

describe("waarschuwingen die niets tegenhouden", () => {
  it("meldt een workshop die nergens aan staat", () => {
    const basis = rooster((r) => {
      for (const u of r.workshops[1].uitvoeringen) u.actief = false;
      return r;
    });

    const meldingen = controleerRooster(basis);
    expect(meldingen.some((w) => w.soort === "let op" && w.tekst === "dj staat in geen enkele ronde aan.")).toBe(true);
  });
});

describe("wie raakt een klasbeperking", () => {
  const deelnemers = [
    { naam: "Lissa van der Velde", groepId: "h1" },
    { naam: "Ilse Mooren", groepId: "v1" },
  ];

  it("noemt de leerlingen die er straks niet meer in zouden mogen", () => {
    expect(geraaktDoorKlasbeperking(deelnemers, ["h1"])).toEqual(["Ilse Mooren"]);
  });

  it("raakt niemand als alles open blijft", () => {
    expect(geraaktDoorKlasbeperking(deelnemers, [])).toEqual([]);
  });

  it("raakt niemand als iedereen in de nieuwe selectie past", () => {
    expect(geraaktDoorKlasbeperking(deelnemers, ["h1", "v1"])).toEqual([]);
  });
});

/**
 * Pauzes zijn geen workshoprondes.
 *
 * WAT ER MIS GING
 *
 *   Een dag met drie workshoprondes en een lunchpauze kwam er niet door. De
 *   pauze werd als gewone ronde nagekeken, en dan klopt er niets: er draait
 *   geen workshop in, dus kreeg je "In Pauze (lunch) draait geen enkele
 *   workshop" en daarna voor elk van de negentien klassen "A1BK1 kan in Pauze
 *   (lunch) niets kiezen". Negentien keer dezelfde blokkade voor iets wat
 *   precies goed stond.
 */
describe("een rooster met een lunchpauze", () => {
  function metPauze(aanpassing: (basis: Rooster) => Rooster = (basis) => basis): Rooster {
    const basis = rooster(aanpassing);
    return {
      ...basis,
      // De pauze staat tussen ronde 2 en 3, zoals de roostergenerator hem zet.
      rondes: [
        basis.rondes[0],
        basis.rondes[1],
        { id: "pauze-1", label: "Pauze (lunch)", pauze: true },
        basis.rondes[2],
      ],
    };
  }

  it("laat de dag gewoon opengaan", () => {
    expect(blokkades(metPauze())).toEqual([]);
  });

  it("klaagt niet dat er in de pauze geen workshop draait", () => {
    const meldingen = controleerRooster(metPauze()).map((waarschuwing) => waarschuwing.tekst);
    expect(meldingen.some((tekst) => tekst.includes("Pauze"))).toBe(false);
  });

  it("vraagt geen keuze van een klas tijdens de pauze", () => {
    const meldingen = controleerRooster(metPauze()).map((waarschuwing) => waarschuwing.tekst);
    expect(meldingen.some((tekst) => tekst.includes("kan in Pauze"))).toBe(false);
  });

  it("telt de pauze niet mee bij het aantal verschillende workshops dat nodig is", () => {
    // Drie workshoprondes en precies drie bereikbare workshops is genoeg.
    // Zou de pauze meetellen, dan waren er vier nodig en kwam er een blokkade.
    const krap = metPauze((basis) => ({
      ...basis,
      workshops: basis.workshops.slice(0, 3),
    }));
    expect(blokkades(krap)).toEqual([]);
  });

  it("kijkt wel gewoon naar de echte rondes", () => {
    // In ronde 2 staat alles uit: dat hoort nog steeds een blokkade te zijn.
    const stuk = metPauze((basis) => ({
      ...basis,
      workshops: basis.workshops.map((workshop) => ({
        ...workshop,
        uitvoeringen: workshop.uitvoeringen.map((uitvoering) =>
          uitvoering.rondeId === "r2" ? { ...uitvoering, actief: false } : uitvoering,
        ),
      })),
    }));
    const meldingen = blokkades(stuk).map((waarschuwing) => waarschuwing.tekst);
    expect(meldingen).toContain("In Ronde 2 draait geen enkele workshop.");
  });

  it("weigert een dag waarop alleen pauzes staan", () => {
    const alleenPauze: Rooster = {
      ...rooster(),
      rondes: [{ id: "pauze-1", label: "Pauze (lunch)", pauze: true }],
    };
    const meldingen = blokkades(alleenPauze).map((waarschuwing) => waarschuwing.tekst);
    expect(meldingen).toHaveLength(1);
    expect(meldingen[0]).toContain("minstens één workshopronde");
  });

  it("zegt nog steeds iets zinnigs als er helemaal geen ronde is", () => {
    const leeg: Rooster = { ...rooster(), rondes: [] };
    expect(blokkades(leeg).map((waarschuwing) => waarschuwing.tekst)).toEqual([
      "Er is nog geen enkele ronde.",
    ]);
  });
});
