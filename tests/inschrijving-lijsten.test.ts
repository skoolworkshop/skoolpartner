import { describe, expect, it } from "vitest";

import { leesPdf } from "@/lib/inschrijving/pdf";
import { leesWerkbladen } from "@/lib/inschrijving/xlsx";
import {
  bestandsnaam,
  klassenLijsten,
  klassenPdf,
  klassenXlsx,
  ontbrekendOverzicht,
  workshopLijsten,
  workshopsPdf,
  workshopsXlsx,
  type LijstGegevens,
} from "@/lib/inschrijving/lijsten";

/** Een kleine maar complete cultuurdag: 2 klassen, 3 workshops, 2 rondes. */
function dag(): LijstGegevens {
  return {
    dag: {
      naam: "Cultuurdag",
      datumTekst: "31 mei 2027",
      organisatie: "Over-Y College",
      locatie: "Amsterdam",
    },
    rondes: [
      { id: "r1", label: "Workshopronde 1", tijd: "09:15 tot 10:15", pauze: false },
      { id: "p", label: "Pauze", tijd: "10:15 tot 10:45", pauze: true },
      { id: "r2", label: "Workshopronde 2", tijd: "10:45 tot 11:45", pauze: false },
    ],
    uitvoeringen: [
      { id: "s1", rondeId: "r1", workshopNaam: "Ghetto Drums", label: null, ruimte: "Aula", docent: "Dathen", maximum: 25 },
      { id: "s2", rondeId: "r1", workshopNaam: "Graffiti", label: null, ruimte: "Buiten", docent: null, maximum: 25 },
      { id: "s3", rondeId: "r2", workshopNaam: "Hiphop", label: "Groep A", ruimte: "Gymzaal", docent: "Iris", maximum: 20 },
    ],
    deelnemers: [
      { id: "d1", naam: "Lissa van der Velde", groepNaam: "1 HAVO", vrijgesteld: false, keuzes: { r1: "s1", r2: "s3" } },
      { id: "d2", naam: "Anne-Marie de Jong", groepNaam: "1 HAVO", vrijgesteld: false, keuzes: { r1: "s2" } },
      { id: "d3", naam: "Jan-Peter Bakker", groepNaam: "2 VWO", vrijgesteld: false, keuzes: { r1: "s1", r2: "s3" } },
      { id: "d4", naam: "Ilse Mooren", groepNaam: "2 VWO", vrijgesteld: true, keuzes: {} },
    ],
  };
}

describe("klassenlijsten", () => {
  it("zet per klas de leerlingen op alfabet met hun workshop per ronde", () => {
    const lijsten = klassenLijsten(dag());

    expect(lijsten.map((lijst) => lijst.klas)).toEqual(["1 HAVO", "2 VWO"]);
    expect(lijsten[0].regels[0].naam).toBe("Anne-Marie de Jong");
    expect(lijsten[0].regels[1].perRonde).toEqual([
      "Ghetto Drums (Aula)",
      "Pauze",
      "Hiphop · Groep A (Gymzaal)",
    ]);
  });

  it("laat zien wie nog niet is ingedeeld en wie vrijgesteld is", () => {
    const lijsten = klassenLijsten(dag());
    expect(lijsten[0].regels[0].perRonde[2]).toBe("Nog niet ingedeeld");
    expect(lijsten[1].regels.find((regel) => regel.naam === "Ilse Mooren")?.perRonde[0]).toBe("Vrijgesteld");
  });
});

describe("workshoplijsten", () => {
  it("zet per ronde en workshop de deelnemers met hun klas", () => {
    const lijsten = workshopLijsten(dag());

    expect(lijsten[0]).toMatchObject({
      rondeLabel: "Workshopronde 1",
      workshop: "Ghetto Drums",
      ruimte: "Aula",
      docent: "Dathen",
      maximum: 25,
    });
    expect(lijsten[0].deelnemers).toEqual([
      { naam: "Jan-Peter Bakker", klas: "2 VWO" },
      { naam: "Lissa van der Velde", klas: "1 HAVO" },
    ]);
  });

  it("telt een vrijgestelde leerling nergens mee", () => {
    const alles = workshopLijsten(dag()).flatMap((lijst) => lijst.deelnemers.map((d) => d.naam));
    expect(alles).not.toContain("Ilse Mooren");
  });
});

