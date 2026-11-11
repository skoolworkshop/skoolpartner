/**
 * Hoe lang we leerlinggegevens bewaren.
 *
 * HET UITGANGSPUNT
 *
 *   Dertig dagen na de cultuurdag. Daarna zijn de namen, de klassen, de
 *   e-mailadressen, de persoonlijke codes en de gemaakte keuzes weg. Wat
 *   blijft staan is de dag zelf met zijn rooster en workshops, want dat is
 *   ons eigen werk en er staat geen kind in.
 *
 * WAAROM DERTIG DAGEN
 *
 *   Lang genoeg om na afloop nog een vraag van een school te kunnen
 *   beantwoorden, een lijst opnieuw te sturen of een factuur na te lopen.
 *   Kort genoeg dat we niet jarenlang de namen van andermans leerlingen
 *   bewaren. Dat is wat de wet bedoelt met niet langer dan nodig.
 *
 * ALS EEN SCHOOL IETS ANDERS AFSPREEKT
 *
 *   Dan zet je per dag een eigen datum. Die staat gewoon in het scherm, zodat
 *   iedereen kan zien tot wanneer er bewaard wordt en waarom dat afwijkt.
 *   Leeg laten betekent: terug naar de standaard.
 *
 * REKENWERK ZONDER DATABASE
 *
 *   Alles hier is datumrekenen. Het opruimen zelf staat in opruimen.ts.
 */

/** De standaardtermijn, in dagen na de cultuurdag. */
export const BEWAARDAGEN = 30;

/** Een datum als jjjj-mm-dd, in de tijdzone van de datum zelf. */
function alsDatum(waarde: string | Date): string {
  if (waarde instanceof Date) return waarde.toISOString().slice(0, 10);
  return String(waarde).slice(0, 10);
}

/**
 * Tot wanneer de leerlinggegevens van deze dag bewaard worden.
 *
 * Staat er een eigen datum op de dag, dan geldt die. Anders de dagdatum plus
 * dertig dagen. Een dag zonder eigen datum is dus niet een dag zonder termijn:
 * er is altijd een moment waarop het weggaat.
 */
export function bewaartTot(dag: { event_date: string; purge_after?: string | null }): string {
  if (dag.purge_after) return alsDatum(dag.purge_after);
  return standaardBewaardatum(dag.event_date);
}

/** De standaarddatum: de dag van de cultuurdag plus dertig dagen. */
export function standaardBewaardatum(datum: string, dagen = BEWAARDAGEN): string {
  const moment = new Date(`${alsDatum(datum)}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() + dagen);
  return moment.toISOString().slice(0, 10);
}

/** Is de termijn voorbij op dit moment? */
export function isVerlopen(
  dag: { event_date: string; purge_after?: string | null },
  vandaag: string | Date = new Date(),
): boolean {
  return bewaartTot(dag) < alsDatum(vandaag);
}

/** Hoeveel dagen er nog te gaan zijn. Negatief als het al voorbij is. */
export function dagenTeGaan(
  dag: { event_date: string; purge_after?: string | null },
  vandaag: string | Date = new Date(),
): number {
  const einde = Date.parse(`${bewaartTot(dag)}T00:00:00Z`);
  const nu = Date.parse(`${alsDatum(vandaag)}T00:00:00Z`);
  return Math.round((einde - nu) / 86_400_000);
}

/**
 * Wat er in het scherm komt te staan.
 *
 * Eén zin die Anne zonder uitleg begrijpt, en die duidelijk maakt dat het
 * vanzelf gebeurt en niet iets is wat zij moet onthouden.
 */
export function bewaarUitleg(
  dag: { event_date: string; purge_after?: string | null },
  vandaag: string | Date = new Date(),
): string {
  const dagen = dagenTeGaan(dag, vandaag);
  const datum = new Date(`${bewaartTot(dag)}T00:00:00Z`).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  if (dagen < 0) return `De leerlinggegevens van deze dag hadden op ${datum} verwijderd moeten zijn.`;
  if (dagen === 0) return `De leerlinggegevens van deze dag worden vannacht verwijderd.`;
  if (dagen === 1) return `De leerlinggegevens van deze dag worden morgen verwijderd.`;
  return `De leerlinggegevens van deze dag worden op ${datum} verwijderd, over ${dagen} dagen.`;
}
