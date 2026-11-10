import { createHash, randomInt } from "node:crypto";

import { isCode, leesCode, maakCode } from "@/lib/inschrijving/codes";

/**
 * Wie mag er binnen, en hoe vaak mag iemand het proberen.
 *
 * TWEE LAGEN
 *
 *   De gedeelde toegangscode van een cultuurdag is de deur: hij zegt dat je
 *   bij deze dag hoort. Hij zegt niets over wie je bent. Daarvoor is de tweede
 *   laag: de persoonlijke code van de leerling, of een verificatiecode naar
 *   het adres dat de school van die leerling kent.
 *
 * WAAROM DIT BESTAND GEEN DATABASE KENT
 *
 *   Alles hier is rekenwerk: een code inlezen, een adres maskeren, beoordelen
 *   of een verificatiecode nog geldig is. Dat is precies het stuk waar de
 *   beveiliging in zit, en dat is zo los te testen zonder database erbij. Het
 *   opzoeken en wegschrijven staat in publiek.ts en dagen.ts.
 */

/** Standaardgrenzen. Te overschrijven via de instellingen. */
export const POGINGEN_MAX = 10;
export const POGINGEN_VENSTER_SECONDEN = 600;
export const VERIFICATIE_MINUTEN = 10;
export const VERIFICATIE_POGINGEN = 5;

/** Hoe een leerling zich bekendmaakt. */
export type Toegangswijze = "code" | "schoolmail" | "naam";

export function leesToegangswijze(waarde: string | null | undefined): Toegangswijze {
  return waarde === "schoolmail" || waarde === "naam" ? waarde : "code";
}

// -----------------------------------------------------------------------------
// De gedeelde code van een dag
// -----------------------------------------------------------------------------

/**
 * Een nieuwe gedeelde code.
 *
 * Acht tekens uit hetzelfde alfabet als de persoonlijke code: geen I, L, O en
 * U, want die worden aan de telefoon verkeerd overgeschreven. Acht uit 32 zijn
 * ruim duizend miljard combinaties, dus raden is zinloos. De pogingenteller is
 * er voor het geval iemand het toch met een script probeert.
 */
export function maakGedeeldeCode(): string {
  return maakCode(8);
}

/**
 * Wat iemand intypt omzetten naar de opgeslagen vorm, of null als het er niet
 * eens op lijkt. Streepjes en spaties mogen, hoofdletters hoeven niet.
 */
export function leesGedeeldeCode(ruw: string): string | null {
  const schoon = leesCode(ruw);
  return isCode(schoon) ? schoon : null;
}

/**
 * Hoort deze ingetypte code bij de code van de dag?
 *
 * Zonder code op de dag, of met een ingetrokken code, is het antwoord altijd
 * nee. Dat is bewust: een dag zonder gedeelde code hoort niet stil open te
 * staan voor iedereen met de link.
 */
export function vergelijkGedeeldeCode(
  ingetypt: string,
  dag: { shared_code: string | null; shared_code_active: boolean },
): "ok" | "fout" | "uit" {
  if (!dag.shared_code || !dag.shared_code_active) return "uit";
  return leesGedeeldeCode(ingetypt) === dag.shared_code ? "ok" : "fout";
}

// -----------------------------------------------------------------------------
// Verificatie per mail
// -----------------------------------------------------------------------------

/**
 * Het adres half verbergen.
 *
 * Genoeg om te herkennen dat het jouw schooladres is, te weinig om er de
 * adressen van een hele klas uit te vissen.
 */
export function maskeer(email: string): string {
  const apenstaartje = email.lastIndexOf("@");
  if (apenstaartje < 1) return "•••";
  const naam = email.slice(0, apenstaartje);
  const domein = email.slice(apenstaartje + 1);
  const zichtbaar = naam.length <= 2 ? naam.slice(0, 1) : naam.slice(0, 2);
  const punten = "•".repeat(Math.min(Math.max(naam.length - zichtbaar.length, 1), 6));
  return `${zichtbaar}${punten}@${domein}`;
}

/** Zes cijfers, zoals bij het inloggen van het klantportaal. */
export function maakVerificatiecode(): string {
  // randomInt van het systeem, niet Math.random: dat laatste is niet bedoeld
  // voor iets wat een slot opent.
  return String(randomInt(1_000_000)).padStart(6, "0");
}

/**
 * De versleutelde vorm van een verificatiecode.
 *
 * Het deelnemer-id gaat mee in de berekening. Zes cijfers zijn maar een
 * miljoen mogelijkheden, dus zonder zoiets zou één tabel met voorberekende
 * uitkomsten voor alle rijen tegelijk werken. Met het id erin is elke rij een
 * eigen rekensom.
 */
export function verificatieSleutel(deelnemerId: string, code: string): string {
  return createHash("sha256").update(`skoolpartner-verify:${deelnemerId}:${code}`).digest("hex");
}

export interface VerificatieRegel {
  code_hash: string;
  expires_at: string;
  attempts: number;
  used_at: string | null;
}

export type VerificatieOordeel =
  | { ok: true }
  | { ok: false; reden: "geen" | "verlopen" | "gebruikt" | "fout" | "tevaak" };

/**
 * Beoordelen of een ingetypte verificatiecode klopt.
 *
 * Rekenwerk zonder database, zodat alle grensgevallen los te testen zijn: een
 * code die verlopen is, een die al gebruikt is, en een die te vaak fout is
 * ingetypt. Vijf pogingen per code; daarna moet er een nieuwe aangevraagd
 * worden.
 */
export function beoordeelVerificatie(params: {
  regel: VerificatieRegel | null;
  deelnemerId: string;
  code: string;
  nu?: number;
}): VerificatieOordeel {
  const nu = params.nu ?? Date.now();
  const regel = params.regel;

  if (!regel) return { ok: false, reden: "geen" };
  if (regel.used_at) return { ok: false, reden: "gebruikt" };
  if (Date.parse(regel.expires_at) <= nu) return { ok: false, reden: "verlopen" };
  if (regel.attempts >= VERIFICATIE_POGINGEN) return { ok: false, reden: "tevaak" };

  const ingetypt = (params.code ?? "").replace(/\D/g, "");
  if (ingetypt.length !== 6 || verificatieSleutel(params.deelnemerId, ingetypt) !== regel.code_hash) {
    return { ok: false, reden: regel.attempts + 1 >= VERIFICATIE_POGINGEN ? "tevaak" : "fout" };
  }

  return { ok: true };
}

/** Het kenmerk waarop pogingen geteld worden. Nooit het adres zelf. */
export function bezoekerSleutel(vanaf: string): string {
  return createHash("sha256").update(`skoolpartner-poging:${vanaf}`).digest("hex").slice(0, 32);
}

/** De naam van de teller voor dit soort poging. */
export function pogingSleutel(soort: "gedeeld" | "code" | "naam" | "verificatie", vanaf: string): string {
  return `${soort}:${bezoekerSleutel(vanaf)}`;
}
