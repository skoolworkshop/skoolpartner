import { describe, expect, it } from "vitest";

import {
  STANDAARD_REGELS,
  STANDAARD_VENSTERS,
  berekenVrijeMomenten,
  controleerVensters,
  dagenVanaf,
  isNogVrij,
  leesKlok,
  lokaleTijd,
  minutenOpDeDag,
  naarInstant,
  schrijfKlok,
  zoneOffsetOp,
  type BezetBlok,
  type BoekingsRegels,
} from "@/lib/crm/beschikbaarheid";

/**
 * Controles op de beschikbaarheid.
 *
 * De belangrijkste hiervan gaan over tijdzones. Een school ziet "dinsdag
 * 10:00" en dat betekent 10:00 in Nederland: in de zomer 08:00 UTC en in de
 * winter 09:00 UTC. Wie met een vast verschil rekent, heeft twee keer per jaar
 * een week lang afspraken die een uur verschoven staan.
 *
 * Verder:
 *   - een moment dat botst met de agenda of het CRM verdwijnt uit de lijst;
 *   - de buffer telt mee bij het botsen;
 *   - de opzegtermijn en de horizon snijden aan beide kanten af;
 *   - bij het echt boeken wordt opnieuw gerekend, want het scherm kan oud zijn.
 */

const AMS = "Europe/Amsterdam";

function regels(extra: Partial<BoekingsRegels> = {}): BoekingsRegels {
  return { ...STANDAARD_REGELS, vensters: STANDAARD_VENSTERS, ...extra };
}

// -----------------------------------------------------------------------------
// Tijdzones
// -----------------------------------------------------------------------------

describe("zoneOffsetOp", () => {
  it("geeft twee uur in de zomer", () => {
    expect(zoneOffsetOp(new Date("2026-07-15T12:00:00Z"), AMS)).toBe(120);
  });

  it("geeft een uur in de winter", () => {
    expect(zoneOffsetOp(new Date("2026-01-15T12:00:00Z"), AMS)).toBe(60);
  });

  it("geeft nul voor UTC", () => {
    expect(zoneOffsetOp(new Date("2026-07-15T12:00:00Z"), "UTC")).toBe(0);
  });
});

describe("lokaleTijd", () => {
  it("leest de klok in Amsterdam", () => {
    const lokaal = lokaleTijd(new Date("2026-07-15T08:30:00Z"), AMS);
    expect(lokaal.uur).toBe(10);
    expect(lokaal.minuut).toBe(30);
    expect(lokaal.datum).toBe("2026-07-15");
  });

  it("houdt rekening met een dag die in Nederland al is begonnen", () => {
    // 22:30 UTC is in Nederland al de volgende dag, 00:30.
    const lokaal = lokaleTijd(new Date("2026-07-15T22:30:00Z"), AMS);
    expect(lokaal.datum).toBe("2026-07-16");
    expect(lokaal.uur).toBe(0);
  });

  it("geeft de juiste weekdag", () => {
    // 15 juli 2026 is een woensdag.
    expect(lokaleTijd(new Date("2026-07-15T08:00:00Z"), AMS).weekdag).toBe(3);
  });
});

describe("naarInstant", () => {
  it("zet een zomerse ochtend om naar het juiste moment", () => {
    // 10:00 Nederlandse zomertijd is 08:00 UTC.
    expect(naarInstant("2026-07-15", 10 * 60, AMS).toISOString()).toBe("2026-07-15T08:00:00.000Z");
  });

  it("zet dezelfde kloktijd in de winter een uur anders om", () => {
    // 10:00 wintertijd is 09:00 UTC. Dit is de test die de hele
    // tijdzonebehandeling rechtvaardigt.
    expect(naarInstant("2026-01-15", 10 * 60, AMS).toISOString()).toBe("2026-01-15T09:00:00.000Z");
  });

  it("klopt ook op de dag dat de klok vooruit gaat", () => {
    // Laatste zondag van maart 2026 is 29 maart: om 02:00 wordt het 03:00.
    // Een afspraak om 10:00 die ochtend is dan gewoon zomertijd.
    expect(naarInstant("2026-03-29", 10 * 60, AMS).toISOString()).toBe("2026-03-29T08:00:00.000Z");
  });

  it("klopt ook op de dag dat de klok terug gaat", () => {
    // Laatste zondag van oktober 2026 is 25 oktober.
    expect(naarInstant("2026-10-25", 10 * 60, AMS).toISOString()).toBe("2026-10-25T09:00:00.000Z");
  });

  it("is omkeerbaar met minutenOpDeDag", () => {
    for (const datum of ["2026-01-15", "2026-03-29", "2026-07-15", "2026-10-25"]) {
      const instant = naarInstant(datum, 14 * 60 + 30, AMS);
      expect(minutenOpDeDag(instant, AMS)).toBe(14 * 60 + 30);
    }
  });
});

