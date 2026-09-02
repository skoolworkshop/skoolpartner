import { describe, expect, it } from "vitest";

import {
  bedragNaarCenten,
  betaalStand,
  bezetting,
  contactStilte,
  dagenTussen,
  leesDatum,
  leeftijdOp,
  leeftijdSignaal,
} from "@/lib/crm/regels";

describe("leesDatum", () => {
  it("leest een gewone datum", () => {
    expect(leesDatum("2026-10-02")?.toISOString()).toBe("2026-10-02T00:00:00.000Z");
  });

  it("negeert een tijd die erachter staat", () => {
    expect(leesDatum("2026-10-02T14:33:00Z")?.toISOString()).toBe("2026-10-02T00:00:00.000Z");
  });

  it("weigert een dag die niet bestaat", () => {
    // Zonder deze controle schuift 31 februari stilletjes door naar 3 maart.
    expect(leesDatum("2026-02-31")).toBeNull();
    expect(leesDatum("2026-13-01")).toBeNull();
  });

  it("geeft null bij niets", () => {
    expect(leesDatum(null)).toBeNull();
    expect(leesDatum("")).toBeNull();
    expect(leesDatum("morgen")).toBeNull();
  });
});

describe("dagenTussen", () => {
  it("telt hele dagen", () => {
    expect(dagenTussen("2026-10-02", "2026-11-01")).toBe(30);
  });

  it("telt terug als de tweede datum eerder is", () => {
    expect(dagenTussen("2026-11-01", "2026-10-02")).toBe(-30);
  });

  it("rekent over een zomertijdwissel heen goed", () => {
    // 25 oktober 2026 gaat de klok terug. Met lokale tijd zou dit 30,04 dagen
    // worden en dus verkeerd afronden.
    expect(dagenTussen("2026-10-20", "2026-11-19")).toBe(30);
  });
});

describe("leeftijdOp", () => {
  it("rekent de leeftijd op de peildatum", () => {
    expect(leeftijdOp("2008-04-12", "2026-10-02")).toBe(18);
  });

  it("telt de verjaardag zelf mee", () => {
    expect(leeftijdOp("2008-10-02", "2026-10-02")).toBe(18);
  });

  it("telt de dag ervoor nog niet mee", () => {
    expect(leeftijdOp("2008-10-03", "2026-10-02")).toBe(17);
  });
});

describe("leeftijdSignaal", () => {
  it("ziet dat iemand bij vertrek nog minderjarig is", () => {
    // Dit is het punt van de hele functie: iemand kan zich aanmelden als 17 en
    // vertrekken als 18, of andersom.
    const signaal = leeftijdSignaal("2009-06-01", "2027-03-12");
    expect(signaal?.leeftijd).toBe(17);
    expect(signaal?.toon).toBe("let-op");
    expect(signaal?.bericht).toContain("ouder");
  });

  it("ziet dat dezelfde persoon in een latere periode wel achttien is", () => {
    const signaal = leeftijdSignaal("2009-06-01", "2027-06-05");
    expect(signaal?.leeftijd).toBe(18);
    expect(signaal?.toon).toBe("goed");
  });

  it("noemt zestien een uitzondering en geen weigering", () => {
    const signaal = leeftijdSignaal("2011-01-01", "2027-03-12");
    expect(signaal?.toon).toBe("let-op");
    expect(signaal?.bericht).toContain("uitzondering");
  });

  it("meldt het als iemand echt buiten de doelgroep valt", () => {
    expect(leeftijdSignaal("2013-01-01", "2027-03-12")?.toon).toBe("buiten");
    expect(leeftijdSignaal("1999-01-01", "2027-03-12")?.toon).toBe("buiten");
  });

  it("zegt niets als de gegevens ontbreken", () => {
    expect(leeftijdSignaal(null, "2027-03-12")).toBeNull();
    expect(leeftijdSignaal("2009-06-01", null)).toBeNull();
  });
});

describe("betaalStand", () => {
  it("rekent uit wat er nog open staat", () => {
    const stand = betaalStand(425000, 50000);
    expect(stand.openCents).toBe(375000);
    expect(stand.volledig).toBe(false);
    expect(stand.teveelCents).toBe(0);
  });

  it("herkent volledig betaald", () => {
    const stand = betaalStand(425000, 425000);
    expect(stand.volledig).toBe(true);
    expect(stand.openCents).toBe(0);
    expect(stand.label).toBe("Volledig betaald");
  });

  it("benoemt te veel betaald apart in plaats van het weg te rekenen", () => {
    const stand = betaalStand(425000, 430000);
    expect(stand.openCents).toBe(0);
    expect(stand.teveelCents).toBe(5000);
    expect(stand.label).toBe("Er is te veel betaald");
  });

  it("zegt het eerlijk als er nog geen prijs is", () => {
    const stand = betaalStand(0, 0);
    expect(stand.volledig).toBe(false);
    expect(stand.label).toBe("Nog geen prijs ingesteld");
  });
});

describe("bezetting", () => {
  it("toont ruimte bij een lege periode", () => {
    expect(bezetting(0, 15)).toMatchObject({ vrij: 15, toon: "ruimte" });
  });

  it("waarschuwt bij twee plaatsen of minder", () => {
    expect(bezetting(13, 15).toon).toBe("bijna-vol");
    expect(bezetting(14, 15).label).toBe("Nog een plaats vrij");
  });

  it("herkent vol", () => {
    expect(bezetting(15, 15)).toMatchObject({ vrij: 0, toon: "vol" });
  });

  it("verzwijgt een overboeking niet", () => {
    const stand = bezetting(17, 15);
    expect(stand.toon).toBe("over");
    expect(stand.label).toContain("2 te veel");
  });
});

describe("contactStilte", () => {
  it("houdt nooit contact gehad apart van lang geleden", () => {
    expect(contactStilte(null, "2026-09-01").toon).toBe("nooit");
    expect(contactStilte("2024-01-01", "2026-09-01").toon).toBe("lang");
  });

  it("schrijft recente dagen uit", () => {
    expect(contactStilte("2026-09-01", "2026-09-01").label).toBe("Vandaag");
    expect(contactStilte("2026-08-31", "2026-09-01").label).toBe("Gisteren");
    expect(contactStilte("2026-08-25", "2026-09-01").label).toBe("7 dagen geleden");
  });

  it("gaat over op maanden en jaren", () => {
    expect(contactStilte("2026-06-01", "2026-09-01").label).toBe("3 maanden geleden");
    expect(contactStilte("2025-01-01", "2026-09-01").label).toBe("Ruim een jaar geleden");
  });

  it("kan overweg met een tijdstempel in plaats van een datum", () => {
    expect(contactStilte("2026-08-31T09:14:00.000Z", "2026-09-01").label).toBe("Gisteren");
  });
});

describe("bedragNaarCenten", () => {
  it("leest de gewone schrijfwijzen", () => {
    expect(bedragNaarCenten("4250")).toBe(425000);
    expect(bedragNaarCenten("4.250,00")).toBe(425000);
    expect(bedragNaarCenten("4250,50")).toBe(425050);
    expect(bedragNaarCenten("€ 500")).toBe(50000);
    expect(bedragNaarCenten("4,250.50")).toBe(425050);
  });

  it("laat een terugbetaling negatief zijn", () => {
    expect(bedragNaarCenten("-125,00")).toBe(-12500);
  });

  it("weigert onzin", () => {
    expect(bedragNaarCenten("")).toBeNull();
    expect(bedragNaarCenten("veel")).toBeNull();
    expect(bedragNaarCenten("12,345")).toBe(1234500);
  });
});
