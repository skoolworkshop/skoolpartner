import { toonCode } from "@/lib/inschrijving/codes";
import { maakPdf, type PdfBlok } from "@/lib/inschrijving/pdf-maken";
import { maakXlsx, type XlsxBlad } from "@/lib/inschrijving/xlsx-maken";

/**
 * De lijsten die de school krijgt.
 *
 * TWEE SOORTEN, ZOALS ALTIJD
 *
 *   Klassenlijsten: per klas alle leerlingen met hun workshop per ronde. Die
 *   gaan naar de mentor en op het prikbord.
 *
 *   Workshoplijsten: per ronde en per workshop wie er komt. Die liggen bij de
 *   workshopdocent in het lokaal.
 *
 *   Precies de twee bestanden die jullie al jaren mailden, met dezelfde
 *   tabbladen onderin. Wat erbij komt is dat ze kloppen op het moment dat je
 *   op de knop drukt.
 *
 * BOVENAAN STAAT WAAR HET OVER GAAT
 *
 *   Schoolnaam, datum en de ronde met zijn tijd. Een losgeraakt vel moet
 *   terug te leggen zijn, en een lijst van vorig jaar moet je kunnen
 *   herkennen.
 *
 * DIT REKENT ALLEEN
 *
 *   Geen database. Daardoor te testen met een verzonnen cultuurdag, en
 *   daardoor maken de Excel- en de PDF-versie gegarandeerd dezelfde lijst.
 */

export interface LijstDag {
  naam: string;
  datumTekst: string;
  organisatie: string;
  locatie: string | null;
}

export interface LijstRonde {
  id: string;
  label: string;
  tijd: string;
  pauze: boolean;
}

export interface LijstUitvoering {
  id: string;
  rondeId: string;
  workshopNaam: string;
  label: string | null;
  ruimte: string | null;
  docent: string | null;
  maximum: number;
}

export interface LijstDeelnemer {
  id: string;
  naam: string;
  groepNaam: string;
  vrijgesteld: boolean;
  /** Per ronde de uitvoering waar deze deelnemer in zit. */
  keuzes: Record<string, string>;
  /** De persoonlijke inschrijfcode. Alleen gevuld voor de codelijst. */
  code?: string | null;
}

export interface LijstGegevens {
  dag: LijstDag;
  rondes: LijstRonde[];
  uitvoeringen: LijstUitvoering[];
  deelnemers: LijstDeelnemer[];
}

function opNaam(a: { naam: string }, b: { naam: string }): number {
  return a.naam.localeCompare(b.naam, "nl");
}

function volledigeNaam(uitvoering: LijstUitvoering): string {
  return uitvoering.label ? `${uitvoering.workshopNaam} · ${uitvoering.label}` : uitvoering.workshopNaam;
}

export interface KlasLijst {
  klas: string;
  rondes: LijstRonde[];
  regels: { naam: string; perRonde: string[]; vrijgesteld: boolean }[];
}

export function klassenLijsten(gegevens: LijstGegevens): KlasLijst[] {
  const uitvoeringen = new Map(gegevens.uitvoeringen.map((uitvoering) => [uitvoering.id, uitvoering]));
  const klassen = [...new Set(gegevens.deelnemers.map((deelnemer) => deelnemer.groepNaam))].sort((a, b) =>
    a.localeCompare(b, "nl", { numeric: true }),
  );

  return klassen.map((klas) => ({
    klas,
    rondes: gegevens.rondes,
    regels: gegevens.deelnemers
      .filter((deelnemer) => deelnemer.groepNaam === klas)
      .sort(opNaam)
      .map((deelnemer) => ({
        naam: deelnemer.naam,
        vrijgesteld: deelnemer.vrijgesteld,
        perRonde: gegevens.rondes.map((ronde) => {
          if (ronde.pauze) return "Pauze";
          if (deelnemer.vrijgesteld) return "Vrijgesteld";
          const uitvoering = uitvoeringen.get(deelnemer.keuzes[ronde.id] ?? "");
          if (!uitvoering) return "Nog niet ingedeeld";
          return uitvoering.ruimte
            ? `${volledigeNaam(uitvoering)} (${uitvoering.ruimte})`
            : volledigeNaam(uitvoering);
        }),
      })),
  }));
}

export interface CodeLijst {
  klas: string;
  regels: { naam: string; code: string; vrijgesteld: boolean }[];
}

