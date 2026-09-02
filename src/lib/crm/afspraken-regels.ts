/**
 * De regels rond afspraken.
 *
 * Pure logica zonder database, net als regels.ts en fragment-tekst.ts. Zo is
 * te testen dat een afspraak niet in het verleden gepland kan worden gemeld
 * als "nog te gaan", en dat twee afspraken die elkaar overlappen ook echt als
 * overlap worden herkend.
 *
 * ============================================================================
 * DE TIJD
 * ============================================================================
 *
 * Alles wordt als ISO-tijdstip opgeslagen en vergeleken. Een invoerveld van
 * het type datetime-local levert een lokale tijd zonder zone op ("2026-09-10
 * T14:00"), en die moet je omzetten voordat je hem bewaart. Doe je dat niet,
 * dan schuift een afspraak in de zomer een uur op ten opzichte van de winter,
 * en dat is precies het soort fout dat je pas merkt als iemand voor een
 * dichte deur staat.
 *
 * De omzetting gebeurt hier op een plek: leesInvoerTijd en naarInvoerTijd.
 */

export const AFSPRAAK_SOORTEN = {
  kennismaking: "Kennismaking",
  intake: "Intakegesprek",
  advies: "Adviesgesprek",
  rondleiding: "Rondleiding of bezoek",
  evaluatie: "Evaluatie",
  overig: "Overig",
} as const;

export type AfspraakSoort = keyof typeof AFSPRAAK_SOORTEN;

export function isAfspraakSoort(waarde: unknown): waarde is AfspraakSoort {
  return typeof waarde === "string" && waarde in AFSPRAAK_SOORTEN;
}

export const AFSPRAAK_VORMEN = {
  op_locatie: "Bij de school",
  bij_ons: "Bij ons",
  videobellen: "Videobellen",
  telefoon: "Telefonisch",
} as const;

export type AfspraakVorm = keyof typeof AFSPRAAK_VORMEN;

export function isAfspraakVorm(waarde: unknown): waarde is AfspraakVorm {
  return typeof waarde === "string" && waarde in AFSPRAAK_VORMEN;
}

/**
 * De vier standen van een afspraak.
 *
 * "Niet verschenen" staat er los van "geannuleerd" met opzet. Afzeggen is
 * netjes en zegt weinig; niet komen opdagen zegt wel iets over de relatie, en
 * dat wil je later kunnen terugzien zonder in notities te hoeven graven.
 */
export const AFSPRAAK_STATUSSEN = {
  gepland: "Gepland",
  gehouden: "Gehouden",
  geannuleerd: "Geannuleerd",
  niet_verschenen: "Niet verschenen",
} as const;

export type AfspraakStatus = keyof typeof AFSPRAAK_STATUSSEN;

export function isAfspraakStatus(waarde: unknown): waarde is AfspraakStatus {
  return typeof waarde === "string" && waarde in AFSPRAAK_STATUSSEN;
}

/** Een afspraak die is afgesloten, hoe dan ook. */
export function isAfgerond(status: AfspraakStatus): boolean {
  return status !== "gepland";
}

// -----------------------------------------------------------------------------
// Tijd
// -----------------------------------------------------------------------------

/**
 * Zet de waarde uit een datetime-local veld om naar een echt tijdstip.
 *
 * De browser levert "2026-09-10T14:00" zonder zone. new Date() leest dat als
 * lokale tijd van de server, en dat is bij ons Nederland maar op een
 * Vercel-server ergens anders. Daarom wordt de zone expliciet meegegeven door
 * de aanroeper, en niet stilzwijgend aangenomen.
 *
 * Geeft null bij iets onleesbaars, zodat een kapot veld geen scherm omgooit.
 */
export function leesInvoerTijd(waarde: string | null | undefined, zoneOffsetMinuten = 0): string | null {
  if (!waarde) return null;
  const patroon = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(waarde.trim());
  if (!patroon) {
    // Misschien is het al een volledig tijdstip met zone.
    const tijd = Date.parse(waarde);
    return Number.isNaN(tijd) ? null : new Date(tijd).toISOString();
  }

  const [, jaar, maand, dag, uur, minuut, seconde] = patroon;
  const alsUtc = Date.UTC(
    Number(jaar),
    Number(maand) - 1,
    Number(dag),
    Number(uur),
    Number(minuut),
    Number(seconde ?? "0")
  );

  // De datum moet echt bestaan. 31 februari schuift anders stil door.
  const controle = new Date(alsUtc);
  if (
    controle.getUTCFullYear() !== Number(jaar) ||
    controle.getUTCMonth() !== Number(maand) - 1 ||
    controle.getUTCDate() !== Number(dag)
  ) {
    return null;
  }

  return new Date(alsUtc - zoneOffsetMinuten * 60_000).toISOString();
}

