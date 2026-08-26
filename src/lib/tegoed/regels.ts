/**
 * De rekenregels en controles rond geparkeerd CJP-tegoed.
 *
 * Bewust zonder database en zonder server: alles hier is pure logica, zodat
 * het te testen is en zodat de klant precies dezelfde uitkomst ziet als de
 * server berekent.
 *
 * Belangrijk om te onthouden bij het lezen: euro's en SkoolPoints zijn twee
 * verschillende dingen. In dit bestand staat geen enkele omrekening tussen
 * die twee, en die hoort er ook nooit in te komen.
 */

export type ParkingStatus = "requested" | "in_review" | "confirmed" | "rejected";

export const PARKING_STATUS_LABELS: Record<ParkingStatus, string> = {
  requested: "Aangevraagd",
  in_review: "In behandeling",
  confirmed: "Bevestigd",
  rejected: "Afgewezen",
};

export const PARKING_STATUS_ORDER: ParkingStatus[] = [
  "requested",
  "in_review",
  "confirmed",
  "rejected",
];

export type CreditType = "parking" | "spend" | "correction" | "refund";

export const CREDIT_TYPE_LABELS: Record<CreditType, string> = {
  parking: "Tegoed geparkeerd",
  spend: "Tegoed gebruikt",
  correction: "Correctie",
  refund: "Terugboeking",
};

/** Zo hoog dat geen enkele school er tegenaan loopt, laag genoeg om een typefout te vangen. */
export const MAX_AMOUNT_CENTS = 5_000_000;

/* -------------------------------------------------------------------------- */
/* Bedragen                                                                    */
/* -------------------------------------------------------------------------- */

export interface AmountResult {
  ok: boolean;
  cents?: number;
  message?: string;
}

/**
 * Leest een bedrag zoals iemand het intypt en maakt er hele centen van.
 *
 * Mensen typen bedragen op allerlei manieren: "1250", "1.250,00", "1250,50",
 * "€ 1250", "1250.50". Die willen wij allemaal begrijpen, want een school
 * afwijzen op een punt of komma is onnodig vervelend.
 *
 * De enige echt lastige gevallen zijn punt en komma. De regel die wij
 * aanhouden: het laatste scheidingsteken met precies twee cijfers erachter is
 * de decimaal, al het andere is een duizendtalscheiding.
 */
export function parseAmountToCents(raw: string): AmountResult {
  const schoon = raw.replace(/[€\s ]/g, "").trim();

  if (schoon === "") return { ok: false, message: "Vul een bedrag in." };
  if (!/^-?[\d.,]+$/.test(schoon)) {
    return { ok: false, message: "Vul het bedrag in cijfers in, bijvoorbeeld 1250,00." };
  }
  if (schoon.startsWith("-")) {
    return { ok: false, message: "Vul een bedrag groter dan nul in." };
  }

  const laatstePunt = schoon.lastIndexOf(".");
  const laatsteKomma = schoon.lastIndexOf(",");
  const scheider = Math.max(laatstePunt, laatsteKomma);

  let heel = schoon;
  let centen = "00";

  if (scheider !== -1) {
    const staart = schoon.slice(scheider + 1);
    // Twee cijfers erachter: dat zijn de centen. Anders is het een
    // duizendtalscheiding, zoals in 1.250.
    if (staart.length === 2 && /^\d{2}$/.test(staart)) {
      heel = schoon.slice(0, scheider);
      centen = staart;
    } else if (staart.length === 1 && /^\d$/.test(staart)) {
      heel = schoon.slice(0, scheider);
      centen = `${staart}0`;
    }
  }

  const heelSchoon = heel.replace(/[.,]/g, "");
  if (heelSchoon === "" || !/^\d+$/.test(heelSchoon)) {
    return { ok: false, message: "Vul het bedrag in cijfers in, bijvoorbeeld 1250,00." };
  }

  const cents = Number.parseInt(heelSchoon, 10) * 100 + Number.parseInt(centen, 10);

  if (!Number.isFinite(cents) || cents <= 0) {
    return { ok: false, message: "Vul een bedrag groter dan nul in." };
  }
  if (cents > MAX_AMOUNT_CENTS) {
    return {
      ok: false,
      message: "Dit bedrag lijkt niet te kloppen. Neem even contact met ons op.",
    };
  }

  return { ok: true, cents };
}

/* -------------------------------------------------------------------------- */
/* De aanvraag                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * De gegevens die als momentopname bij de aanvraag worden bewaard.
 *
 * Wisselt de budgethouder later van baan, dan blijft bij een oude aanvraag
 * gewoon zichtbaar wie het destijds was. Daarom zijn dit losse velden en geen
 * verwijzing naar een gebruiker.
 */
