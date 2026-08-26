import { describe, expect, it } from "vitest";

import {
  booleanToCjpAnswer,
  cjpAnswerToBoolean,
  describeCjp,
  needsCjpCompletion,
  normalizeCjpNumber,
} from "@/lib/cjp";
import {
  detecteerAfbeeldingstype,
  domeinNaarUrl,
  isBruikbareAfbeelding,
  isVeiligeUrl,
  logoBestandsnaam,
  standaardFavicon,
  UPLOAD_TYPES,
  vindLogoKandidaten,
} from "@/lib/organizations/logo-parse";
import { validateRegistration } from "@/lib/registration";

describe("logo: welke adressen mogen wij ophalen", () => {
  it("staat een gewoon schooldomein toe", () => {
    expect(isVeiligeUrl("https://goudsewaarden.nl")).toBe(true);
    expect(isVeiligeUrl("https://www.goudsewaarden.nl/over-ons")).toBe(true);
  });

  it("weigert alles wat naar binnen wijst", () => {
    expect(isVeiligeUrl("http://goudsewaarden.nl")).toBe(false);
    expect(isVeiligeUrl("https://localhost")).toBe(false);
    expect(isVeiligeUrl("https://127.0.0.1")).toBe(false);
    expect(isVeiligeUrl("https://192.168.1.1")).toBe(false);
    expect(isVeiligeUrl("https://server.local")).toBe(false);
    expect(isVeiligeUrl("https://metadata.google.internal")).toBe(false);
    expect(isVeiligeUrl("https://goudsewaarden.nl:8080")).toBe(false);
    expect(isVeiligeUrl("https://gebruiker:wachtwoord@goudsewaarden.nl")).toBe(false);
    expect(isVeiligeUrl("file:///etc/passwd")).toBe(false);
    expect(isVeiligeUrl("geen url")).toBe(false);
  });

  it("maakt van een domein een adres", () => {
    expect(domeinNaarUrl("goudsewaarden.nl")).toBe("https://goudsewaarden.nl");
    expect(domeinNaarUrl("www.goudsewaarden.nl")).toBe("https://goudsewaarden.nl");
    expect(domeinNaarUrl("https://goudsewaarden.nl/contact")).toBe("https://goudsewaarden.nl");
    expect(domeinNaarUrl("localhost")).toBeNull();
    expect(domeinNaarUrl("")).toBeNull();
  });
});

describe("logo: het beste plaatje kiezen", () => {
  const html = `
    <html><head>
      <link rel="icon" href="/favicon-16.png" sizes="16x16">
      <link rel="apple-touch-icon" href="/apple-touch-icon.png">
      <meta property="og:image" content="https://goudsewaarden.nl/sfeerfoto.jpg">
      <script type="application/ld+json">{"logo":"https://goudsewaarden.nl/logo.png"}</script>
    </head><body></body></html>
  `;

  it("kiest het apple-touch-icon boven een sfeerfoto", () => {
    const kandidaten = vindLogoKandidaten(html, "https://goudsewaarden.nl");
    expect(kandidaten[0].url).toBe("https://goudsewaarden.nl/apple-touch-icon.png");
    expect(kandidaten.map((k) => k.url)).toContain("https://goudsewaarden.nl/logo.png");
  });

  it("zet relatieve adressen om naar volledige adressen", () => {
    const kandidaten = vindLogoKandidaten(html, "https://goudsewaarden.nl");
    expect(kandidaten.every((k) => k.url.startsWith("https://"))).toBe(true);
  });

  it("laat SVG links liggen, want daar kan script in zitten", () => {
    const kandidaten = vindLogoKandidaten(
      '<link rel="apple-touch-icon" href="/logo.svg">',
      "https://goudsewaarden.nl"
    );
    expect(kandidaten).toHaveLength(0);
  });

  it("negeert een plaatje op een ander, onveilig adres", () => {
    const kandidaten = vindLogoKandidaten(
      '<meta property="og:image" content="http://192.168.1.5/logo.png">',
      "https://goudsewaarden.nl"
    );
    expect(kandidaten).toHaveLength(0);
  });

  it("houdt het favicon over als laatste redding", () => {
    expect(standaardFavicon("https://goudsewaarden.nl")).toBe("https://goudsewaarden.nl/favicon.ico");
  });
});

describe("logo: wat slaan wij op", () => {
  it("accepteert alleen echte afbeeldingen van een redelijke grootte", () => {
    expect(isBruikbareAfbeelding("image/png", 5000)).toBe(true);
    expect(isBruikbareAfbeelding("image/jpeg; charset=binary", 5000)).toBe(true);
    expect(isBruikbareAfbeelding("image/svg+xml", 5000)).toBe(false);
    expect(isBruikbareAfbeelding("text/html", 5000)).toBe(false);
    expect(isBruikbareAfbeelding(null, 5000)).toBe(false);
    expect(isBruikbareAfbeelding("image/png", 50)).toBe(false);
    expect(isBruikbareAfbeelding("image/png", 9_000_000)).toBe(false);
  });

  it("bewaart per organisatie op een vast pad", () => {
    expect(logoBestandsnaam("abc-123", "image/png")).toBe("abc-123/logo.png");
    expect(logoBestandsnaam("abc-123", "image/jpeg")).toBe("abc-123/logo.jpg");
  });
});

