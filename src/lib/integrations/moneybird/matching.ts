import type { MoneybirdInvoiceDetail } from "./client";

/**
 * Herkent of een factuurregel over workshopkosten gaat.
 *
 * Dit wordt uitsluitend gebruikt als AANVULLENDE controle. Het aantal
 * workshopuren wordt nooit uit het factuurbedrag afgeleid: een factuur bevat
 * ook reiskosten, starttarief, materiaal, extra deelnemers en toeslagen.
 */
const NON_WORKSHOP_PATTERNS = [
  /reiskost/i,
  /kilometer/i,
  /starttarief/i,
  /voorrijkost/i,
  /materiaal/i,
  /extra deelnemer/i,
  /toeslag/i,
  /parkeer/i,
  /annulering/i,
  /administratiekost/i,
  /borg/i,
];

const WORKSHOP_PATTERNS = [/workshop/i, /clinic/i, /cultuurdag/i, /projectdag/i, /training/i];

export function isWorkshopLine(description: string | null | undefined): boolean {
  if (!description) return false;
  if (NON_WORKSHOP_PATTERNS.some((pattern) => pattern.test(description))) return false;
  return WORKSHOP_PATTERNS.some((pattern) => pattern.test(description));
}

export interface LineHint {
  workshopName: string | null;
  workshopCount: number | null;
  minutesPerWorkshop: number | null;
}

/**
 * Leest een hint uit een factuurregel zoals "Workshop Graffiti - 4 x 90 minuten".
 * Levert null-waarden op zodra iets niet zeker is; er wordt nooit gegokt.
 */
export function extractLineHint(detail: MoneybirdInvoiceDetail): LineHint {
  const description = detail.description ?? "";
  if (!isWorkshopLine(description)) {
    return { workshopName: null, workshopCount: null, minutesPerWorkshop: null };
  }

  const durationMatch = description.match(/(\d{1,3})\s*(?:x|×)\s*(\d{2,3})\s*(?:min|minuten)/i);
  const singleDuration = description.match(/(\d{2,3})\s*(?:min|minuten)/i);
  const namePart = description.split(/[-–—]/)[0]?.trim() ?? null;

  return {
    workshopName: namePart && namePart.length > 2 ? namePart : null,
    workshopCount: durationMatch ? Number.parseInt(durationMatch[1], 10) : null,
    minutesPerWorkshop: durationMatch
      ? Number.parseInt(durationMatch[2], 10)
      : singleDuration
        ? Number.parseInt(singleDuration[1], 10)
        : null,
  };
}

export interface BookingCandidate {
  id: string;
  reference: string | null;
  workshop_name: string;
  scheduled_date: string | null;
  workshop_count: number;
  minutes_per_workshop: number;
}

export interface InvoiceMatchInput {
  reference: string | null;
  invoiceDate: string | null;
  lineHints: LineHint[];
}

export interface MatchOutcome {
  bookingId: string | null;
  confidence: number;
  method: string;
  reasons: string[];
}

/**
 * Koppelt een factuur aan de meest waarschijnlijke boeking.
 *
 * De score is opgebouwd uit meerdere onafhankelijke signalen. Bij twijfel
 * (score onder de drempel) wordt er niets gekoppeld en komt de factuur in de
 * wachtrij "Controle nodig".
 */
export function matchInvoiceToBooking(
  invoice: InvoiceMatchInput,
  candidates: BookingCandidate[],
  { threshold = 0.6 }: { threshold?: number } = {}
): MatchOutcome {
  if (candidates.length === 0) {
    return { bookingId: null, confidence: 0, method: "none", reasons: ["Geen boekingen gevonden"] };
  }

  let best: { booking: BookingCandidate; score: number; reasons: string[] } | null = null;

  for (const booking of candidates) {
    let score = 0;
    const reasons: string[] = [];

    // 1. Exacte boekingsreferentie op de factuur.
    if (
      booking.reference &&
      invoice.reference &&
      invoice.reference.toLowerCase().includes(booking.reference.toLowerCase())
    ) {
      score += 0.6;
      reasons.push("Boekingsreferentie komt overeen");
    }

    // 2. Workshopnaam in een van de factuurregels.
    const nameHit = invoice.lineHints.some(
      (hint) =>
        hint.workshopName &&
        booking.workshop_name.toLowerCase().includes(hint.workshopName.toLowerCase().replace(/^workshop\s+/i, ""))
    );
    if (nameHit) {
      score += 0.25;
      reasons.push("Workshopnaam komt overeen met een factuurregel");
    }

    // 3. Aantal en duur komen overeen.
    const durationHit = invoice.lineHints.some(
      (hint) =>
        hint.workshopCount === booking.workshop_count &&
        hint.minutesPerWorkshop === booking.minutes_per_workshop
    );
    if (durationHit) {
      score += 0.2;
      reasons.push("Aantal workshops en duur komen overeen");
    }

    // 4. Factuurdatum ligt dicht bij de workshopdatum.
    if (invoice.invoiceDate && booking.scheduled_date) {
      const days = Math.abs(
        (new Date(invoice.invoiceDate).getTime() - new Date(booking.scheduled_date).getTime()) /
          86_400_000
      );
      if (days <= 21) {
        score += 0.2;
        reasons.push("Factuurdatum ligt binnen drie weken van de workshopdatum");
      } else if (days <= 60) {
        score += 0.08;
        reasons.push("Factuurdatum ligt binnen twee maanden van de workshopdatum");
      }
    }

    if (!best || score > best.score) best = { booking, score, reasons };
  }

  if (!best || best.score < threshold) {
    return {
      bookingId: null,
      confidence: best?.score ?? 0,
      method: "uncertain",
      reasons: best?.reasons.length
        ? [...best.reasons, "Onvoldoende zekerheid voor automatische koppeling"]
        : ["Onvoldoende signalen voor automatische koppeling"],
    };
  }

  return {
    bookingId: best.booking.id,
    confidence: Math.min(1, best.score),
    method: "automatic",
    reasons: best.reasons,
  };
}

const STATE_MAP: Record<string, string> = {
  draft: "draft",
  scheduled: "open",
  open: "open",
  pending_payment: "pending_payment",
  reminded: "reminded",
  late: "late",
  paid: "paid",
  uncollectible: "uncollectible",
};

export function mapInvoiceState(state: string | null | undefined): string {
  if (!state) return "unknown";
  return STATE_MAP[state] ?? "unknown";
}