/**
 * De uitdeellijst met de persoonlijke codes.
 *
 * Deze gaat naar de mentor en verder niemand. Daarom staat hij apart: de
 * klassenlijst met de indeling erop mag rondgaan, deze niet. Per klas een
 * eigen blad of pagina, zodat de mentor alleen zijn eigen klas in handen
 * krijgt.
 */
export function codeLijsten(gegevens: LijstGegevens): CodeLijst[] {
  const klassen = [...new Set(gegevens.deelnemers.map((deelnemer) => deelnemer.groepNaam))].sort((a, b) =>
    a.localeCompare(b, "nl", { numeric: true }),
  );

  return klassen.map((klas) => ({
    klas,
    regels: gegevens.deelnemers
      .filter((deelnemer) => deelnemer.groepNaam === klas)
      .sort(opNaam)
      .map((deelnemer) => ({
        naam: deelnemer.naam,
        code: deelnemer.code ? toonCode(deelnemer.code) : "",
        vrijgesteld: deelnemer.vrijgesteld,
      })),
  }));
}

export interface WorkshopLijst {
  rondeLabel: string;
  tijd: string;
  workshop: string;
  ruimte: string | null;
  docent: string | null;
  maximum: number;
  deelnemers: { naam: string; klas: string }[];
}

export function workshopLijsten(gegevens: LijstGegevens): WorkshopLijst[] {
  const perSessie = new Map<string, { naam: string; klas: string }[]>();
  for (const deelnemer of gegevens.deelnemers) {
    if (deelnemer.vrijgesteld) continue;
    for (const sessieId of Object.values(deelnemer.keuzes)) {
      const lijst = perSessie.get(sessieId);
      const regel = { naam: deelnemer.naam, klas: deelnemer.groepNaam };
      if (lijst) lijst.push(regel);
      else perSessie.set(sessieId, [regel]);
    }
  }

  const rondes = new Map(gegevens.rondes.map((ronde) => [ronde.id, ronde]));
  const volgorde = new Map(gegevens.rondes.map((ronde, index) => [ronde.id, index]));

  return [...gegevens.uitvoeringen]
    .sort(
      (a, b) =>
        (volgorde.get(a.rondeId) ?? 99) - (volgorde.get(b.rondeId) ?? 99) ||
        volledigeNaam(a).localeCompare(volledigeNaam(b), "nl"),
    )
    .map((uitvoering) => {
      const ronde = rondes.get(uitvoering.rondeId);
      return {
        rondeLabel: ronde?.label ?? "",
        tijd: ronde?.tijd ?? "",
        workshop: volledigeNaam(uitvoering),
        ruimte: uitvoering.ruimte,
        docent: uitvoering.docent,
        maximum: uitvoering.maximum,
        deelnemers: (perSessie.get(uitvoering.id) ?? []).sort(opNaam),
      };
    });
}

export interface Ontbrekend {
  nietIngedeeld: { naam: string; klas: string; rondes: string[] }[];
  vrijgesteld: { naam: string; klas: string }[];
  teVol: { workshop: string; ronde: string; aantal: number; maximum: number }[];
  leeg: { workshop: string; ronde: string }[];
}

/**
 * Wat er nog niet klopt.
 *
 * Dit is het lijstje waarmee je op maandagochtend begint, zoals de school het
 * vroeger zelf in het geel in de Excel zette: wie heeft zich niet
 * ingeschreven, wie doet niet mee, en zit er ergens iets scheef.
 */
