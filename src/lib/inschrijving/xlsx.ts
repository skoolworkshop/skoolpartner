/**
 * Een Excel-bestand lezen, zonder extra pakket.
 *
 * WAAROM ZELF
 *
 *   Een school stuurt bijna altijd een .xlsx. Vragen om eerst op te slaan als
 *   CSV is precies het soort stap waarop mensen afhaken. Een bibliotheek
 *   erbij halen voor het lezen van twee kolommen is dan weer zwaar geschut:
 *   dat is een afhankelijkheid die onderhouden en bijgewerkt moet worden.
 *
 *   Een xlsx is een zip met XML erin. Uitpakken kan met DecompressionStream,
 *   dat zowel in de browser als in Node ingebouwd zit, en de twee bestanden
 *   die we nodig hebben zijn goed te lezen. Dat is het hele verhaal.
 *
 * WAT HET WEL EN NIET KAN
 *
 *   Wel: het eerste werkblad, gedeelde teksten, getallen, datums als tekst
 *   zoals ze in het bestand staan, en lege cellen.
 *
 *   Niet: formules uitrekenen, meerdere werkbladen, opmaak, of een bestand met
 *   een wachtwoord. Lukt het niet, dan zegt het dat eerlijk en kan de school
 *   alsnog plakken of een CSV opslaan.
 */

import { isOudOfficeBestand, isZip, leesZip, pakUit } from "@/lib/inschrijving/zip";

/**
 * Is dit wel een xlsx?
 *
 * Een .xls uit 2003 is een heel ander bestand: geen zip maar OLE2. Dat moet je
 * niet proberen uit te pakken maar meteen melden, met de oplossing erbij.
 */
function controleerExcel(data: Uint8Array): void {
  if (isOudOfficeBestand(data)) {
    throw new Error(
      "Dit is een oud Excel-bestand (.xls). Open het in Excel, kies Opslaan als en bewaar het als .xlsx. Upload dat bestand.",
    );
  }
  if (!isZip(data)) {
    throw new Error("Dit lijkt geen Excel-bestand te zijn.");
  }
}

const ENTITEITEN: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function ontsnap(tekst: string): string {
  return tekst.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (heel, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    }
    if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return ENTITEITEN[code] ?? heel;
  });
}

/** Alle <t>-tekst binnen een stuk XML aan elkaar, zoals Excel het bedoelt. */
function teksten(xml: string): string {
  let uit = "";
  for (const treffer of xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
    uit += ontsnap(treffer[1]);
  }
  return uit;
}

/** A, B, ... Z, AA -> 0, 1, ... 25, 26 */
export function kolomNummer(verwijzing: string): number {
  const letters = verwijzing.replace(/\d+/g, "").toUpperCase();
  let nummer = 0;
  for (const letter of letters) {
    nummer = nummer * 26 + (letter.charCodeAt(0) - 64);
  }
  return nummer - 1;
}

export interface Werkblad {
  /** De naam van het tabblad. Bij een werkmap per klas is dat de klas. */
  naam: string;
  rijen: string[][];
}

function leesBlad(xml: string, gedeeld: string[]): string[][] {
  const rijen: string[][] = [];

  for (const rijTreffer of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cellen: string[] = [];
    for (const celTreffer of rijTreffer[1].matchAll(/<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const kenmerken = celTreffer[1] ?? celTreffer[2] ?? "";
      const inhoud = celTreffer[3] ?? "";
      const verwijzing = /r="([A-Z]+\d+)"/.exec(kenmerken)?.[1];
      const soort = /t="([^"]+)"/.exec(kenmerken)?.[1];

      let waarde = "";
      if (soort === "s") {
        const index = Number.parseInt(/<v>([\s\S]*?)<\/v>/.exec(inhoud)?.[1] ?? "", 10);
        waarde = Number.isFinite(index) ? (gedeeld[index] ?? "") : "";
      } else if (soort === "inlineStr") {
        waarde = teksten(inhoud);
      } else {
        waarde = ontsnap(/<v>([\s\S]*?)<\/v>/.exec(inhoud)?.[1] ?? "");
      }

      const positie = verwijzing ? kolomNummer(verwijzing) : cellen.length;
      while (cellen.length < positie) cellen.push("");
      cellen[positie] = waarde.trim();
    }
    rijen.push(cellen);
  }

  return rijen;
}

