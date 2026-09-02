import { describe, expect, it } from "vitest";

import {
  TOKENS,
  isGeldigeSneltoets,
  maakSneltoets,
  splitsNaam,
  tokensIn,
  voorbeeldVan,
  vulFragment,
} from "@/lib/crm/fragment-tekst";

/**
 * Controles op de fragmenten.
 *
 * Waar het hier om gaat: een fragment mag nooit een halve zin naar buiten
 * sturen. "Beste ," is de fout die elk mailsysteem een keer maakt, en deze
 * test bestaat om te bewijzen dat dat hier niet kan.
 */

describe("vulFragment", () => {
  it("vult wat er is", () => {
    const uit = vulFragment("Beste {{voornaam}}, over {{deal}}.", {
      voornaam: "Nora",
      deal: "Cultuurdag 2026",
    });
    expect(uit.tekst).toBe("Beste Nora, over Cultuurdag 2026.");
    expect(uit.ontbrekend).toEqual([]);
    expect(uit.onbekend).toEqual([]);
  });

  it("laat een ontbrekende waarde zichtbaar staan en meldt hem", () => {
    // Dit is de kern: geen "Beste ," maar een zichtbaar gat dat je opvalt.
    const uit = vulFragment("Beste {{voornaam}},", {});
    expect(uit.tekst).toBe("Beste {{voornaam}},");
    expect(uit.ontbrekend).toEqual(["voornaam"]);
  });

  it("behandelt een lege string als ontbrekend", () => {
    const uit = vulFragment("Beste {{voornaam}},", { voornaam: "   " });
    expect(uit.ontbrekend).toEqual(["voornaam"]);
  });

  it("behandelt null als ontbrekend", () => {
    expect(vulFragment("{{functie}}", { functie: null }).ontbrekend).toEqual(["functie"]);
  });

  it("gebruikt een terugvalwaarde als die er is", () => {
    const uit = vulFragment("Beste {{voornaam|relatie}},", {});
    expect(uit.tekst).toBe("Beste relatie,");
    expect(uit.ontbrekend).toEqual([]);
  });

  it("laat de echte waarde altijd winnen van de terugval", () => {
    expect(vulFragment("{{voornaam|relatie}}", { voornaam: "Nora" }).tekst).toBe("Nora");
  });

  it("ziet een lege terugval als een bewuste keuze om weg te laten", () => {
    const uit = vulFragment("Hallo{{functie|}}, hoe gaat het?", {});
    expect(uit.tekst).toBe("Hallo, hoe gaat het?");
    expect(uit.ontbrekend).toEqual([]);
  });

  it("laat een onbekend token staan in plaats van het weg te poetsen", () => {
    // Een typefout mag geen gat in de zin achterlaten.
    const uit = vulFragment("Beste {{voornaan}},", { voornaam: "Nora" });
    expect(uit.tekst).toBe("Beste {{voornaan}},");
    expect(uit.onbekend).toEqual(["voornaan"]);
    expect(uit.ontbrekend).toEqual([]);
  });

  it("raakt gewone accolades in de tekst niet aan", () => {
    const bron = "Gebruik { en } gewoon, en {niet zo} ook.";
    expect(vulFragment(bron, {}).tekst).toBe(bron);
  });

  it("laat een half getypt token met rust", () => {
    expect(vulFragment("Beste {{voornaam, ", {}).tekst).toBe("Beste {{voornaam, ");
  });

  it("verdraagt spaties en hoofdletters in het token", () => {
    expect(vulFragment("{{ Voornaam }}", { voornaam: "Nora" }).tekst).toBe("Nora");
  });

  it("vult hetzelfde token overal", () => {
    const uit = vulFragment("{{voornaam}}, nogmaals {{voornaam}}.", { voornaam: "Nora" });
    expect(uit.tekst).toBe("Nora, nogmaals Nora.");
    expect(uit.gebruikt).toEqual(["voornaam"]);
  });

  it("meldt elk ontbrekend token maar een keer", () => {
    const uit = vulFragment("{{voornaam}} {{voornaam}} {{organisatie}}", {});
    expect(uit.ontbrekend).toEqual(["voornaam", "organisatie"]);
  });

  it("werkt bij herhaald gebruik, ook al is het patroon globaal", () => {
    // Een globale reguliere expressie onthoudt zijn positie. Bij String.replace
    // wordt die gereset, maar dit is precies het soort ding dat je een keer wilt
    // vastleggen in plaats van aannemen.
    const bron = "Beste {{voornaam}}";
    expect(vulFragment(bron, { voornaam: "A" }).tekst).toBe("Beste A");
    expect(vulFragment(bron, { voornaam: "B" }).tekst).toBe("Beste B");
    expect(vulFragment(bron, { voornaam: "C" }).tekst).toBe("Beste C");
  });

  it("laat tekst zonder tokens ongemoeid", () => {
    const bron = "Gewoon een zin zonder personalisatie.";
    const uit = vulFragment(bron, { voornaam: "Nora" });
    expect(uit.tekst).toBe(bron);
    expect(uit.gebruikt).toEqual([]);
  });
});

