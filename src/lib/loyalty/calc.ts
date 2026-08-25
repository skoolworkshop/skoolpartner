/**
 * Zuivere rekenlogica voor SkoolPoints.
 *
 * Deze module bevat geen database- of netwerkcode, zodat de bedrijfsregels
 * volledig getest kunnen worden. Alle instellingen komen als parameter binnen:
 * niets is hier hardcoded.
 *
 * Basisregels (startinstelling, aanpasbaar via Admin > Instellingen):
 *   - 100 SkoolPoints per workshopuur
 *   - 100 SkoolPoints = € 2,50 Skool Voordeel
 *   - minimale afname 90 minuten per dag
 *
 * Punten worden uitsluitend berekend over kwalificerende workshopduur.
 * Reiskosten, starttarief, materiaal, extra deelnemers en toeslagen tellen
 * nooit mee.
 */

export interface LoyaltyRates {
  /** Punten per volledig workshopuur. */
  pointsPerHour: number;
  /** Waarde van 100 punten in eurocenten. */
  pointValueCentsPer100: number;
  /** Minimale afname in minuten (plausibiliteitscontrole). */
  minimumBookingMinutes: number;
}

export const DEFAULT_RATES: LoyaltyRates = {
  pointsPerHour: 100,
  pointValueCentsPer100: 250,
  minimumBookingMinutes: 90,
};

export interface BookingPointsInput {
  /** Aantal workshops in deze boeking. */
  workshopCount: number;
  /** Duur per workshop in minuten. */
  minutesPerWorkshop: number;
}

export interface BookingPointsResult {
  qualifyingMinutes: number;
  qualifyingHours: number;
  points: number;
  valueCents: number;
  warnings: string[];
}

/** Rekent kwalificerende minuten om naar punten. Rondt af op hele punten. */
export function pointsForMinutes(minutes: number, pointsPerHour: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  if (!Number.isFinite(pointsPerHour) || pointsPerHour <= 0) return 0;
  return Math.round((minutes / 60) * pointsPerHour);
}

/** Euro-equivalent van een aantal punten, in centen. Rondt naar beneden af. */
export function pointsToCents(points: number, pointValueCentsPer100: number): number {
  if (!Number.isFinite(points) || points <= 0) return 0;
  if (!Number.isFinite(pointValueCentsPer100) || pointValueCentsPer100 <= 0) return 0;
  return Math.floor((points * pointValueCentsPer100) / 100);
}

/** Hoeveel punten heb je nodig voor een bepaald bedrag in centen. */
export function centsToPoints(cents: number, pointValueCentsPer100: number): number {
  if (cents <= 0 || pointValueCentsPer100 <= 0) return 0;
  return Math.ceil((cents * 100) / pointValueCentsPer100);
}

/**
 * Berekent de punten voor een complete boeking.
 * Geeft waarschuwingen terug wanneer de invoer onwaarschijnlijk is; die
 * waarschuwingen zetten de boeking in de wachtrij "Controle nodig".
 */
export function calculateBookingPoints(
  input: BookingPointsInput,
  rates: LoyaltyRates = DEFAULT_RATES
): BookingPointsResult {
  const warnings: string[] = [];
  const count = Math.trunc(input.workshopCount);
  const minutes = Math.trunc(input.minutesPerWorkshop);

  if (!Number.isFinite(count) || count < 1) {
    warnings.push("Aantal workshops is niet vastgesteld");
  }
  if (!Number.isFinite(minutes) || minutes < 1) {
    warnings.push("Workshopduur is niet vastgesteld");
  }

  const safeCount = Math.max(0, Number.isFinite(count) ? count : 0);
  const safeMinutes = Math.max(0, Number.isFinite(minutes) ? minutes : 0);
  const qualifyingMinutes = safeCount * safeMinutes;

  if (qualifyingMinutes > 0 && qualifyingMinutes < rates.minimumBookingMinutes) {
    warnings.push(
      `Totale duur (${qualifyingMinutes} min) ligt onder de minimale afname van ${rates.minimumBookingMinutes} minuten`
    );
  }
  if (safeMinutes > 8 * 60) {
    warnings.push(`Workshopduur van ${safeMinutes} minuten is ongebruikelijk lang`);
  }
  if (safeCount > 20) {
    warnings.push(`Aantal workshops (${safeCount}) is ongebruikelijk hoog`);
  }

  const points = pointsForMinutes(qualifyingMinutes, rates.pointsPerHour);

  return {
    qualifyingMinutes,
    qualifyingHours: qualifyingMinutes / 60,
    points,
    valueCents: pointsToCents(points, rates.pointValueCentsPer100),
    warnings,
  };
}

/**
 * Subtiele voortgang richting de volgende mijlpaal.
 * Bewust rustig gehouden: geen game-elementen, geen badges.
 */
export function nextMilestone(
  availablePoints: number,
  stepPoints: number
): { target: number; remaining: number; progress: number } | null {
  if (stepPoints <= 0) return null;
  const target = (Math.floor(availablePoints / stepPoints) + 1) * stepPoints;
  const previous = target - stepPoints;
  const remaining = target - availablePoints;
  const progress = Math.min(1, Math.max(0, (availablePoints - previous) / stepPoints));
  return { target, remaining, progress };
}

/** Beschrijving zoals gebruikt in de puntenhistorie. */
export function describeWorkshopEarning(
  workshopName: string,
  workshopCount: number,
  minutesPerWorkshop: number
): string {
  if (workshopCount > 1) {
    return `${workshopName} — ${workshopCount} × ${minutesPerWorkshop} minuten`;
  }
  return `${workshopName} — ${minutesPerWorkshop} minuten`;
}
