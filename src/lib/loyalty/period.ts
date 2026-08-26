/**
 * De SkoolPartner-periode van een klant.
 *
 * Eén regel, op één plek, gebruikt door de puntenberekening, de facturen, de
 * berichten en de synchronisaties: alles van vóór het startmoment telt niet
 * mee. Het startmoment zelf staat in loyalty_accounts.enrolled_at.
 *
 * Deze module bevat bewust geen database- of netwerkcode, zodat de regel
 * volledig te testen is.
 */

/** Wanneer kwam de boeking tot stand? booked_at is leidend. */
export function bookingMoment(booking: {
  booked_at?: string | null;
  created_at: string;
}): string {
  return booking.booked_at ?? booking.created_at;
}

/**
 * Valt dit moment binnen de SkoolPartner-periode?
 *
 * Zonder startmoment doet de organisatie niet mee en valt er dus niets binnen.
 * Het startmoment zelf telt mee: wie zich om 10:00 registreert en om 10:05
 * boekt, spaart punten.
 */
export function isWithinPartnerPeriod(
  moment: string | null | undefined,
  enrolledAt: string | null | undefined
): boolean {
  if (!enrolledAt) return false;
  if (!moment) return false;
  return new Date(moment).getTime() >= new Date(enrolledAt).getTime();
}

/**
 * Mag deze boeking punten opleveren?
 *
 * Let op: dit gaat uitsluitend over het startmoment. De andere voorwaarden,
 * zoals een definitieve boeking en kwalificerende workshopuren, staan elders
 * en blijven onverkort gelden.
 */
export function bookingQualifiesForPoints(
  booking: { booked_at?: string | null; created_at: string },
  enrolledAt: string | null | undefined
): boolean {
  return isWithinPartnerPeriod(bookingMoment(booking), enrolledAt);
}

/**
 * Hoort deze factuur bij de SkoolPartner-periode?
 *
 * Een factuur telt mee als zij hoort bij een boeking binnen de periode, of, als
 * die koppeling er niet is, als de factuurdatum zelf na het startmoment ligt.
 * De boeking gaat voor: een factuur van 20 september bij een boeking van
 * 1 september hoort niet bij SkoolPartner, ook al ligt de factuurdatum later.
 */
export function invoiceBelongsToPeriod(
  invoice: { invoice_date: string | null; created_at?: string },
  enrolledAt: string | null | undefined,
  bookingMomentIso?: string | null
): boolean {
  if (!enrolledAt) return false;
  if (bookingMomentIso !== undefined && bookingMomentIso !== null) {
    return isWithinPartnerPeriod(bookingMomentIso, enrolledAt);
  }
  return isWithinPartnerPeriod(invoice.invoice_date ?? invoice.created_at ?? null, enrolledAt);
}
