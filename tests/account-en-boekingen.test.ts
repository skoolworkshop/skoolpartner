import { describe, expect, it } from "vitest";

import { checkProfile, isProfileComplete, isValidEmail, missingLabel } from "@/lib/account";
import { formatPhone, normalizePhone } from "@/lib/phone";

describe("telefoonnummer", () => {
  it("maakt van een Nederlands mobiel nummer een internationaal nummer", () => {
    expect(normalizePhone("06 12345678").value).toBe("+31612345678");
    expect(normalizePhone("06-12345678").value).toBe("+31612345678");
    expect(normalizePhone("0612345678").value).toBe("+31612345678");
  });

  it("werkt ook met een vast nummer", () => {
    expect(normalizePhone("085 065 39 23").value).toBe("+31850653923");
  });

  it("accepteert een buitenlands nummer met landcode", () => {
    expect(normalizePhone("+32 470 12 34 56").value).toBe("+32470123456");
    expect(normalizePhone("0032470123456").value).toBe("+32470123456");
  });

  it("weigert een leeg of onvolledig nummer", () => {
    expect(normalizePhone("").ok).toBe(false);
    expect(normalizePhone("   ").ok).toBe(false);
    expect(normalizePhone("0612").ok).toBe(false);
    expect(normalizePhone("06 1234567").ok).toBe(false);
  });

  it("weigert een onmogelijk lang nummer", () => {
    expect(normalizePhone("+3161234567890123456").ok).toBe(false);
  });

  it("toont een opgeslagen nummer leesbaar", () => {
    expect(formatPhone("+31612345678")).toBe("+31 6 12 34 56 78");
    expect(formatPhone("+31850653923")).toBe("+31 85 065 39 23");
    expect(formatPhone(null)).toBe("");
  });
});

describe("e-mailadres", () => {
  it("herkent een geldig adres", () => {
    expect(isValidEmail("planning@skoolworkshop.nl")).toBe(true);
    expect(isValidEmail("s.de.vries+portaal@goudsewaarden.nl")).toBe(true);
  });

  it("weigert wat geen adres is", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail("planning@skoolworkshop")).toBe(false);
    expect(isValidEmail("planning skoolworkshop.nl")).toBe(false);
    expect(isValidEmail("twee@apen@staarten.nl")).toBe(false);
  });
});

describe("account compleet", () => {
  const compleet = {
    full_name: "Sanne de Vries",
    phone: "+31612345678",
    email: "s.devries@goudsewaarden.nl",
  };

  it("is pas compleet met naam, e-mailadres én telefoonnummer", () => {
    expect(isProfileComplete(compleet)).toBe(true);
    expect(isProfileComplete({ ...compleet, phone: null })).toBe(false);
    expect(isProfileComplete({ ...compleet, phone: "  " })).toBe(false);
    expect(isProfileComplete({ ...compleet, email: null })).toBe(false);
    expect(isProfileComplete({ ...compleet, email: "geen adres" })).toBe(false);
    expect(isProfileComplete({ ...compleet, full_name: null })).toBe(false);
    expect(isProfileComplete(null)).toBe(false);
  });

  it("vertelt precies wat er ontbreekt", () => {
    expect(checkProfile({ ...compleet, phone: null }).missing).toEqual(["telefoonnummer"]);
    expect(checkProfile({ ...compleet, email: null, phone: null }).missing).toEqual([
      "e-mailadres",
      "telefoonnummer",
    ]);
  });

  it("schrijft dat leesbaar op", () => {
    expect(missingLabel(["telefoonnummer"])).toBe("uw telefoonnummer");
    expect(missingLabel(["e-mailadres", "telefoonnummer"])).toBe(
      "uw e-mailadres en uw telefoonnummer"
    );
  });
});
