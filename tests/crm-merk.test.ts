import { describe, expect, it } from "vitest";

import {
  MERKEN,
  MERK_STIJL,
  STANDAARD_MERK,
  anderMerk,
  isMerk,
  merkLabel,
  parseMerk,
  sorteerFases,
  type Fase,
} from "@/lib/crm/merk";

function fase(overschrijf: Partial<Fase> & Pick<Fase, "key" | "position">): Fase {
  return {
    id: `id-${overschrijf.key}`,
    brand: "skool_workshop",
    label: overschrijf.key,
    description: null,
    is_won: false,
    is_lost: false,
    ...overschrijf,
  };
}

describe("parseMerk", () => {
  it("herkent de twee merken", () => {
    expect(parseMerk("skool_workshop")).toBe("skool_workshop");
    expect(parseMerk("suri_impact")).toBe("suri_impact");
  });

  it("is niet gevoelig voor hoofdletters en spaties", () => {
    expect(parseMerk("  Suri_Impact ")).toBe("suri_impact");
  });

  it("valt terug op het standaardmerk in plaats van te struikelen", () => {
    // Een kapotte cookie of een verzonnen zoekparameter hoort geen scherm om
    // te gooien.
    expect(parseMerk("hubspot")).toBe(STANDAARD_MERK);
    expect(parseMerk("")).toBe(STANDAARD_MERK);
    expect(parseMerk(null)).toBe(STANDAARD_MERK);
    expect(parseMerk(undefined)).toBe(STANDAARD_MERK);
    expect(parseMerk(42)).toBe(STANDAARD_MERK);
    expect(parseMerk({ merk: "suri_impact" })).toBe(STANDAARD_MERK);
  });
});

describe("isMerk", () => {
  it("is strenger dan parseMerk", () => {
    expect(isMerk("suri_impact")).toBe(true);
    expect(isMerk("Suri_Impact")).toBe(false);
    expect(isMerk("van alles")).toBe(false);
    expect(isMerk(null)).toBe(false);
  });
});

describe("de merken zelf", () => {
  it("heeft voor elk merk een volledige stijl", () => {
    for (const merk of MERKEN) {
      const stijl = MERK_STIJL[merk];
      expect(stijl.key).toBe(merk);
      expect(stijl.label.length).toBeGreaterThan(2);
      expect(stijl.omschrijving.length).toBeGreaterThan(10);
      expect(stijl.chip).toBeTruthy();
      expect(stijl.actief).toBeTruthy();
      expect(stijl.streep).toBeTruthy();
    }
  });

  it("geeft de twee merken een verschillende kleur", () => {
    // Als deze test faalt, lopen de merken in een gemengde lijst door elkaar.
    expect(MERK_STIJL.skool_workshop.streep).not.toBe(MERK_STIJL.suri_impact.streep);
    expect(MERK_STIJL.skool_workshop.chip).not.toBe(MERK_STIJL.suri_impact.chip);
  });

  it("wisselt naar het andere merk", () => {
    expect(anderMerk("skool_workshop")).toBe("suri_impact");
    expect(anderMerk("suri_impact")).toBe("skool_workshop");
  });

  it("noemt de merken bij hun naam", () => {
    expect(merkLabel("skool_workshop")).toBe("Skool Workshop");
    expect(merkLabel("suri_impact")).toBe("Suri Impact");
  });
});

describe("sorteerFases", () => {
  it("zet de lopende fases op volgorde en haalt begin en eind eruit", () => {
    const overzicht = sorteerFases([
      fase({ key: "verloren", position: 90, is_lost: true }),
      fase({ key: "offerte", position: 30 }),
      fase({ key: "aanvraag", position: 10 }),
      fase({ key: "ingepland", position: 50, is_won: true }),
      fase({ key: "contact", position: 20 }),
    ]);

    expect(overzicht.lopend.map((f) => f.key)).toEqual(["aanvraag", "contact", "offerte"]);
    expect(overzicht.gewonnen?.key).toBe("ingepland");
    expect(overzicht.verloren?.key).toBe("verloren");
  });

  it("verandert de meegegeven lijst niet", () => {
    const lijst = [fase({ key: "b", position: 20 }), fase({ key: "a", position: 10 })];
    sorteerFases(lijst);
    expect(lijst.map((f) => f.key)).toEqual(["b", "a"]);
  });

  it("kan overweg met een merk dat nog geen eindfases heeft", () => {
    const overzicht = sorteerFases([fase({ key: "start", position: 10 })]);
    expect(overzicht.lopend).toHaveLength(1);
    expect(overzicht.gewonnen).toBeNull();
    expect(overzicht.verloren).toBeNull();
  });

  it("valt bij dezelfde volgorde terug op het label", () => {
    const overzicht = sorteerFases([
      fase({ key: "zebra", position: 10, label: "Zebra" }),
      fase({ key: "appel", position: 10, label: "Appel" }),
    ]);
    expect(overzicht.lopend.map((f) => f.label)).toEqual(["Appel", "Zebra"]);
  });

  it("levert een lege lijst op als er nog niets is", () => {
    const overzicht = sorteerFases([]);
    expect(overzicht.lopend).toEqual([]);
    expect(overzicht.gewonnen).toBeNull();
  });
});
