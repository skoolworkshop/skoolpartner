import { describe, expect, it } from "vitest";

import {
  ACTIVITEIT_LABELS,
  HANDMATIGE_SOORTEN,
  isActiviteitSoort,
} from "@/lib/crm/tijdlijn";

/**
 * De datalaag van de tijdlijn praat met Supabase en wordt daarom niet hier
 * getest maar in scripts/verify-crm-tijdlijn.mjs, tegen een echte Postgres.
 * Wat hier staat is de logica die bepaalt wat een gebruiker mag kiezen, en dat
 * is precies het stuk waar een fout stil doorwerkt in een formulier.
 */

describe("soorten activiteiten", () => {
  it("herkent de bekende soorten", () => {
    for (const soort of Object.keys(ACTIVITEIT_LABELS)) {
      expect(isActiviteitSoort(soort)).toBe(true);
    }
  });

  it("weigert onbekende soorten", () => {
    expect(isActiviteitSoort("duifpost")).toBe(false);
    expect(isActiviteitSoort("")).toBe(false);
    expect(isActiviteitSoort(null)).toBe(false);
    expect(isActiviteitSoort(42)).toBe(false);
  });

  it("laat systeem niet met de hand kiezen", () => {
    // Een systeemregel is een weerslag van iets wat het systeem zelf deed.
    // Zou je die met de hand kunnen aanmaken, dan is de tijdlijn niet meer te
    // vertrouwen als verslag van wat er echt is gebeurd.
    expect(HANDMATIGE_SOORTEN).not.toContain("systeem");
    expect(isActiviteitSoort("systeem")).toBe(true);
  });

  it("heeft voor elke handmatige soort een label", () => {
    for (const soort of HANDMATIGE_SOORTEN) {
      expect(ACTIVITEIT_LABELS[soort]).toBeTruthy();
    }
  });

  it("heeft geen dubbele labels", () => {
    const labels = Object.values(ACTIVITEIT_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