export function ontbrekendOverzicht(gegevens: LijstGegevens): Ontbrekend {
  const rondes = gegevens.rondes.filter((ronde) => !ronde.pauze);
  const rondeLabel = new Map(gegevens.rondes.map((ronde) => [ronde.id, ronde.label]));

  const nietIngedeeld = gegevens.deelnemers
    .filter((deelnemer) => !deelnemer.vrijgesteld)
    .map((deelnemer) => ({
      naam: deelnemer.naam,
      klas: deelnemer.groepNaam,
      rondes: rondes.filter((ronde) => !deelnemer.keuzes[ronde.id]).map((ronde) => ronde.label),
    }))
    .filter((regel) => regel.rondes.length > 0)
    .sort((a, b) => a.klas.localeCompare(b.klas, "nl", { numeric: true }) || opNaam(a, b));

  const vrijgesteld = gegevens.deelnemers
    .filter((deelnemer) => deelnemer.vrijgesteld)
    .map((deelnemer) => ({ naam: deelnemer.naam, klas: deelnemer.groepNaam }))
    .sort((a, b) => a.klas.localeCompare(b.klas, "nl", { numeric: true }) || opNaam(a, b));

  const aantallen = new Map<string, number>();
  for (const deelnemer of gegevens.deelnemers) {
    if (deelnemer.vrijgesteld) continue;
    for (const sessieId of Object.values(deelnemer.keuzes)) {
      aantallen.set(sessieId, (aantallen.get(sessieId) ?? 0) + 1);
    }
  }

  const teVol: Ontbrekend["teVol"] = [];
  const leeg: Ontbrekend["leeg"] = [];
  for (const uitvoering of gegevens.uitvoeringen) {
    const aantal = aantallen.get(uitvoering.id) ?? 0;
    const ronde = rondeLabel.get(uitvoering.rondeId) ?? "";
    if (aantal > uitvoering.maximum) {
      teVol.push({ workshop: volledigeNaam(uitvoering), ronde, aantal, maximum: uitvoering.maximum });
    }
    if (aantal === 0) leeg.push({ workshop: volledigeNaam(uitvoering), ronde });
  }

  return { nietIngedeeld, vrijgesteld, teVol, leeg };
}


// -----------------------------------------------------------------------------
// Dezelfde lijsten als bestand
// -----------------------------------------------------------------------------

function kopregel(dag: LijstDag): string {
  return [dag.organisatie, dag.naam, dag.datumTekst, dag.locatie].filter(Boolean).join(" · ");
}

export function klassenXlsx(gegevens: LijstGegevens): Uint8Array {
  const lijsten = klassenLijsten(gegevens);

  const bladen: XlsxBlad[] = lijsten.map((lijst) => ({
    naam: lijst.klas,
    breedtes: [30, ...lijst.rondes.map(() => 28)],
    rijen: [
      [kopregel(gegevens.dag)],
      [`Klas ${lijst.klas}`],
      [],
      ["Leerling", ...lijst.rondes.map((ronde) => `${ronde.label} (${ronde.tijd})`)],
      ...lijst.regels.map((regel) => [regel.naam, ...regel.perRonde]),
    ],
  }));

  return maakXlsx(bladen.length > 0 ? bladen : [{ naam: "Leeg", rijen: [["Nog geen klassen"]] }]);
}

export function workshopsXlsx(gegevens: LijstGegevens): Uint8Array {
  const lijsten = workshopLijsten(gegevens);

  const bladen: XlsxBlad[] = lijsten.map((lijst) => ({
    naam: `${lijst.rondeLabel} ${lijst.workshop}`,
    breedtes: [6, 32, 16],
    rijen: [
      [kopregel(gegevens.dag)],
      [`${lijst.rondeLabel} · ${lijst.tijd} · ${lijst.workshop}`],
      [
        [lijst.ruimte ? `Ruimte: ${lijst.ruimte}` : null, lijst.docent ? `Docent: ${lijst.docent}` : null]
          .filter(Boolean)
          .join(" · "),
      ],
      [`Totaal: ${lijst.deelnemers.length} van ${lijst.maximum} plaatsen`],
      [],
      ["Nr", "Leerling", "Klas"],
      ...lijst.deelnemers.map((deelnemer, index) => [index + 1, deelnemer.naam, deelnemer.klas]),
    ],
  }));

  return maakXlsx(bladen.length > 0 ? bladen : [{ naam: "Leeg", rijen: [["Nog geen workshops"]] }]);
}

export function klassenPdf(gegevens: LijstGegevens): Uint8Array {
  const lijsten = klassenLijsten(gegevens);
  const blokken: PdfBlok[] = [];

  lijsten.forEach((lijst, index) => {
    if (index > 0) blokken.push({ soort: "nieuwePagina" });
    blokken.push({ soort: "kop", tekst: `Klas ${lijst.klas}` });
    blokken.push({ soort: "regel", tekst: kopregel(gegevens.dag) });
    blokken.push({ soort: "ruimte" });

    const breedte = Math.floor((BREEDTE_TABEL - 150) / Math.max(lijst.rondes.length, 1));
    blokken.push({
      soort: "tabel",
      kolommen: [
        { titel: "Leerling", breedte: 150 },
        ...lijst.rondes.map((ronde) => ({ titel: `${ronde.label} (${ronde.tijd})`, breedte })),
      ],
      rijen: lijst.regels.map((regel) => [regel.naam, ...regel.perRonde]),
    });
  });

  return maakPdf({
    titel: `Klassenlijsten · ${gegevens.dag.organisatie}`,
    voettekst: kopregel(gegevens.dag),
    blokken,
  });
}

