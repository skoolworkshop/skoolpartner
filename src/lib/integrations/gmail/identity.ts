/**
 * Het verschil tussen het Google-account en het boekingenadres.
 *
 * Bij Skool Workshop zijn dat bewust twee verschillende dingen:
 *
 *   Google-account    clinten@skoolworkshop.nl
 *                     hiermee wordt ingelogd bij Google en hiermee wordt de
 *                     koppeling geautoriseerd
 *
 *   Boekingenadres    boekingen@skoolworkshop.nl
 *                     hiermee mailen wij met klanten; dit is binnen Google
 *                     Workspace een alias of send-as identiteit onder het
 *                     account hierboven
 *
 * De koppeling mag dus niet stukgaan omdat die twee niet gelijk zijn. Tegelijk
 * mag niet alles uit de persoonlijke mailbox in SkoolPartner belanden. Dit
 * bestand bevat de regels die dat onderscheid maken.
 *
 * Alles hier is pure logica zonder database en zonder netwerk, zodat het te
 * testen is.
 */

/* -------------------------------------------------------------------------- */
/* Adressen                                                                    */
/* -------------------------------------------------------------------------- */

/** Kleine letters, spaties eraf, en een eventuele naam ervoor weggehaald. */
export function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const binnenHaakjes = value.match(/<([^>]+)>/);
  const kaal = (binnenHaakjes ? binnenHaakjes[1] : value).trim().toLowerCase();
  return kaal.includes("@") ? kaal : null;
}

/** Splitst een header met meerdere adressen. */
export function splitAddresses(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((deel) => normalizeEmail(deel))
    .filter((email): email is string => Boolean(email));
}

/* -------------------------------------------------------------------------- */
/* Send-as identiteiten                                                        */
/* -------------------------------------------------------------------------- */

/** Zoals Gmail ze teruggeeft bij users.settings.sendAs.list. */
export interface SendAsEntry {
  sendAsEmail: string;
  displayName?: string;
  isPrimary?: boolean;
  isDefault?: boolean;
  treatAsAlias?: boolean;
  /** "accepted", "pending" of "verificationStatusUnspecified". */
  verificationStatus?: string;
}

export type SendAsState = "gereed" | "verificatie-open" | "ontbreekt";

export interface SendAsCheck {
  state: SendAsState;
  ready: boolean;
  /** Korte uitleg in gewone taal, geschikt om in het beheer te tonen. */
  message: string;
  entry: SendAsEntry | null;
}

export function findSendAs(lijst: SendAsEntry[], adres: string): SendAsEntry | null {
  const gezocht = normalizeEmail(adres);
  if (!gezocht) return null;
  return lijst.find((item) => normalizeEmail(item.sendAsEmail) === gezocht) ?? null;
}

/**
 * Mag er namens dit adres worden verzonden?
 *
 * De regel die Google hanteert: een adres in de send-as lijst is bruikbaar,
 * behalve wanneer de verificatie nog openstaat. Bij een alias binnen je eigen
 * Workspace-domein hoeft er niets geverifieerd te worden; die krijgt dan
 * "verificationStatusUnspecified". Dat is dus geen probleem, en daarom kijken
 * wij alleen of de status expliciet op "pending" staat.
 */
export function checkSendAs(lijst: SendAsEntry[], adres: string): SendAsCheck {
  const entry = findSendAs(lijst, adres);

  if (!entry) {
    return {
      state: "ontbreekt",
      ready: false,
      entry: null,
      message: `${adres} staat niet als verzendadres in dit Google-account.`,
    };
  }

  if ((entry.verificationStatus ?? "").toLowerCase() === "pending") {
    return {
      state: "verificatie-open",
      ready: false,
      entry,
      message: `${adres} staat wel in Gmail, maar de verificatie is nog niet afgerond.`,
    };
  }

  return {
    state: "gereed",
    ready: true,
    entry,
    message: `Er kan worden verzonden als ${adres}.`,
  };
}

/** De tekst die in Admin > Integraties komt te staan. */
export function sendAsLabel(check: SendAsCheck): "Gereed" | "Configuratie vereist" {
  return check.ready ? "Gereed" : "Configuratie vereist";
}

/**
 * Wat de beheerder in Gmail moet doen als het nog niet goed staat.
 * Bewust concreet, want "configuratie vereist" alleen helpt niemand verder.
 */