/**
 * Alle tabbladen van een werkmap, met hun naam.
 *
 * Scholen leveren het op twee manieren aan: één tabblad met alle klassen en
 * een kolom Klas erbij, of een tabblad per klas met de klasnaam als tabnaam.
 * Allebei komt hier binnen; welke het is, blijkt vanzelf uit wat erin staat.
 */
export async function leesWerkbladen(buffer: ArrayBuffer): Promise<Werkblad[]> {
  const data = new Uint8Array(buffer);
  controleerExcel(data);
  const entries = leesZip(data);

  const gedeeldeEntry = entries.find((entry) => entry.naam === "xl/sharedStrings.xml");
  const gedeeld: string[] = [];
  if (gedeeldeEntry) {
    const xml = await pakUit(data, gedeeldeEntry);
    for (const treffer of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      gedeeld.push(teksten(treffer[1]));
    }
  }

  // De namen van de tabbladen staan in workbook.xml, maar welk bestand erbij
  // hoort staat in de rels ernaast. Zonder die omweg kun je naam en inhoud
  // niet met zekerheid aan elkaar knopen.
  const workbookEntry = entries.find((entry) => entry.naam === "xl/workbook.xml");
  const relsEntry = entries.find((entry) => entry.naam === "xl/_rels/workbook.xml.rels");

  const bladen: Werkblad[] = [];

  if (workbookEntry && relsEntry) {
    const workbook = await pakUit(data, workbookEntry);
    const rels = await pakUit(data, relsEntry);

    const doelen = new Map<string, string>();
    for (const treffer of rels.matchAll(/<Relationship\b([^>]*)\/>/g)) {
      const id = /Id="([^"]+)"/.exec(treffer[1])?.[1];
      const doel = /Target="([^"]+)"/.exec(treffer[1])?.[1];
      if (id && doel) doelen.set(id, doel.replace(/^\//, "").replace(/^xl\//, ""));
    }

    for (const treffer of workbook.matchAll(/<sheet\b([^>]*)\/>/g)) {
      const naam = ontsnap(/name="([^"]*)"/.exec(treffer[1])?.[1] ?? "");
      const id = /r:id="([^"]+)"/.exec(treffer[1])?.[1];
      const doel = id ? doelen.get(id) : undefined;
      if (!doel) continue;
      const entry = entries.find((rij) => rij.naam === `xl/${doel}`);
      if (!entry) continue;
      bladen.push({ naam, rijen: leesBlad(await pakUit(data, entry), gedeeld) });
    }
  }

  if (bladen.length === 0) {
    // Geen werkmapgegevens gevonden: dan maar op volgorde van bestandsnaam.
    const losse = entries
      .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.naam))
      .sort((a, b) => a.naam.localeCompare(b.naam, "en", { numeric: true }));
    for (const [index, entry] of losse.entries()) {
      bladen.push({ naam: `Tabblad ${index + 1}`, rijen: leesBlad(await pakUit(data, entry), gedeeld) });
    }
  }

  if (bladen.length === 0) throw new Error("In dit bestand staat geen werkblad.");
  return bladen;
}

/** Alleen het eerste tabblad. */
export async function leesXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  return (await leesWerkbladen(buffer))[0].rijen;
}

/** De cellen terug naar tekst met tabs, zodat leesLijst() ermee verder kan. */
export function naarTabTekst(rijen: string[][]): string {
  return rijen
    .map((rij) => rij.map((cel) => cel.replace(/[\t\r\n]+/g, " ")).join("\t"))
    .join("\n");
}
