/**
 * De omschrijving van een afspraak leesbaar maken.
 *
 * ============================================================================
 * WAAROM DIT BESTAAT
 * ============================================================================
 *
 * De afspraken die uit HubSpot zijn overgenomen dragen hun oorspronkelijke
 * omschrijving mee, en die is daar HTML. In het scherm zag dat er zo uit:
 *
 *   Join link for Google Meet : https://meet.google.com/hov-grgh-qup<br><b>Wil
 *   je wijzigingen aanbrengen?</b><br><ul><li>Opnieuw plannen:&nbsp;<a
 *   href="https://app-eu1.hubspot.com/meetings/...?rescheduleId=918810da...
 *
 * Dat is geen omschrijving meer, dat is een berg techniek. Deze functie haalt
 * er weer een gewone zin uit en zet de links apart, zodat het scherm er een
 * nette knop van kan maken.
 *
 * ============================================================================
 * WAT ER MET DE LINKS GEBEURT
 * ============================================================================
 *
 *   De videolink blijft, want die heb je nodig om het gesprek in te gaan.
 *
 *   De HubSpot-links om te verzetten of af te zeggen gaan eruit. Ze wijzen naar
 *   een systeem waar wij mee stoppen, en een knop die straks een foutmelding
 *   geeft is erger dan geen knop. Afzeggen doe je in SkoolPartner zelf.
 *
 * Deze functie verandert niets aan wat er in de database staat. Zij bepaalt
 * alleen wat je ziet. Het opschonen van de opgeslagen tekst is een aparte,
 * bewuste handeling.
 */

/** Herkent een videogesprek. Bewust een korte lijst: alleen wat wij gebruiken. */
const VIDEO_DIENSTEN: { patroon: RegExp; naam: string }[] = [
  { patroon: /meet\.google\.com/i, naam: "Google Meet" },
  { patroon: /zoom\.us/i, naam: "Zoom" },
  { patroon: /teams\.microsoft\.com|teams\.live\.com/i, naam: "Teams" },
  { patroon: /whereby\.com/i, naam: "Whereby" },
];

/** Links die naar HubSpot wijzen, laten wij niet meer zien. */
const HUBSPOT_LINK = /hubspot\.com/i;

const ENTITEITEN: [RegExp, string][] = [
  [/&nbsp;/gi, " "],
  [/&amp;/gi, "&"],
  [/&lt;/gi, "<"],
  [/&gt;/gi, ">"],
  [/&quot;/gi, '"'],
  [/&#39;|&apos;/gi, "'"],
  [/&euro;/gi, "€"],
];

/** HTML eruit, gewone tekst erin. Opmaak gaat verloren, en dat mag. */
export function platteTekst(waarde: unknown): string {
  let tekst = typeof waarde === "string" ? waarde : "";
  tekst = tekst
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|ul|ol)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, "");
  for (const [patroon, vervanging] of ENTITEITEN) tekst = tekst.replace(patroon, vervanging);
  return tekst
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface AfspraakTekst {
  /** De omschrijving zonder HTML en zonder losse adressen. */
  tekst: string;
  /** De link naar het gesprek, als die er is. */
  gesprek: { url: string; dienst: string } | null;
  /** Hoeveel links er zijn weggelaten omdat ze naar HubSpot wezen. */
  weggelaten: number;
}

const URL_PATROON = /https?:\/\/[^\s<>"')\]]+/gi;

export function leesAfspraakTekst(waarde: unknown): AfspraakTekst {
  const plat = platteTekst(waarde);
  const adressen = plat.match(URL_PATROON) ?? [];

  let gesprek: AfspraakTekst["gesprek"] = null;
  let weggelaten = 0;

  for (const adres of adressen) {
    // Een punt of komma direct achter een adres hoort bij de zin, niet bij de
    // link. Zonder dit krijg je een knop naar een adres dat niet bestaat.
    const schoon = adres.replace(/[.,;:]+$/, "");
    const dienst = VIDEO_DIENSTEN.find((d) => d.patroon.test(schoon));
    if (dienst && !gesprek) {
      gesprek = { url: schoon, dienst: dienst.naam };
      continue;
    }
    if (HUBSPOT_LINK.test(schoon)) weggelaten += 1;
  }

  /*
    De adressen uit de lopende tekst halen. Ze staan nu in een knop, of ze zijn
    bewust weggelaten; ze twee keer tonen maakt de tekst opnieuw onleesbaar.
  */
  let tekst = plat.replace(URL_PATROON, "").replace(/[ \t]+/g, " ");

  // Wat er dan overblijft aan losse leestekens en lege regels, gaat eruit.
  tekst = tekst
    .split("\n")
    // Aan het eind bewust geen punt weghalen: een zin die op een punt eindigt
    // is gewoon een zin. Het gaat om de dubbele punt en de komma die overblijven
    // waar een adres stond, zoals in "Opnieuw plannen:".
    .map((regel) => regel.replace(/^[\s•:;,.-]+|[\s:;,-]+$/g, "").trim())
    .filter((regel) => regel.length > 1)
    .join("\n");

  /*
    Wat er overblijft aan bijschriften bij weggehaalde links.

    "Join link for Google Meet" zegt niets meer zodra de link in een knop staat,
    en "Opnieuw plannen" en "Annuleren" waren de bijschriften bij de twee
    HubSpot-links die wij niet meer tonen. Zonder hun link is het een woord dat
    nergens meer heen gaat.

    Bewust een korte, letterlijke lijst en geen slimme regel: alleen deze vaste
    teksten van HubSpot, zodat een echte zin van een collega nooit sneuvelt.
  */
  const BIJSCHRIFTEN = [
    /^join link/i,
    /^opnieuw plannen$/i,
    /^annuleren$/i,
    /^reschedule$/i,
    /^cancel$/i,
    /^wil je wijzigingen aanbrengen\??$/i,
  ];
  if (gesprek || weggelaten > 0) {
    tekst = tekst
      .split("\n")
      .filter((regel) => !BIJSCHRIFTEN.some((patroon) => patroon.test(regel.trim())))
      .join("\n");
  }

  return { tekst: tekst.trim(), gesprek, weggelaten };
}

/** De eerste zinnen, kort genoeg voor een smalle kolom. */
export function kortAf(tekst: string, maximum = 220): { kort: string; ingekort: boolean } {
  if (tekst.length <= maximum) return { kort: tekst, ingekort: false };
  const afgekapt = tekst.slice(0, maximum);
  const spatie = afgekapt.lastIndexOf(" ");
  return { kort: `${(spatie > 80 ? afgekapt.slice(0, spatie) : afgekapt).trimEnd()}...`, ingekort: true };
}
