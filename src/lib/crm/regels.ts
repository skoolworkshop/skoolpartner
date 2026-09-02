/**
 * Rekenregels van het CRM.
 *
 * Alles hier is pure logica zonder database, net als src/lib/tegoed/regels.ts.
 * Dat is met opzet: dit zijn de plekken waar een fout stil doorwerkt in een
 * scherm, dus juist hier hoort een test omheen te kunnen.
 */

/** Een datum als "2026-10-02". Nooit een tijd erbij, want dit zijn dagen. */
export type DatumString = string;

const DAG = 24 * 60 * 60 * 1000;

/**
 * Leest een datum zonder tijdzone-verrassingen.
 *
 * Een datum uit Postgres komt binnen als "2026-10-02". Die door new Date()
 * halen levert middernacht UTC op, en in Nederland kan dat een dag schelen bij
 * het terugrekenen. Daarom splitsen wij hem zelf.
 */
export function leesDatum(waarde: DatumString | null | undefined): Date | null {
  if (!waarde) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(waarde);
  if (!match) return null;
  const jaar = Number(match[1]);
  const maand = Number(match[2]);
  const dag = Number(match[3]);
  if (maand < 1 || maand > 12 || dag < 1 || dag > 31) return null;
  const datum = new Date(Date.UTC(jaar, maand - 1, dag));
  // Vangt 31 februari af: die schuift door naar maart.
  if (datum.getUTCMonth() !== maand - 1 || datum.getUTCDate() !== dag) return null;
  return datum;
}

/** Hele dagen tussen twee datums. Negatief als de tweede eerder ligt. */
export function dagenTussen(vanaf: DatumString, tot: DatumString): number | null {
  const a = leesDatum(vanaf);
  const b = leesDatum(tot);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / DAG);
}

/**
 * De leeftijd op een bepaalde dag.
 *
 * Voor Suri is dat de leeftijd bij vertrek en niet de leeftijd van vandaag:
 * iemand die zich in september aanmeldt voor april kan er tussendoor achttien
 * worden, en dat verandert of er toestemming van een ouder nodig is.
 */
export function leeftijdOp(geboortedatum: DatumString, opDatum: DatumString): number | null {
  const geboren = leesDatum(geboortedatum);
  const peil = leesDatum(opDatum);
  if (!geboren || !peil) return null;

  let leeftijd = peil.getUTCFullYear() - geboren.getUTCFullYear();
  const maandVerschil = peil.getUTCMonth() - geboren.getUTCMonth();
  if (maandVerschil < 0 || (maandVerschil === 0 && peil.getUTCDate() < geboren.getUTCDate())) {
    leeftijd -= 1;
  }
  return leeftijd;
}

export interface LeeftijdSignaal {
  leeftijd: number;
  toon: "goed" | "let-op" | "buiten";
  bericht: string;
}

/**
 * Wat de leeftijd bij vertrek betekent voor het Breekjaar.
 *
 * De doelgroep is 17 tot en met 22. Zestien mag bij uitzondering, dus dat is
 * een aandachtspunt en geen weigering: dat is een menselijke afweging en niet
 * iets wat een scherm hoort te beslissen.
 */
export function leeftijdSignaal(
  geboortedatum: DatumString | null,
  vertrekdatum: DatumString | null
): LeeftijdSignaal | null {
  if (!geboortedatum || !vertrekdatum) return null;
  const leeftijd = leeftijdOp(geboortedatum, vertrekdatum);
  if (leeftijd === null) return null;

  if (leeftijd < 16) {
    return { leeftijd, toon: "buiten", bericht: `${leeftijd} bij vertrek, ruim onder de doelgroep.` };
  }
  if (leeftijd === 16) {
    return {
      leeftijd,
      toon: "let-op",
      bericht: "16 bij vertrek. Kan bij uitzondering, en dan is toestemming van een ouder nodig.",
    };
  }
  if (leeftijd === 17) {
    return {
      leeftijd,
      toon: "let-op",
      bericht: "17 bij vertrek, dus nog minderjarig. Toestemming van een ouder is nodig.",
    };
  }
  if (leeftijd > 22) {
    return { leeftijd, toon: "buiten", bericht: `${leeftijd} bij vertrek, boven de doelgroep.` };
  }
  return { leeftijd, toon: "goed", bericht: `${leeftijd} bij vertrek.` };
}