describe("tokensIn", () => {
  it("vindt de tokens zonder iets in te vullen", () => {
    const uit = tokensIn("Beste {{voornaam}}, over {{deal}} bij {{organisatie}}.");
    expect(uit.gebruikt).toEqual(["voornaam", "deal", "organisatie"]);
    expect(uit.onbekend).toEqual([]);
  });

  it("wijst een typefout aan", () => {
    expect(tokensIn("{{organistie}}").onbekend).toEqual(["organistie"]);
  });
});

describe("voorbeeldVan", () => {
  it("vult elk bekend token met een voorbeeldwaarde", () => {
    const bron = TOKENS.map((t) => `{{${t.naam}}}`).join(" ");
    const uit = voorbeeldVan(bron);
    expect(uit.ontbrekend).toEqual([]);
    expect(uit.tekst).toContain("Nora");
    expect(uit.tekst).toContain("Markenhage College");
  });

  it("elk token in de lijst heeft een voorbeeld en een uitleg", () => {
    for (const token of TOKENS) {
      expect(token.voorbeeld.trim().length).toBeGreaterThan(0);
      expect(token.uitleg.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("maakSneltoets", () => {
  it("maakt van een naam iets typbaars", () => {
    expect(maakSneltoets("Offerte nabellen")).toBe("offerte-nabellen");
  });

  it("haalt accenten weg", () => {
    expect(maakSneltoets("Coördinator café")).toBe("coordinator-cafe");
  });

  it("laat geen streepje aan het begin of eind staan", () => {
    expect(maakSneltoets("  ...Offerte!  ")).toBe("offerte");
  });

  it("plakt losse tekens niet aan elkaar tot onzin", () => {
    expect(maakSneltoets("Prijs & voorwaarden 2026")).toBe("prijs-voorwaarden-2026");
  });

  it("geeft een lege string bij niets bruikbaars", () => {
    expect(maakSneltoets("!!!")).toBe("");
  });
});

describe("isGeldigeSneltoets", () => {
  it("keurt goed wat maakSneltoets maakt", () => {
    for (const naam of ["Offerte nabellen", "Prijs & voorwaarden 2026", "Coördinator café"]) {
      expect(isGeldigeSneltoets(maakSneltoets(naam))).toBe(true);
    }
  });

  it("weigert spaties, hoofdletters en een leeg begin", () => {
    expect(isGeldigeSneltoets("offerte nabellen")).toBe(false);
    expect(isGeldigeSneltoets("Offerte")).toBe(false);
    expect(isGeldigeSneltoets("-offerte")).toBe(false);
    expect(isGeldigeSneltoets("o")).toBe(false);
    expect(isGeldigeSneltoets("")).toBe(false);
  });
});

describe("splitsNaam", () => {
  it("splitst een gewone naam", () => {
    expect(splitsNaam("Nora Bakker")).toEqual({ voornaam: "Nora", achternaam: "Bakker" });
  });

  it("houdt een tussenvoegsel bij de achternaam", () => {
    expect(splitsNaam("Wil de Groot")).toEqual({ voornaam: "Wil", achternaam: "de Groot" });
  });

  it("verdraagt een enkele naam", () => {
    expect(splitsNaam("Jayden")).toEqual({ voornaam: "Jayden", achternaam: null });
  });

  it("verdraagt dubbele spaties", () => {
    expect(splitsNaam("  Nora   Bakker ")).toEqual({ voornaam: "Nora", achternaam: "Bakker" });
  });

  it("geeft niets terug bij niets", () => {
    expect(splitsNaam(null)).toEqual({ voornaam: null, achternaam: null });
    expect(splitsNaam("   ")).toEqual({ voornaam: null, achternaam: null });
  });
});
