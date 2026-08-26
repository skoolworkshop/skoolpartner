import { describe, expect, it } from "vitest";

import { formatPhone, isProfileComplete, normalizePhone } from "@/lib/phone";

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

describe("account compleet", () => {
  it("is pas compleet met naam én telefoonnummer", () => {
    expect(isProfileComplete({ full_name: "Sanne de Vries", phone: "+31612345678" })).toBe(true);
    expect(isProfileComplete({ full_name: "Sanne de Vries", phone: null })).toBe(false);
    expect(isProfileComplete({ full_name: "Sanne de Vries", phone: "  " })).toBe(false);
    expect(isProfileComplete({ full_name: null, phone: "+31612345678" })).toBe(false);
    expect(isProfileComplete(null)).toBe(false);
  });
});