export interface BetaalStand {
  prijsCents: number;
  betaaldCents: number;
  openCents: number;
  volledig: boolean;
  teveelCents: number;
  label: string;
}

/**
 * Hoe ver een deelnemer is met betalen.
 *
 * Teveel betaald wordt apart benoemd in plaats van weggerekend. Een negatief
 * openstaand bedrag op een scherm is verwarrend, terwijl "er staat te veel op"
 * meteen duidelijk maakt dat er iets terug moet.
 */
export function betaalStand(prijsCents: number, betaaldCents: number): BetaalStand {
  const prijs = Math.max(Math.round(prijsCents), 0);
  const betaald = Math.round(betaaldCents);
  const verschil = prijs - betaald;

  return {
    prijsCents: prijs,
    betaaldCents: betaald,
    openCents: Math.max(verschil, 0),
    volledig: prijs > 0 && verschil <= 0,
    teveelCents: verschil < 0 ? -verschil : 0,
    label:
      prijs === 0
        ? "Nog geen prijs ingesteld"
        : verschil > 0
          ? "Nog niet volledig betaald"
          : verschil === 0
            ? "Volledig betaald"
            : "Er is te veel betaald",
  };
}

export interface Bezetting {
  aangemeld: number;
  capaciteit: number;
  vrij: number;
  toon: "ruimte" | "bijna-vol" | "vol" | "over";
  label: string;
}

/**
 * De bezetting van een reisperiode.
 *
 * "Bijna vol" begint bij twee vrije plaatsen. Dat is de grens waarop je een
 * gesprek anders voert: dan wordt het tijd om iemand door te sturen naar de
 * volgende periode.
 */
export function bezetting(aangemeld: number, capaciteit: number): Bezetting {
  const cap = Math.max(Math.round(capaciteit), 0);
  const bezet = Math.max(Math.round(aangemeld), 0);
  const vrij = Math.max(cap - bezet, 0);

  if (bezet > cap) {
    return {
      aangemeld: bezet,
      capaciteit: cap,
      vrij: 0,
      toon: "over",
      label: `${bezet} van ${cap}, dat is ${bezet - cap} te veel`,
    };
  }
  if (vrij === 0) {
    return { aangemeld: bezet, capaciteit: cap, vrij, toon: "vol", label: `Vol, ${bezet} van ${cap}` };
  }
  if (vrij <= 2) {
    return {
      aangemeld: bezet,
      capaciteit: cap,
      vrij,
      toon: "bijna-vol",
      label: vrij === 1 ? "Nog een plaats vrij" : `Nog ${vrij} plaatsen vrij`,
    };
  }
  return {
    aangemeld: bezet,
    capaciteit: cap,
    vrij,
    toon: "ruimte",
    label: `${vrij} van ${cap} plaatsen vrij`,
  };
}

export interface ContactStilte {
  dagen: number | null;
  toon: "recent" | "lang" | "nooit";
  label: string;
}

/**
 * Hoe lang het geleden is dat er contact was met een relatie.
 *
 * Nooit contact gehad is iets anders dan lang geleden contact gehad. Dat
 * verschil verdwijnt als je er allebei een streepje van maakt, terwijl het bij
 * een prospect juist het belangrijkste onderscheid is.
 */
