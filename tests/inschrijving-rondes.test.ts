import { describe, expect, it } from "vitest";

import { controleerTijden, maakRooster, naarTijd, vatSamen } from "@/lib/inschrijving/rondes";

/**
 * Het dagrooster uitrekenen.
 *
 * De getallen hieronder zijn de roosters die Skool Workshop in het echt
 * draait: drie of vier rondes van een uur met een kwartier ertussen, en een
 * langere pauze rond het middaguur.
 */

describe("een rooster uitrekenen", () => {
  it("rekent twee rondes met een kwartier pauze uit", () => {
    const rooster = maakRooster({ aantal: 2, start: "09:15", duurMinuten: 60, pauzeMinuten: 15 });

    expect(rooster.fouten).toEqual([]);
    expect(rooster.regels).toEqual([
      { label: "Workshopronde 1", begin: "09:15", eind: "10:15", pauze: false },
      { label: "Pauze", begin: "10:15", eind: "10:30", pauze: true },
      { label: "Workshopronde 2", begin: "10:30", eind: "11:30", pauze: false },
    ]);
    expect(rooster.eindtijd).toBe("11:30");
  });

  it("rekent drie rondes uit", () => {
    const rooster = maakRooster({ aantal: 3, start: "09:00", duurMinuten: 45, pauzeMinuten: 10 });
    const rondes = rooster.regels.filter((regel) => !regel.pauze);

    expect(rondes.map((regel) => `${regel.begin}-${regel.eind}`)).toEqual([
      "09:00-09:45",
      "09:55-10:40",
      "10:50-11:35",
    ]);
    expect(rooster.eindtijd).toBe("11:35");
  });

  it("rekent vier rondes met een lunch na de tweede uit", () => {
    const rooster = maakRooster({
      aantal: 4,
      start: "09:15",
      duurMinuten: 60,
      pauzeMinuten: 15,
      langePauzeNa: 2,
      langePauzeMinuten: 45,
    });

    expect(rooster.fouten).toEqual([]);
    expect(rooster.regels.map((regel) => `${regel.label} ${regel.begin}-${regel.eind}`)).toEqual([
      "Workshopronde 1 09:15-10:15",
      "Pauze 10:15-10:30",
      "Workshopronde 2 10:30-11:30",
      "Pauze (lunch) 11:30-12:15",
      "Workshopronde 3 12:15-13:15",
      "Pauze 13:15-13:30",
      "Workshopronde 4 13:30-14:30",
    ]);
    expect(rooster.eindtijd).toBe("14:30");
  });

  it("zet geen pauze achter de laatste ronde", () => {
    const rooster = maakRooster({ aantal: 2, start: "10:00", duurMinuten: 60, pauzeMinuten: 30 });
    expect(rooster.regels.at(-1)?.pauze).toBe(false);
  });

  it("laat de pauze weg als die nul is", () => {
    const rooster = maakRooster({ aantal: 3, start: "09:00", duurMinuten: 50, pauzeMinuten: 0 });
    expect(rooster.regels.every((regel) => !regel.pauze)).toBe(true);
    expect(rooster.regels).toHaveLength(3);
    expect(rooster.eindtijd).toBe("11:30");
  });

  it("laat één ronde gewoon toe", () => {
    const rooster = maakRooster({ aantal: 1, start: "13:00", duurMinuten: 90, pauzeMinuten: 15 });
    expect(rooster.regels).toEqual([
      { label: "Workshopronde 1", begin: "13:00", eind: "14:30", pauze: false },
    ]);
  });

  it("neemt een eigen naam over", () => {
    const rooster = maakRooster({ aantal: 2, start: "09:00", duurMinuten: 60, pauzeMinuten: 0, naam: "Blok" });
    expect(rooster.regels.map((regel) => regel.label)).toEqual(["Blok 1", "Blok 2"]);
  });

  it("vat het rooster samen voor op het scherm", () => {
    const rooster = maakRooster({ aantal: 4, start: "09:15", duurMinuten: 60, pauzeMinuten: 15 });
    // 4 x 60 minuten plus 3 x 15 minuten pauze vanaf 09:15 is klaar om 14:00.
    expect(vatSamen(rooster)).toBe("4 rondes van 60 minuten, van 09:15 tot 14:00");
  });
});

