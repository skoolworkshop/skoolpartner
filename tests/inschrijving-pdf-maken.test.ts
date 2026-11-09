import { describe, expect, it } from "vitest";

import { leesPdf } from "@/lib/inschrijving/pdf";
import { kortAf, maakPdf, pdfTekst, type PdfBlok } from "@/lib/inschrijving/pdf-maken";

/**
 * De maker wordt getest met de lezer ernaast: een PDF schrijven en hem daarna
 * terugleren. Wat er niet uit komt, staat er niet in.
 */
async function heenEnWeer(blokken: PdfBlok[], titel = "Cultuurdag"): Promise<string> {
  const bytes = maakPdf({ titel, voettekst: "Skool Workshop", blokken });
  const kopie = new Uint8Array(bytes);
  return leesPdf(kopie.buffer.slice(kopie.byteOffset, kopie.byteOffset + kopie.byteLength) as ArrayBuffer);
}

describe("tekst klaarmaken", () => {
  it("ontsnapt haakjes en backslashes", () => {
    expect(pdfTekst("Groep (3/4)")).toBe("Groep \\(3/4\\)");
    expect(pdfTekst("a\\b")).toBe("a\\\\b");
  });

  it("schrijft accenten als octaal", () => {
    expect(pdfTekst("Stèfanie")).toBe("St\\350fanie");
  });

  it("vervangt wat niet in een PDF-lettertype past", () => {
    expect(pdfTekst("Lissa 🎉")).toContain("?");
  });

  it("kapt een te lange naam af met een beletselteken", () => {
    expect(kortAf("Workshop Smartphone Fotografie", 40, 9)).toMatch(/\u2026$/);
    expect(kortAf("Kort", 100, 9)).toBe("Kort");
  });
});

describe("een PDF maken", () => {
  it("levert een bestand dat de eigen lezer begrijpt", async () => {
    const tekst = await heenEnWeer([
      { soort: "kop", tekst: "Klassenlijst 1 HAVO" },
      { soort: "regel", tekst: "Scholengemeenschap De Rotonde · 31 mei 2027" },
      {
        soort: "tabel",
        kolommen: [
          { titel: "Leerling", breedte: 160 },
          { titel: "Ronde 1", breedte: 120 },
          { titel: "Ronde 2", breedte: 120 },
        ],
        rijen: [
          ["Lissa van der Velde", "Ghetto Drums", "Graffiti"],
          ["Jan-Peter Bakker", "Hiphop", "DJ Skills"],
        ],
      },
    ]);

    expect(tekst).toContain("Klassenlijst 1 HAVO");
    expect(tekst).toContain("Scholengemeenschap De Rotonde");
    expect(tekst).toContain("Lissa van der Velde");
    expect(tekst).toContain("Ghetto Drums");
  });

  it("houdt accenten en apostrofs heel", async () => {
    const tekst = await heenEnWeer([
      { soort: "regel", tekst: "Stèfanie de Haas" },
      { soort: "regel", tekst: "Tim van 't Hof" },
      { soort: "regel", tekst: "Kbs Petrus & Paulus" },
    ]);

    expect(tekst).toContain("Stèfanie de Haas");
    expect(tekst).toContain("Tim van 't Hof");
    expect(tekst).toContain("Kbs Petrus & Paulus");
  });

  it("zet de titel op elke pagina en herhaalt de kopregel", async () => {
    const rijen = Array.from({ length: 120 }, (_, i) => [`Leerling ${i + 1}`, "Hiphop", "Graffiti"]);
    const tekst = await heenEnWeer([
      {
        soort: "tabel",
        kolommen: [
          { titel: "Leerling", breedte: 200 },
          { titel: "Ronde 1", breedte: 120 },
          { titel: "Ronde 2", breedte: 120 },
        ],
        rijen,
      },
    ]);

    // Meer dan één pagina, dus de titel en de kopregel komen vaker voor.
    expect(tekst.split("Cultuurdag").length - 1).toBeGreaterThan(1);
    expect(tekst.split("Leerling\tRonde 1").length - 1).toBeGreaterThan(1);
    // En alle 120 leerlingen staan erin.
    expect(tekst).toContain("Leerling 1\tHiphop");
    expect(tekst).toContain("Leerling 120");
  });

  it("begint waar gevraagd op een nieuwe pagina", async () => {
    const tekst = await heenEnWeer([
      { soort: "kop", tekst: "Eerste blad" },
      { soort: "nieuwePagina" },
      { soort: "kop", tekst: "Tweede blad" },
    ]);

    expect(tekst).toContain("Eerste blad");
    expect(tekst).toContain("Tweede blad");
    expect(tekst).toContain("pagina 2 van 2");
  });

  it("zet de voettekst met het paginanummer eronder", async () => {
    const tekst = await heenEnWeer([{ soort: "regel", tekst: "Eén regel" }]);
    expect(tekst).toContain("Skool Workshop · pagina 1 van 1");
  });
});
