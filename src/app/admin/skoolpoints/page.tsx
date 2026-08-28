import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/admin/action-form";
import { LoyaltyStatusBadge, loyaltyTypeLabel } from "@/components/portal/status-badges";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { requireAdmin } from "@/lib/auth/session";
import { listLoyaltyTransactions } from "@/lib/admin/queries";
import { formatEuroCents, formatPoints, formatShortDate } from "@/lib/format";
import { computeBalance } from "@/lib/loyalty/balance";
import { pointsToCents } from "@/lib/loyalty/calc";
import { reverseTransactionAction } from "../actions";
import type { LoyaltyTransactionRow } from "@/lib/types/database";

export const metadata: Metadata = { title: "SkoolPoints" };

type Row = LoyaltyTransactionRow & {
  organizations: { name: string } | null;
  profiles: { email: string; full_name: string | null } | null;
};

export default async function AdminLoyaltyPage() {
  await requireAdmin();
  const transactions = (await listLoyaltyTransactions()) as unknown as Row[];
  // Totalen worden hier opnieuw vanuit de ledger berekend, met dezelfde regels
  // als de databaseview. Zo is direct zichtbaar of beide bronnen overeenkomen.
  const totals = computeBalance(
    transactions.map((transaction) => ({
      points: transaction.points,
      status: transaction.status,
    }))
  );

  return (
    <>
      <h1 className="mb-2 text-[30px]">SkoolPoints</h1>
      <p className="mb-6 max-w-3xl text-[15px] text-muted">
        De volledige ledger. Saldi worden altijd hieruit berekend, nooit uit een los veld.
        Terugdraaien laat de oorspronkelijke regel staan en voegt een tegenboeking toe.
      </p>

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Beschikbaar", value: totals.availablePoints },
          { label: "In behandeling", value: totals.pendingPoints },
          { label: "Gereserveerd", value: totals.reservedPoints },
          { label: "Verlopen", value: totals.expiredPoints },
        ].map((tile) => (
          <Card key={tile.label}>
            <div className="px-5 py-4">
              <p className="text-sm text-muted">{tile.label}</p>
              <p className="mt-1 font-display text-2xl">{formatPoints(tile.value)}</p>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title={`${transactions.length} transacties`} />
        <ul className="divide-y divide-line-soft xl:hidden">
          {transactions.map((transaction) => (
            <li key={transaction.id} className="space-y-3 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words font-semibold">{transaction.description}</p>
                  <Link
                    href={`/admin/organisaties/${transaction.organization_id}`}
                    className="block break-words text-sm text-muted underline underline-offset-4"
                  >
                    {transaction.organizations?.name ?? "—"}
                  </Link>
                  <p className="break-all text-sm text-muted">
                    {transaction.profiles?.full_name ?? transaction.profiles?.email ?? "Historische eigenaar"}
                  </p>
                </div>
                <p className="shrink-0 text-right font-semibold">
                  {transaction.points > 0 ? "+" : "−"}{formatPoints(Math.abs(transaction.points))}
                  <span className="block text-xs font-normal text-muted">
                    {formatEuroCents(pointsToCents(Math.abs(transaction.points), transaction.point_value_cents_per_100))}
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted">{formatShortDate(transaction.occurred_at)}</span>
                <span className="text-muted">{loyaltyTypeLabel(transaction.type)}</span>
                <LoyaltyStatusBadge status={transaction.status} />
              </div>
              {transaction.reason ? <p className="break-words text-sm text-muted">Reden: {transaction.reason}</p> : null}
              {transaction.status === "reversed" || transaction.type === "reversal" ? null : (
                <ActionForm action={reverseTransactionAction} submitLabel="Terugdraaien" variant="secondary">
                  <input type="hidden" name="transaction_id" value={transaction.id} />
                  <Field label="Reden voor terugdraaien" htmlFor={`mobile-reason-${transaction.id}`}>
                    <Input id={`mobile-reason-${transaction.id}`} name="reason" required minLength={3} placeholder="Leg kort vast waarom" />
                  </Field>
                </ActionForm>
              )}
            </li>
          ))}
          {transactions.length === 0 ? <li className="px-4 py-8 text-center text-muted">Nog geen transacties.</li> : null}
        </ul>

        <div className="hidden xl:block">
          <table className="w-full min-w-4xl text-left text-sm">
            <thead className="border-b border-line-soft text-muted">
              <tr>
                <th scope="col" className="px-5 py-2.5 font-semibold">Datum</th>
                <th scope="col" className="px-5 py-2.5 font-semibold">Organisatie</th>
                <th scope="col" className="px-5 py-2.5 font-semibold">Gebruiker</th>
                <th scope="col" className="px-5 py-2.5 font-semibold">Omschrijving</th>
                <th scope="col" className="px-5 py-2.5 font-semibold">Type</th>
                <th scope="col" className="px-5 py-2.5 text-right font-semibold">Punten</th>
                <th scope="col" className="px-5 py-2.5 text-right font-semibold">Waarde</th>
                <th scope="col" className="px-5 py-2.5 font-semibold">Status</th>
                <th scope="col" className="px-5 py-2.5 font-semibold">Actie</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td className="px-5 py-2.5 whitespace-nowrap">
                    {formatShortDate(transaction.occurred_at)}
                  </td>
                  <td className="px-5 py-2.5">
                    <span className="block">{transaction.profiles?.full_name ?? "—"}</span>
                    <span className="block text-xs text-muted">{transaction.profiles?.email}</span>
                  </td>
                  <td className="px-5 py-2.5">
                    <Link
                      href={`/admin/organisaties/${transaction.organization_id}`}
                      className="underline underline-offset-4"
                    >
                      {transaction.organizations?.name ?? "—"}
                    </Link>
                  </td>
                  <td className="px-5 py-2.5">
                    {transaction.description}
                    {transaction.reason ? (
                      <span className="block text-xs text-muted">Reden: {transaction.reason}</span>
                    ) : null}
                  </td>
                  <td className="px-5 py-2.5 text-muted">
                    {loyaltyTypeLabel(transaction.type)}
                  </td>
                  <td className="px-5 py-2.5 text-right font-medium">
                    {transaction.points > 0 ? "+" : "−"}
                    {formatPoints(Math.abs(transaction.points))}
                  </td>
                  <td className="px-5 py-2.5 text-right text-muted">
                    {formatEuroCents(
                      pointsToCents(
                        Math.abs(transaction.points),
                        transaction.point_value_cents_per_100
                      )
                    )}
                  </td>
                  <td className="px-5 py-2.5">
                    <LoyaltyStatusBadge status={transaction.status} />
                  </td>
                  <td className="px-5 py-2.5">
                    {transaction.status === "reversed" || transaction.type === "reversal" ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <ActionForm
                        action={reverseTransactionAction}
                        submitLabel="Terugdraaien"
                        variant="secondary"
                        inline
                      >
                        <input type="hidden" name="transaction_id" value={transaction.id} />
                        <Field
                          label="Reden voor terugdraaien"
                          htmlFor={`reason-${transaction.id}`}
                          className="w-48"
                        >
                          <Input
                            id={`reason-${transaction.id}`}
                            name="reason"
                            required
                            minLength={3}
                            placeholder="Leg vast waarom deze boeking wordt teruggedraaid"
                          />
                        </Field>
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-muted">
                    Nog geen transacties.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
