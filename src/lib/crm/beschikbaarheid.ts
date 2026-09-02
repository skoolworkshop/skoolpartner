/**
 * Vrije momenten uitrekenen voor een boekingslink.
 *
 * Pure logica zonder database en zonder Google. De agenda en het CRM leveren
 * bezette blokken aan; dit bestand bepaalt wat er overblijft.
 *
 * ============================================================================
 * WAAROM TIJDZONES HIER HET ECHTE WERK ZIJN
 * ============================================================================
 *
 * Een school ziet "dinsdag 10:00". Dat is 10:00 in Nederland, en dat is in de
 * zomer 08:00 UTC en in de winter 09:00 UTC. Wie met een vast verschil rekent,
 * heeft twee keer per jaar een week lang afspraken die een uur verschoven
 * staan. Dat is precies het soort fout dat pas opvalt als iemand voor een
 * dichte deur staat.
 *
 * De oplossing hier gebruikt Intl.DateTimeFormat met een tijdzone om per
 * moment uit te rekenen hoeveel die zone op dat moment voorloopt op UTC. Geen
 * bibliotheek nodig, en het klopt ook op de dag dat de klok verspringt.
 *
 * ============================================================================
 * WAT EEN VRIJ MOMENT IS
 * ============================================================================
 *
 * Een moment is vrij als het:
 *   1. binnen een werkvenster van die weekdag valt, helemaal;
 *   2. niet botst met een bezet blok, inclusief de buffer ervoor en erna;
 *   3. ver genoeg in de toekomst ligt (de opzegtermijn);
 *   4. niet verder weg ligt dan de horizon.
 *
 * Bezette blokken komen uit twee bronnen: afspraken die al in het CRM staan,
 * en de echte agenda. Beide worden hier gelijk behandeld, zodat een ontbrekende
 * agendakoppeling het rekenen niet verandert maar alleen minder blokken
 * oplevert.
 */

// -----------------------------------------------------------------------------
// Tijdzones
// -----------------------------------------------------------------------------

const ZONE_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/**
 * Een formatter per tijdzone, met UTC als terugval.
 *
 * Intl gooit een fout bij een zone die niet bestaat. Dat mag hier nooit
 * doorwerken: de tijdzone komt uit de database, en een typefout in een
 * instelling hoort geen openbare boekingspagina om te gooien. Dan liever
 * rekenen in UTC en tijden die een uur schelen, dan een witte pagina.
 */
function formatter(tijdzone: string): Intl.DateTimeFormat {
  const bestaand = ZONE_FORMATTERS.get(tijdzone);
  if (bestaand) return bestaand;

  const opties: Intl.DateTimeFormatOptions = {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  };

  let gemaakt: Intl.DateTimeFormat;
  try {
    gemaakt = new Intl.DateTimeFormat("en-CA", { ...opties, timeZone: tijdzone });
  } catch {
    gemaakt = new Intl.DateTimeFormat("en-CA", { ...opties, timeZone: "UTC" });
  }

  ZONE_FORMATTERS.set(tijdzone, gemaakt);
  return gemaakt;
}

export interface LokaleTijd {
  jaar: number;
  maand: number;
  dag: number;
  uur: number;
  minuut: number;
  /** 0 is zondag, net als Date.getUTCDay(). */
  weekdag: number;
  /** Als "2026-09-10". */
  datum: string;
}

/** Wat de klok in deze tijdzone aanwijst op dit moment. */
export function lokaleTijd(instant: Date, tijdzone: string): LokaleTijd {
  const delen = formatter(tijdzone).formatToParts(instant);
  const waarde = (soort: string) => Number(delen.find((d) => d.type === soort)?.value ?? "0");

  const jaar = waarde("year");
  const maand = waarde("month");
  const dag = waarde("day");
  // Intl geeft 24 voor middernacht in en-CA; dat is dan het begin van de dag.
  const uur = waarde("hour") % 24;
  const minuut = waarde("minute");

  const datum = `${String(jaar).padStart(4, "0")}-${String(maand).padStart(2, "0")}-${String(dag).padStart(2, "0")}`;

  return {
    jaar,
    maand,
    dag,
    uur,
    minuut,
    weekdag: new Date(`${datum}T00:00:00Z`).getUTCDay(),
    datum,
  };
}