/** De omgekeerde weg: een tijdstip terug naar de waarde voor een invoerveld. */
export function naarInvoerTijd(iso: string | null | undefined, zoneOffsetMinuten = 0): string {
  if (!iso) return "";
  const tijd = Date.parse(iso);
  if (Number.isNaN(tijd)) return "";
  return new Date(tijd + zoneOffsetMinuten * 60_000).toISOString().slice(0, 16);
}

/** De duur in minuten, of null als een van beide tijden ontbreekt of onleesbaar is. */
export function duurInMinuten(start: string | null, eind: string | null): number | null {
  if (!start || !eind) return null;
  const van = Date.parse(start);
  const tot = Date.parse(eind);
  if (Number.isNaN(van) || Number.isNaN(tot)) return null;
  const minuten = Math.round((tot - van) / 60_000);
  return minuten > 0 ? minuten : null;
}

export function formatDuur(minuten: number | null): string {
  if (minuten === null || minuten <= 0) return "—";
  const uren = Math.floor(minuten / 60);
  const rest = minuten % 60;
  if (uren === 0) return `${rest} min`;
  if (rest === 0) return uren === 1 ? "1 uur" : `${uren} uur`;
  return `${uren} uur ${rest} min`;
}

// -----------------------------------------------------------------------------
// Overlap
// -----------------------------------------------------------------------------

export interface Tijdvak {
  id: string;
  startsAt: string;
  endsAt: string;
}

/**
 * Overlappen twee tijdvakken elkaar?
 *
 * Aansluitend is geen overlap: een afspraak die om 15:00 eindigt botst niet
 * met een die om 15:00 begint. Dat is hoe een agenda werkt, en het scheelt een
 * waarschuwing bij elke dag met twee afspraken achter elkaar.
 */
export function overlapt(a: Tijdvak, b: Tijdvak): boolean {
  const aVan = Date.parse(a.startsAt);
  const aTot = Date.parse(a.endsAt);
  const bVan = Date.parse(b.startsAt);
  const bTot = Date.parse(b.endsAt);
  if ([aVan, aTot, bVan, bTot].some(Number.isNaN)) return false;
  return aVan < bTot && bVan < aTot;
}

/**
 * Welke bestaande afspraken botsen met deze?
 *
 * Bewust een waarschuwing en geen verbod. Twee afspraken tegelijk kan een
 * vergissing zijn, maar ook een bewuste keuze: een collega gaat naar de ene en
 * jij naar de andere. Een systeem dat dat weigert, wordt omzeild.
 */
export function botsendeAfspraken(nieuw: Tijdvak, bestaand: Tijdvak[]): Tijdvak[] {
  return bestaand.filter((ander) => ander.id !== nieuw.id && overlapt(nieuw, ander));
}

// -----------------------------------------------------------------------------
// Indelen
// -----------------------------------------------------------------------------

export interface AfspraakKern {
  id: string;
  startsAt: string;
  endsAt: string;
  status: AfspraakStatus;
  outcome: string | null;
}

export interface AfspraakIndeling<T extends AfspraakKern> {
  /** Gepland en nog niet geweest, eerstvolgende voorop. */
  komend: T[];
  /** Gepland maar het moment is voorbij. Hier moet iets mee. */
  achterstallig: T[];
  /** Afgerond, meest recente voorop. */
  geweest: T[];
  /** Gehouden zonder dat er is vastgelegd wat eruit kwam. */
  zonderUitkomst: T[];
}

/**
 * Afspraken indelen op wat je ermee moet.
 *
 * "Achterstallig" is de categorie die het meeste oplevert: een afspraak die
 * gepland staat en waarvan het moment voorbij is, betekent dat niemand heeft
 * bijgewerkt of hij is doorgegaan. Zonder die lijst blijft dat onzichtbaar en
 * kloppen de cijfers over gehouden gesprekken niet meer.
 */
