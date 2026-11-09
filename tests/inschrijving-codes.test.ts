import { describe, expect, it } from "vitest";

import { CODE_ALFABET, isCode, leesCode, maakCode, toonCode } from "@/lib/inschrijving/codes";

describe("codes maken", () => {
  it("gebruikt geen tekens die verkeerd worden overgeschreven", () => {
    expect(CODE_ALFABET).not.toMatch(/[ILOU]/);
  });

  it("maakt codes van de gevraagde lengte die de database accepteert", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = maakCode();
      expect(code).toHaveLength(8);
      expect(isCode(code)).toBe(true);
    }
  });

  it("maakt niet twee keer dezelfde code", () => {
    const gezien = new Set<string>();
    for (let i = 0; i < 2000; i += 1) gezien.add(maakCode());
    expect(gezien.size).toBe(2000);
  });
});

describe("codes inlezen", () => {
  it("accepteert kleine letters, spaties en streepjes", () => {
    expect(leesCode("a3f9-k2m7")).toBe("A3F9K2M7");
    expect(leesCode(" A3F9 K2M7 ")).toBe("A3F9K2M7");
  });

  it("zet de klassieke leesfouten recht", () => {
    expect(leesCode("O123")).toBe("0123");
    expect(leesCode("IL23")).toBe("1123");
    expect(leesCode("U23")).toBe("V23");
  });

  it("laat een goede code met rust", () => {
    const code = "A3F9K2M7";
    expect(leesCode(code)).toBe(code);
  });

  it("zet er een streepje in om voor te lezen", () => {
    expect(toonCode("A3F9K2M7")).toBe("A3F9-K2M7");
  });
});