describe("wat er nog niet klopt", () => {
  it("noemt per leerling welke rondes nog leeg zijn", () => {
    const overzicht = ontbrekendOverzicht(dag());
    expect(overzicht.nietIngedeeld).toEqual([
      { naam: "Anne-Marie de Jong", klas: "1 HAVO", rondes: ["Workshopronde 2"] },
    ]);
  });

  it("noemt de vrijgestelde leerlingen apart", () => {
    expect(ontbrekendOverzicht(dag()).vrijgesteld).toEqual([{ naam: "Ilse Mooren", klas: "2 VWO" }]);
  });

  it("merkt een workshop op waar niemand in zit", () => {
    const overzicht = ontbrekendOverzicht(dag());
    expect(overzicht.leeg).toEqual([]);
    const leeg = dag();
    leeg.deelnemers = leeg.deelnemers.map((d) => ({ ...d, keuzes: {} }));
    expect(ontbrekendOverzicht(leeg).leeg).toHaveLength(3);
  });

  it("merkt het op als er meer leerlingen in zitten dan er plekken zijn", () => {
    const vol = dag();
    vol.uitvoeringen[0].maximum = 1;
    expect(ontbrekendOverzicht(vol).teVol).toEqual([
      { workshop: "Ghetto Drums", ronde: "Workshopronde 1", aantal: 2, maximum: 1 },
    ]);
  });
});

describe("de bestanden", () => {
  it("maakt een Excel met een tabblad per klas", async () => {
    const bytes = klassenXlsx(dag());
    const kopie = new Uint8Array(bytes);
    const bladen = await leesWerkbladen(kopie.buffer.slice(0, kopie.byteLength) as ArrayBuffer);

    expect(bladen.map((blad) => blad.naam)).toEqual(["1 HAVO", "2 VWO"]);
    expect(bladen[0].rijen[0][0]).toContain("Over-Y College");
    expect(bladen[0].rijen[3]).toEqual([
      "Leerling",
      "Workshopronde 1 (09:15 tot 10:15)",
      "Pauze (10:15 tot 10:45)",
      "Workshopronde 2 (10:45 tot 11:45)",
    ]);
    expect(bladen[0].rijen[4][0]).toBe("Anne-Marie de Jong");
  });

  it("maakt een Excel met een tabblad per workshop per ronde", async () => {
    const bytes = workshopsXlsx(dag());
    const kopie = new Uint8Array(bytes);
    const bladen = await leesWerkbladen(kopie.buffer.slice(0, kopie.byteLength) as ArrayBuffer);

    expect(bladen).toHaveLength(3);
    expect(bladen[0].naam).toContain("Ghetto Drums");
    expect(bladen[0].rijen[3][0]).toBe("Totaal: 2 van 25 plaatsen");
    expect(bladen[0].rijen[6]).toEqual(["1", "Jan-Peter Bakker", "2 VWO"]);
  });

  it("maakt een leesbare PDF met de klassenlijsten", async () => {
    const bytes = klassenPdf(dag());
    const kopie = new Uint8Array(bytes);
    const tekst = await leesPdf(kopie.buffer.slice(0, kopie.byteLength) as ArrayBuffer);

    expect(tekst).toContain("Klas 1 HAVO");
    expect(tekst).toContain("Klas 2 VWO");
    expect(tekst).toContain("Over-Y College");
    expect(tekst).toContain("Lissa van der Velde");
  });

  it("maakt een leesbare PDF met de workshoplijsten", async () => {
    const bytes = workshopsPdf(dag());
    const kopie = new Uint8Array(bytes);
    const tekst = await leesPdf(kopie.buffer.slice(0, kopie.byteLength) as ArrayBuffer);

    expect(tekst).toContain("Workshopronde 1 · Ghetto Drums");
    expect(tekst).toContain("Ruimte: Aula");
    expect(tekst).toContain("Docent: Dathen");
    expect(tekst).toContain("Totaal: 2 van 25 plaatsen");
  });

  it("gebruikt de bestandsnamen die scholen gewend zijn", () => {
    expect(bestandsnaam(dag().dag, "Klassenlijsten", "xlsx")).toBe("Over-Y College - Klassenlijsten.xlsx");
    expect(bestandsnaam(dag().dag, "Workshoplijsten", "pdf")).toBe("Over-Y College - Workshoplijsten.pdf");
  });
});
