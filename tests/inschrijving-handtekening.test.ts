import { describe, expect, it } from "vitest";

import {
  STANDAARD_HANDTEKENING,
  handtekeningTekst,
  maakHandtekening,
  maakMailHtml,
  metDomein,
  veilig,
  veiligeUrl,
} from "@/lib/inschrijving/handtekening";

/**
 * De e-mailhandtekening.
 *
 * Twee dingen worden hier bewaakt. Ten eerste dat er geen verzonnen link in
 * sluipt: elk adres hieronder staat op skoolworkshop.nl of in de instellingen
 * van het systeem. Ten tweede dat de HTML in Outlook overeind blijft, en dat
 * betekent tabellen en opmaak inline.
 */

describe("de gegevens in de handtekening", () => {
  it("gebruikt het telefoonnummer en adres van Skool Workshop", () => {
    expect(STANDAARD_HANDTEKENING.telefoon).toBe("085-0653923");
    expect(STANDAARD_HANDTEKENING.telefoonLink).toBe("tel:0850653923");
    expect(STANDAARD_HANDTEKENING.email).toBe("info@skoolworkshop.nl");
    expect(STANDAARD_HANDTEKENING.adres).toBe("Goeseelsstraat 27, Breda");
  });

  it("wijst alleen naar onze eigen kanalen", () => {
    const toegestaan = [
      "https://www.linkedin.com/company/skool-workshop/",
      "https://www.facebook.com/skoolworkshop",
      "https://www.instagram.com/skoolworkshop/",
      "https://wa.me/31850653923",
    ];
    expect(STANDAARD_HANDTEKENING.social.map((item) => item.url)).toEqual(toegestaan);
  });

  it("gebruikt het logo dat SkoolPartner zelf in huis heeft", () => {
    // Geen plaatje van de WordPress-website: die kan verhuizen, en dan zit er
    // een kapot logo in elke verstuurde mail.
    expect(STANDAARD_HANDTEKENING.logo).toBe("/brand/skool-workshop-logo.png");
  });

  it("maakt er bij het versturen een volledig adres van", () => {
    const metAdres = metDomein(STANDAARD_HANDTEKENING, "https://mijn.skoolworkshop.nl/");
    expect(metAdres.logo).toBe("https://mijn.skoolworkshop.nl/brand/skool-workshop-logo.png");
  });
});

describe("de HTML", () => {
  const html = maakHandtekening();

  it("zet de naam en de functie erin", () => {
    expect(html).toContain("Clinten Piqué");
    expect(html).toContain("Bedrijfsleider | Skool Workshop");
  });

  it("maakt telefoon, e-mail en website aanklikbaar", () => {
    expect(html).toContain('href="tel:0850653923"');
    expect(html).toContain('href="mailto:info@skoolworkshop.nl"');
    expect(html).toContain('href="https://www.skoolworkshop.nl"');
  });

  it("zet de socialmedialinks erin", () => {
    for (const item of STANDAARD_HANDTEKENING.social) {
      expect(html).toContain(`href="${item.url}"`);
    }
  });

  it("gebruikt tabellen en opmaak inline, want Outlook", () => {
    expect(html).toContain("<table");
    expect(html).toContain("style=");
    expect(html).not.toContain("<style");
    expect(html).not.toContain("display:flex");
    expect(html).not.toContain("class=");
  });

  it("geeft het logo een breedte en een alt-tekst", () => {
    const metAdres = maakHandtekening(metDomein(STANDAARD_HANDTEKENING, "https://mijn.skoolworkshop.nl"));
    expect(metAdres).toMatch(
      /<img src="https:\/\/mijn\.skoolworkshop\.nl\/brand\/skool-workshop-logo\.png" width="180" alt="Skool Workshop"/,
    );
  });
});

describe("niets anders dan wat we zelf invullen", () => {
  it("laat alleen https, tel en mailto door", () => {
    expect(veiligeUrl("https://skoolworkshop.nl/")).toBe("https://skoolworkshop.nl/");
    expect(veiligeUrl("tel:0850653923")).toBe("tel:0850653923");
    expect(veiligeUrl("mailto:info@skoolworkshop.nl")).toBe("mailto:info@skoolworkshop.nl");
  });

  it("weigert alles waar je naar van wordt", () => {
    expect(veiligeUrl("javascript:alert(1)")).toBeNull();
    expect(veiligeUrl("http://skoolworkshop.nl")).toBeNull();
    expect(veiligeUrl('https://ergens.nl" onmouseover="x')).toBeNull();
    expect(veiligeUrl("")).toBeNull();
  });

  it("laat een geweigerde link als gewone tekst staan", () => {
    const html = maakHandtekening({
      ...STANDAARD_HANDTEKENING,
      website: "javascript:alert(1)",
      websiteLabel: "onze site",
    });
    expect(html).not.toContain("javascript:");
    expect(html).toContain("onze site");
  });

  it("ontsnapt tekens die HTML zouden breken", () => {
    expect(veilig('Piqué & Zn <"test">')).toBe("Piqué &amp; Zn &lt;&quot;test&quot;&gt;");
  });
});

describe("de hele mail", () => {
  const html = maakMailHtml({
    tekst: "Beste Heleen,\n\nIn de bijlage vind je de indeling.\nTot dan.",
    naschrift: { tekst: "Bekijk de indeling online", url: "https://mijn.skoolworkshop.nl/indeling/abc" },
  });

  it("is een compleet HTML-document", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta name="viewport"');
  });

  it("maakt van elke alinea een eigen blok en houdt regelafbrekingen heel", () => {
    expect(html).toContain("Beste Heleen,");
    expect(html).toContain("In de bijlage vind je de indeling.<br />Tot dan.");
  });

  it("zet de handtekening eronder", () => {
    expect(html).toContain("Clinten Piqué");
    expect(html).toContain("Met vriendelijke groet,");
  });

  it("zet het naschrift met de link erin", () => {
    expect(html).toContain("https://mijn.skoolworkshop.nl/indeling/abc");
    expect(html).toContain("Bekijk de indeling online");
  });

  it("laat de tekst van de medewerker geen HTML worden", () => {
    const stiekem = maakMailHtml({ tekst: "<script>alert(1)</script>" });
    expect(stiekem).not.toContain("<script>alert(1)</script>");
    expect(stiekem).toContain("&lt;script&gt;");
  });

  it("heeft dezelfde gegevens in de platte tekst", () => {
    const tekst = handtekeningTekst();
    expect(tekst).toContain("Clinten Piqué");
    expect(tekst).toContain("085-0653923");
    expect(tekst).toContain("info@skoolworkshop.nl");
    expect(tekst).toContain("Goeseelsstraat 27, Breda");
  });
});
