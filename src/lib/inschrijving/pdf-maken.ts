/**
 * Een PDF maken, zonder extra pakket.
 *
 * WAARVOOR
 *
 *   Lijsten om te printen en op te hangen, en de persoonlijke planning van een
 *   leerling. Geen opmaakwonder: een kop, wat regels en een tabel die netjes
 *   over pagina's doorloopt met de kopregel erboven.
 *
 * HOE HET GETEST WORDT
 *
 *   Met de lezer ernaast. De test maakt een PDF, leest hem terug met
 *   leesPdf() en kijkt of de tekst er staat. Zo kan er geen bestand uitkomen
 *   dat alleen op het eerste gezicht goed lijkt.
 *
 * LETTERS
 *
 *   Helvetica en Helvetica-Bold, de twee die in elke PDF-lezer ingebouwd
 *   zitten. Daardoor hoeft er geen lettertype mee in het bestand en blijft
 *   een lijst van 200 namen een bestand van een paar tientallen kilobytes.
 *   Tekens buiten WinAnsi, zoals een emoji in een naam, worden vervangen door
 *   een vraagteken in plaats van het bestand stuk te maken.
 */

export type PdfBlok =
  | { soort: "kop"; tekst: string }
  | { soort: "subkop"; tekst: string }
  | { soort: "regel"; tekst: string; vet?: boolean }
  | { soort: "tabel"; kolommen: { titel: string; breedte: number }[]; rijen: string[][] }
  | { soort: "ruimte"; hoogte?: number }
  | { soort: "nieuwePagina" };

export interface PdfOpties {
  titel: string;
  /** Komt onderaan elke pagina te staan, met het paginanummer erachter. */
  voettekst?: string;
  blokken: PdfBlok[];
}

const BREEDTE = 595.28;
const HOOGTE = 841.89;
const MARGE = 48;
const ONDERGRENS = 60;

/** De tekens die WinAnsi op een andere plek heeft staan dan Latin-1. */
const WINANSI_OMGEKEERD: Record<string, number> = {
  "€": 0x80,
  "‚": 0x82,
  "ƒ": 0x83,
  "„": 0x84,
  "…": 0x85,
  "†": 0x86,
  "‡": 0x87,
  "ˆ": 0x88,
  "‰": 0x89,
  "Š": 0x8a,
  "‹": 0x8b,
  "Œ": 0x8c,
  "Ž": 0x8e,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "˜": 0x98,
  "™": 0x99,
  "š": 0x9a,
  "›": 0x9b,
  "œ": 0x9c,
  "ž": 0x9e,
  "Ÿ": 0x9f,
};

/** Tekst naar bytes zoals een PDF-lezer ze verwacht, met ontsnapping erbij. */
function pdfTekst(ruw: string): string {
  let uit = "";
  for (const teken of ruw ?? "") {
    let code = WINANSI_OMGEKEERD[teken] ?? teken.codePointAt(0) ?? 63;
    if (code > 0xff) code = 63; // vraagteken
    if (code === 40 || code === 41 || code === 92) uit += `\\${String.fromCharCode(code)}`;
    else if (code < 32 || code > 126) uit += `\\${code.toString(8).padStart(3, "0")}`;
    else uit += String.fromCharCode(code);
  }
  return uit;
}

/**
 * Hoe breed een stuk tekst ongeveer wordt.
 *
 * Geen echte lettertabel: Helvetica is gemiddeld ongeveer een halve puntgrootte
 * per teken, en voor het afkappen van een kolom is dat nauwkeurig genoeg. Het
 * gaat om namen in een lijst, niet om drukwerk op de millimeter.
 */
function breedteVan(tekst: string, grootte: number): number {
  return tekst.length * grootte * 0.5;
}

function kortAf(tekst: string, breedte: number, grootte: number): string {
  const maximum = Math.max(1, Math.floor(breedte / (grootte * 0.5)));
  return tekst.length <= maximum ? tekst : `${tekst.slice(0, Math.max(1, maximum - 1))}…`;
}

interface Pagina {
  regels: string[];
}