export function sendAsInstructie(check: SendAsCheck, adres: string, account: string): string[] {
  if (check.ready) return [];

  if (check.state === "verificatie-open") {
    return [
      `Log in bij Gmail als ${account}.`,
      "Ga naar Instellingen, Alle instellingen bekijken, tabblad Accounts en import.",
      `Bij "E-mail verzenden als" staat ${adres} met de melding dat verificatie nog nodig is.`,
      "Klik op Verifiëren en volg de bevestigingsmail die naar dat adres gaat.",
    ];
  }

  return [
    `Log in bij Gmail als ${account}.`,
    "Ga naar Instellingen, Alle instellingen bekijken, tabblad Accounts en import.",
    `Klik bij "E-mail verzenden als" op "Nog een e-mailadres toevoegen" en vul ${adres} in.`,
    'Laat "Behandelen als alias" aangevinkt staan.',
    `Is ${adres} in Google Workspace een groep in plaats van een alias, geef ${account} dan in de Admin console het recht om namens die groep te verzenden.`,
    "Koppel daarna in SkoolPartner opnieuw, zodat wij de nieuwe instelling zien.",
  ];
}

/* -------------------------------------------------------------------------- */
/* Hoort dit bericht bij het boekingenadres?                                   */
/* -------------------------------------------------------------------------- */

/**
 * De headers waarin het boekingenadres kan opduiken.
 *
 * Bewust meer dan alleen To en From. Bij een alias komt het adres soms alleen
 * in Delivered-To of X-Original-To terug, en bij doorgestuurde post soms alleen
 * in Reply-To. Kijken wij naar één veld, dan missen wij echte klantberichten.
 */
export const RELEVANTE_HEADERS = [
  "to",
  "from",
  "cc",
  "bcc",
  "reply-to",
  "sender",
  "delivered-to",
  "x-original-to",
  "x-forwarded-to",
  "x-forwarded-for",
  "envelope-to",
  "return-path",
] as const;

/**
 * Hoort dit bericht aantoonbaar bij het boekingenadres?
 *
 * Dit is de eerste van twee sloten. Het tweede slot is de geverifieerde
 * contactpersoon in resolveThreadVisibility. Een bericht moet door beide heen
 * voordat een klant het ooit te zien krijgt.
 *
 * Let op: het Google-account zelf telt hier NIET mee. Persoonlijke mail aan
 * clinten@skoolworkshop.nl hoort niet in SkoolPartner, ook niet als die van een
 * bekende school komt.
 */
export function betreftMailbox(
  headers: Record<string, string | null | undefined>,
  mailbox: string
): boolean {
  const gezocht = normalizeEmail(mailbox);
  if (!gezocht) return false;

  return RELEVANTE_HEADERS.some((naam) => {
    const waarde = headers[naam];
    if (!waarde) return false;
    return splitAddresses(waarde).includes(gezocht);
  });
}

/** Waarom een bericht wel of niet is meegenomen. Handig in het audit log. */
export function betreftMailboxReden(
  headers: Record<string, string | null | undefined>,
  mailbox: string
): string {
  const gezocht = normalizeEmail(mailbox);
  if (!gezocht) return "Geen boekingenadres ingesteld";

  const gevonden = RELEVANTE_HEADERS.filter((naam) => {
    const waarde = headers[naam];
    return waarde ? splitAddresses(waarde).includes(gezocht) : false;
  });

  return gevonden.length > 0
    ? `${mailbox} gevonden in ${gevonden.join(", ")}`
    : `${mailbox} komt in dit bericht niet voor`;
}

/* -------------------------------------------------------------------------- */
/* De zoekopdracht richting Gmail                                              */
/* -------------------------------------------------------------------------- */

/**
 * Beperkt de Gmail-zoekopdracht tot post die met het boekingenadres te maken
 * heeft.
 *
 * Waarom dit belangrijk is: wij koppelen met de persoonlijke mailbox van
 * clinten@skoolworkshop.nl. Zonder deze beperking zouden wij zijn hele
 * postvak ophalen, inclusief privémail, sollicitaties en interne overleggen.
 * Door de beperking al in de zoekopdracht te zetten, verlaat die post Google
 * niet eens.
 *
 * Het blijft een eerste zeef, geen bewijs: in storeEmail wordt per bericht
 * nog een keer gecontroleerd.
 */
export function buildScopedQuery(mailbox: string, gebruikersQuery: string): string {
  const adres = normalizeEmail(mailbox);
  const rest = gebruikersQuery.trim();

  if (!adres) return rest;

  const opMailbox = [
    `to:${adres}`,
    `from:${adres}`,
    `cc:${adres}`,
    `bcc:${adres}`,
    `deliveredto:${adres}`,
  ].join(" OR ");

  return rest ? `{${opMailbox}} ${rest}` : `{${opMailbox}}`;
}

/**
 * Is dit bericht door ons verstuurd?
 *
 * Zowel het boekingenadres als het Google-account tellen als "van ons". Stuurt
 * Clinten een bericht dat per ongeluk vanaf zijn eigen adres uitgaat, dan is
 * dat nog steeds uitgaande post en geen klantbericht.
 */
export function isUitgaand(
  from: string | null,
  mailbox: string,
  account: string | null
): boolean {
  const afzender = normalizeEmail(from);
  if (!afzender) return false;
  return afzender === normalizeEmail(mailbox) || afzender === normalizeEmail(account);
}
