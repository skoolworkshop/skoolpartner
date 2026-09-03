import { describe, expect, it } from "vitest";

import { blokkadeVoorSequenceStart, momentVanStap } from "@/lib/crm/sequences";

describe("momentVanStap", () => {
  const stappen = [
    { position: 20, waitDays: 3 },
    { position: 10, waitDays: 0 },
    { position: 30, waitDays: 2 },
  ];

  it("telt wachttijden op in de ingestelde volgorde", () => {
    const start = "2026-09-03T09:00:00.000Z";
    expect(momentVanStap(start, stappen, 1)).toBe("2026-09-03T09:00:00.000Z");
    expect(momentVanStap(start, stappen, 2)).toBe("2026-09-06T09:00:00.000Z");
    expect(momentVanStap(start, stappen, 3)).toBe("2026-09-08T09:00:00.000Z");
  });

  it("geeft niets terug buiten de reeks", () => {
    expect(momentVanStap("2026-09-03T09:00:00.000Z", stappen, 0)).toBeNull();
    expect(momentVanStap("2026-09-03T09:00:00.000Z", stappen, 4)).toBeNull();
  });
});

describe("blokkadeVoorSequenceStart", () => {
  it("laat alleen een geldig, niet afgemeld contact starten", () => {
    expect(
      blokkadeVoorSequenceStart({
        full_name: "Nora Bakker",
        email: "nora@voorbeeld.nl",
        is_unsubscribed: false,
      })
    ).toBeNull();
  });

  it("weigert een afgemeld contact", () => {
    expect(
      blokkadeVoorSequenceStart({
        full_name: "Nora Bakker",
        email: "nora@voorbeeld.nl",
        is_unsubscribed: true,
      })
    ).toContain("afgemeld");
  });

  it.each([null, "nora@voorbeeld", "nora voorbeeld.nl", "nora@@voorbeeld.nl"])(
    "weigert een ongeldig e-mailadres: %s",
    (email) => {
      expect(
        blokkadeVoorSequenceStart({
          full_name: "Nora Bakker",
          email,
          is_unsubscribed: false,
        })
      ).toContain("geldig e-mailadres");
    }
  );
});
