/**
 * Een Excel-bestand maken, zonder extra pakket.
 *
 * WAAROM
 *
 *   Scholen krijgen de lijsten al jaren als Excel met tabbladen onderin, en
 *   dat werkt: ze kunnen er zelf in schrijven, kolommen breder maken en
 *   printen. Dat gaan we niet afpakken.
 *
 * HOE
 *
 *   Een xlsx is een zip met XML. De lezer ernaast doet het omgekeerde, en de
 *   test schrijft een bestand en leest het daarna met die lezer terug. Zo weet
 *   je zeker dat er geen bestand uitkomt dat Excel weigert.
 *
 * WAT HET BEWUST NIET DOET
 *
 *   Kleuren, randen, formules, filters. Een lijst om op te hangen heeft dat
 *   niet nodig. Wel: vette kopregels, kolombreedtes en een bevroren bovenste
 *   regel, want daar scrol je anders in een lijst van 200 namen op stuk.
 */

export interface XlsxBlad {
  naam: string;
  /** De eerste rij is de kopregel en wordt vet. */
  rijen: (string | number | null)[][];
  /** Breedte per kolom in tekens. Weggelaten betekent automatisch. */
  breedtes?: number[];
}

const CRC_TABEL = (() => {
  const tabel = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let waarde = i;
    for (let bit = 0; bit < 8; bit += 1) {
      waarde = waarde & 1 ? 0xedb88320 ^ (waarde >>> 1) : waarde >>> 1;
    }
    tabel[i] = waarde >>> 0;
  }
  return tabel;
})();

function crc32(data: Uint8Array): number {
  let waarde = 0xffffffff;
  for (const byte of data) waarde = CRC_TABEL[(waarde ^ byte) & 0xff] ^ (waarde >>> 8);
  return (waarde ^ 0xffffffff) >>> 0;
}

