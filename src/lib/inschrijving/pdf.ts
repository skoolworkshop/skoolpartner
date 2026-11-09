/**
 * Tekst uit een PDF halen, zonder extra pakket.
 *
 * WAAROM
 *
 *   Scholen sturen hun klassenlijst net zo vaak als PDF als in Excel. Dat is
 *   meestal een afdruk uit het leerlingvolgsysteem. Vragen om een ander
 *   bestand kost een mailtje heen en weer, en dan nog is het maar de vraag of
 *   het komt.
 *
 * HOE
 *
 *   Een PDF bewaart tekst in streams die ingepakt zijn met deflate, net als
 *   een zip. Uitpakken kan met DecompressionStream, dat in de browser en in
 *   Node ingebouwd zit. In die streams staan tekenreeksen met daarnaast waar
 *   ze op de pagina staan. Door de stukjes op hun y-waarde te groeperen
 *   ontstaan er regels, en door binnen een regel op x te sorteren ontstaan de
 *   kolommen weer. Een grote horizontale sprong wordt een tab, en daarmee
 *   leest de rest van het systeem het als een tabel.
 *
 * WAT HET NIET KAN
 *
 *   Een gescande PDF. Daar staan geen letters in maar een foto van letters;
 *   daar is tekstherkenning voor nodig en dat hoort hier niet thuis. Komt er
 *   niets uit, dan zegt het dat, in plaats van een lege lijst te laten zien.
 */

/** De tekens die WinAnsi anders invult dan Latin-1. */
const WINANSI: Record<number, string> = {
  0x80: "€",
  0x82: "‚",
  0x83: "ƒ",
  0x84: "„",
  0x85: "…",
  0x86: "†",
  0x87: "‡",
  0x88: "ˆ",
  0x89: "‰",
  0x8a: "Š",
  0x8b: "‹",
  0x8c: "Œ",
  0x8e: "Ž",
  0x91: "‘",
  0x92: "’",
  0x93: "“",
  0x94: "”",
  0x95: "•",
  0x96: "–",
  0x97: "—",
  0x98: "˜",
  0x99: "™",
  0x9a: "š",
  0x9b: "›",
  0x9c: "œ",
  0x9e: "ž",
  0x9f: "Ÿ",
};

function alsLatijn(data: Uint8Array): string {
  let uit = "";
  for (let i = 0; i < data.length; i += 4096) {
    uit += String.fromCharCode(...data.subarray(i, i + 4096));
  }
  return uit;
}