describe("logo: wat iemand uploadt", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
  ]);

  it("herkent een echt bestand aan de inhoud, niet aan de naam", () => {
    expect(detecteerAfbeeldingstype(png)).toBe("image/png");
    expect(detecteerAfbeeldingstype(jpeg)).toBe("image/jpeg");
    expect(detecteerAfbeeldingstype(webp)).toBe("image/webp");
  });

  it("weigert iets dat alleen maar op een afbeelding lijkt", () => {
    // Een HTML-bestand dat logo.png heet.
    const nep = new TextEncoder().encode("<html><script>alert(1)</script>");
    expect(detecteerAfbeeldingstype(nep)).toBeNull();

    // Een SVG, want daar kan script in zitten.
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">');
    expect(detecteerAfbeeldingstype(svg)).toBeNull();

    expect(detecteerAfbeeldingstype(new Uint8Array([]))).toBeNull();
  });

  it("een favicon mag wel opgehaald worden, maar niet geüpload", () => {
    const ico = new Uint8Array([0x00, 0x00, 0x01, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(detecteerAfbeeldingstype(ico)).toBe("image/x-icon");
    expect(UPLOAD_TYPES).not.toContain("image/x-icon");
  });
});

describe("CJP-schoolnummer", () => {
  it("haalt overbodige spaties weg", () => {
    expect(normalizeCjpNumber("  123 456  ").value).toBe("123 456");
    expect(normalizeCjpNumber("123456").value).toBe("123456");
  });

  it("leeg mag, want niet iedere school heeft een nummer", () => {
    expect(normalizeCjpNumber("").ok).toBe(true);
    expect(normalizeCjpNumber("   ").value).toBeNull();
  });

  it("weigert alleen wat overduidelijk fout is", () => {
    expect(normalizeCjpNumber("12").ok).toBe(false);
    expect(normalizeCjpNumber("x".repeat(60)).ok).toBe(false);
  });

  it("zet het antwoord om naar wat er in de database komt", () => {
    expect(cjpAnswerToBoolean("ja")).toBe(true);
    expect(cjpAnswerToBoolean("nee")).toBe(false);
    expect(cjpAnswerToBoolean("onbekend")).toBeNull();
    expect(booleanToCjpAnswer(true)).toBe("ja");
    expect(booleanToCjpAnswer(null)).toBe("onbekend");
  });

  it("vraagt alleen om aanvulling als de school zegt een nummer te hebben", () => {
    expect(needsCjpCompletion({ hasCjp: true, number: null })).toBe(true);
    expect(needsCjpCompletion({ hasCjp: true, number: "123456" })).toBe(false);
    expect(needsCjpCompletion({ hasCjp: false, number: null })).toBe(false);
    expect(needsCjpCompletion({ hasCjp: null, number: null })).toBe(false);
  });

  it("legt in gewone taal uit wat er bekend is", () => {
    expect(describeCjp({ hasCjp: true, number: "123456" })).toBe("123456");
    expect(describeCjp({ hasCjp: true, number: null })).toBe("Nog niet ingevuld");
    expect(describeCjp({ hasCjp: false, number: null })).toBe(
      "Deze organisatie heeft geen CJP-schoolnummer"
    );
    expect(describeCjp({ hasCjp: null, number: null })).toBe("Niet ingevuld");
  });
});

describe("CJP in de registratie", () => {
  const basis = {
    firstName: "Sanne",
    lastName: "de Vries",
    jobTitle: "Cultuurcoördinator",
    phone: "06 12345678",
    organizationName: "De Goudse Waarden",
    street: "Kanaalstraat",
    houseNumber: "5",
    houseNumberAddition: "",
    postalCode: "2801 AB",
    city: "Gouda",
    hasCjp: "onbekend",
    cjpSchoolNumber: "",
  };

  it("kiest de klant Ja, dan is het nummer verplicht", () => {
    const zonder = validateRegistration({ ...basis, hasCjp: "ja" });
    expect(zonder.ok).toBe(false);
    expect(zonder.errors.cjpSchoolNumber).toBeTruthy();

    const met = validateRegistration({ ...basis, hasCjp: "ja", cjpSchoolNumber: "123456" });
    expect(met.ok).toBe(true);
    expect(met.values?.hasCjp).toBe(true);
    expect(met.values?.cjpSchoolNumber).toBe("123456");
  });

  it("kiest de klant Nee, dan kan de registratie gewoon door", () => {
    const result = validateRegistration({ ...basis, hasCjp: "nee" });
    expect(result.ok).toBe(true);
    expect(result.values?.hasCjp).toBe(false);
    expect(result.values?.cjpSchoolNumber).toBeNull();
  });

  it("kiest de klant Weet ik niet, dan kan de registratie ook gewoon door", () => {
    const result = validateRegistration({ ...basis, hasCjp: "onbekend" });
    expect(result.ok).toBe(true);
    expect(result.values?.hasCjp).toBeNull();
    expect(result.values?.cjpSchoolNumber).toBeNull();
  });

  it("bewaart geen nummer als de school zegt er geen te hebben", () => {
    const result = validateRegistration({
      ...basis,
      hasCjp: "nee",
      cjpSchoolNumber: "123456",
    });
    expect(result.ok).toBe(true);
    expect(result.values?.cjpSchoolNumber).toBeNull();
  });
});
