/**
 * Een zip-bestand uitpakken, zonder extra pakket.
 *
 * WAAROM APART
 *
 *   Een xlsx en een docx zijn allebei gewoon een zip met XML erin. Dit stond
 *   eerst in xlsx.ts, maar sinds Word-bestanden er ook doorheen gaan hoort het
 *   op één plek. Er is niets aan veranderd behalve de naam van de foutmelding,
 *   die nu "bestand" zegt in plaats van "Excel-bestand".
 *
 *   Uitpakken gebeurt met DecompressionStream, dat zowel in de browser als in
 *   Node ingebouwd zit. Geen afhankelijkheid die onderhouden moet worden.
 */

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

export interface ZipEntry {
  naam: string;
  methode: number;
  begin: number;
  lengte: number;
}

export function leesZip(data: Uint8Array): ZipEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Het einde van een zip is een blokje van 22 bytes, eventueel met een
  // commentaar erachter. Daarom van achteren naar voren zoeken.
  let eocd = -1;
  for (let i = data.length - 22; i >= 0 && i > data.length - 22 - 65536; i -= 1) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Dit bestand is geen geldig zip-bestand.");

  const aantal = view.getUint16(eocd + 10, true);
  let wijzer = view.getUint32(eocd + 16, true);

  const entries: ZipEntry[] = [];
  for (let i = 0; i < aantal; i += 1) {
    if (view.getUint32(wijzer, true) !== CENTRAL) break;
    const methode = view.getUint16(wijzer + 10, true);
    const gecomprimeerd = view.getUint32(wijzer + 20, true);
    const naamLengte = view.getUint16(wijzer + 28, true);
    const extraLengte = view.getUint16(wijzer + 30, true);
    const commentaarLengte = view.getUint16(wijzer + 32, true);
    const lokaal = view.getUint32(wijzer + 42, true);
    const naam = new TextDecoder().decode(data.subarray(wijzer + 46, wijzer + 46 + naamLengte));

    // De lokale kop staat vooraan het bestand zelf en heeft zijn eigen lengtes.
    const lokaalNaam = view.getUint16(lokaal + 26, true);
    const lokaalExtra = view.getUint16(lokaal + 28, true);
    const begin = lokaal + 30 + lokaalNaam + lokaalExtra;

    entries.push({ naam, methode, begin, lengte: gecomprimeerd });
    wijzer += 46 + naamLengte + extraLengte + commentaarLengte;
  }

  return entries;
}

export async function pakUit(data: Uint8Array, entry: ZipEntry): Promise<string> {
  const stuk = data.subarray(entry.begin, entry.begin + entry.lengte);
  if (entry.methode === 0) return new TextDecoder().decode(stuk);
  if (entry.methode !== 8) throw new Error("Dit bestand gebruikt een onbekende compressie.");

  const stroom = new Blob([stuk as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stroom).text();
}

/**
 * Herkent dit bestand aan zijn eerste bytes.
 *
 * De oude Office-formaten (.xls en .doc) zijn geen zip maar een OLE2-bestand.
 * Die beginnen met een vaste reeks van acht bytes. Dat herkennen is beter dan
 * de uitpakker erop loslaten en met een onbegrijpelijke fout eindigen.
 */
export function isOudOfficeBestand(data: Uint8Array): boolean {
  const kop = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return kop.every((byte, index) => data[index] === byte);
}

export function isZip(data: Uint8Array): boolean {
  return data[0] === 0x50 && data[1] === 0x4b;
}
