/**
 * De twee merken van Skool Workshop.
 *
 * Geen server-only bestand: dit is pure logica zonder database, zodat zowel de
 * serverkant als een clientcomponent er gebruik van kan maken, en zodat het te
 * testen is zonder Supabase.
 *
 * WAAROM HET MERK NIET AAN DE ORGANISATIE HANGT
 *
 *   Skool Workshop verkoopt aan scholen, Suri Impact Breekjaar aan een
 *   individuele deelnemer. Er is dus geen organisatie die "bij beide merken
 *   klant" kan zijn. Het merk hoort daarom bij de deal, en de deal bepaalt
 *   waar je naar kijkt.
 */

export const MERKEN = ["skool_workshop", "suri_impact"] as const;

export type Merk = (typeof MERKEN)[number];

export interface MerkStijl {
  key: Merk;
  /** Zoals het in het scherm staat. */
  label: string;
  /** Korte omschrijving, voor een tooltip of een lege staat. */
  omschrijving: string;
  /** Wat er in dit merk verkocht wordt, in een woord. */
  eenheid: string;
  /** Tailwind-klassen voor een gekleurde markering. */
  chip: string;
  /** Tailwind-klassen voor het gekozen tabblad. */
  actief: string;
  /** Het smalle streepje links van een kaart of regel. */
  streep: string;
}

export const MERK_STIJL: Record<Merk, MerkStijl> = {
  skool_workshop: {
    key: "skool_workshop",
    label: "Skool Workshop",
    omschrijving: "Workshops voor scholen en organisaties.",
    eenheid: "boeking",
    chip: "bg-accent-wash text-accent-strong",
    actief: "bg-accent-wash text-ink ring-1 ring-accent/40",
    streep: "bg-accent",
  },
  suri_impact: {
    key: "suri_impact",
    label: "Suri Impact",
    omschrijving: "Het Breekjaar: vier weken Suriname voor jongeren van 17 tot en met 22.",
    eenheid: "deelnemer",
    chip: "bg-suri-wash text-suri-strong",
    actief: "bg-suri-wash text-ink ring-1 ring-suri/40",
    streep: "bg-suri",
  },
};

export const STANDAARD_MERK: Merk = "skool_workshop";

/**
 * Maakt van onbetrouwbare invoer een geldig merk.
 *
 * Gebruikt voor de waarde uit een cookie, een zoekparameter of een instelling.
 * Onbekend of leeg levert altijd het standaardmerk op, nooit een fout: een
 * kapotte cookie hoort geen scherm om te gooien.
 */
export function parseMerk(waarde: unknown): Merk {
  if (typeof waarde !== "string") return STANDAARD_MERK;
  const schoon = waarde.trim().toLowerCase();
  return (MERKEN as readonly string[]).includes(schoon) ? (schoon as Merk) : STANDAARD_MERK;
}

/** Is dit precies een van de twee merken? Strenger dan parseMerk. */
export function isMerk(waarde: unknown): waarde is Merk {
  return typeof waarde === "string" && (MERKEN as readonly string[]).includes(waarde);
}

export function merkLabel(merk: Merk): string {
  return MERK_STIJL[merk].label;
}

/** Het andere merk. Handig voor "wissel naar ..." zonder lijstje. */
export function anderMerk(merk: Merk): Merk {
  return merk === "skool_workshop" ? "suri_impact" : "skool_workshop";
}

/**
 * Telt de fases van een merk uit tot iets wat een scherm kan tonen.
 *
 * De fases komen uit de database, dus de volgorde en de labels kunnen
 * veranderen zonder dat hier iets aangepast hoeft te worden.
 */
export interface Fase {
  id: string;
  brand: Merk;
  key: string;
  label: string;
  description: string | null;
  position: number;
  is_won: boolean;
  is_lost: boolean;
  /**
   * Een gearchiveerde fase bestaat nog, maar is geen kolom meer op het bord en
   * is niet meer te kiezen. Zo blijft de historie leesbaar zonder dat de
   * pijplijn volloopt met fases die niemand meer gebruikt.
   *
   * Optioneel getypeerd, want de kolom komt pas met migratie 039. Zolang die
   * niet is toegepast leest hij als undefined, en dan is niets gearchiveerd.
   */
  is_archived?: boolean | null;
}

export interface FaseOverzicht {
  /** De fases waar een deal doorheen loopt, op volgorde. */
  lopend: Fase[];
  /** De fase die telt als gewonnen, als die er is. */
  gewonnen: Fase | null;
  /** De fase die telt als verloren, als die er is. */
  verloren: Fase | null;
}

export function sorteerFases(fases: Fase[]): FaseOverzicht {
  /*
    Gearchiveerde fases doen niet meer mee. Ze bestaan nog zodat de historie
    ernaar kan verwijzen, maar je kunt een deal er niet meer in zetten: een fase
    aanbieden die niet meer op het bord staat, betekent dat een deal daarna
    nergens meer te zien is.
  */
  const opVolgorde = [...fases]
    .filter((f) => !f.is_archived)
    .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
  return {
    lopend: opVolgorde.filter((f) => !f.is_won && !f.is_lost),
    gewonnen: opVolgorde.find((f) => f.is_won) ?? null,
    verloren: opVolgorde.find((f) => f.is_lost) ?? null,
  };
}
