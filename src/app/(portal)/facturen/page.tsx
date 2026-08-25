import type { Metadata } from "next";
import { Download, FileText } from "lucide-react";

import { PageHeader } from "@/components/portal/page-header";
import { InvoiceStatusBadge } from "@/components/portal/status-badges";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { requireMember } from "@/lib/auth/session";
import { formatEuroCents, formatShortDate } from "@/lib/format";
import { getInvoices } from "@/lib/portal/queries";

export const metadata: Metadata = { title: "Facturen" };

export default async function InvoicesPage() {
  const session = await requireMember();
  const invoices = await getInvoices(session.activeOrganizationId);

  return (
    <>
      <PageHeader
        eyebrow="Administratie"
        title="Facturen"
        description="Alle facturen van uw organisatie. U ziet uitsluitend facturen van de organisatie waarvoor u geautoriseerd bent."
      />

      <Card>
        {invoices.length > 0 ? (
          <ul className="divide-y divide-line-soft">
            {invoices.map((invoice) => (
              <li
                key={invoice.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-display text-[17px]">
                    Factuur {invoice.invoice_number ?? "(concept)"}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {formatShortDate(invoice.invoice_date)}
                    {invoice.due_date ? ` · vervalt ${formatShortDate(invoice.due_date)}` : ""}
                    {invoice.reference ? ` · ${invoice.reference}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  <span className="font-display text-lg">
                    {formatEuroCents(invoice.total_incl_cents)}
                  </span>
                  <InvoiceStatusBadge state={invoice.state} />
                  <a
                    href={`/facturen/${invoice.id}/pdf`}
                    className="inline-flex items-center gap-1.5 rounded-pill border border-line px-3 py-1.5 text-sm font-semibold hover:bg-surface-2"
                  >
                    <Download aria-hidden className="size-4" />
                    <span className="hidden sm:inline">Bekijken</span>
                    <span className="sr-only">
                      Factuur {invoice.invoice_number ?? ""} openen als pdf
                    </span>
                  </a>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={FileText}
            title="Nog geen facturen"
            description="Zodra Skool Workshop een factuur verstuurt, verschijnt die hier automatisch."
          />
        )}
      </Card>
    </>
  );
}
