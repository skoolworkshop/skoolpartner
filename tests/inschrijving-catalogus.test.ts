import { describe, expect, it } from "vitest";

import {
  STANDAARD_MAXIMUM,
  WORKSHOP_CATALOGUS,
  normaliseer,
  staatErAl,
  zoekWorkshops,
} from "@/lib/inschrijving/catalogus";

/**
 * Het workshopaanbod.
 *
 * Deze test bewaakt vooral twee dingen: dat er niets verzonnen in de lijst
 * sluipt, en dat dezelfde workshop nooit twee keer op één dag kan komen te
 * staan doordat hij net anders geschreven is.
 */

describe("de catalogus zelf", () => {
  it("bevat het hele aanbod", () => {
    expect(WORKSHOP_CATALOGUS.length).toBe(29);
  });

  it("heeft overal een naam die met Workshop begint", () => {
    expect(WORKSHOP_CATALOGUS.every((workshop) => workshop.naam.startsWith("Workshop "))).toBe(true);
  });

  it("wijst alleen naar echte pagina's op onze eigen website", () => {
    for (const workshop of WORKSHOP_CATALOGUS) {
      expect(workshop.url).toMatch(/^https:\/\/skoolworkshop\.nl\/workshops\/[a-z0-9-]+\/$/);
    }
  });

  it("staat op alfabetische volgorde", () => {
    const namen = WORKSHOP_CATALOGUS.map((workshop) => workshop.naam);
    expect([...namen].sort((a, b) => a.localeCompare(b, "nl"))).toEqual(namen);
  });

  it("bevat geen enkele naam dubbel", () => {
    const sleutels = WORKSHOP_CATALOGUS.map((workshop) => normaliseer(workshop.naam));
    expect(new Set(sleutels).size).toBe(sleutels.length);
  });

  it("houdt 25 aan als standaardmaximum", () => {
    expect(STANDAARD_MAXIMUM).toBe(25);
  });
});

describe("zoeken", () => {
  it("geeft alles terug zonder zoekterm", () => {
    expect(zoekWorkshops("")).toHaveLength(WORKSHOP_CATALOGUS.length);
    expect(zoekWorkshops("   ")).toHaveLength(WORKSHOP_CATALOGUS.length);
  });

  it("vindt op een deel van de naam", () => {
    expect(zoekWorkshops("graffiti").map((workshop) => workshop.naam)).toEqual([
      "Workshop Graffiti",
      "Workshop Light Graffiti",
    ]);
  });

  it("trekt zich niets aan van hoofdletters", () => {
    expect(zoekWorkshops("DJ")).toEqual(zoekWorkshops("dj"));
    expect(zoekWorkshops("dj")[0].naam).toBe("Workshop DJ Skills");
  });

  it("vindt op de soort", () => {
    const dans = zoekWorkshops("dans").map((workshop) => workshop.naam);
    expect(dans).toContain("Workshop Breakdance");
    expect(dans).toContain("Workshop Streetdance");
    expect(dans).toContain("Workshop Hiphop");
  });

  it("gebruikt alle woorden uit de zoekterm", () => {
    expect(zoekWorkshops("film maken").map((workshop) => workshop.naam)).toEqual([
      "Workshop Korte Film Maken",
    ]);
  });

  it("geeft niets terug bij onzin", () => {
    expect(zoekWorkshops("vioolbouwen")).toEqual([]);
  });
});

describe("dubbel voorkomen", () => {
  it("ziet dezelfde workshop ook als hij anders geschreven is", () => {
    expect(staatErAl("Workshop DJ Skills", ["Workshop dj skills"])).toBe(true);
    expect(staatErAl("Workshop Graffiti", ["graffiti"])).toBe(true);
    expect(staatErAl("Workshop T-shirt Ontwerpen", ["Workshop T shirt ontwerpen"])).toBe(true);
  });

  it("houdt verschillende workshops uit elkaar", () => {
    expect(staatErAl("Workshop Graffiti", ["Workshop Light Graffiti"])).toBe(false);
    expect(staatErAl("Workshop Hiphop", ["Workshop Streetdance", "Workshop Rap"])).toBe(false);
  });

  it("vindt niets in een lege dag", () => {
    expect(staatErAl("Workshop Rap", [])).toBe(false);
  });
});
