import { isOudOfficeBestand, isZip, leesZip, pakUit } from "@/lib/inschrijving/zip";

/**
 * Een Word-bestand lezen, zonder extra pakket.
 *
 * WAT SCHOLEN STUREN
 *
 *   Een klassenlijst in Word ziet er bijna altijd hetzelfde uit: een kopregel
 *   met de klas, daaronder een tabel met de leerlingen, en dat drie of vier
 *   keer achter elkaar. De kolommen zijn meestal voornaam, tussenvoegsel en
 *   achternaam.
 *
 * DE KOP STAAT NIET ALTIJD BOVEN DE TABEL
 *
 *   In het testbestand staat de eerste klasnaam er juist ónder, en de twee
 *   daarna erboven. Dat is geen fout van de school, zo is het document nu
 *   eenmaal gemaakt. Daarom wordt per tabel eerst gekeken naar de dichtstbij
 *   staande kop erboven die nog vrij is, en pas als die er niet is naar de
 *   kop eronder. Op dat testbestand levert dat precies de goede verdeling op.
 *
 * WAT HET NIET DOET
 *
 *   Opmaak, afbeeldingen, kop- en voetteksten, of tekstvakken. Alleen
 *   paragrafen en tabellen in de hoofdtekst, want daar staat de lijst in.
 */

/** Een blok uit het document, in de volgorde waarin het er staat. */
export type DocxBlok =
  | { soort: "alinea"; tekst: string }
  | { soort: "tabel"; rijen: string[][] };

const XML_ENTITEITEN: Record<string, string> = {
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
    return XML_ENTITEITEN[code] ?? heel;
  });
}

/**
 * De tekst uit een stuk Word-XML halen.
 *
 * <w:t> bevat de letters. <w:tab> en <w:br> worden een spatie, anders plakken
 * twee woorden aan elkaar. Al het andere is opmaak en mag weg.
 */