describe("wat er niet klopt", () => {
  it("weigert een onmogelijke begintijd", () => {
    expect(maakRooster({ aantal: 2, start: "25:00", duurMinuten: 60, pauzeMinuten: 15 }).fouten).toContain(
      "Vul een begintijd in, bijvoorbeeld 09:15.",
    );
    expect(maakRooster({ aantal: 2, start: "negen uur", duurMinuten: 60, pauzeMinuten: 15 }).regels).toEqual([]);
  });

  it("weigert een ronde die te kort of te lang is", () => {
    expect(maakRooster({ aantal: 2, start: "09:00", duurMinuten: 5, pauzeMinuten: 0 }).fouten).toContain(
      "Een ronde duurt minstens 15 minuten.",
    );
    expect(maakRooster({ aantal: 2, start: "09:00", duurMinuten: 300, pauzeMinuten: 0 }).fouten.length).toBe(1);
  });

  it("weigert meer dan tien rondes", () => {
    expect(maakRooster({ aantal: 11, start: "08:00", duurMinuten: 30, pauzeMinuten: 0 }).fouten).toContain(
      "Tien rondes is het maximum.",
    );
  });

  it("weigert een dag die doorloopt tot na middernacht", () => {
    const rooster = maakRooster({ aantal: 6, start: "22:00", duurMinuten: 60, pauzeMinuten: 15 });
    expect(rooster.regels).toEqual([]);
    expect(rooster.fouten[0]).toContain("middernacht");
  });

  it("weigert een lange pauze na een ronde die er niet is", () => {
    const rooster = maakRooster({
      aantal: 2,
      start: "09:00",
      duurMinuten: 60,
      pauzeMinuten: 15,
      langePauzeNa: 4,
      langePauzeMinuten: 45,
    });
    expect(rooster.fouten[0]).toContain("lange pauze");
  });
});

describe("tijden die met de hand zijn aangepast", () => {
  const rooster = maakRooster({ aantal: 3, start: "09:15", duurMinuten: 60, pauzeMinuten: 15 });

  it("vindt niets mis met een rooster dat klopt", () => {
    expect(controleerTijden(rooster.regels)).toEqual([]);
  });

  it("ziet het als twee rondes over elkaar heen vallen", () => {
    const aangepast = rooster.regels.map((regel, index) =>
      index === 2 ? { ...regel, begin: "10:00" } : regel,
    );
    const problemen = controleerTijden(aangepast);
    expect(problemen).toHaveLength(1);
    expect(problemen[0].tekst).toContain("10:00");
  });

  it("ziet een eindtijd die voor de begintijd ligt", () => {
    const aangepast = rooster.regels.map((regel, index) =>
      index === 0 ? { ...regel, eind: "08:00" } : regel,
    );
    expect(controleerTijden(aangepast)[0].tekst).toContain("eindtijd");
  });

  it("laat een gat tussen twee rondes gewoon toe", () => {
    // Een uur niets tussen ronde 2 en 3 is geen fout: dan eet de school langer.
    const aangepast = rooster.regels.map((regel, index) =>
      index === 4 ? { ...regel, begin: "13:00", eind: "14:00" } : regel,
    );
    expect(controleerTijden(aangepast)).toEqual([]);
  });
});

describe("tijd omrekenen", () => {
  it("zet minuten om naar uu:mm", () => {
    expect(naarTijd(0)).toBe("00:00");
    expect(naarTijd(555)).toBe("09:15");
    expect(naarTijd(1439)).toBe("23:59");
  });
});
