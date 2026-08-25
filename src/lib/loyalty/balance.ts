import type { LoyaltyTransactionStatus } from "@/lib/types/database";

/**
 * Berekent saldi vanuit de ledger.
 *
 * Dit is dezelfde logica als de databaseview loyalty_balances, hier in
 * TypeScript zodat hij testbaar is en gebruikt kan worden om een berekening te
 * controleren zonder een extra query.
 *
 * Regels:
 *   beschikbaar = som van punten met status available, reserved, redeemed of expired
 *   in behandeling = som van punten met status pending
 *   gereserveerd = som van (negatieve) punten met status reserved, als positief getal
 *   reversed en cancelled tellen nergens in mee
 */

const COUNTS_TOWARD_AVAILABLE: LoyaltyTransactionStatus[] = [
  "available",
  "reserved",
  "redeemed",
  "expired",
];

export interface LedgerEntry {
  points: number;
  status: LoyaltyTransactionStatus;
}

export interface LedgerBalance {
  availablePoints: number;
  pendingPoints: number;
  reservedPoints: number;
  redeemedPoints: number;
  expiredPoints: number;
  lifetimeEarnedPoints: number;
}

export function computeBalance(entries: LedgerEntry[]): LedgerBalance {
  const active = entries.filter(
    (entry) => entry.status !== "reversed" && entry.status !== "cancelled"
  );

  const sumWhere = (predicate: (entry: LedgerEntry) => boolean) =>
    active.filter(predicate).reduce((total, entry) => total + entry.points, 0);

  // Voorkomt -0 als uitkomst, dat leest verwarrend in de interface.
  const negate = (value: number) => (value === 0 ? 0 : -value);

  return {
    availablePoints: sumWhere((entry) => COUNTS_TOWARD_AVAILABLE.includes(entry.status)),
    pendingPoints: sumWhere((entry) => entry.status === "pending"),
    reservedPoints: negate(sumWhere((entry) => entry.status === "reserved")),
    redeemedPoints: negate(sumWhere((entry) => entry.status === "redeemed")),
    expiredPoints: negate(sumWhere((entry) => entry.status === "expired")),
    lifetimeEarnedPoints: sumWhere(
      (entry) => entry.points > 0 && COUNTS_TOWARD_AVAILABLE.includes(entry.status)
    ),
  };
}

/** Kan dit aantal punten nu worden ingewisseld? */
export function canRedeem(
  balance: LedgerBalance,
  points: number,
  options: { minimum: number; maximum: number }
): { ok: boolean; reason?: string } {
  if (!Number.isInteger(points) || points <= 0) {
    return { ok: false, reason: "Vul een geldig aantal punten in." };
  }
  if (points < options.minimum) {
    return { ok: false, reason: `Minimaal ${options.minimum} punten per verzoek.` };
  }
  if (options.maximum > 0 && points > options.maximum) {
    return { ok: false, reason: `Maximaal ${options.maximum} punten per boeking.` };
  }
  if (points > balance.availablePoints) {
    return { ok: false, reason: `Onvoldoende saldo: ${balance.availablePoints} beschikbaar.` };
  }
  return { ok: true };
}
