import { describe, expect, it } from "vitest";

import {
  DEFAULT_RATES,
  calculateBookingPoints,
  centsToPoints,
  nextMilestone,
  pointsForMinutes,
  pointsToCents,
} from "@/lib/loyalty/calc";

describe("puntenberekening", () => {
  it("90 minuten levert 150 SkoolPoints op", () => {
    expect(pointsForMinutes(90, 100)).toBe(150);
  });

  it("2 uur levert 200 SkoolPoints op", () => {
    expect(pointsForMinutes(120, 100)).toBe(200);
  });

  it("2 workshops van 90 minuten leveren 300 SkoolPoints op", () => {
    const result = calculateBookingPoints({ workshopCount: 2, minutesPerWorkshop: 90 });
    expect(result.qualifyingMinutes).toBe(180);
    expect(result.points).toBe(300);
  });

  it("4 workshops van 90 minuten leveren 600 SkoolPoints op", () => {
    const result = calculateBookingPoints({ workshopCount: 4, minutesPerWorkshop: 90 });
    expect(result.qualifyingMinutes).toBe(360);
    expect(result.qualifyingHours).toBe(6);
    expect(result.points).toBe(600);
  });

  it("8 workshops van 90 minuten leveren 1.200 SkoolPoints op", () => {
    expect(calculateBookingPoints({ workshopCount: 8, minutesPerWorkshop: 90 }).points).toBe(1200);
  });

  it("gebruikt de meegegeven instelling in plaats van een vaste waarde", () => {
    const result = calculateBookingPoints(
      { workshopCount: 4, minutesPerWorkshop: 90 },
      { ...DEFAULT_RATES, pointsPerHour: 150 }
    );
    expect(result.points).toBe(900);
  });

  it("geeft geen punten bij ongeldige invoer", () => {
    expect(pointsForMinutes(0, 100)).toBe(0);
    expect(pointsForMinutes(-90, 100)).toBe(0);
    expect(pointsForMinutes(90, 0)).toBe(0);
    expect(pointsForMinutes(Number.NaN, 100)).toBe(0);
  });

  it("waarschuwt onder de minimale afname van 90 minuten", () => {
    const result = calculateBookingPoints({ workshopCount: 1, minutesPerWorkshop: 45 });
    expect(result.warnings.some((w) => w.includes("minimale afname"))).toBe(true);
  });

  it("waarschuwt bij onwaarschijnlijk lange of talrijke workshops", () => {
    expect(
      calculateBookingPoints({ workshopCount: 1, minutesPerWorkshop: 600 }).warnings.length
    ).toBeGreaterThan(0);
    expect(
      calculateBookingPoints({ workshopCount: 25, minutesPerWorkshop: 90 }).warnings.length
    ).toBeGreaterThan(0);
  });
});

describe("waarde van SkoolPoints", () => {
  it("100 punten is € 2,50", () => {
    expect(pointsToCents(100, 250)).toBe(250);
  });

  it("volgt de voorbeelden uit de bedrijfsregels", () => {
    expect(pointsToCents(150, 250)).toBe(375);
    expect(pointsToCents(500, 250)).toBe(1250);
    expect(pointsToCents(1000, 250)).toBe(2500);
    expect(pointsToCents(1600, 250)).toBe(4000);
    expect(pointsToCents(2500, 250)).toBe(6250);
    expect(pointsToCents(5000, 250)).toBe(12500);
    expect(pointsToCents(10000, 250)).toBe(25000);
  });

  it("rondt naar beneden af zodat er nooit te veel voordeel wordt gegeven", () => {
    expect(pointsToCents(101, 250)).toBe(252);
  });

  it("rekent terug van euro naar punten", () => {
    expect(centsToPoints(1250, 250)).toBe(500);
    expect(centsToPoints(0, 250)).toBe(0);
  });

  it("werkt met een gewijzigde puntenwaarde", () => {
    expect(pointsToCents(1000, 300)).toBe(3000);
  });
});

describe("mijlpalen", () => {
  it("berekent hoeveel punten er nog nodig zijn", () => {
    const milestone = nextMilestone(1850, 500);
    expect(milestone).not.toBeNull();
    expect(milestone!.target).toBe(2000);
    expect(milestone!.remaining).toBe(150);
    expect(milestone!.progress).toBeCloseTo(0.7);
  });

  it("geeft null als mijlpalen uitstaan", () => {
    expect(nextMilestone(1000, 0)).toBeNull();
  });
});
