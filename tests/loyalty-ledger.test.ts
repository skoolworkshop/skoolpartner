import { describe, expect, it } from "vitest";

import { canRedeem, computeBalance, type LedgerEntry } from "@/lib/loyalty/balance";

const earn600Pending: LedgerEntry = { points: 600, status: "pending" };
const earn600Available: LedgerEntry = { points: 600, status: "available" };

describe("saldo vanuit de ledger", () => {
  it("punten in behandeling tellen niet mee in het beschikbare saldo", () => {
    const balance = computeBalance([earn600Pending]);
    expect(balance.pendingPoints).toBe(600);
    expect(balance.availablePoints).toBe(0);
  });

  it("na betaling worden dezelfde punten beschikbaar", () => {
    const balance = computeBalance([earn600Available]);
    expect(balance.availablePoints).toBe(600);
    expect(balance.pendingPoints).toBe(0);
  });

  it("een reservering verlaagt het beschikbare saldo direct", () => {
    const balance = computeBalance([
      earn600Available,
      { points: -500, status: "reserved" },
    ]);
    expect(balance.availablePoints).toBe(100);
    expect(balance.reservedPoints).toBe(500);
  });

  it("dezelfde punten kunnen niet twee keer worden gereserveerd", () => {
    const balance = computeBalance([
      earn600Available,
      { points: -500, status: "reserved" },
    ]);
    expect(canRedeem(balance, 500, { minimum: 100, maximum: 0 }).ok).toBe(false);
  });

  it("een ingewisselde reservering blijft het saldo verlagen", () => {
    const balance = computeBalance([
      earn600Available,
      { points: -500, status: "redeemed" },
    ]);
    expect(balance.availablePoints).toBe(100);
    expect(balance.redeemedPoints).toBe(500);
  });

  it("verlopen punten verlagen het saldo en blijven zichtbaar", () => {
    const balance = computeBalance([
      earn600Available,
      { points: -600, status: "expired" },
    ]);
    expect(balance.availablePoints).toBe(0);
    expect(balance.expiredPoints).toBe(600);
    expect(balance.lifetimeEarnedPoints).toBe(600);
  });

  it("teruggedraaide regels tellen nergens in mee", () => {
    const balance = computeBalance([
      { points: 600, status: "reversed" },
      { points: -600, status: "reversed" },
      { points: 150, status: "available" },
    ]);
    expect(balance.availablePoints).toBe(150);
    expect(balance.lifetimeEarnedPoints).toBe(150);
  });

  it("een geannuleerd verzoek geeft de punten weer vrij", () => {
    const balance = computeBalance([
      earn600Available,
      { points: -500, status: "cancelled" },
    ]);
    expect(balance.availablePoints).toBe(600);
    expect(balance.reservedPoints).toBe(0);
  });

  it("dubbele verwerking van dezelfde boeking mag niet dubbel tellen", () => {
    // De database dwingt dit af met een unieke index op
    // (organization_id, type, external_reference). Hier controleren we dat de
    // rekenregel zelf geen tweede regel wegpoetst als die er tóch zou staan.
    const single = computeBalance([earn600Available]);
    const doubled = computeBalance([earn600Available, earn600Available]);
    expect(single.availablePoints).toBe(600);
    expect(doubled.availablePoints).toBe(1200);
  });
});

describe("inwisselen", () => {
  const balance = computeBalance([{ points: 1850, status: "available" }]);

  it("staat een geldig verzoek toe", () => {
    expect(canRedeem(balance, 1000, { minimum: 500, maximum: 0 }).ok).toBe(true);
  });

  it("weigert onder het minimum", () => {
    const result = canRedeem(balance, 100, { minimum: 500, maximum: 0 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Minimaal");
  });

  it("weigert boven het maximum per boeking", () => {
    const result = canRedeem(balance, 1500, { minimum: 500, maximum: 1000 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Maximaal");
  });

  it("weigert bij onvoldoende saldo", () => {
    const result = canRedeem(balance, 2000, { minimum: 500, maximum: 0 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Onvoldoende saldo");
  });

  it("weigert nul, negatieve en gebroken aantallen", () => {
    expect(canRedeem(balance, 0, { minimum: 500, maximum: 0 }).ok).toBe(false);
    expect(canRedeem(balance, -500, { minimum: 500, maximum: 0 }).ok).toBe(false);
    expect(canRedeem(balance, 500.5, { minimum: 500, maximum: 0 }).ok).toBe(false);
  });
});
