import { describe, expect, it } from "vitest";

import { CONTACT_TYPE_LABELS, isContactType } from "@/lib/crm/contacten";

/**
 * De datalaag van contacten praat met Supabase en wordt getest in
 * scripts/verify-crm-contacten.mjs, tegen een echte Postgres. Daar staat ook
 * het bewijs dat een contact geen gebruiker is.
 *
 * Wat hier staat is de lijst met soorten contacten. Die moet precies gelijk
 * lopen met de controle in de database: staat er hier eentje in die de
 * database niet kent, dan krijgt iemand pas bij het opslaan een foutmelding.
 */

/** Dezelfde waarden als in de check-constraint van migratie 031. */
const IN_DE_DATABASE = [
  "docent",
  "cultuurcoordinator",
  "decaan",
  "administratie",
  "directie",
  "ouder",
  "deelnemer",
  "opdrachtgever",
  "leverancier",
  "overig",
];

describe("soorten contacten", () => {
  it("loopt gelijk met wat de database toestaat", () => {
    expect(Object.keys(CONTACT_TYPE_LABELS).sort()).toEqual([...IN_DE_DATABASE].sort());
  });

  it("herkent alleen bekende soorten", () => {
    for (const soort of IN_DE_DATABASE) expect(isContactType(soort)).toBe(true);
    expect(isContactType("conciërge")).toBe(false);
    expect(isContactType("")).toBe(false);
    expect(isContactType(null)).toBe(false);
    expect(isContactType(7)).toBe(false);
  });

  it("heeft voor elke soort een leesbaar label", () => {
    for (const label of Object.values(CONTACT_TYPE_LABELS)) {
      expect(label.length).toBeGreaterThan(2);
      expect(label[0]).toBe(label[0].toUpperCase());
    }
  });

  it("heeft geen dubbele labels", () => {
    const labels = Object.values(CONTACT_TYPE_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