function tekens(tekst: string): string {
  return tekst
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Besturingstekens mogen niet in XML. Ze komen voor in geplakte lijsten.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

/** A, B, ... Z, AA. De omgekeerde weg van de lezer. */
export function kolomLetter(index: number): string {
  let letters = "";
  let rest = index;
  while (rest >= 0) {
    letters = String.fromCharCode(65 + (rest % 26)) + letters;
    rest = Math.floor(rest / 26) - 1;
  }
  return letters;
}

/**
 * Excel staat geen \\ / ? * [ ] : toe in een tabnaam, en niet meer dan 31
 * tekens. Een klas die "Groep 3/4" heet zou het bestand dus onbruikbaar
 * maken; daarom wordt de naam schoongemaakt in plaats van geweigerd.
 */
export function tabNaam(naam: string, bestaand: string[] = []): string {
  let schoon = (naam || "Blad").replace(/[\\/?*[\]:]/g, "-").slice(0, 31).trim() || "Blad";

  if (!bestaand.includes(schoon)) return schoon;
  for (let nummer = 2; nummer < 100; nummer += 1) {
    const staart = ` (${nummer})`;
    const poging = `${schoon.slice(0, 31 - staart.length)}${staart}`;
    if (!bestaand.includes(poging)) return poging;
  }
  schoon = schoon.slice(0, 28);
  return `${schoon}...`;
}

function bladXml(blad: XlsxBlad): string {
  const kolommen = blad.breedtes?.length
    ? `<cols>${blad.breedtes
        .map((breedte, index) => `<col min="${index + 1}" max="${index + 1}" width="${breedte}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";

  const rijen = blad.rijen
    .map((rij, rijIndex) => {
      const cellen = rij
        .map((waarde, kolomIndex) => {
          if (waarde === null || waarde === undefined || waarde === "") return "";
          const verwijzing = `${kolomLetter(kolomIndex)}${rijIndex + 1}`;
          const stijl = rijIndex === 0 ? ' s="1"' : "";
          if (typeof waarde === "number" && Number.isFinite(waarde)) {
            return `<c r="${verwijzing}"${stijl}><v>${waarde}</v></c>`;
          }
          return `<c r="${verwijzing}"${stijl} t="inlineStr"><is><t xml:space="preserve">${tekens(
            String(waarde),
          )}</t></is></c>`;
        })
        .join("");
      return `<row r="${rijIndex + 1}">${cellen}</row>`;
    })
    .join("");

  // De bovenste regel vastzetten, zodat de kopregel blijft staan bij scrollen.
  const bevriezen =
    blad.rijen.length > 1
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${bevriezen}${kolommen}<sheetData>${rijen}</sheetData></worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

interface ZipBestand {
  naam: string;
  data: Uint8Array;
}

/** De zip in elkaar zetten. Zonder compressie: eenvoudig en goed genoeg. */
function maakZip(bestanden: ZipBestand[]): Uint8Array {
  const lokaal: Uint8Array[] = [];
  const centraal: Uint8Array[] = [];
  const codeerder = new TextEncoder();
  let positie = 0;

  for (const bestand of bestanden) {
    const naam = codeerder.encode(bestand.naam);
    const som = crc32(bestand.data);

    const kop = new Uint8Array(30 + naam.length);
    const kopView = new DataView(kop.buffer);
    kopView.setUint32(0, 0x04034b50, true);
    kopView.setUint16(4, 20, true);
    kopView.setUint16(6, 0, true);
    kopView.setUint16(8, 0, true); // geen compressie
    kopView.setUint16(10, 0, true);
    kopView.setUint16(12, 0, true);
    kopView.setUint32(14, som, true);
    kopView.setUint32(18, bestand.data.length, true);
    kopView.setUint32(22, bestand.data.length, true);
    kopView.setUint16(26, naam.length, true);
    kopView.setUint16(28, 0, true);
    kop.set(naam, 30);

    const regel = new Uint8Array(46 + naam.length);
    const regelView = new DataView(regel.buffer);
    regelView.setUint32(0, 0x02014b50, true);
    regelView.setUint16(4, 20, true);
    regelView.setUint16(6, 20, true);
    regelView.setUint16(8, 0, true);
    regelView.setUint16(10, 0, true);
    regelView.setUint16(12, 0, true);
    regelView.setUint16(14, 0, true);
    regelView.setUint32(16, som, true);
    regelView.setUint32(20, bestand.data.length, true);
    regelView.setUint32(24, bestand.data.length, true);
    regelView.setUint16(28, naam.length, true);
    regelView.setUint16(30, 0, true);
    regelView.setUint16(32, 0, true);
    regelView.setUint16(34, 0, true);
    regelView.setUint16(36, 0, true);
    regelView.setUint32(38, 0, true);
    regelView.setUint32(42, positie, true);
    regel.set(naam, 46);

    lokaal.push(kop, bestand.data);
    centraal.push(regel);
    positie += kop.length + bestand.data.length;
  }

  const centraalLengte = centraal.reduce((som, deel) => som + deel.length, 0);
  const staart = new Uint8Array(22);
  const staartView = new DataView(staart.buffer);
  staartView.setUint32(0, 0x06054b50, true);
  staartView.setUint16(8, bestanden.length, true);
  staartView.setUint16(10, bestanden.length, true);
  staartView.setUint32(12, centraalLengte, true);
  staartView.setUint32(16, positie, true);

  const alles = [...lokaal, ...centraal, staart];
  const totaal = alles.reduce((som, deel) => som + deel.length, 0);
  const uit = new Uint8Array(totaal);
  let wijzer = 0;
  for (const deel of alles) {
    uit.set(deel, wijzer);
    wijzer += deel.length;
  }
  return uit;
}

export function maakXlsx(bladen: XlsxBlad[]): Uint8Array {
  if (bladen.length === 0) throw new Error("Een werkmap heeft minstens één tabblad nodig.");

  const codeerder = new TextEncoder();
  const namen: string[] = [];
  const schoon = bladen.map((blad) => {
    const naam = tabNaam(blad.naam, namen);
    namen.push(naam);
    return { ...blad, naam };
  });

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${schoon
  .map(
    (_blad, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join("\n")}
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${schoon
    .map((blad, index) => `<sheet name="${tekens(blad.naam)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join("")}</sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${schoon
  .map(
    (_blad, index) =>
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  )
  .join("\n")}
<Relationship Id="rId${schoon.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const bestanden: ZipBestand[] = [
    { naam: "[Content_Types].xml", data: codeerder.encode(contentTypes) },
    { naam: "_rels/.rels", data: codeerder.encode(rels) },
    { naam: "xl/workbook.xml", data: codeerder.encode(workbook) },
    { naam: "xl/_rels/workbook.xml.rels", data: codeerder.encode(workbookRels) },
    { naam: "xl/styles.xml", data: codeerder.encode(STYLES) },
    ...schoon.map((blad, index) => ({
      naam: `xl/worksheets/sheet${index + 1}.xml`,
      data: codeerder.encode(bladXml(blad)),
    })),
  ];

  return maakZip(bestanden);
}
