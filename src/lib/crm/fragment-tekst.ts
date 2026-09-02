/**
 * Fragmenten: herbruikbare tekstblokken met personalisatie.
 *
 * Dit bestand bevat uitsluitend pure logica. Geen database, geen server-only
 * markering, zodat dezelfde functie op de server een concept kan opbouwen en
 * in de browser een voorbeeld kan tonen zonder dat er twee versies van de
 * waarheid ontstaan.
 *
 * ============================================================================
 * DE BELANGRIJKSTE REGEL: EEN LEEG VELD WORDT NOOIT STIL WEGGELATEN
 * ============================================================================
 *
 * "Beste ," is de klassieke blunder van elk mailsysteem. Hier kan dat niet.
 * Een token waarvan de waarde ontbreekt blijft zichtbaar staan als {{voornaam}}
 * en wordt bovendien apart teruggegeven in `ontbrekend`. Je ziet dus vooraf
 * dat er iets mist, in plaats van achteraf bij de ontvanger.
 *
 * Wie dat niet wil, geeft een terugvalwaarde mee: {{voornaam|Beste relatie}}.
 * Dan is het een bewuste keuze en geen ongelukje.
 *
 * Een onbekend token wordt ook nooit weggepoetst. Als iemand {{voornaan}}
 * typt, blijft dat staan en komt het terug in `onbekend`. Stilzwijgend
 * verwijderen zou betekenen dat een typefout een gat in de zin achterlaat.
 *
 * ============================================================================
 * WAAROM DIT ER NU AL IS
 * ============================================================================
 *
 * Een fragment is op zichzelf handig: je typt niet elke week dezelfde uitleg
 * over de opzet van een workshopdag. Maar het echte nut komt later: een
 * sequence is niets anders dan een reeks fragmenten met een wachttijd ertussen.
 * Door de personalisatie nu goed te doen, hoeft die later niet opnieuw.
 */

export const TOKEN_OPEN = "{{";
export const TOKEN_SLUIT = "}}";

/** Elk token dat een fragment kent. Alles daarbuiten is een typefout. */
export const TOKEN_NAMEN = [
  "voornaam",
  "achternaam",
  "volledige_naam",
  "functie",
  "organisatie",
  "plaats",
  "deal",
  "bedrag",
  "datum",
  "mijn_naam",
  "mijn_email",
  "vandaag",
] as const;

export type TokenNaam = (typeof TOKEN_NAMEN)[number];

export interface TokenUitleg {
  naam: TokenNaam;
  label: string;
  uitleg: string;
  voorbeeld: string;
}

export const TOKENS: TokenUitleg[] = [
  {
    naam: "voornaam",
    label: "Voornaam",
    uitleg: "Het eerste woord van de naam van de contactpersoon.",
    voorbeeld: "Nora",
  },
  {
    naam: "achternaam",
    label: "Achternaam",
    uitleg: "Alles na het eerste woord, inclusief een tussenvoegsel als 'de' of 'van'.",
    voorbeeld: "Bakker",
  },
  {
    naam: "volledige_naam",
    label: "Volledige naam",
    uitleg: "De naam zoals hij in het contact staat.",
    voorbeeld: "Nora Bakker",
  },
  {
    naam: "functie",
    label: "Functie",
    uitleg: "De functie van de contactpersoon, als die is ingevuld.",
    voorbeeld: "Cultuurcoordinator",
  },
  {
    naam: "organisatie",
    label: "Organisatie",
    uitleg: "De naam van de school of organisatie.",
    voorbeeld: "Markenhage College",
  },
  {
    naam: "plaats",
    label: "Plaats",
    uitleg: "De plaats van de organisatie, of anders die van het contact.",
    voorbeeld: "Breda",
  },
  {
    naam: "deal",
    label: "Deal",
    uitleg: "De titel van de deal waar dit over gaat.",
    voorbeeld: "Cultuurdag 2026",
  },
  {
    naam: "bedrag",
    label: "Bedrag",
    uitleg: "De waarde van de deal, als bedrag in euro's.",
    voorbeeld: "€ 1.450,00",
  },
  {
    naam: "datum",
    label: "Verwachte datum",
    uitleg: "De verwachte datum van de deal.",
    voorbeeld: "12 maart 2027",
  },
  {
    naam: "mijn_naam",
    label: "Mijn naam",
    uitleg: "De naam van degene die het fragment gebruikt.",
    voorbeeld: "Clinten",
  },
  {
    naam: "mijn_email",
    label: "Mijn e-mailadres",
    uitleg: "Het e-mailadres van degene die het fragment gebruikt.",
    voorbeeld: "info@skoolworkshop.nl",
  },
  {
    naam: "vandaag",
    label: "Vandaag",
    uitleg: "De datum van vandaag, uitgeschreven.",
    voorbeeld: "2 september 2026",
  },
];

export const TOKEN_PER_NAAM = new Map(TOKENS.map((t) => [t.naam, t]));

export function isTokenNaam(waarde: string): waarde is TokenNaam {
  return (TOKEN_NAMEN as readonly string[]).includes(waarde);
}

/** De waarden waarmee een fragment wordt ingevuld. Alles mag ontbreken. */
export type TokenContext = Partial<Record<TokenNaam, string | null>>;

