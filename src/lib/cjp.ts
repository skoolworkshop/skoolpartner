/**
 * Het CJP-schoolnummer.
 *
 * Bewust geen streng formaat. Wij hebben geen betrouwbare bron gevonden voor
 * de opbouw van een CJP-schoolnummer, en een verkeerde aanname over lengte of
 * "alleen cijfers" houdt scholen tegen die wel gewoon een geldig nummer hebben.
 * Daarom alleen: spaties eraf, dubbele spaties samenvoegen, en een ruime
 * lengtegrens die overduidelijke typefouten tegenhoudt.
 *
 * Het nummer hoort bij de organisatie, niet bij een persoon. Alle medewerkers
 * van dezelfde school zien dus hetzelfde nummer.
 */

export interface CjpResult {
  ok: boolean;
  /** Genormaliseerd, klaar om op te slaan. Leeg betekent: geen nummer. */
  value?: string | null;
  message?: string;
}

export function normalizeCjpNumber(raw: string): CjpResult {
  const schoon = raw.trim().replace(/\s+/g, " ");

  if (schoon === "") return { ok: true, value: null };

  if (schoon.length < 3) {
    return { ok: false, message: "Dit CJP-schoolnummer lijkt te kort." };
  }
  if (schoon.length > 40) {
    return { ok: false, message: "Dit CJP-schoolnummer lijkt te lang." };
  }

  return { ok: true, value: schoon };
}

export type CjpAnswer = "ja" | "nee" | "onbekend";

/** Zet het antwoord uit het formulier om naar wat er in de database komt. */
export function cjpAnswerToBoolean(answer: string): boolean | null {
  if (answer === "ja") return true;
  if (answer === "nee") return false;
  return null;
}

export function booleanToCjpAnswer(value: boolean | null | undefined): CjpAnswer {
  if (value === true) return "ja";
  if (value === false) return "nee";
  return "onbekend";
}

/** Wat de klant en de beheerder te zien krijgen. */
export function describeCjp(params: {
  hasCjp: boolean | null | undefined;
  number: string | null | undefined;
}): string {
  if (params.number) return params.number;
  if (params.hasCjp === true) return "Nog niet ingevuld";
  if (params.hasCjp === false) return "Deze organisatie heeft geen CJP-schoolnummer";
  return "Niet ingevuld";
}

/**
 * Moeten wij vragen om aanvulling?
 *
 * Alleen als de school zelf heeft gezegd er een te hebben. Wie "nee" of "weet
 * ik niet" heeft gezegd, wordt niet lastiggevallen.
 */
export function needsCjpCompletion(params: {
  hasCjp: boolean | null | undefined;
  number: string | null | undefined;
}): boolean {
  return params.hasCjp === true && !params.number;
}