/**
 * Hoeveel minuten deze tijdzone op dit moment voorloopt op UTC.
 *
 * Voor Nederland: 60 in de winter, 120 in de zomer. Berekend door de lokale
 * kloktijd als UTC te lezen en het verschil met het echte moment te nemen.
 */
export function zoneOffsetOp(instant: Date, tijdzone: string): number {
  const lokaal = lokaleTijd(instant, tijdzone);
  const alsUtc = Date.UTC(
    lokaal.jaar,
    lokaal.maand - 1,
    lokaal.dag,
    lokaal.uur,
    lokaal.minuut,
    instant.getUTCSeconds()
  );
  return Math.round((alsUtc - instant.getTime()) / 60_000);
}

/**
 * Een lokale wandkloktijd omzetten naar een echt moment.
 *
 * Twee ronden, en dat is nodig: de offset hangt af van het moment, en het
 * moment hangt af van de offset. Een eerste schatting met de offset van die
 * dag om twaalf uur 's middags, daarna een correctie. Op de dag dat de klok
 * verspringt levert de tweede ronde het juiste antwoord.
 */
export function naarInstant(
  datum: string,
  minutenNaMiddernacht: number,
  tijdzone: string
): Date {
  const [jaar, maand, dag] = datum.split("-").map(Number);
  const alsofUtc = Date.UTC(jaar, maand - 1, dag, 0, minutenNaMiddernacht);

  const eersteGok = new Date(alsofUtc - zoneOffsetOp(new Date(alsofUtc), tijdzone) * 60_000);
  const tweedeOffset = zoneOffsetOp(eersteGok, tijdzone);
  return new Date(alsofUtc - tweedeOffset * 60_000);
}

/** Hoeveel minuten na middernacht wijst de klok aan in deze zone? */
export function minutenOpDeDag(instant: Date, tijdzone: string): number {
  const lokaal = lokaleTijd(instant, tijdzone);
  return lokaal.uur * 60 + lokaal.minuut;
}

/** De dagen vanaf een startdag, als "2026-09-10". */
export function dagenVanaf(startDatum: string, aantal: number): string[] {
  const [jaar, maand, dag] = startDatum.split("-").map(Number);
  const dagen: string[] = [];
  for (let i = 0; i < aantal; i += 1) {
    const d = new Date(Date.UTC(jaar, maand - 1, dag + i));
    dagen.push(d.toISOString().slice(0, 10));
  }
  return dagen;
}

// -----------------------------------------------------------------------------
// De invoer
// -----------------------------------------------------------------------------

/** Een werkvenster op een weekdag, in minuten na middernacht, lokale tijd. */
export interface Werkvenster {
  /** 0 is zondag. */
  weekdag: number;
  vanafMinuut: number;
  totMinuut: number;
}

/** Een blok waarop niet geboekt kan worden. Beide als ISO-tijdstip. */
export interface BezetBlok {
  startsAt: string;
  endsAt: string;
  /** Waar dit blok vandaan komt. Alleen voor uitleg op het scherm. */
  bron?: "crm" | "agenda";
}

export interface BoekingsRegels {
  /** Hoe lang een afspraak duurt. */
  duurMinuten: number;
  /** Rust voor en na een afspraak. Telt mee bij het botsen. */
  bufferVoorMinuten: number;
  bufferNaMinuten: number;
  /** Hoeveel uur van tevoren er minstens geboekt moet worden. */
  opzegtermijnUren: number;
  /** Hoeveel dagen vooruit er geboekt mag worden. */
  horizonDagen: number;
  /** Om de hoeveel minuten een moment mag beginnen. 15 geeft :00, :15, :30, :45. */
  rasterMinuten: number;
  tijdzone: string;
  vensters: Werkvenster[];
}

export const STANDAARD_REGELS: Omit<BoekingsRegels, "vensters"> = {
  duurMinuten: 30,
  bufferVoorMinuten: 0,
  bufferNaMinuten: 15,
  opzegtermijnUren: 24,
  horizonDagen: 60,
  rasterMinuten: 15,
  tijdzone: "Europe/Amsterdam",
};

/** Maandag tot en met vrijdag, negen tot vijf. Een eerlijke startsituatie. */
export const STANDAARD_VENSTERS: Werkvenster[] = [1, 2, 3, 4, 5].map((weekdag) => ({
  weekdag,
  vanafMinuut: 9 * 60,
  totMinuut: 17 * 60,
}));

