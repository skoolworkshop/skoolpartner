import type { ExtractedBooking } from "./types";

/**
 * Deterministische extractie uit de tekst van een bevestigingsmail.
 *
 * Er wordt bewust géén AI gebruikt. Elk veld komt uit een expliciet patroon.
 * Kan een veld niet met zekerheid worden bepaald, dan blijft het null en gaat
 * de boeking naar de wachtrij "Controle nodig".
 */

const DUTCH_MONTHS: Record<string, number> = {
  januari: 1, jan: 1,
  februari: 2, feb: 2,
  maart: 3, mrt: 3,
  april: 4, apr: 4,
  mei: 5,
  juni: 6, jun: 6,
  juli: 7, jul: 7,
  augustus: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

/** Zoekt de waarde achter een label, bijvoorbeeld "Workshop: Graffiti". */
export function labelledValue(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const pattern = new RegExp(
      `^[\\t \\u00a0]*${label}[\\t \\u00a0]*[:\\-–][\\t \\u00a0]*(.+)$`,
      "im"
    );
    const match = text.match(pattern);
    if (match) {
      const value = match[1].trim().replace(/\s{2,}/g, " ");
      if (value && value.length > 0 && !/^[-–—]+$/.test(value)) return value;
    }
  }
  return null;
}

export function parseDutchDate(value: string | null): string | null {
  if (!value) return null;

  // 12-03-2026 of 12/03/2026
  const numeric = value.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (numeric) {
    const [, d, m, y] = numeric;
    return toIsoDate(Number(y), Number(m), Number(d));
  }

  // 2026-03-12
  const iso = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // 12 maart 2026 (eventueel voorafgegaan door een weekdag)
  const textual = value.match(/\b(\d{1,2})\s+([a-zA-Zé]+)\s+(\d{4})\b/);
  if (textual) {
    const month = DUTCH_MONTHS[textual[2].toLowerCase()];
    if (month) return toIsoDate(Number(textual[3]), month, Number(textual[1]));
  }

  return null;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year.toString().padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseTimeRange(value: string | null): { start: string | null; end: string | null } {
  if (!value) return { start: null, end: null };
  const range = value.match(/\b(\d{1,2})[:.](\d{2})\s*(?:-|–|—|tot|t\/m)\s*(\d{1,2})[:.](\d{2})\b/);
  if (range) {
    return {
      start: normalizeTime(range[1], range[2]),
      end: normalizeTime(range[3], range[4]),
    };
  }
  const single = value.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (single) return { start: normalizeTime(single[1], single[2]), end: null };
  return { start: null, end: null };
}

function normalizeTime(hour: string, minute: string): string | null {
  const h = Number(hour);
  const m = Number(minute);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function minutesBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const diff = eh * 60 + em - (sh * 60 + sm);
  return diff > 0 ? diff : null;
}

/** "90 minuten", "1,5 uur", "2 uur", "90 min per workshop" */
export function parseDuration(value: string | null): number | null {
  if (!value) return null;

  const minutes = value.match(/\b(\d{2,3})\s*(?:min|minuten|minuut)\b/i);
  if (minutes) return Number(minutes[1]);

  const hours = value.match(/\b(\d{1,2})(?:[.,](\d{1,2}))?\s*(?:uur|u\b|uren)/i);
  if (hours) {
    const whole = Number(hours[1]);
    const fraction = hours[2] ? Number(`0.${hours[2]}`) : 0;
    const total = Math.round((whole + fraction) * 60);
    return total > 0 ? total : null;
  }

  return null;
}

export function parseCount(value: string | null): number | null {
  if (!value) return null;
  const digits = value.match(/\b(\d{1,3})\b/);
  if (digits) {
    const parsed = Number(digits[1]);
    return parsed > 0 ? parsed : null;
  }
  const words: Record<string, number> = {
    een: 1, één: 1, twee: 2, drie: 3, vier: 4, vijf: 5,
    zes: 6, zeven: 7, acht: 8, negen: 9, tien: 10,
  };
  const word = value.toLowerCase().match(/\b(een|één|twee|drie|vier|vijf|zes|zeven|acht|negen|tien)\b/);
  return word ? words[word[1]] : null;
}

const REFERENCE_PATTERNS = [
  /\b(SW-\d{4}-\d{3,6})\b/i,
  /\b(BOEK-\d{4,10})\b/i,
  /boekingsnummer[:\s]+([A-Z0-9-]{4,20})/i,
  /boekingsreferentie[:\s]+([A-Z0-9-]{4,20})/i,
  /referentie[:\s]+([A-Z0-9-]{4,20})/i,
];

export function extractReference(text: string): string | null {
  for (const pattern of REFERENCE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/;

export function extractBooking(bodyText: string, subject: string | null): ExtractedBooking {
  const text = bodyText.replace(/\r\n/g, "\n");

  const organizationName = labelledValue(text, [
    "organisatie", "school", "bedrijf", "opdrachtgever", "klant", "instelling",
  ]);
  const contactName = labelledValue(text, ["contactpersoon", "contact", "t\\.a\\.v\\."]);
  const contactRaw = labelledValue(text, ["e-mail", "email", "mailadres", "e-mailadres"]);
  const contactEmail = contactRaw?.match(EMAIL_PATTERN)?.[0]?.toLowerCase() ?? null;

  const workshopName =
    labelledValue(text, ["workshop", "workshops", "activiteit", "programma"]) ??
    (subject ? subject.replace(/^\s*(bevestiging|boekingsbevestiging)\s*[:\-–]\s*/i, "").trim() || null : null);

  const countRaw = labelledValue(text, [
    "aantal workshops", "aantal rondes", "aantal groepen", "aantal",
  ]);
  const durationRaw = labelledValue(text, [
    "duur", "duur per workshop", "workshopduur", "lengte",
  ]);
  const dateRaw = labelledValue(text, ["datum", "workshopdatum", "dag"]);
  const timeRaw = labelledValue(text, ["tijd", "tijden", "tijdstip", "van", "starttijd"]);
  const locationRaw = labelledValue(text, ["locatie", "adres", "plaats", "waar"]);
  const participantsRaw = labelledValue(text, [
    "aantal deelnemers", "deelnemers", "leerlingen", "aantal leerlingen",
  ]);

  const times = parseTimeRange(timeRaw ?? text.match(/\b\d{1,2}[:.]\d{2}\s*(?:-|–|tot)\s*\d{1,2}[:.]\d{2}\b/)?.[0] ?? null);

  let workshopCount = parseCount(countRaw);
  let minutesPerWorkshop = parseDuration(durationRaw);

  // Combinatie in één regel, bijvoorbeeld "4 x 90 minuten".
  const combined = text.match(/\b(\d{1,2})\s*(?:x|×)\s*(\d{2,3})\s*(?:min|minuten)\b/i);
  if (combined) {
    workshopCount = workshopCount ?? Number(combined[1]);
    minutesPerWorkshop = minutesPerWorkshop ?? Number(combined[2]);
  }

  return {
    organizationName,
    contactName,
    contactEmail,
    workshopName: workshopName?.slice(0, 120) ?? null,
    workshopCount,
    minutesPerWorkshop,
    date: parseDutchDate(dateRaw) ?? parseDutchDate(text.split("\n").find((l) => /datum/i.test(l)) ?? null),
    startTime: times.start,
    endTime: times.end,
    location: locationRaw?.slice(0, 200) ?? null,
    participants: parseCount(participantsRaw),
    reference: extractReference(text) ?? (subject ? extractReference(subject) : null),
  };
}