describe("dagenVanaf", () => {
  it("loopt netjes over een maandgrens", () => {
    expect(dagenVanaf("2026-01-30", 4)).toEqual([
      "2026-01-30",
      "2026-01-31",
      "2026-02-01",
      "2026-02-02",
    ]);
  });

  it("verdraagt een schrikkeljaar", () => {
    expect(dagenVanaf("2028-02-28", 3)).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
  });
});

// -----------------------------------------------------------------------------
// Vrije momenten
// -----------------------------------------------------------------------------

describe("berekenVrijeMomenten", () => {
  // Woensdag 15 juli 2026, 06:00 UTC is 08:00 in Nederland.
  const NU = new Date("2026-07-15T06:00:00Z");

  it("geeft momenten binnen het werkvenster, in lokale tijd", () => {
    const dagen = berekenVrijeMomenten(
      regels({ opzegtermijnUren: 0, horizonDagen: 1, rasterMinuten: 60, duurMinuten: 60 }),
      [],
      NU
    );

    const woensdag = dagen.find((d) => d.datum === "2026-07-15");
    expect(woensdag?.momenten[0].label).toBe("09:00");
    expect(woensdag?.momenten[0].startsAt).toBe("2026-07-15T07:00:00.000Z");
    // Negen tot vijf met blokken van een uur: laatste start om 16:00.
    expect(woensdag?.momenten.at(-1)?.label).toBe("16:00");
  });

  it("slaat een weekend over als daar geen venster staat", () => {
    const dagen = berekenVrijeMomenten(
      regels({ opzegtermijnUren: 0, horizonDagen: 7 }),
      [],
      NU
    );
    // 18 juli 2026 is een zaterdag, 19 juli een zondag.
    expect(dagen.map((d) => d.datum)).not.toContain("2026-07-18");
    expect(dagen.map((d) => d.datum)).not.toContain("2026-07-19");
  });

  it("houdt de opzegtermijn aan", () => {
    const dagen = berekenVrijeMomenten(
      regels({ opzegtermijnUren: 24, horizonDagen: 3, rasterMinuten: 60, duurMinuten: 60 }),
      [],
      NU
    );
    // Alles binnen 24 uur valt af, dus vandaag komt niet meer voor.
    expect(dagen.map((d) => d.datum)).not.toContain("2026-07-15");
    expect(dagen[0].datum).toBe("2026-07-16");
  });

  it("houdt de horizon aan", () => {
    const dagen = berekenVrijeMomenten(
      regels({ opzegtermijnUren: 0, horizonDagen: 2 }),
      [],
      NU
    );
    const laatste = dagen.at(-1);
    expect(Date.parse(laatste!.momenten[0].startsAt)).toBeLessThanOrEqual(
      NU.getTime() + 2 * 24 * 60 * 60_000
    );
  });

  it("laat een bezet blok uit de lijst verdwijnen", () => {
    const bezet: BezetBlok[] = [
      // 11:00 tot 12:00 lokaal, oftewel 09:00 tot 10:00 UTC.
      { startsAt: "2026-07-15T09:00:00Z", endsAt: "2026-07-15T10:00:00Z", bron: "agenda" },
    ];
    const dagen = berekenVrijeMomenten(
      regels({ opzegtermijnUren: 0, horizonDagen: 1, rasterMinuten: 60, duurMinuten: 60, bufferNaMinuten: 0 }),
      bezet,
      NU
    );

    const labels = dagen.find((d) => d.datum === "2026-07-15")?.momenten.map((m) => m.label);
    expect(labels).not.toContain("11:00");
    expect(labels).toContain("10:00");
    expect(labels).toContain("12:00");
  });

  it("rekent de buffer mee bij het botsen", () => {
    const bezet: BezetBlok[] = [
      { startsAt: "2026-07-15T09:00:00Z", endsAt: "2026-07-15T10:00:00Z" },
    ];
    const dagen = berekenVrijeMomenten(
      regels({
        opzegtermijnUren: 0,
        horizonDagen: 1,
        rasterMinuten: 60,
        duurMinuten: 60,
        bufferNaMinuten: 30,
        bufferVoorMinuten: 30,
      }),
      bezet,
      NU
    );

    const labels = dagen.find((d) => d.datum === "2026-07-15")?.momenten.map((m) => m.label);
    // Zonder buffer zouden 10:00 en 12:00 nog kunnen. Met een halfuur rust
    // ervoor en erna botsen ze allebei.
    expect(labels).not.toContain("10:00");
    expect(labels).not.toContain("11:00");
    expect(labels).not.toContain("12:00");
    expect(labels).toContain("13:00");
  });

  it("noemt aansluitend geen botsing", () => {
    const bezet: BezetBlok[] = [
      // Precies 09:00 tot 10:00 lokaal.
      { startsAt: "2026-07-15T07:00:00Z", endsAt: "2026-07-15T08:00:00Z" },
    ];
    const dagen = berekenVrijeMomenten(
      regels({ opzegtermijnUren: 0, horizonDagen: 1, rasterMinuten: 60, duurMinuten: 60, bufferNaMinuten: 0 }),
      bezet,
      NU
    );
    const labels = dagen.find((d) => d.datum === "2026-07-15")?.momenten.map((m) => m.label);
    expect(labels).not.toContain("09:00");
    expect(labels).toContain("10:00");
  });

  it("behandelt agenda en CRM als dezelfde soort blokkade", () => {
    const alleenAgenda = berekenVrijeMomenten(
      regels({ opzegtermijnUren: 0, horizonDagen: 1, rasterMinuten: 60, duurMinuten: 60, bufferNaMinuten: 0 }),
      [{ startsAt: "2026-07-15T09:00:00Z", endsAt: "2026-07-15T10:00:00Z", bron: "agenda" }],
      NU
    );
    const alleenCrm = berekenVrijeMomenten(
      regels({ opzegtermijnUren: 0, horizonDagen: 1, rasterMinuten: 60, duurMinuten: 60, bufferNaMinuten: 0 }),
      [{ startsAt: "2026-07-15T09:00:00Z", endsAt: "2026-07-15T10:00:00Z", bron: "crm" }],
      NU
    );
    expect(JSON.stringify(alleenAgenda)).toBe(JSON.stringify(alleenCrm));
  });

  it("geeft niets terug zonder vensters", () => {
    expect(berekenVrijeMomenten(regels({ vensters: [] }), [], NU)).toEqual([]);
  });

  it("geeft niets terug bij een duur van nul", () => {
    expect(berekenVrijeMomenten(regels({ duurMinuten: 0 }), [], NU)).toEqual([]);
  });

  it("negeert een venster dat eindigt voor het begint", () => {
    const dagen = berekenVrijeMomenten(
      regels({
        opzegtermijnUren: 0,
        horizonDagen: 1,
        vensters: [{ weekdag: 3, vanafMinuut: 17 * 60, totMinuut: 9 * 60 }],
      }),
      [],
      NU
    );
    expect(dagen).toEqual([]);
  });

  it("houdt een moment binnen het venster, ook het laatste", () => {
    const dagen = berekenVrijeMomenten(
      regels({
        opzegtermijnUren: 0,
        horizonDagen: 1,
        rasterMinuten: 30,
        duurMinuten: 45,
        vensters: [{ weekdag: 3, vanafMinuut: 9 * 60, totMinuut: 10 * 60 }],
      }),
      [],
      NU
    );
    const labels = dagen[0].momenten.map((m) => m.label);
    // 09:00 tot 09:45 past. 09:30 tot 10:15 niet.
    expect(labels).toEqual(["09:00"]);
  });

  it("werkt over de zomertijdgrens heen met de juiste kloktijden", () => {
    // Vrijdag 23 oktober 2026, met de klokwissel op zondag 25 oktober.
    const nu = new Date("2026-10-23T06:00:00Z");
    const dagen = berekenVrijeMomenten(
      regels({ opzegtermijnUren: 0, horizonDagen: 7, rasterMinuten: 60, duurMinuten: 60 }),
      [],
      nu
    );

    const voor = dagen.find((d) => d.datum === "2026-10-23");
    const na = dagen.find((d) => d.datum === "2026-10-26");

    // Allebei zien er voor de school hetzelfde uit: negen uur 's ochtends.
    expect(voor?.momenten[0].label).toBe("09:00");
    expect(na?.momenten[0].label).toBe("09:00");

    // Maar het echte moment verschilt een uur, en dat is precies goed.
    expect(voor?.momenten[0].startsAt).toBe("2026-10-23T07:00:00.000Z");
    expect(na?.momenten[0].startsAt).toBe("2026-10-26T08:00:00.000Z");
  });

  it("kapt het aantal momenten per dag af", () => {
    const dagen = berekenVrijeMomenten(
      regels({ opzegtermijnUren: 0, horizonDagen: 1, rasterMinuten: 15, duurMinuten: 30 }),
      [],
      NU,
      4
    );
    expect(dagen[0].momenten).toHaveLength(4);
  });
});