export function workshopsPdf(gegevens: LijstGegevens): Uint8Array {
  const lijsten = workshopLijsten(gegevens);
  const blokken: PdfBlok[] = [];

  lijsten.forEach((lijst, index) => {
    if (index > 0) blokken.push({ soort: "nieuwePagina" });
    blokken.push({ soort: "kop", tekst: `${lijst.rondeLabel} · ${lijst.workshop}` });
    blokken.push({ soort: "regel", tekst: `Tijd: ${lijst.tijd}` });
    if (lijst.ruimte) blokken.push({ soort: "regel", tekst: `Ruimte: ${lijst.ruimte}` });
    if (lijst.docent) blokken.push({ soort: "regel", tekst: `Docent: ${lijst.docent}` });
    blokken.push({
      soort: "regel",
      tekst: `Totaal: ${lijst.deelnemers.length} van ${lijst.maximum} plaatsen`,
      vet: true,
    });
    blokken.push({ soort: "ruimte" });
    blokken.push({
      soort: "tabel",
      kolommen: [
        { titel: "Nr", breedte: 30 },
        { titel: "Leerling", breedte: 220 },
        { titel: "Klas", breedte: 120 },
      ],
      rijen: lijst.deelnemers.map((deelnemer, nummer) => [String(nummer + 1), deelnemer.naam, deelnemer.klas]),
    });
  });

  return maakPdf({
    titel: `Workshoplijsten · ${gegevens.dag.organisatie}`,
    voettekst: kopregel(gegevens.dag),
    blokken,
  });
}

export function codesXlsx(gegevens: LijstGegevens): Uint8Array {
  const lijsten = codeLijsten(gegevens);

  const bladen: XlsxBlad[] = lijsten.map((lijst) => ({
    naam: lijst.klas,
    breedtes: [30, 16, 14],
    rijen: [
      [kopregel(gegevens.dag)],
      [`Klas ${lijst.klas} · persoonlijke inschrijfcodes`],
      ["Geef iedere leerling alleen zijn eigen code. Met deze code kan hij zijn eigen workshops kiezen."],
      [],
      ["Leerling", "Code", "Bijzonderheid"],
      ...lijst.regels.map((regel) => [regel.naam, regel.code, regel.vrijgesteld ? "Vrijgesteld" : ""]),
    ],
  }));

  return maakXlsx(bladen.length > 0 ? bladen : [{ naam: "Leeg", rijen: [["Nog geen leerlingen"]] }]);
}

export function codesPdf(gegevens: LijstGegevens): Uint8Array {
  const lijsten = codeLijsten(gegevens);
  const blokken: PdfBlok[] = [];

  lijsten.forEach((lijst, index) => {
    if (index > 0) blokken.push({ soort: "nieuwePagina" });
    blokken.push({ soort: "kop", tekst: `Klas ${lijst.klas} · inschrijfcodes` });
    blokken.push({ soort: "regel", tekst: kopregel(gegevens.dag) });
    blokken.push({
      soort: "regel",
      tekst: "Geef iedere leerling alleen zijn eigen code.",
      vet: true,
    });
    blokken.push({ soort: "ruimte" });
    blokken.push({
      soort: "tabel",
      kolommen: [
        { titel: "Leerling", breedte: 220 },
        { titel: "Code", breedte: 110 },
        { titel: "Bijzonderheid", breedte: 120 },
      ],
      rijen: lijst.regels.map((regel) => [regel.naam, regel.code, regel.vrijgesteld ? "Vrijgesteld" : ""]),
    });
  });

  return maakPdf({
    titel: `Inschrijfcodes · ${gegevens.dag.organisatie}`,
    voettekst: kopregel(gegevens.dag),
    blokken,
  });
}

/** De breedte die een tabel op een A4 met marges overhoudt. */
const BREEDTE_TABEL = 499;

/** Een bestandsnaam zoals jullie hem altijd gebruikten. */
export function bestandsnaam(
  dag: LijstDag,
  soort: "Klassenlijsten" | "Workshoplijsten" | "Inschrijfcodes",
  extensie: string,
): string {
  const schoon = dag.organisatie.replace(/[\\/:*?"<>|]/g, "").trim() || "School";
  return `${schoon} - ${soort}.${extensie}`;
}
