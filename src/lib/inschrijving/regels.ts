import type { EnrollmentAudience, EnrollmentStatus } from "@/lib/types/database";

/**
 * De regels en woorden van het inschrijfsysteem, zonder database eromheen.
 *
 * Dit bestand mag overal gebruikt worden, ook in een component dat in de
 * browser draait. De vragen aan de database staan in dagen.ts, en dat bestand
 * is bewust alleen op de server te gebruiken.
 */

export const STATUS_LABELS: Record<EnrollmentStatus, string> = {
  concept: "Concept",
  open: "Inschrijving open",
  gesloten: "Gesloten",
  afgerond: "Afgerond",
};

/**
 * Dezelfde tabellen, andere woorden.
 *
 * Een school denkt in klassen en leerlingen, een bedrijf in teams en
 * deelnemers. Technisch is het hetzelfde, dus dat verschil zit alleen hier en
 * op het scherm. Zo hoeft een zakelijke klant nooit naar het woord klas te
 * kijken, en hoeft er geen tweede systeem naast.
 */
export interface Woorden {
  groep: string;
  groepen: string;
  deelnemer: string;
  deelnemers: string;
}

export function woorden(audience: EnrollmentAudience): Woorden {
  return audience === "organisatie"
    ? { groep: "team", groepen: "teams", deelnemer: "deelnemer", deelnemers: "deelnemers" }
    : { groep: "klas", groepen: "klassen", deelnemer: "leerling", deelnemers: "leerlingen" };
}

/** Een woord in enkelvoud of meervoud, met het aantal ervoor. */
export function aantalMet(aantal: number, enkel: string, meer: string): string {
  return `${aantal} ${aantal === 1 ? enkel : meer}`;
}
