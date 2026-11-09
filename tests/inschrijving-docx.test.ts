import { describe, expect, it } from "vitest";

import {
  koppelKlassen,
  leesBlokken,
  lijktOpKlasKop,
  naarBladen,
  schoonKlasNaam,
} from "@/lib/inschrijving/docx";
import { leesBladen } from "@/lib/inschrijving/lijst";

/**
 * Word-bestanden met klassenlijsten erin.
 *
 * DE VORM DIE SCHOLEN STUREN
 *
 *   Een kop met de klas, daaronder een tabel met voornaam, tussenvoegsel en
 *   achternaam, en dat een paar keer achter elkaar. In het echte testbestand
 *   staat de eerste kop echter onder zijn tabel en de andere twee erboven.
 *   Precies dat wordt hieronder nagespeeld, met verzonnen namen.
 */

function alinea(tekst: string): string {
  return `<w:p><w:r><w:t>${tekst}</w:t></w:r></w:p>`;
}

function tabel(rijen: string[][]): string {
  const cellen = (rij: string[]) =>
    rij.map((cel) => `<w:tc><w:p><w:r><w:t>${cel}</w:t></w:r></w:p></w:tc>`).join("");
  return `<w:tbl>${rijen.map((rij) => `<w:tr>${cellen(rij)}</w:tr>`).join("")}</w:tbl>`;
}

const KLAS_A = [
  ["Sanne", "", "Bakker"],
  ["Daan", "van der", "Vloot"],
  ["Noor", "", "Visser"],
];
const KLAS_B = [
  ["Bram", "van", "Beek"],
  ["Esmée", "", "Kuipers"],
];
const KLAS_C = [["Lotte", "de", "Jong"]];

// Kop onder de eerste tabel, boven de twee daarna. Zoals in het echte bestand.
const DOCUMENT = `<w:document><w:body>
  ${tabel(KLAS_A)}
  ${alinea("Klas Km1A")}
  ${alinea("")}
  ${alinea("Klas KM1B")}
  ${tabel(KLAS_B)}
  ${alinea("KH1C")}
  ${tabel(KLAS_C)}
</w:body></w:document>`;

describe("de blokken uit een Word-document", () => {
  it("leest alinea's en tabellen in de volgorde waarin ze staan", () => {
    const blokken = leesBlokken(DOCUMENT);
    expect(blokken.map((blok) => blok.soort)).toEqual([
      "tabel",
      "alinea",
      "alinea",
      "tabel",
      "alinea",
      "tabel",
    ]);
  });

  it("slaat lege alinea's over", () => {
    const blokken = leesBlokken(DOCUMENT);
    expect(blokken.filter((blok) => blok.soort === "alinea")).toHaveLength(3);
  });

  it("leest de cellen van een tabel", () => {
    const blokken = leesBlokken(DOCUMENT);
    const eerste = blokken[0];
    expect(eerste.soort).toBe("tabel");
    if (eerste.soort !== "tabel") return;
    expect(eerste.rijen).toHaveLength(3);
    expect(eerste.rijen[1]).toEqual(["Daan", "van der", "Vloot"]);
  });

  it("maakt van een tab en een regelafbreking een spatie", () => {
    const xml = `<w:document><w:body><w:p><w:r><w:t>Jan</w:t><w:tab/><w:t>Peter</w:t></w:r></w:p></w:body></w:document>`;
    const blokken = leesBlokken(xml);
    expect(blokken[0]).toEqual({ soort: "alinea", tekst: "Jan Peter" });
  });

  it("laat XML-ontsnappingen weer als gewone tekens zien", () => {
    const xml = `<w:document><w:body><w:p><w:r><w:t>Z&#246;e &amp; Co</w:t></w:r></w:p></w:body></w:document>`;
    expect(leesBlokken(xml)[0]).toEqual({ soort: "alinea", tekst: "Zöe & Co" });
  });
});

describe("de klas bij de juiste tabel", () => {
  it("pakt de kop boven de tabel, en anders die eronder", () => {
    const lijsten = koppelKlassen(leesBlokken(DOCUMENT));
    expect(lijsten.map((lijst) => `${lijst.klas}=${lijst.rijen.length}`)).toEqual([
      "Km1A=3",
      "KM1B=2",
      "KH1C=1",
    ]);
  });

  it("gebruikt een kop maar één keer", () => {
    const xml = `<w:document><w:body>${alinea("Klas 1A")}${tabel(KLAS_A)}${tabel(KLAS_B)}</w:body></w:document>`;
    const lijsten = koppelKlassen(leesBlokken(xml));
    expect(lijsten[0].klas).toBe("1A");
    expect(lijsten[1].klas).toBeNull();
  });

  it("herkent wat een klasnaam kan zijn", () => {
    expect(lijktOpKlasKop("Klas Km1A")).toBe(true);
    expect(lijktOpKlasKop("KH1C")).toBe(true);
    expect(lijktOpKlasKop("2 VWO")).toBe(true);
    expect(lijktOpKlasKop("Hieronder staan de leerlingen van deze groep")).toBe(false);
    expect(lijktOpKlasKop("")).toBe(false);
  });

  it("haalt het woord klas van de naam af", () => {
    expect(schoonKlasNaam("Klas Km1A")).toBe("Km1A");
    expect(schoonKlasNaam("Groep: 3/4")).toBe("3/4");
    expect(schoonKlasNaam("KH1C")).toBe("KH1C");
  });
});

describe("van Word naar leerlingen", () => {
  it("levert de leerlingen met hun eigen klas op", () => {
    const lezing = leesBladen(naarBladen(koppelKlassen(leesBlokken(DOCUMENT))));

    expect(lezing.regels).toHaveLength(6);
    expect(lezing.problemen).toHaveLength(0);

    const perKlas = new Map<string, number>();
    for (const regel of lezing.regels) {
      perKlas.set(regel.groep ?? "", (perKlas.get(regel.groep ?? "") ?? 0) + 1);
    }
    expect([...perKlas.entries()].sort()).toEqual([
      ["KH1C", 1],
      ["KM1B", 2],
      ["Km1A", 3],
    ]);
  });

  it("houdt Nederlandse tussenvoegsels heel", () => {
    const lezing = leesBladen(naarBladen(koppelKlassen(leesBlokken(DOCUMENT))));
    const namen = lezing.regels.map((regel) => regel.naam);
    expect(namen).toContain("Daan van der Vloot");
    expect(namen).toContain("Bram van Beek");
    expect(namen).toContain("Lotte de Jong");
  });
});