async function inflate(stuk: Uint8Array, rauw: boolean): Promise<Uint8Array | null> {
  try {
    const stroom = new Blob([stuk as unknown as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream(rauw ? "deflate-raw" : "deflate"));
    return new Uint8Array(await new Response(stroom).arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * ASCII85 uitpakken.
 *
 * Sommige programma's zetten de tekst eerst om naar leesbare tekens voordat
 * ze hem inpakken. Dan staat er twee keer een filter in het bestand en moeten
 * ze allebei, in de goede volgorde, worden toegepast.
 */
function ascii85(tekst: string): Uint8Array {
  const schoon = tekst.replace(/^<~/, "").replace(/~>[\s\S]*$/, "").replace(/\s+/g, "");
  const uit: number[] = [];
  let groep: number[] = [];

  for (const teken of schoon) {
    if (teken === "z" && groep.length === 0) {
      uit.push(0, 0, 0, 0);
      continue;
    }
    const waarde = teken.charCodeAt(0) - 33;
    if (waarde < 0 || waarde > 84) continue;
    groep.push(waarde);
    if (groep.length === 5) {
      let getal = 0;
      for (const deel of groep) getal = getal * 85 + deel;
      uit.push((getal >>> 24) & 255, (getal >>> 16) & 255, (getal >>> 8) & 255, getal & 255);
      groep = [];
    }
  }

  if (groep.length > 1) {
    const tekort = 5 - groep.length;
    for (let i = 0; i < tekort; i += 1) groep.push(84);
    let getal = 0;
    for (const deel of groep) getal = getal * 85 + deel;
    const bytes = [(getal >>> 24) & 255, (getal >>> 16) & 255, (getal >>> 8) & 255, getal & 255];
    uit.push(...bytes.slice(0, 4 - tekort));
  }

  return new Uint8Array(uit);
}

function asciiHex(tekst: string): Uint8Array {
  const hex = tekst.replace(/>[\s\S]*$/, "").replace(/[^0-9a-fA-F]/g, "");
  const uit = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < uit.length; i += 1) uit[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return uit;
}

interface Stream {
  /** Het objectnummer, voor het koppelen van een lettertype aan zijn tabel. */
  nummer: number | null;
  dict: string;
  inhoud: string;
}

/** Alle streams uitpakken, met het objectnummer waar ze bij horen. */
async function leesStreams(rauw: string, data: Uint8Array): Promise<Stream[]> {
  const streams: Stream[] = [];
  const objecten = [...rauw.matchAll(/(\d+)\s+\d+\s+obj\b/g)];

  for (const [index, obj] of objecten.entries()) {
    const begin = obj.index!;
    const eind = index + 1 < objecten.length ? objecten[index + 1].index! : rauw.length;
    const blok = rauw.slice(begin, eind);

    const streamPositie = blok.indexOf("stream");
    if (streamPositie < 0) continue;

    const dict = blok.slice(0, streamPositie);
    let start = begin + streamPositie + "stream".length;
    if (rauw[start] === "\r") start += 1;
    if (rauw[start] === "\n") start += 1;

    const eindePositie = blok.indexOf("endstream", streamPositie);
    if (eindePositie < 0) continue;
    const stop = begin + eindePositie;

    let bytes: Uint8Array = data.subarray(start, stop);
    const filters = [...dict.matchAll(/\/(FlateDecode|ASCII85Decode|ASCIIHexDecode|LZWDecode|DCTDecode|JPXDecode|CCITTFaxDecode|RunLengthDecode)/g)].map(
      (treffer) => treffer[1],
    );

    let gelukt = true;
    for (const filter of filters) {
      if (filter === "ASCII85Decode") {
        bytes = ascii85(alsLatijn(bytes));
      } else if (filter === "ASCIIHexDecode") {
        bytes = asciiHex(alsLatijn(bytes));
      } else if (filter === "FlateDecode") {
        const uitgepakt = (await inflate(bytes, false)) ?? (await inflate(bytes, true));
        if (!uitgepakt) {
          gelukt = false;
          break;
        }
        bytes = uitgepakt;
      } else {
        // Een plaatje of een filter dat hier niet thuishoort. Overslaan.
        gelukt = false;
        break;
      }
    }
    if (!gelukt) continue;

    streams.push({ nummer: Number.parseInt(obj[1], 10), dict, inhoud: alsLatijn(bytes) });
  }

  return streams;
}

/** Een ToUnicode-tabel: van tekencode naar de letter die je ziet. */
function leesCMap(inhoud: string): Map<number, string> {
  const tabel = new Map<number, string>();

  const naarTekst = (hex: string) => {
    let uit = "";
    for (let i = 0; i + 3 < hex.length + 1; i += 4) {
      const code = Number.parseInt(hex.slice(i, i + 4), 16);
      if (Number.isFinite(code) && code > 0) uit += String.fromCharCode(code);
    }
    return uit;
  };

  for (const blok of inhoud.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const regel of blok[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      tabel.set(Number.parseInt(regel[1], 16), naarTekst(regel[2]));
    }
  }

  for (const blok of inhoud.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const regel of blok[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const van = Number.parseInt(regel[1], 16);
      const tot = Number.parseInt(regel[2], 16);
      const eerste = Number.parseInt(regel[3], 16);
      for (let code = van; code <= tot && code - van < 65536; code += 1) {
        tabel.set(code, String.fromCharCode(eerste + (code - van)));
      }
    }
  }

  return tabel;
}

interface Stuk {
  x: number;
  y: number;
  tekst: string;
}

/**
 * Wat we van een lettertype moeten weten om zijn tekst te kunnen lezen.
 *
 * Een ingesloten lettertype hernummert zijn eigen tekens: de e met accent kan
 * code 1 worden. De ToUnicode-tabel zegt welke letter daar hoort. Of een code
 * uit één of twee bytes bestaat, hangt af van het soort lettertype.
 */
interface Lettertype {
  tabel: Map<number, string> | null;
  tweeBytes: boolean;
}

function viaTabel(code: number, tabel: Map<number, string> | null): string | null {
  const letter = tabel?.get(code);
  return letter !== undefined && letter !== "" ? letter : null;
}

function ontcijferLiteraal(ruw: string, font: Lettertype | null): string {
  let uit = "";
  for (let i = 0; i < ruw.length; i += 1) {
    const teken = ruw[i];
    if (teken !== "\\") {
      const code = teken.charCodeAt(0);
      uit += viaTabel(code, font?.tabel ?? null) ?? WINANSI[code] ?? teken;
      continue;
    }

    const volgend = ruw[i + 1];
    i += 1;
    if (volgend === "n") uit += "\n";
    else if (volgend === "r") uit += "\r";
    else if (volgend === "t") uit += "\t";
    else if (volgend === "b" || volgend === "f") uit += " ";
    else if (volgend >= "0" && volgend <= "7") {
      let octaal = volgend;
      while (octaal.length < 3 && ruw[i + 1] >= "0" && ruw[i + 1] <= "7") {
        octaal += ruw[i + 1];
        i += 1;
      }
      const code = Number.parseInt(octaal, 8);
      uit += viaTabel(code, font?.tabel ?? null) ?? WINANSI[code] ?? String.fromCharCode(code);
    } else if (volgend === "\n") {
      // Een regeleinde met een backslash ervoor betekent: geen regeleinde.
    } else {
      uit += volgend ?? "";
    }
  }
  return uit;
}

function ontcijferHex(ruw: string, font: Lettertype | null): string {
  const hex = ruw.replace(/[^0-9a-fA-F]/g, "");
  const stap = font?.tweeBytes ? 4 : 2;
  let uit = "";

  for (let i = 0; i + 1 < hex.length; i += stap) {
    const code = Number.parseInt(hex.slice(i, i + stap), 16);
    uit += viaTabel(code, font?.tabel ?? null) ?? (stap === 2 ? (WINANSI[code] ?? String.fromCharCode(code)) : "");
  }
  return uit;
}

/** De stukjes tekst uit één contentstream, met hun plek op de pagina. */
function leesStukken(inhoud: string, lettertypen: Map<string, Lettertype>): Stuk[] {
  const stukken: Stuk[] = [];
  let x = 0;
  let y = 0;
  let regelX = 0;
  let regelY = 0;
  let leiding = 12;
  let font: Lettertype | null = null;

  const patroon =
    /\/([^\s/[\]<>()]+)\s+[\d.-]+\s+Tf|BT|ET|T\*|([\d.-]+)\s+TL|([\d.-]+)\s+([\d.-]+)\s+(Td|TD)|([\d.-]+\s+){6}Tm|\(((?:\\.|[^\\()])*)\)\s*(Tj|')|<([0-9a-fA-F\s]*)>\s*(Tj|')|\[((?:\\.|[^\]])*)\]\s*TJ/g;

  for (const treffer of inhoud.matchAll(patroon)) {
    const heel = treffer[0];

    if (treffer[1]) {
      font = lettertypen.get(treffer[1]) ?? null;
      continue;
    }
    if (heel === "BT") {
      x = 0;
      y = 0;
      regelX = 0;
      regelY = 0;
      continue;
    }
    if (heel === "ET") continue;
    if (heel === "T*") {
      regelY -= leiding;
      x = regelX;
      y = regelY;
      continue;
    }
    if (treffer[2]) {
      leiding = Number.parseFloat(treffer[2]);
      continue;
    }
    if (treffer[3] !== undefined && treffer[4] !== undefined) {
      regelX += Number.parseFloat(treffer[3]);
      regelY += Number.parseFloat(treffer[4]);
      if (treffer[5] === "TD") leiding = -Number.parseFloat(treffer[4]);
      x = regelX;
      y = regelY;
      continue;
    }
    if (heel.endsWith("Tm")) {
      const getallen = heel.trim().split(/\s+/);
      regelX = Number.parseFloat(getallen[4]);
      regelY = Number.parseFloat(getallen[5]);
      x = regelX;
      y = regelY;
      continue;
    }

    let tekst = "";
    if (treffer[7] !== undefined) {
      tekst = ontcijferLiteraal(treffer[7], font);
    } else if (treffer[9] !== undefined) {
      tekst = ontcijferHex(treffer[9], font);
    } else if (treffer[11] !== undefined) {
      for (const deel of treffer[11].matchAll(/\(((?:\\.|[^\\()])*)\)|<([0-9a-fA-F\s]*)>|(-?[\d.]+)/g)) {
        if (deel[1] !== undefined) tekst += ontcijferLiteraal(deel[1], font);
        else if (deel[2] !== undefined) tekst += ontcijferHex(deel[2], font);
        else if (deel[3] !== undefined && Number.parseFloat(deel[3]) < -120) tekst += " ";
      }
    }

    if (tekst.length > 0) stukken.push({ x, y, tekst });
    if (heel.endsWith("'")) {
      regelY -= leiding;
      x = regelX;
      y = regelY;
    }
  }

  return stukken;
}

/** De stukjes terug naar regels, en binnen een regel terug naar kolommen. */
export function stukkenNaarTekst(stukken: Stuk[]): string {
  if (stukken.length === 0) return "";

  const regels = new Map<number, Stuk[]>();
  for (const stuk of stukken) {
    // Afronden op twee punten: binnen een regel staat niet alles exact gelijk.
    const sleutel = Math.round(stuk.y / 2) * 2;
    const rij = regels.get(sleutel);
    if (rij) rij.push(stuk);
    else regels.set(sleutel, [stuk]);
  }

  return [...regels.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, rij]) => {
      const gesorteerd = [...rij].sort((a, b) => a.x - b.x);
      let regel = "";
      let vorigeX: number | null = null;
      for (const stuk of gesorteerd) {
        if (vorigeX !== null) {
          // Een flinke sprong naar rechts is in de praktijk een nieuwe kolom.
          regel += stuk.x - vorigeX > 24 ? "\t" : "";
        }
        regel += stuk.tekst;
        vorigeX = stuk.x + stuk.tekst.length * 5;
      }
      return regel.replace(/[ \t]+$/g, "");
    })
    .filter((regel) => regel.trim().length > 0)
    .join("\n");
}

/**
 * Leest een PDF en geeft de tekst terug met tabs tussen de kolommen.
 *
 * Komt er niets uit, dan is het vrijwel zeker een scan. Dat zegt de
 * foutmelding dan ook, zodat niemand gaat zoeken naar een fout die er niet is.
 */
export async function leesPdf(buffer: ArrayBuffer): Promise<string> {
  const data = new Uint8Array(buffer);
  const rauw = alsLatijn(data);

  if (!rauw.startsWith("%PDF")) throw new Error("Dit lijkt geen PDF te zijn.");

  const streams = await leesStreams(rauw, data);

  // Welke tabel hoort bij welk lettertype: /F1 verwijst naar een objectnummer,
  // en dat object verwijst naar zijn ToUnicode-stream.
  const cmaps = new Map<number, Map<number, string>>();
  for (const stream of streams) {
    if (/beginbfchar|beginbfrange/.test(stream.inhoud) && stream.nummer !== null) {
      cmaps.set(stream.nummer, leesCMap(stream.inhoud));
    }
  }

  // De inhoud van elk object, zodat verwijzingen op te zoeken zijn.
  const lichamen = new Map<number, string>();
  const objecten = [...rauw.matchAll(/(\d+)\s+\d+\s+obj\b/g)];
  for (const [index, obj] of objecten.entries()) {
    const eind = index + 1 < objecten.length ? objecten[index + 1].index! : rauw.length;
    lichamen.set(Number.parseInt(obj[1], 10), rauw.slice(obj.index!, eind));
  }

  /*
    Welk lettertype hoort bij /F1 in de tekst?

    Dat staat in de resources van de pagina, en die kunnen er op twee manieren
    staan: de lijst met lettertypen staat er direct in, of er staat een
    verwijzing naar een ander object. Allebei komt voor, dus allebei opzoeken.
  */
  const naarObject = new Map<string, number>();
  const leesFontLijst = (tekst: string) => {
    for (const paar of tekst.matchAll(/\/([^\s/[\]<>()]+)\s+(\d+)\s+\d+\s+R/g)) {
      naarObject.set(paar[1], Number.parseInt(paar[2], 10));
    }
  };

  for (const treffer of rauw.matchAll(/\/Font\s*<<([\s\S]{0,4000}?)>>/g)) leesFontLijst(treffer[1]);
  for (const treffer of rauw.matchAll(/\/Font\s+(\d+)\s+\d+\s+R/g)) {
    const lichaam = lichamen.get(Number.parseInt(treffer[1], 10));
    if (lichaam) leesFontLijst(lichaam);
  }

  const perLettertype = new Map<string, Lettertype>();
  for (const [naam, objectnummer] of naarObject) {
    const lichaam = lichamen.get(objectnummer);
    if (!lichaam || !/\/Type\s*\/Font/.test(lichaam)) continue;
    const verwijzing = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(lichaam)?.[1];
    const tabel = verwijzing ? (cmaps.get(Number.parseInt(verwijzing, 10)) ?? null) : null;
    // Type0 en Identity-H werken met codes van twee bytes, de rest met één.
    const tweeBytes = /\/Subtype\s*\/Type0\b/.test(lichaam) || /Identity-[HV]/.test(lichaam);
    if (tabel || tweeBytes) perLettertype.set(naam, { tabel, tweeBytes });
  }

  /*
    Per pagina apart uitlezen.

    Elke pagina heeft zijn eigen contentstream, en de hoogtes daarin beginnen
    weer bovenaan. Alles op een hoop gooien zou regel 1 van pagina 1 samen
    laten vallen met regel 1 van pagina 2, en dan staat er bij een lijst van
    drie pagina's "Leerling 1Leerling 51Leerling 101" op een regel.
  */
  const paginas: string[] = [];
  for (const stream of streams) {
    if (!/\bBT\b/.test(stream.inhoud)) continue;
    const pagina = stukkenNaarTekst(leesStukken(stream.inhoud, perLettertype));
    if (pagina.trim().length > 0) paginas.push(pagina);
  }

  const tekst = paginas.join("\n");
  if (tekst.trim().length === 0) {
    throw new Error(
      "Uit deze PDF komt geen tekst. Waarschijnlijk is het een scan of een foto, en dan staan er geen letters in het bestand.",
    );
  }

  return tekst;
}