export function deelAfsprakenIn<T extends AfspraakKern>(
  afspraken: T[],
  nu: string
): AfspraakIndeling<T> {
  const moment = Date.parse(nu);
  const grens = Number.isNaN(moment) ? Date.now() : moment;

  const komend: T[] = [];
  const achterstallig: T[] = [];
  const geweest: T[] = [];
  const zonderUitkomst: T[] = [];

  for (const afspraak of afspraken) {
    if (afspraak.status === "gepland") {
      const eind = Date.parse(afspraak.endsAt);
      if (!Number.isNaN(eind) && eind < grens) achterstallig.push(afspraak);
      else komend.push(afspraak);
      continue;
    }

    geweest.push(afspraak);
    if (afspraak.status === "gehouden" && !afspraak.outcome?.trim()) {
      zonderUitkomst.push(afspraak);
    }
  }

  const vroegEerst = (a: T, b: T) => a.startsAt.localeCompare(b.startsAt);
  const laatEerst = (a: T, b: T) => b.startsAt.localeCompare(a.startsAt);

  komend.sort(vroegEerst);
  achterstallig.sort(laatEerst);
  geweest.sort(laatEerst);
  zonderUitkomst.sort(laatEerst);

  return { komend, achterstallig, geweest, zonderUitkomst };
}

/** Valt dit tijdstip op de opgegeven dag? Beide als ISO, de dag als "2026-09-10". */
export function opDezelfdeDag(tijdstip: string, dag: string): boolean {
  return tijdstip.slice(0, 10) === dag;
}

// -----------------------------------------------------------------------------
// Wat mag er met de status gebeuren
// -----------------------------------------------------------------------------

export interface StatusOordeel {
  toegestaan: boolean;
  reden?: string;
}

/**
 * Mag deze afspraak op deze stand gezet worden?
 *
 * Eén echte regel: een afspraak die nog moet plaatsvinden kan niet gehouden
 * of niet-verschenen zijn. Dat lijkt vanzelfsprekend, maar het is precies wat
 * er misgaat als iemand alvast afvinkt: de doorlooptijden en de telling van
 * gehouden gesprekken kloppen dan niet meer.
 *
 * Annuleren mag altijd, ook achteraf. Terugzetten naar gepland mag ook: een
 * vergissing corrigeren moet kunnen zonder de afspraak weg te gooien.
 */
export function magStatusWorden(
  afspraak: { startsAt: string; status: AfspraakStatus },
  nieuw: AfspraakStatus,
  nu: string
): StatusOordeel {
  if (nieuw === afspraak.status) return { toegestaan: true };

  if (nieuw === "gehouden" || nieuw === "niet_verschenen") {
    const start = Date.parse(afspraak.startsAt);
    const moment = Date.parse(nu);
    if (!Number.isNaN(start) && !Number.isNaN(moment) && start > moment) {
      return {
        toegestaan: false,
        reden:
          "Deze afspraak moet nog plaatsvinden. Pas de datum aan als hij al is geweest, of wacht tot het zover is.",
      };
    }
  }

  return { toegestaan: true };
}

/**
 * Controleert de invoer van een afspraak.
 *
 * Geeft een lijst met alles wat er mis is, niet alleen het eerste. Wie drie
 * velden vergeet, wil dat in een keer horen.
 */
export function controleerAfspraak(invoer: {
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  soort: string;
  vorm: string;
  heeftOnderwerp: boolean;
}): string[] {
  const fouten: string[] = [];

  if (invoer.title.trim().length < 2) fouten.push("Geef de afspraak een korte titel.");
  if (!invoer.startsAt) fouten.push("Vul een geldig begintijdstip in.");
  if (!invoer.endsAt) fouten.push("Vul een geldig eindtijdstip in.");

  if (invoer.startsAt && invoer.endsAt) {
    const duur = duurInMinuten(invoer.startsAt, invoer.endsAt);
    if (duur === null) fouten.push("De afspraak moet eindigen na het moment waarop hij begint.");
    else if (duur > 60 * 24) fouten.push("Een afspraak van meer dan een dag is waarschijnlijk een vergissing.");
  }

  if (!isAfspraakSoort(invoer.soort)) fouten.push("Kies wat voor soort afspraak dit is.");
  if (!isAfspraakVorm(invoer.vorm)) fouten.push("Kies waar of hoe de afspraak plaatsvindt.");
  if (!invoer.heeftOnderwerp) {
    fouten.push("Een afspraak hoort bij een organisatie, een contactpersoon of een deal.");
  }

  return fouten;
}