// -----------------------------------------------------------------------------
// De uitkomst
// -----------------------------------------------------------------------------

export interface VrijMoment {
  /** ISO-tijdstip waarop het begint. */
  startsAt: string;
  endsAt: string;
  /** De lokale kloktijd, als "10:00". */
  label: string;
}

export interface VrijeDag {
  /** Als "2026-09-10". */
  datum: string;
  /** 0 is zondag. */
  weekdag: number;
  momenten: VrijMoment[];
}

function alsKlok(minuten: number): string {
  const uur = Math.floor(minuten / 60);
  const rest = minuten % 60;
  return `${String(uur).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function overlapt(aVan: number, aTot: number, bVan: number, bTot: number): boolean {
  // Aansluitend is geen overlap: een blok dat om 11:00 eindigt botst niet met
  // een moment dat om 11:00 begint.
  return aVan < bTot && bVan < aTot;
}

/**
 * De vrije momenten per dag.
 *
 * `nu` wordt meegegeven en niet uit de klok gehaald, zodat dit te testen is en
 * twee aanroepen vlak na elkaar hetzelfde antwoord geven.
 */
export function berekenVrijeMomenten(
  regels: BoekingsRegels,
  bezet: BezetBlok[],
  nu: Date,
  maximumPerDag = 24
): VrijeDag[] {
  if (regels.duurMinuten <= 0 || regels.vensters.length === 0) return [];

  const vroegste = nu.getTime() + regels.opzegtermijnUren * 60 * 60_000;
  const laatste = nu.getTime() + regels.horizonDagen * 24 * 60 * 60_000;

  // De bezette blokken één keer omzetten naar getallen, met de buffers erin
  // verwerkt. Zo hoeft dat niet bij elk kandidaat-moment opnieuw.
  const blokken = bezet
    .map((blok) => ({
      van: Date.parse(blok.startsAt) - regels.bufferNaMinuten * 60_000,
      tot: Date.parse(blok.endsAt) + regels.bufferVoorMinuten * 60_000,
    }))
    .filter((b) => Number.isFinite(b.van) && Number.isFinite(b.tot))
    .sort((a, b) => a.van - b.van);

  const vensterPerWeekdag = new Map<number, Werkvenster[]>();
  for (const venster of regels.vensters) {
    if (venster.totMinuut <= venster.vanafMinuut) continue;
    const lijst = vensterPerWeekdag.get(venster.weekdag);
    if (lijst) lijst.push(venster);
    else vensterPerWeekdag.set(venster.weekdag, [venster]);
  }

  const vandaag = lokaleTijd(nu, regels.tijdzone).datum;
  const dagen = dagenVanaf(vandaag, regels.horizonDagen + 1);
  const raster = Math.max(regels.rasterMinuten, 5);

  const uitkomst: VrijeDag[] = [];

  for (const datum of dagen) {
    const weekdag = new Date(`${datum}T00:00:00Z`).getUTCDay();
    const vensters = vensterPerWeekdag.get(weekdag);
    if (!vensters) continue;

    const momenten: VrijMoment[] = [];

    for (const venster of vensters) {
      for (
        let minuut = venster.vanafMinuut;
        minuut + regels.duurMinuten <= venster.totMinuut;
        minuut += raster
      ) {
        const start = naarInstant(datum, minuut, regels.tijdzone);
        const startTijd = start.getTime();
        const eindTijd = startTijd + regels.duurMinuten * 60_000;

        if (startTijd < vroegste) continue;
        if (startTijd > laatste) continue;

        const botst = blokken.some((blok) => overlapt(startTijd, eindTijd, blok.van, blok.tot));
        if (botst) continue;

        momenten.push({
          startsAt: new Date(startTijd).toISOString(),
          endsAt: new Date(eindTijd).toISOString(),
          label: alsKlok(minuut),
        });

        if (momenten.length >= maximumPerDag) break;
      }
      if (momenten.length >= maximumPerDag) break;
    }

    if (momenten.length > 0) {
      momenten.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      uitkomst.push({ datum, weekdag, momenten });
    }
  }

  return uitkomst;
}

/**
 * Is dit precies een moment dat geboekt mag worden?
 *
 * Dit is de controle die telt. Wat de bezoeker op zijn scherm zag kan
 * inmiddels bezet zijn, en het formulier kan met de hand zijn aangepast. Bij
 * het daadwerkelijk boeken wordt daarom opnieuw gerekend, en pas als het
 * gekozen moment nog steeds in de lijst staat, gaat de boeking door.
 */
export function isNogVrij(
  gekozenStart: string,
  regels: BoekingsRegels,
  bezet: BezetBlok[],
  nu: Date
): boolean {
  const dagen = berekenVrijeMomenten(regels, bezet, nu, 200);
  return dagen.some((dag) => dag.momenten.some((m) => m.startsAt === gekozenStart));
}

// -----------------------------------------------------------------------------
// Vensters lezen en schrijven
// -----------------------------------------------------------------------------

export const WEEKDAG_NAMEN = [
  "Zondag",
  "Maandag",
  "Dinsdag",
  "Woensdag",
  "Donderdag",
  "Vrijdag",
  "Zaterdag",
];

export const WEEKDAG_KORT = ["zo", "ma", "di", "wo", "do", "vr", "za"];

/** "09:00" naar 540. Geeft null bij onzin, zodat een kapot veld niets omgooit. */
export function leesKlok(waarde: string | null | undefined): number | null {
  if (!waarde) return null;
  const patroon = /^(\d{1,2}):(\d{2})$/.exec(waarde.trim());
  if (!patroon) return null;
  const uur = Number(patroon[1]);
  const minuut = Number(patroon[2]);
  if (uur > 23 || minuut > 59) return null;
  return uur * 60 + minuut;
}

export function schrijfKlok(minuten: number): string {
  return alsKlok(Math.max(0, Math.min(minuten, 24 * 60)));
}

/**
 * Controleert een set werkvensters.
 *
 * Overlappende vensters op dezelfde dag zijn geen ramp maar wel een
 * vergissing: ze leveren dubbele momenten op in de lijst. Daarom worden ze
 * geweigerd in plaats van stil samengevoegd.
 */
export function controleerVensters(vensters: Werkvenster[]): string[] {
  const fouten: string[] = [];

  for (const venster of vensters) {
    if (venster.weekdag < 0 || venster.weekdag > 6) {
      fouten.push("Onbekende weekdag.");
      continue;
    }
    if (venster.totMinuut <= venster.vanafMinuut) {
      fouten.push(`${WEEKDAG_NAMEN[venster.weekdag]}: de eindtijd moet na de begintijd liggen.`);
    }
  }

  for (let dag = 0; dag <= 6; dag += 1) {
    const opDeDag = vensters
      .filter((v) => v.weekdag === dag && v.totMinuut > v.vanafMinuut)
      .sort((a, b) => a.vanafMinuut - b.vanafMinuut);

    for (let i = 1; i < opDeDag.length; i += 1) {
      if (opDeDag[i].vanafMinuut < opDeDag[i - 1].totMinuut) {
        fouten.push(`${WEEKDAG_NAMEN[dag]}: twee tijdvakken overlappen elkaar.`);
        break;
      }
    }
  }

  return fouten;
}

/**
 * De tijdzone zoals een bezoeker hem herkent.
 *
 * "UTC +02:00 (Europa) Central European Summer Time" is wat HubSpot toont, en
 * dat is nuttiger dan alleen "Europe/Amsterdam": wie vanuit het buitenland
 * boekt, ziet meteen dat de tijden Nederlandse tijden zijn.
 */
export function tijdzoneLabel(tijdzone: string, opMoment = new Date()): string {
  const offset = zoneOffsetOp(opMoment, tijdzone);
  const teken = offset < 0 ? "-" : "+";
  const uren = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const minuten = String(Math.abs(offset) % 60).padStart(2, "0");

  let naam = tijdzone;
  try {
    const delen = new Intl.DateTimeFormat("nl-NL", {
      timeZone: tijdzone,
      timeZoneName: "long",
    }).formatToParts(opMoment);
    naam = delen.find((d) => d.type === "timeZoneName")?.value ?? tijdzone;
  } catch {
    /* Onbekende zone: dan blijft de technische naam staan. */
  }

  return `UTC ${teken}${uren}:${minuten} \u00b7 ${naam}`;
}
