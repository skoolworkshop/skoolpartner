import { describe, expect, it } from "vitest";

import { koppelfout, KOPPELFOUT_CODES } from "@/lib/integrations/gmail/koppelfouten";

describe("uitleg bij een mislukte Gmail-koppeling", () => {
  it("geeft bij elke code een titel, uitleg en stappen", () => {
    for (const code of KOPPELFOUT_CODES) {
      const fout = koppelfout(code);
      expect(fout.titel.length, code).toBeGreaterThan(5);
      expect(fout.uitleg.length, code).toBeGreaterThan(20);
      expect(fout.stappen.length, code).toBeGreaterThan(0);
    }
  });

  it("valt terug op een algemene tekst bij een onbekende code", () => {
    expect(koppelfout("iets-nieuws").titel).toBe("Koppelen is niet gelukt");
    expect(koppelfout(null).titel).toBe("Koppelen is niet gelukt");
    expect(koppelfout("").titel).toBe("Koppelen is niet gelukt");
  });

  it("noemt bij een rechtenfout de service role key als oorzaak", () => {
    const fout = koppelfout("database-rechten");
    expect(`${fout.uitleg} ${fout.stappen.join(" ")}`).toContain("service_role");
  });

  it("legt bij een ongeldige sleutel uit hoe je een goede maakt", () => {
    expect(koppelfout("sleutel-ongeldig").stappen.join(" ")).toContain("openssl rand -base64 32");
  });

  /**
   * De uitleg belandt in de browser van de beheerder. Er mag dus nooit een
   * echte waarde in staan, alleen de naam van een instelling.
   */
  it("bevat nergens iets dat op een secret lijkt", () => {
    for (const code of KOPPELFOUT_CODES) {
      const fout = koppelfout(code);
      const alles = `${fout.titel} ${fout.uitleg} ${fout.stappen.join(" ")}`;
      expect(alles, code).not.toMatch(/[A-Za-z0-9_-]{40,}/);
      expect(alles.toLowerCase(), code).not.toContain("bearer ");
    }
  });
});
