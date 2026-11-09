/**
 * Namen van deelnemers herkennen zoals ze echt worden ingetypt.
 *
 * HET PROBLEEM
 *
 *   De school levert een lijst aan. Daarop staat "Lissa van der Velde". De
 *   leerling zelf typt op haar telefoon "lissa v/d velde", of "Lissa vd Velde",
 *   of "LISSA VAN DER VELDE", of ze laat het tussenvoegsel weg. Dat is
 *   allemaal dezelfde persoon, en het oude systeem maakte er een nieuwe
 *   inschrijving van of vond haar niet.
 *
 * DE AANPAK
 *
 *   Elke naam wordt teruggebracht tot een sleutel. Daarbij gaat weg wat mensen
 *   toch door elkaar halen: hoofdletters, accenten, punten, streepjes en de
 *   tussenvoegsels. Wat overblijft noemen we de kern: de voornaam en de
 *   achternaam zonder opsmuk. Die kern wordt alfabetisch gesorteerd, zodat
 *   "Velde, Lissa" en "Lissa van der Velde" op dezelfde sleutel uitkomen.
 *
 *   Daarnaast is er een platte sleutel zonder spaties. Die vangt "Anne-Marie"
 *   tegenover "Annemarie" en "Jan Peter" tegenover "Jan-Peter".
 *
 *   Pas als geen van die sleutels iets oplevert, wordt er gezocht op kleine
 *   typefouten. Dat geeft nooit direct een match, maar een vraag: bedoel je
 *   Lissa van der Velde? Zo wordt niemand per ongeluk als iemand anders
 *   ingeschreven.
 *
 * WAT HET BEWUST NIET DOET
 *
 *   Roepnamen raden. "Loes" wordt niet gekoppeld aan "Louise" en "Sem" niet
 *   aan "Sebastiaan". Dat lijkt behulpzaam, maar bij twee leerlingen in
 *   dezelfde klas gaat dat fout en schrijf je de verkeerde in. Wie niet
 *   gevonden wordt, krijgt de vraag om de naam te typen zoals de school hem
 *   kent, of om het aan de docent te vragen.
 *
 *   Zoeken buiten de gekozen groep. De klas of groep is altijd eerst gekozen,
 *   dus er wordt alleen in die groep gezocht. Dat maakt de lijst kort, de kans
 *   op een verwisseling klein, en namen van andere groepen blijven onzichtbaar.
 */

/**
 * Nederlandse tussenvoegsels. Deze doen niet mee in de sleutel, omdat ze het
 * vaakst verkeerd of helemaal niet worden getypt. Ze blijven wel in de naam
 * staan die je op het scherm en op de lijsten ziet.
 */
export const TUSSENVOEGSELS = new Set([
  "van",
  "de",
  "den",
  "der",
  "het",
  "ter",
  "te",
  "ten",
  "op",
  "in",
  "aan",
  "bij",
  "uit",
  "voor",
  "onder",
  "over",
  "tot",
  "la",
  "le",
  "du",
  "des",
  "del",
  "della",
  "di",
  "da",
  "dos",
  "el",
  "al",
  "bin",
  "ibn",
  "von",
  "zu",
  "af",
  "av",
]);

