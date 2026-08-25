import { extractBooking, minutesBetween } from "./extract";
import type { ParseResult, ParserInput, ParserSettings } from "./types";

export * from "./types";
export * from "./extract";

export const PARSER_VERSION = "v1";

/**
 * Patronen die een e-mail juist DISKWALIFICEREN als definitieve bevestiging.
 * Een aanvraag, offerte, vraag, wijzigingsverzoek of interne mail mag nooit
 * automatisch als boeking worden gezien.
 */
const DISQUALIFYING_SUBJECT = [
  /offerte/i,
  /aanvraag/i,
  /voorstel/i,
  /vrijblijvend/i,
  /wijzig/i,
  /annuler/i,
  /herinnering/i,
  /concept/i,
  /^re:.*vraag/i,
  /^fwd?:/i,
  /automatisch antwoord/i,
  /out of office/i,
  /afwezig/i,
  /nieuwsbrief/i,
  /factuur/i,
];

const DISQUALIFYING_BODY = [
  /dit is een offerte/i,
  /vrijblijvende offerte/i,
  /nog niet definitief/i,
  /onder voorbehoud/i,
  /wij hebben uw aanvraag ontvangen/i,
];

const CONFIRMING_SUBJECT = [
  /boekingsbevestiging/i,
  /definitieve bevestiging/i,
  /bevestiging (van )?(uw|je) (workshop|boeking|reservering)/i,
  /^bevestiging\b/i,
];

const CONFIRMING_BODY = [
  /de boeking is definitief/i,
  /hierbij bevestigen wij (uw|je) boeking/i,
  /uw boeking is bevestigd/i,
  /definitief ingepland/i,
];

const STRUCTURED_FIELDS = [
  /^\s*workshop\s*[:\-–]/im,
  /^\s*datum\s*[:\-–]/im,
  /^\s*tijd(en)?\s*[:\-–]/im,
  /^\s*locatie\s*[:\-–]/im,
];

function domainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const match = email.match(/@([\w.-]+)/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Bepaalt of een e-mail een definitieve boekingsbevestiging is en haalt de
 * boekingsgegevens eruit.
 *
 * De zekerheid wordt opgebouwd uit onafhankelijke, deterministische signalen.
 * Het Gmail-label is daarbij het sterkste signaal, omdat Skool Workshop dat
 * zelf op de definitieve bevestiging zet.
 */
export function parseConfirmationEmail(
  input: ParserInput,
  settings: ParserSettings
): ParseResult {
  const signals: string[] = [];
  const reviewReasons: string[] = [];
  const subject = input.subject ?? "";
  const body = input.bodyText ?? "";

  // Harde uitsluitingen eerst.
  const autoSubmitted = input.headers?.["auto-submitted"];
  if (autoSubmitted && autoSubmitted !== "no") {
    return blocked("Automatisch gegenereerd bericht", input);
  }
  if (input.headers?.["x-autoreply"] || input.headers?.["x-autorespond"]) {
    return blocked("Automatisch antwoord", input);
  }
  for (const pattern of DISQUALIFYING_SUBJECT) {
    if (pattern.test(subject)) return blocked(`Onderwerp duidt niet op een bevestiging`, input);
  }
  for (const pattern of DISQUALIFYING_BODY) {
    if (pattern.test(body)) return blocked("Tekst duidt op een offerte of aanvraag", input);
  }

  let confidence = 0;

  // 1. Gmail-label: het meest betrouwbare, deterministische signaal.
  const labels = input.labels ?? [];
  const hasLabel = labels.some(
    (label) => label.toLowerCase() === settings.confirmationLabel.toLowerCase()
  );
  if (hasLabel) {
    confidence += 0.55;
    signals.push(`Gmail-label "${settings.confirmationLabel}" aanwezig`);
  }

  // 2. Afzenderdomein.
  const fromDomain = domainOf(input.from);
  if (fromDomain && settings.allowedFromDomains.map((d) => d.toLowerCase()).includes(fromDomain)) {
    confidence += 0.15;
    signals.push(`Afzender is ${fromDomain}`);
  } else {
    reviewReasons.push("Afzenderdomein staat niet in de lijst met toegestane domeinen");
  }

  // 3. Onderwerp.
  if (CONFIRMING_SUBJECT.some((pattern) => pattern.test(subject))) {
    confidence += 0.15;
    signals.push("Onderwerp bevat een bevestigingspatroon");
  }

  // 4. Bevestigende zin in de tekst.
  if (CONFIRMING_BODY.some((pattern) => pattern.test(body))) {
    confidence += 0.1;
    signals.push("Tekst bevestigt de boeking expliciet");
  }

  // 5. Gestructureerd blok met workshopgegevens.
  const structuredHits = STRUCTURED_FIELDS.filter((pattern) => pattern.test(body)).length;
  if (structuredHits >= 3) {
    confidence += 0.15;
    signals.push("Gestructureerde workshopgegevens gevonden");
  } else if (structuredHits > 0) {
    confidence += 0.05;
    reviewReasons.push("Niet alle standaardvelden staan in de e-mail");
  } else {
    reviewReasons.push("Geen gestructureerde workshopgegevens gevonden");
  }

  const extracted = extractBooking(body, subject);

  // 6. Boekingsreferentie.
  if (extracted.reference) {
    confidence += 0.1;
    signals.push(`Boekingsreferentie ${extracted.reference} gevonden`);
  }

  // Duur afleiden uit begin- en eindtijd wanneer er één workshop is.
  if (!extracted.minutesPerWorkshop && extracted.startTime && extracted.endTime) {
    const span = minutesBetween(extracted.startTime, extracted.endTime);
    if (span && (extracted.workshopCount ?? 1) === 1) {
      extracted.minutesPerWorkshop = span;
      signals.push("Duur afgeleid uit begin- en eindtijd");
    } else if (span) {
      reviewReasons.push(
        "Duur per workshop niet vermeld; totale tijdspanne is niet zomaar door het aantal workshops te delen"
      );
    }
  }

  // Verplichte velden controleren.
  if (!extracted.workshopName) reviewReasons.push("Workshopnaam ontbreekt");
  if (!extracted.date) reviewReasons.push("Datum ontbreekt of is onduidelijk");
  if (!extracted.minutesPerWorkshop) reviewReasons.push("Workshopduur ontbreekt");
  if (!extracted.workshopCount) {
    extracted.workshopCount = 1;
    reviewReasons.push("Aantal workshops niet vermeld, voorlopig op 1 gezet");
  }
  if (!extracted.organizationName && !extracted.contactEmail) {
    reviewReasons.push("Organisatie of contactpersoon niet herkend");
  }

  if (
    extracted.minutesPerWorkshop &&
    extracted.workshopCount &&
    extracted.minutesPerWorkshop * extracted.workshopCount < settings.minimumBookingMinutes
  ) {
    reviewReasons.push(
      `Totale duur ligt onder de minimale afname van ${settings.minimumBookingMinutes} minuten`
    );
  }

  const finalConfidence = Math.max(0, Math.min(1, confidence));

  // Zonder label én zonder duidelijke bevestigingssignalen is dit geen boeking.
  const isConfirmation = hasLabel || finalConfidence >= 0.45;

  if (!isConfirmation) {
    reviewReasons.push("Onvoldoende signalen om dit als definitieve bevestiging te zien");
  }

  return {
    isConfirmation,
    confidence: finalConfidence,
    signals,
    reviewReasons,
    extracted,
    parserVersion: PARSER_VERSION,
  };
}

function blocked(reason: string, input: ParserInput): ParseResult {
  return {
    isConfirmation: false,
    confidence: 0,
    signals: [],
    reviewReasons: [reason],
    extracted: extractBooking(input.bodyText ?? "", input.subject ?? null),
    parserVersion: PARSER_VERSION,
  };
}