function tekstVan(xml: string): string {
  return ontsnap(
    xml
      // Een tab of regelafbreking staat buiten <w:t>. Door er een <w:t> met
      // een spatie van te maken, blijft hij staan bij het uitlezen hieronder
      // en plakken twee woorden niet aan elkaar.
      .replace(/<w:tab\b[^>]*\/>/g, "<w:t> </w:t>")
      .replace(/<w:br\b[^>]*\/>/g, "<w:t> </w:t>")
      .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, (_heel, inhoud: string) => `\u0000${inhoud}\u0000`)
      .replace(/<[^>]+>/g, "")
      .split("\u0000")
      .filter((_deel, index) => index % 2 === 1)
      .join(""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * De hoofdtekst in blokken hakken.
 *
 * Alinea's en tabellen staan in document.xml door elkaar heen, en die
 * volgorde is precies wat we nodig hebben om een klasnaam aan een tabel te
 * kunnen koppelen. Daarom wordt er één keer door het bestand gelopen in
 * plaats van eerst alle tabellen en dan alle alinea's te pakken.
 */
export function leesBlokken(xml: string): DocxBlok[] {
  const body = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? xml;
  const blokken: DocxBlok[] = [];

  // Alleen de blokken op het hoogste niveau. Een tabel in een tabel komt niet
  // voor in klassenlijsten, en een alinea binnen een cel is geen kopregel.
  let positie = 0;
  while (positie < body.length) {
    const volgendeAlinea = body.indexOf("<w:p", positie);
    const volgendeTabel = body.indexOf("<w:tbl", positie);

    const alineaEerst =
      volgendeAlinea >= 0 && (volgendeTabel < 0 || volgendeAlinea < volgendeTabel);
    const tabelEerst = volgendeTabel >= 0 && (volgendeAlinea < 0 || volgendeTabel < volgendeAlinea);

    if (tabelEerst) {
      const eind = sluitPositie(body, volgendeTabel, "w:tbl");
      if (eind < 0) break;
      blokken.push({ soort: "tabel", rijen: leesTabelRijen(body.slice(volgendeTabel, eind)) });
      positie = eind;
      continue;
    }

    if (alineaEerst) {
      const eind = sluitPositie(body, volgendeAlinea, "w:p");
      if (eind < 0) break;
      const tekst = tekstVan(body.slice(volgendeAlinea, eind));
      if (tekst) blokken.push({ soort: "alinea", tekst });
      positie = eind;
      continue;
    }

    break;
  }

  return blokken;
}

/**
 * Waar sluit dit element?
 *
 * Een tabel kan een tabel bevatten en een alinea staat in een cel, dus
 * zoeken naar de eerste `</w:tbl>` levert de verkeerde grens op. Daarom
 * worden open- en sluittags geteld.
 */
function sluitPositie(xml: string, begin: number, tag: string): number {
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`, "g");
  const dicht = new RegExp(`</${tag}>`, "g");
  // Een leeg element sluit zichzelf meteen.
  const zelfsluitend = new RegExp(`^<${tag}(\\s[^>]*)?/>`).exec(xml.slice(begin));
  if (zelfsluitend) return begin + zelfsluitend[0].length;

  open.lastIndex = begin;
  dicht.lastIndex = begin;
  let diepte = 0;
  let wijzer = begin;

  for (;;) {
    open.lastIndex = wijzer;
    dicht.lastIndex = wijzer;
    const volgendeOpen = open.exec(xml);
    const volgendeDicht = dicht.exec(xml);
    if (!volgendeDicht) return -1;

    if (volgendeOpen && volgendeOpen.index < volgendeDicht.index) {
      diepte += 1;
      wijzer = volgendeOpen.index + volgendeOpen[0].length;
      continue;
    }

    diepte -= 1;
    wijzer = volgendeDicht.index + volgendeDicht[0].length;
    if (diepte === 0) return wijzer;
  }
}

function leesTabelRijen(xml: string): string[][] {
  const rijen: string[][] = [];
  let positie = 0;

  for (;;) {
    const begin = xml.indexOf("<w:tr", positie);
    if (begin < 0) break;
    const eind = sluitPositie(xml, begin, "w:tr");
    if (eind < 0) break;

    const rij = xml.slice(begin, eind);
    const cellen: string[] = [];
    let celPositie = 0;
    for (;;) {
      const celBegin = rij.indexOf("<w:tc", celPositie);
      if (celBegin < 0) break;
      const celEind = sluitPositie(rij, celBegin, "w:tc");
      if (celEind < 0) break;
      cellen.push(tekstVan(rij.slice(celBegin, celEind)));
      celPositie = celEind;
    }

    rijen.push(cellen);
    positie = eind;
  }

  return rijen;
}

export interface DocxLijst {
  /** De klas, als die uit een kopregel te halen was. */
  klas: string | null;
  rijen: string[][];
}

/** Ziet deze alinea eruit als de naam van een klas? */
export function lijktOpKlasKop(tekst: string): boolean {
  const schoon = tekst.trim();
  if (schoon.length === 0 || schoon.length > 40) return false;
  if (/^(klas|groep|team)\b/i.test(schoon)) return true;
  // Km1A, KH1C, 2 VWO, 4havo: kort, met minstens één cijfer erin.
  return /\d/.test(schoon) && schoon.split(/\s+/).length <= 3 && schoon.length <= 20;
}

/** "Klas Km1A" wordt "Km1A". De rest blijft zoals de school het schrijft. */
export function schoonKlasNaam(tekst: string): string {
  return tekst
    .trim()
    .replace(/^(klas|groep|team)\s*[:-]?\s*/i, "")
    .trim();
}

/**
 * De tabellen uit een document met hun klas erbij.
 *
 * Eerst de kop erboven, anders die eronder. Een kop wordt maar één keer
 * gebruikt, zodat twee tabellen onder elkaar niet allebei dezelfde klas
 * krijgen.
 */
export function koppelKlassen(blokken: DocxBlok[]): DocxLijst[] {
  const koppen = blokken
    .map((blok, index) => ({ index, blok }))
    .filter(({ blok }) => blok.soort === "alinea" && lijktOpKlasKop(blok.tekst))
    .map(({ index, blok }) => ({ index, tekst: schoonKlasNaam((blok as { tekst: string }).tekst) }));

  const gebruikt = new Set<number>();
  const lijsten: DocxLijst[] = [];

  blokken.forEach((blok, index) => {
    if (blok.soort !== "tabel" || blok.rijen.length === 0) return;

    const erboven = [...koppen].reverse().find((kop) => kop.index < index && !gebruikt.has(kop.index));
    const eronder = koppen.find((kop) => kop.index > index && !gebruikt.has(kop.index));
    const gekozen = erboven ?? eronder ?? null;
    if (gekozen) gebruikt.add(gekozen.index);

    lijsten.push({ klas: gekozen?.tekst ?? null, rijen: blok.rijen });
  });

  return lijsten;
}

function controleerWord(data: Uint8Array): void {
  if (isOudOfficeBestand(data)) {
    throw new Error(
      "Dit is een oud Word-bestand (.doc). Open het in Word, kies Opslaan als en bewaar het als .docx. Upload dat bestand.",
    );
  }
  if (!isZip(data)) {
    throw new Error("Dit lijkt geen Word-bestand te zijn.");
  }
}

/** Het hele document inlezen en per klas een tabel teruggeven. */
export async function leesDocx(buffer: ArrayBuffer): Promise<DocxLijst[]> {
  const data = new Uint8Array(buffer);
  controleerWord(data);

  const entries = leesZip(data);
  const document = entries.find((entry) => entry.naam === "word/document.xml");
  if (!document) throw new Error("Dit Word-bestand mist zijn tekst. Sla het opnieuw op en probeer het nog eens.");

  const xml = await pakUit(data, document);
  const lijsten = koppelKlassen(leesBlokken(xml));

  if (lijsten.length === 0) {
    // Geen tabellen: dan staat de lijst misschien als gewone regels in de
    // tekst. Die worden als één naamloze lijst teruggegeven, zodat de
    // gebruiker er alsnog een klas bij kan kiezen.
    const regels = leesBlokken(xml)
      .filter((blok): blok is { soort: "alinea"; tekst: string } => blok.soort === "alinea")
      .map((blok) => [blok.tekst]);
    if (regels.length > 0) return [{ klas: null, rijen: regels }];
  }

  return lijsten;
}

/**
 * De tabellen omzetten naar tabgescheiden tekst, per klas een "blad".
 *
 * Daarmee gaat een Word-bestand verder precies dezelfde weg als een Excel met
 * een tabblad per klas. Eén lezer, één voorbeeldscherm, één keer getest.
 */
export function naarBladen(lijsten: DocxLijst[]): { naam: string; tekst: string }[] {
  return lijsten.map((lijst, index) => ({
    naam: lijst.klas ?? `Lijst ${index + 1}`,
    tekst: lijst.rijen.map((rij) => rij.join("\t")).join("\n"),
  }));
}