export function contactStilte(
  laatsteContact: string | null,
  vandaag: DatumString
): ContactStilte {
  if (!laatsteContact) return { dagen: null, toon: "nooit", label: "Nog geen contact vastgelegd" };

  const dagen = dagenTussen(laatsteContact.slice(0, 10), vandaag);
  if (dagen === null) return { dagen: null, toon: "nooit", label: "Nog geen contact vastgelegd" };

  if (dagen <= 0) return { dagen: 0, toon: "recent", label: "Vandaag" };
  if (dagen === 1) return { dagen, toon: "recent", label: "Gisteren" };
  if (dagen < 30) return { dagen, toon: "recent", label: `${dagen} dagen geleden` };
  if (dagen < 60) return { dagen, toon: "lang", label: "Ruim een maand geleden" };

  const maanden = Math.floor(dagen / 30);
  if (maanden < 12) return { dagen, toon: "lang", label: `${maanden} maanden geleden` };

  const jaren = Math.floor(dagen / 365);
  return { dagen, toon: "lang", label: jaren === 1 ? "Ruim een jaar geleden" : `${jaren} jaar geleden` };
}

export const LIFECYCLE_LABELS = {
  prospect: "Prospect",
  lead: "Lead",
  klant: "Klant",
  oud_klant: "Oud-klant",
} as const;

export type Lifecycle = keyof typeof LIFECYCLE_LABELS;

export function isLifecycle(waarde: unknown): waarde is Lifecycle {
  return typeof waarde === "string" && waarde in LIFECYCLE_LABELS;
}

export const BETALING_LABELS = {
  aanbetaling: "Aanbetaling",
  restant: "Restant",
  correctie: "Correctie",
  terugbetaling: "Terugbetaling",
} as const;

export type BetalingSoort = keyof typeof BETALING_LABELS;

export function isBetalingSoort(waarde: unknown): waarde is BetalingSoort {
  return typeof waarde === "string" && waarde in BETALING_LABELS;
}

export const PERIODE_STATUS_LABELS = {
  concept: "Concept",
  open: "Open voor aanmeldingen",
  gesloten: "Gesloten",
  afgerond: "Afgerond",
} as const;

export type PeriodeStatus = keyof typeof PERIODE_STATUS_LABELS;

export function isPeriodeStatus(waarde: unknown): waarde is PeriodeStatus {
  return typeof waarde === "string" && waarde in PERIODE_STATUS_LABELS;
}

/**
 * Een bedrag uit een formulier omzetten naar centen.
 *
 * Zelfde regel als bij het CJP-tegoed, bewust apart gehouden zodat het CRM
 * niet afhankelijk wordt van die module: het scheidingsteken dat als laatste
 * komt en precies twee cijfers achter zich heeft, is de komma.
 */
export function bedragNaarCenten(invoer: string): number | null {
  const schoon = invoer.replace(/[€\s ]/g, "").trim();
  if (!schoon) return null;
  if (!/^-?[\d.,]+$/.test(schoon)) return null;

  const negatief = schoon.startsWith("-");
  const cijfers = negatief ? schoon.slice(1) : schoon;

  const laatsteKomma = cijfers.lastIndexOf(",");
  const laatstePunt = cijfers.lastIndexOf(".");
  const scheiding = Math.max(laatsteKomma, laatstePunt);

  let heel = cijfers;
  let decimalen = "0";

  if (scheiding !== -1 && cijfers.length - scheiding - 1 === 2) {
    heel = cijfers.slice(0, scheiding);
    decimalen = cijfers.slice(scheiding + 1);
  }

  const heleCijfers = heel.replace(/[.,]/g, "");
  if (!/^\d*$/.test(heleCijfers) || !/^\d{1,2}$/.test(decimalen)) return null;
  if (heleCijfers === "" && decimalen === "0") return null;

  const centen = Number(heleCijfers || "0") * 100 + Number(decimalen.padEnd(2, "0"));
  if (!Number.isSafeInteger(centen)) return null;
  return negatief ? -centen : centen;
}