// -----------------------------------------------------------------------------
// De controle bij het echte boeken
// -----------------------------------------------------------------------------

describe("isNogVrij", () => {
  const NU = new Date("2026-07-15T06:00:00Z");
  const R = regels({ opzegtermijnUren: 0, horizonDagen: 1, rasterMinuten: 60, duurMinuten: 60, bufferNaMinuten: 0 });

  it("herkent een moment dat in de lijst staat", () => {
    expect(isNogVrij("2026-07-15T07:00:00.000Z", R, [], NU)).toBe(true);
  });

  it("weigert een moment dat inmiddels bezet is", () => {
    // Precies het geval waar dit voor bestaat: de bezoeker had de lijst al
    // open toen er iets in de agenda werd gezet.
    const bezet: BezetBlok[] = [
      { startsAt: "2026-07-15T07:00:00Z", endsAt: "2026-07-15T08:00:00Z" },
    ];
    expect(isNogVrij("2026-07-15T07:00:00.000Z", R, bezet, NU)).toBe(false);
  });

  it("weigert een moment dat niet op het raster valt", () => {
    // Iemand die met de hand een tijdstip in het formulier zet.
    expect(isNogVrij("2026-07-15T07:23:00.000Z", R, [], NU)).toBe(false);
  });

  it("weigert een moment buiten de werktijden", () => {
    expect(isNogVrij("2026-07-15T20:00:00.000Z", R, [], NU)).toBe(false);
  });

  it("weigert een moment in het verleden", () => {
    expect(isNogVrij("2026-07-14T07:00:00.000Z", R, [], NU)).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Vensters
// -----------------------------------------------------------------------------

describe("leesKlok en schrijfKlok", () => {
  it("leest een kloktijd", () => {
    expect(leesKlok("09:00")).toBe(540);
    expect(leesKlok("9:30")).toBe(570);
    expect(leesKlok("17:45")).toBe(1065);
  });

  it("weigert onzin", () => {
    expect(leesKlok("25:00")).toBeNull();
    expect(leesKlok("09:60")).toBeNull();
    expect(leesKlok("negen uur")).toBeNull();
    expect(leesKlok(null)).toBeNull();
  });

  it("is omkeerbaar", () => {
    expect(schrijfKlok(leesKlok("09:05")!)).toBe("09:05");
    expect(schrijfKlok(540)).toBe("09:00");
  });
});

describe("controleerVensters", () => {
  it("laat een normale werkweek door", () => {
    expect(controleerVensters(STANDAARD_VENSTERS)).toEqual([]);
  });

  it("weigert een venster dat eindigt voor het begint", () => {
    const fouten = controleerVensters([{ weekdag: 1, vanafMinuut: 1020, totMinuut: 540 }]);
    expect(fouten[0]).toContain("Maandag");
  });

  it("weigert twee vensters die elkaar overlappen", () => {
    // Overlappende vensters leveren dubbele momenten op in de lijst, dus die
    // worden geweigerd in plaats van stil samengevoegd.
    const fouten = controleerVensters([
      { weekdag: 2, vanafMinuut: 540, totMinuut: 720 },
      { weekdag: 2, vanafMinuut: 660, totMinuut: 1020 },
    ]);
    expect(fouten).toHaveLength(1);
    expect(fouten[0]).toContain("Dinsdag");
  });

  it("laat twee losse vensters op een dag gewoon toe", () => {
    // Ochtend en middag met een pauze ertussen is heel normaal.
    expect(
      controleerVensters([
        { weekdag: 2, vanafMinuut: 540, totMinuut: 720 },
        { weekdag: 2, vanafMinuut: 780, totMinuut: 1020 },
      ])
    ).toEqual([]);
  });
});