export interface ParkingInput {
  schoolName: string;
  cjpSchoolNumber: string;
  holderName: string;
  holderEmail: string;
  holderPhone: string;
  amount: string;
}

export interface ParkingSnapshot {
  schoolName: string;
  cjpSchoolNumber: string;
  holderName: string;
  holderEmail: string;
  holderPhone: string | null;
  amountCents: number;
}

export interface ParkingValidation {
  ok: boolean;
  snapshot?: ParkingSnapshot;
  /** Per veld, zodat het formulier de fout op de goede plek kan tonen. */
  errors: Partial<Record<keyof ParkingInput, string>>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export function validateParkingInput(
  input: ParkingInput,
  options: { minimumCents: number }
): ParkingValidation {
  const errors: ParkingValidation["errors"] = {};

  const schoolName = input.schoolName.trim().replace(/\s+/g, " ");
  if (schoolName.length < 2) errors.schoolName = "Vul de naam van de school in.";
  if (schoolName.length > 200) errors.schoolName = "Deze naam is te lang.";

  // Voor deze aanvraag is het CJP-nummer wél verplicht. Zonder dat nummer
  // kunnen wij het budget bij CJP niet terugvinden.
  const cjp = input.cjpSchoolNumber.trim().replace(/\s+/g, " ");
  if (cjp.length < 3) {
    errors.cjpSchoolNumber =
      "Vul het CJP-schoolnummer in. Dat hebben wij nodig om het budget bij CJP terug te vinden.";
  } else if (cjp.length > 40) {
    errors.cjpSchoolNumber = "Dit CJP-schoolnummer lijkt te lang.";
  }

  const holderName = input.holderName.trim().replace(/\s+/g, " ");
  if (holderName.length < 2) errors.holderName = "Vul de naam van de budgethouder in.";
  if (holderName.length > 120) errors.holderName = "Deze naam is te lang.";

  const holderEmail = input.holderEmail.trim().toLowerCase();
  if (!EMAIL.test(holderEmail)) {
    errors.holderEmail = "Vul een geldig e-mailadres van de budgethouder in.";
  }

  const telefoon = input.holderPhone.trim();
  if (telefoon.length > 30) errors.holderPhone = "Dit telefoonnummer lijkt te lang.";

  const bedrag = parseAmountToCents(input.amount);
  if (!bedrag.ok) {
    errors.amount = bedrag.message;
  } else if (bedrag.cents! < options.minimumCents) {
    errors.amount = `Het laagste bedrag dat u kunt parkeren is ${formatCentsPlain(options.minimumCents)}.`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    errors: {},
    snapshot: {
      schoolName,
      cjpSchoolNumber: cjp,
      holderName,
      holderEmail,
      holderPhone: telefoon === "" ? null : telefoon,
      amountCents: bedrag.cents!,
    },
  };
}

/** "1.250,00" zonder euroteken. Voor gebruik binnen een zin. */
export function formatCentsPlain(cents: number): string {
  return new Intl.NumberFormat("nl-NL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((cents ?? 0) / 100);
}

/**
 * Wat er in het invulveld komt te staan als de klant het formulier opent.
 * Een leeg veld is prettiger dan een nul die je eerst moet weghalen.
 */
export function amountFieldValue(cents: number | null | undefined): string {
  if (!cents || cents <= 0) return "";
  return formatCentsPlain(cents);
}

/* -------------------------------------------------------------------------- */
/* Afboeken                                                                    */
/* -------------------------------------------------------------------------- */

export interface SpendCheck {
  ok: boolean;
  cents?: number;
  message?: string;
}

/**
 * Controleert een afboeking voordat die naar de database gaat.
 *
 * De database controleert het saldo nog een keer, met een slot op de
 * organisatie. Deze controle is er voor een nette melding, niet als
 * beveiliging: die zit in de database.
 */
export function checkSpend(raw: string, availableCents: number): SpendCheck {
  const bedrag = parseAmountToCents(raw);
  if (!bedrag.ok) return { ok: false, message: bedrag.message };

  if (availableCents <= 0) {
    return { ok: false, message: "Deze organisatie heeft geen tegoed staan." };
  }
  if (bedrag.cents! > availableCents) {
    return {
      ok: false,
      message: `Er staat maar ${formatCentsPlain(availableCents)} tegoed. Meer afboeken kan niet.`,
    };
  }

  return { ok: true, cents: bedrag.cents };
}

/** Het bedrag dat na deze afboeking overblijft. */
export function remainingAfter(availableCents: number, spendCents: number): number {
  return Math.max(0, availableCents - spendCents);
}