export function maakPdf(opties: PdfOpties): Uint8Array {
  const paginas: Pagina[] = [];
  let huidige: string[] = [];
  let y = HOOGTE - MARGE;

  const nieuwePagina = () => {
    if (huidige.length > 0) paginas.push({ regels: huidige });
    huidige = [];
    y = HOOGTE - MARGE;
  };

  const schrijf = (tekst: string, x: number, grootte: number, vet: boolean) => {
    huidige.push(
      `BT /${vet ? "F2" : "F1"} ${grootte} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${pdfTekst(tekst)}) Tj ET`,
    );
  };

  const ruimte = (hoogte: number) => {
    y -= hoogte;
    if (y < ONDERGRENS) nieuwePagina();
  };

  // De titel staat op elke pagina, zodat een losgeraakt vel nog te plaatsen is.
  const titelOpPagina = () => {
    schrijf(opties.titel, MARGE, 14, true);
    y -= 22;
  };

  titelOpPagina();

  for (const blok of opties.blokken) {
    if (blok.soort === "nieuwePagina") {
      nieuwePagina();
      titelOpPagina();
      continue;
    }

    if (blok.soort === "ruimte") {
      ruimte(blok.hoogte ?? 10);
      continue;
    }

    if (blok.soort === "kop" || blok.soort === "subkop") {
      const grootte = blok.soort === "kop" ? 13 : 11;
      if (y < ONDERGRENS + 40) {
        nieuwePagina();
        titelOpPagina();
      }
      ruimte(6);
      schrijf(blok.tekst, MARGE, grootte, true);
      ruimte(grootte + 6);
      continue;
    }

    if (blok.soort === "regel") {
      if (y < ONDERGRENS) {
        nieuwePagina();
        titelOpPagina();
      }
      schrijf(blok.tekst, MARGE, 10, blok.vet ?? false);
      ruimte(14);
      continue;
    }

    // Een tabel. De kopregel komt op elke pagina opnieuw.
    const grootte = 9;
    const regelhoogte = 14;

    const kopregel = () => {
      let x = MARGE;
      for (const kolom of blok.kolommen) {
        schrijf(kortAf(kolom.titel, kolom.breedte, grootte), x, grootte, true);
        x += kolom.breedte;
      }
      y -= regelhoogte;
      // Een lijn onder de kopregel.
      huidige.push(
        `0.75 w 0.6 G ${MARGE} ${(y + 4).toFixed(2)} m ${(BREEDTE - MARGE).toFixed(2)} ${(y + 4).toFixed(2)} l S`,
      );
      y -= 4;
    };

    if (y < ONDERGRENS + regelhoogte * 3) {
      nieuwePagina();
      titelOpPagina();
    }
    kopregel();

    for (const rij of blok.rijen) {
      if (y < ONDERGRENS) {
        nieuwePagina();
        titelOpPagina();
        kopregel();
      }
      let x = MARGE;
      for (const [index, kolom] of blok.kolommen.entries()) {
        const waarde = rij[index] ?? "";
        schrijf(kortAf(waarde, kolom.breedte, grootte), x, grootte, false);
        x += kolom.breedte;
      }
      y -= regelhoogte;
    }

    ruimte(6);
  }

  if (huidige.length > 0) paginas.push({ regels: huidige });
  if (paginas.length === 0) paginas.push({ regels: [] });

  // De voettekst met het paginanummer, als laatste zodat het totaal bekend is.
  if (opties.voettekst) {
    paginas.forEach((pagina, index) => {
      const tekst = `${opties.voettekst} · pagina ${index + 1} van ${paginas.length}`;
      pagina.regels.push(
        `BT /F1 8 Tf 1 0 0 1 ${MARGE} ${(ONDERGRENS - 24).toFixed(2)} Tm 0.45 g (${pdfTekst(tekst)}) Tj ET`,
      );
    });
  }

  return bouwPdf(paginas);
}

/** De objecten, de verwijzingen en de tabel achteraan. */
function bouwPdf(paginas: Pagina[]): Uint8Array {
  const codeerder = new TextEncoder();
  const delen: Uint8Array[] = [];
  const posities: number[] = [];
  let lengte = 0;

  const zet = (tekst: string | Uint8Array) => {
    const data = typeof tekst === "string" ? codeerder.encode(tekst) : tekst;
    delen.push(data);
    lengte += data.length;
  };

  const object = (nummer: number, inhoud: string | Uint8Array) => {
    posities[nummer] = lengte;
    zet(`${nummer} 0 obj\n`);
    zet(inhoud);
    zet("\nendobj\n");
  };

  zet("%PDF-1.4\n%âãÏÓ\n");

  const eerstePagina = 4;
  const paginaIds = paginas.map((_pagina, index) => eerstePagina + index * 2);
  const totaalObjecten = eerstePagina + paginas.length * 2 + 1;

  object(1, `<< /Type /Catalog /Pages 2 0 R >>`);
  object(
    2,
    `<< /Type /Pages /Count ${paginas.length} /Kids [${paginaIds.map((id) => `${id} 0 R`).join(" ")}] >>`,
  );
  object(
    3,
    `<< /Font << /F1 ${totaalObjecten - 1} 0 R /F2 ${totaalObjecten} 0 R >> /ProcSet [/PDF /Text] >>`,
  );

  paginas.forEach((pagina, index) => {
    const id = paginaIds[index];
    const inhoud = pagina.regels.join("\n");
    const data = codeerder.encode(inhoud);
    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${BREEDTE} ${HOOGTE}] /Resources 3 0 R /Contents ${id + 1} 0 R >>`,
    );
    posities[id + 1] = lengte;
    zet(`${id + 1} 0 obj\n<< /Length ${data.length} >>\nstream\n`);
    zet(data);
    zet("\nendstream\nendobj\n");
  });

  object(totaalObjecten - 1, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
  object(totaalObjecten, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);

  const xref = lengte;
  let tabel = `xref\n0 ${totaalObjecten + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= totaalObjecten; i += 1) {
    tabel += `${String(posities[i] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  zet(tabel);
  zet(`trailer\n<< /Size ${totaalObjecten + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const uit = new Uint8Array(lengte);
  let wijzer = 0;
  for (const deel of delen) {
    uit.set(deel, wijzer);
    wijzer += deel.length;
  }
  return uit;
}

export { breedteVan, kortAf, pdfTekst };