/** Afkortingen die mensen echt typen, uitgeschreven naar de volle vorm. */
const AFKORTINGEN: [RegExp, string][] = [
  // v/d, v.d., v d, vd  ->  van de
  [/\bv\s*[./]?\s*d\.?(?=\s|$)/g, " van de "],
  // v/h, v.h.  ->  van het
  [/\bv\s*[./]?\s*h\.?(?=\s|$)/g, " van het "],
  // van 't, van t, v/t  ->  van het
  [/\bvan\s*'?\s*t\.?(?=\s|$)/g, " van het "],
  // aan elkaar geschreven tussenvoegsels
  [/\bvander\b/g, " van der "],
  [/\bvanden\b/g, " van den "],
  [/\bvandehet\b/g, " van het "],
  [/\bvande\b/g, " van de "],
  // losse 't en d' als tussenvoegsel
  [/(^|\s)'t(?=\s|$)/g, " het "],
  [/(^|\s)t'(?=\s|$)/g, " het "],
  // v. als afkorting van van, maar nooit vooraan: daar is het een voorletter.
  [/(?<=\S\s)v\.(?=\s|$)/g, " van "],
];

/**
 * Haalt accenten weg en maakt alles kleine letters. Verder wordt alleen de
 * apostrof weggehaald zonder spatie ervoor, zodat d'Hondt dhondt wordt en niet
 * uiteenvalt.
 */
export function normaliseerNaam(ruw: string): string {
  let tekst = (ruw ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

  // De apostrof in een naam verbindt, hij splitst niet. Wel pas na de
  // afkortingen hieronder, want 't en d' zijn juist losse woorden.
  for (const [patroon, vervanging] of AFKORTINGEN) {
    tekst = tekst.replace(patroon, vervanging);
  }

  return tekst
    .replace(/['’`]/g, "")
    .replace(/[^a-z]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** De naam uiteen: de kern (voornaam en achternaam) en de tussenvoegsels. */
export function splitsNaam(ruw: string): { kern: string[]; tussen: string[] } {
  const kern: string[] = [];
  const tussen: string[] = [];
  for (const woord of normaliseerNaam(ruw).split(" ")) {
    if (!woord) continue;
    if (TUSSENVOEGSELS.has(woord)) tussen.push(woord);
    else kern.push(woord);
  }
  return { kern, tussen };
}

/** De sleutel: de kern, alfabetisch, met spaties ertussen. */
export function naamSleutel(ruw: string): string {
  return [...splitsNaam(ruw).kern].sort().join(" ");
}

/** Dezelfde sleutel zonder spaties. Wordt opgeslagen en gebruikt bij typefouten. */
export function platteNaamSleutel(ruw: string): string {
  return [...splitsNaam(ruw).kern].sort().join("");
}

/**
 * Alle manieren waarop de kern aan elkaar geschreven kan zijn.
 *
 * "Anne-Marie de Jong" valt uiteen in anne, marie en jong. Wie "Annemarie de
 * Jong" typt, komt op annemarie en jong. Door van beide alle volgordes aan
 * elkaar te plakken, komen ze allebei uit op annemariejong. Dat is precies:
 * het blijven dezelfde letters in dezelfde volgorde, alleen de spaties staan
 * anders. Een anagram levert dus geen treffer op.
 *
 * Bij meer dan vier losse woorden worden alleen de twee meest voorkomende
 * volgordes genomen, want 120 varianten uitrekenen voor een naam die zo lang
 * is heeft geen zin.
 */
export function platteVarianten(ruw: string): Set<string> {
  const kern = splitsNaam(ruw).kern;
  if (kern.length === 0) return new Set();
  if (kern.length > 4) {
    return new Set([kern.join(""), [...kern].sort().join("")]);
  }

  const varianten = new Set<string>();
  const loop = (over: string[], tot: string) => {
    if (over.length === 0) {
      varianten.add(tot);
      return;
    }
    for (let i = 0; i < over.length; i += 1) {
      loop([...over.slice(0, i), ...over.slice(i + 1)], tot + over[i]);
    }
  };
  loop(kern, "");
  return varianten;
}

export interface Sleutels {
  sleutel: string;
  platteSleutel: string;
}

/** Beide sleutels in één keer. Dit is wat bij de upload wordt opgeslagen. */
export function maakSleutels(ruw: string): Sleutels {
  return { sleutel: naamSleutel(ruw), platteSleutel: platteNaamSleutel(ruw) };
}

export interface Kandidaat {
  id: string;
  naam: string;
  sleutel: string;
  platteSleutel: string;
}

export type Uitkomst =
  /** Eén zekere treffer. Hiermee kan direct worden ingeschreven. */
  | { soort: "gevonden"; kandidaat: Kandidaat }
  /** Waarschijnlijk deze, maar het moet bevestigd worden. */
  | { soort: "bijna"; kandidaten: Kandidaat[] }
  /** Twee deelnemers in dezelfde groep met dezelfde naam. */
  | { soort: "meerdere"; kandidaten: Kandidaat[] }
  /** Niets gevonden. */
  | { soort: "niets" };

/** Hoeveel tekens mogen verschillen voordat het geen typefout meer is. */
function maxAfstand(lengte: number): number {
  if (lengte <= 5) return 0;
  if (lengte <= 9) return 1;
  return 2;
}

/** Levenshtein, met een bovengrens zodat lange namen niet alles kosten. */
export function afstand(a: string, b: string, grens: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > grens) return grens + 1;

  let vorige = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const huidige = [i];
    let besteOpRij = i;
    for (let j = 1; j <= b.length; j += 1) {
      const kosten = a[i - 1] === b[j - 1] ? 0 : 1;
      const waarde = Math.min(huidige[j - 1] + 1, vorige[j] + 1, vorige[j - 1] + kosten);
      huidige.push(waarde);
      if (waarde < besteOpRij) besteOpRij = waarde;
    }
    if (besteOpRij > grens) return grens + 1;
    vorige = huidige;
  }
  return vorige[b.length];
}

/**
 * Zoekt de ingetypte naam in de lijst van één groep.
 *
 * De stappen staan in volgorde van zekerheid. Zodra een stap iets oplevert,
 * stopt het zoeken. Alleen de eerste twee stappen geven een directe treffer;
 * de rest vraagt altijd om bevestiging.
 */
export function zoekDeelnemer(ingevoerd: string, lijst: Kandidaat[]): Uitkomst {
  const gezocht = maakSleutels(ingevoerd);
  if (!gezocht.sleutel) return { soort: "niets" };

  // 1. Dezelfde kern, in welke volgorde dan ook.
  const opSleutel = lijst.filter((k) => k.sleutel === gezocht.sleutel);
  if (opSleutel.length === 1) return { soort: "gevonden", kandidaat: opSleutel[0] };
  if (opSleutel.length > 1) return { soort: "meerdere", kandidaten: opSleutel };

  // 2. Dezelfde letters, alleen de spaties anders: Anne-Marie tegenover Annemarie.
  const gezochteVarianten = platteVarianten(ingevoerd);
  const opPlat = lijst.filter((k) =>
    [...platteVarianten(k.naam)].some((variant) => gezochteVarianten.has(variant)),
  );
  if (opPlat.length === 1) return { soort: "gevonden", kandidaat: opPlat[0] };
  if (opPlat.length > 1) return { soort: "meerdere", kandidaten: opPlat };

  const gezochteKern = splitsNaam(ingevoerd).kern;

  // 3. Voorletters: L. van der Velde tegenover Lissa van der Velde.
  if (gezochteKern.some((woord) => woord.length === 1)) {
    const opVoorletter = lijst.filter((kandidaat) => {
      const kern = kandidaat.sleutel.split(" ").filter(Boolean);
      if (kern.length !== gezochteKern.length) return false;
      const over = [...kern];
      return [...gezochteKern].sort().every((woord) => {
        const index = over.findIndex((k) => (woord.length === 1 ? k.startsWith(woord) : k === woord));
        if (index < 0) return false;
        over.splice(index, 1);
        return true;
      });
    });
    if (opVoorletter.length > 0) return { soort: "bijna", kandidaten: opVoorletter };
  }

  // 4. Eén woord ingetypt, bijvoorbeeld alleen de voornaam.
  if (gezochteKern.length === 1) {
    const woord = gezochteKern[0];
    const opDeel = lijst.filter((k) => k.sleutel.split(" ").includes(woord));
    if (opDeel.length > 0) return { soort: "bijna", kandidaten: opDeel };
  }

  // 5. Een kleine typefout. Alleen als suggestie, nooit als zekerheid.
  const grens = maxAfstand(gezocht.platteSleutel.length);
  if (grens > 0) {
    let beste = grens + 1;
    let kandidaten: Kandidaat[] = [];
    for (const kandidaat of lijst) {
      const d = afstand(gezocht.platteSleutel, kandidaat.platteSleutel, grens);
      if (d > grens) continue;
      if (d < beste) {
        beste = d;
        kandidaten = [kandidaat];
      } else if (d === beste) {
        kandidaten.push(kandidaat);
      }
    }
    if (kandidaten.length > 0) return { soort: "bijna", kandidaten };
  }

  return { soort: "niets" };
}
