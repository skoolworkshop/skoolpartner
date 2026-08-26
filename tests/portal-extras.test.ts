import { describe, expect, it } from "vitest";

import { buildHighlight, daysUntil, greetingForTime } from "@/lib/greeting";
import { findWorkshopImage, parseWorkshopImages } from "@/lib/workshop-images";

const NU = new Date("2026-03-10T09:00:00.000Z");

function dagen(aantal: number): string {
  return new Date(NU.getTime() + aantal * 86_400_000).toISOString();
}

describe("begroeting", () => {
  it("kiest het juiste dagdeel op Nederlandse tijd", () => {
    // 07:00 UTC is 08:00 in Nederland in de winter.
    expect(greetingForTime(new Date("2026-01-15T07:00:00.000Z"))).toBe("Goedemorgen");
    expect(greetingForTime(new Date("2026-01-15T13:00:00.000Z"))).toBe("Goedemiddag");
    expect(greetingForTime(new Date("2026-01-15T20:00:00.000Z"))).toBe("Goedenavond");
  });

  it("rekent dagen tot een datum goed uit", () => {
    expect(daysUntil("2026-03-10", NU)).toBe(0);
    expect(daysUntil("2026-03-12", NU)).toBe(2);
    expect(daysUntil(null, NU)).toBeNull();
  });
});

describe("moment van de dag", () => {
  const basis = {
    availablePoints: 0,
    pendingPoints: 0,
    pointsName: "SkoolPoints",
    loyaltyEnabled: true,
    now: NU,
  };

  it("zet klaarstaande resultaten bovenaan", () => {
    const highlight = buildHighlight({
      ...basis,
      newResultTitle: "Cultuurdag 14 maart",
      newResultExpiresAt: dagen(5),
      nextBookingName: "Breakdance",
      nextBookingDate: "2026-03-12",
    });
    expect(highlight?.title).toContain("Cultuurdag 14 maart");
    expect(highlight?.href).toBe("/resultaten");
    expect(highlight?.description).toContain("5 dagen");
  });

  it("negeert resultaten die al verlopen zijn", () => {
    const highlight = buildHighlight({
      ...basis,
      newResultTitle: "Oude set",
      newResultExpiresAt: dagen(-1),
      nextBookingName: "Breakdance",
      nextBookingDate: "2026-03-12",
    });
    expect(highlight?.title).toContain("Breakdance");
  });

  it("meldt een workshop pas binnen tien dagen", () => {
    expect(
      buildHighlight({ ...basis, nextBookingName: "Rap", nextBookingDate: "2026-04-30" })
    ).toBeNull();
    expect(
      buildHighlight({ ...basis, nextBookingName: "Rap", nextBookingDate: "2026-03-11" })?.title
    ).toContain("morgen");
  });

  it("meldt punten in behandeling als er verder niets speelt", () => {
    const highlight = buildHighlight({ ...basis, pendingPoints: 300 });
    expect(highlight?.tone).toBe("rustig");
    expect(highlight?.title).toContain("300");
  });

  it("verzint niets als er niets te melden is", () => {
    expect(buildHighlight(basis)).toBeNull();
  });

  it("zwijgt over punten als het programma uitstaat", () => {
    expect(buildHighlight({ ...basis, loyaltyEnabled: false, pendingPoints: 300 })).toBeNull();
  });
});

describe("workshopfoto's", () => {
  const map = {
    graffiti: "https://skoolworkshop.nl/wp-content/uploads/graffiti.jpg",
    "light graffiti": "https://skoolworkshop.nl/wp-content/uploads/light.jpg",
    podcast: "https://skoolworkshop.nl/wp-content/uploads/podcast.jpg",
  };

  it("kiest de langste passende sleutel", () => {
    expect(findWorkshopImage("Workshop Light Graffiti", map)).toContain("light.jpg");
    expect(findWorkshopImage("Graffiti", map)).toContain("graffiti.jpg");
  });

  it("kijkt niet naar hoofdletters en leestekens", () => {
    expect(findWorkshopImage("PODCAST maken!", map)).toContain("podcast.jpg");
  });

  it("geeft niets terug als er geen foto bij hoort", () => {
    expect(findWorkshopImage("Spoken word", map)).toBeNull();
    expect(findWorkshopImage(null, map)).toBeNull();
  });

  it("weigert waarden die geen https-adres zijn", () => {
    const parsed = parseWorkshopImages({
      goed: "https://skoolworkshop.nl/foto.jpg",
      onveilig: "http://voorbeeld.nl/foto.jpg",
      onzin: 42,
    });
    expect(Object.keys(parsed)).toEqual(["goed"]);
  });
});