export interface GevuldFragment {
  /** De tekst met alles ingevuld wat kon worden ingevuld. */
  tekst: string;
  /** Tokens die in de tekst staan maar geen waarde en geen terugval hadden. */
  ontbrekend: TokenNaam[];
  /** Tokens die helemaal niet bestaan. Vrijwel altijd een typefout. */
  onbekend: string[];
  /** Alle tokens die in de tekst voorkomen, ook de gevulde. */
  gebruikt: TokenNaam[];
}

/*
  Het patroon.

  Bewust streng: alleen letters, cijfers en liggende streepjes in de naam, en
  na een verticale streep mag alles behalve een accolade. Een losse accolade in
  gewone tekst blijft dus gewoon een accolade, en een half getypt token maakt
  niets kapot.
*/
const TOKEN_PATROON = /\{\{\s*([a-z_][a-z0-9_]*)\s*(?:\|([^}]*))?\}\}/gi;

/**
 * Vult een fragment met de gegevens die er zijn.
 *
 * Terugvalwaarde: {{voornaam|Beste relatie}} gebruikt de tekst achter de
 * streep als de voornaam niet bekend is. Een lege terugval ({{functie|}})
 * betekent "laat dit gewoon weg", en dat is dan een expliciete keuze.
 */
export function vulFragment(bron: string, context: TokenContext): GevuldFragment {
  const ontbrekend = new Set<TokenNaam>();
  const onbekend = new Set<string>();
  const gebruikt = new Set<TokenNaam>();

  const tekst = bron.replace(TOKEN_PATROON, (heel, ruweNaam: string, terugval?: string) => {
    const naam = ruweNaam.toLowerCase();

    if (!isTokenNaam(naam)) {
      onbekend.add(ruweNaam);
      return heel;
    }

    gebruikt.add(naam);
    const waarde = context[naam];
    if (waarde !== undefined && waarde !== null && waarde.trim() !== "") return waarde;

    // Een terugval die er is, wint. Ook een lege terugval: dat is
    // "laat weg" en niet "er ontbreekt iets".
    if (terugval !== undefined) return terugval;

    ontbrekend.add(naam);
    return heel;
  });

  return {
    tekst,
    ontbrekend: [...ontbrekend],
    onbekend: [...onbekend],
    gebruikt: [...gebruikt],
  };
}

/** Alleen kijken welke tokens erin zitten, zonder iets in te vullen. */
export function tokensIn(bron: string): { gebruikt: TokenNaam[]; onbekend: string[] } {
  const { gebruikt, onbekend } = vulFragment(bron, {});
  return { gebruikt, onbekend };
}

/**
 * Een voorbeeld van het fragment, met de voorbeeldwaarden uit TOKENS.
 *
 * Gebruikt op het beheerscherm, zodat je ziet hoe het eruitziet voordat je het
 * ergens op loslaat. De waarden zijn duidelijk herkenbaar als voorbeeld en
 * komen nergens uit de echte administratie.
 */
export function voorbeeldVan(bron: string): GevuldFragment {
  const context: TokenContext = {};
  for (const token of TOKENS) context[token.naam] = token.voorbeeld;
  return vulFragment(bron, context);
}

// -----------------------------------------------------------------------------
// De sneltoets
// -----------------------------------------------------------------------------

/**
 * Maakt van een naam een bruikbare sneltoets.
 *
 * Kleine letters, streepjes, geen accenten. Zo kun je hem typen zonder erover
 * na te denken, en botst hij niet met hoofdlettergebruik.
 */
export function maakSneltoets(waarde: string): string {
  return waarde
    .normalize("NFD")
    // Accenten weghalen: eerst uit elkaar trekken met NFD, dan de
    // combineertekens (U+0300 tot U+036F) verwijderen.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function isGeldigeSneltoets(waarde: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,39}$/.test(waarde);
}

// -----------------------------------------------------------------------------
// Naam uit elkaar halen
// -----------------------------------------------------------------------------

/**
 * Splitst een naam in een voornaam en de rest.
 *
 * Bewust simpel: het eerste woord is de voornaam, alles daarna is de
 * achternaam inclusief tussenvoegsel. "Wil de Groot" wordt dus "Wil" en
 * "de Groot". Dat klopt in verreweg de meeste gevallen, en waar het niet
 * klopt is de fout klein en zichtbaar. Slimmer proberen te zijn met lijstjes
 * van tussenvoegsels levert vooral nieuwe randgevallen op.
 */
export function splitsNaam(volledig: string | null | undefined): {
  voornaam: string | null;
  achternaam: string | null;
} {
  const schoon = (volledig ?? "").trim().replace(/\s+/g, " ");
  if (!schoon) return { voornaam: null, achternaam: null };

  const spatie = schoon.indexOf(" ");
  if (spatie === -1) return { voornaam: schoon, achternaam: null };

  return { voornaam: schoon.slice(0, spatie), achternaam: schoon.slice(spatie + 1) };
}

// -----------------------------------------------------------------------------
// Wat een keuzelijst nodig heeft
// -----------------------------------------------------------------------------

/**
 * Een fragment zoals de keuzelijst het kent.
 *
 * Bewust hier en niet bij de kiezer zelf: de server stelt dit samen en de
 * browser gebruikt het. Zou het type bij de clientcomponent staan, dan zou een
 * servermodule daarvan afhankelijk worden, en dat is precies de verkeerde kant
 * op.
 */
export interface KiesbaarFragment {
  id: string;
  naam: string;
  sneltoets: string;
  categorie: string | null;
  tekst: string;
}
