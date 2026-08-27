import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { InvoiceStatusBadge } from "@/components/portal/status-badges";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { requireAdmin } from "@/lib/auth/session";
import { listInvoices } from "@/lib/admin/queries";
import { formatEuroCents, formatShortDate } from "@/lib/format";
import type { InvoiceState } from "@/lib/types/database";
import { serverEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Facturen" };

interface InvoiceWithOrg {
  id: string;
  moneybird_invoice_id: string;
  organization_id: string | null;
  invoice_number: string | null;
  reference: string | null;
  invoice_date: string | null;
  due_date: string | null;
  state: InvoiceState;
  total_incl_cents: number;
  total_unpaid_cents: number;
  fully_paid: boolean;
  needs_review: boolean;
  organizations: { name: string } | null;
}

const filters = [
  { key: "all", label: "Alles", href: "/admin/facturen" },
  { key: "unpaid", label: "Openstaand", href: "/admin/facturen?filter=unpaid" },
  { key: "review", label: "Controle nodig", href: "/admin/facturen?filter=review" },
] as const;

export default async function AdminInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>;
}) {
  await requireAdmin();
  const { filter, q } = await searchParams;
  const active = filter === "review" || filter === "unpaid" ? filter : "all";

  const rows = (await listInvoices({ filter: active, query: q })) as unknown as InvoiceWithOrg[];
  const administrationId = serverEnv.moneybird.administrationId;
  const totaalOpen = rows.reduce((sum, row) => sum + (row.fully_paid ? 0 : row.total_unpaid_cents), 0);

  return (
    <>
      <h1 className="mb-6 text-[30px]">Facturen</h1>

      <Card>
        <CardHeader
          title="Facturen van alle organisaties"
          description={`${rows.length} facturen · ${formatEuroCents(totaalOpen)} openstaand in deze selectie`}
          action={
            <div className="flex gap-3 text-sm">
              {filters.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className={
                    active === item.key ? "font-semibold underline underline-offset-4" : "text-muted"
                  }
                >
                  {item.label}
                </Link>
              ))}
            </div>
          }
        />

        <form className="border-b border-line-soft px-5 py-3">
          {active !== "all" ? <input type="hidden" name="filter" value={active} /> : null}
          <Input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Zoek op factuurnummer"
            aria-label="Zoek op factuurnummer"
          />
        </form>

        <div className="overflow-x-auto">
          <table className="w-full min-w-3xl text-left text-sm">
            <thead className="border-b border-line-soft text-muted">
              <tr>
                <th scope="col" className="px-5 py-2.5 font-semibold">Datum</th>
                <th scope="col" className="px-5 py-2.5 font-semibold">Nummer</th>
                <th scope="col" className="px-5 py-2.5 font-semibold">Organisatie</th>
                <th scope="col" className="px-5 py-2.5 font-semibold">Referentie</th>
                <th scope="col" className="px-5 py-2.5 font-semibold">Bedrag</th>
                <th scope="col" className="px-5 py-2.5 font-semibold">Openstaand</th>
                <th scope="col" className="px-5 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {rows.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="px-5 py-2.5 whitespace-nowrap">
                    {formatShortDate(invoice.invoice_date)}
                  </td>
                  <td className="px-5 py-2.5 whitespace-nowrap font-semibold">
                    {administrationId ? (
                      <a
                        href={`https://moneybird.com/${encodeURIComponent(administrationId)}/sales_invoices/${encodeURIComponent(invoice.moneybird_invoice_id)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-4"
                        title="Open deze factuur rechtstreeks in Moneybird"
                      >
                        {invoice.invoice_number ?? "Open in Moneybird"}
                      </a>
                    ) : invoice.invoice_number ?? "—"}
                  </td>
                  <td className="px-5 py-2.5">
                    {invoice.organization_id ? (
                      <Link
                        href={`/admin/organisaties/${invoice.organization_id}`}
                        className="underline underline-offset-4"
                      >
                        {invoice.organizations?.name ?? "Onbekend"}
                      </Link>
                    ) : (
                      <span className="text-muted">Nog niet gekoppeld</span>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-muted">{invoice.reference ?? "—"}</td>
                  <td className="px-5 py-2.5 whitespace-nowrap">
                    {formatEuroCents(invoice.total_incl_cents)}
                  </td>
                  <td className="px-5 py-2.5 whitespace-nowrap">
                    {invoice.fully_paid ? (
                      <span className="text-muted">—</span>
                    ) : (
                      formatEuroCents(invoice.total_unpaid_cents)
                    )}
                  </td>
                  <td className="px-5 py-2.5">
                    <span className="flex gap-1">
                      <InvoiceStatusBadge state={invoice.state} />
                      {invoice.needs_review ? <Badge tone="warning">Controle</Badge> : null}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-muted">
                    Geen facturen gevonden.
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
