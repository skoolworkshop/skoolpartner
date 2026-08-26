import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardBody } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { requireAdmin } from "@/lib/auth/session";
import { hasServiceRole } from "@/lib/env";
import { getAdminOverview } from "@/lib/admin/queries";
import { formatEuroCents } from "@/lib/format";

export const metadata: Metadata = { title: "Beheer" };

function Tile({
  label,
  value,
  href,
  urgent,
}: {
  label: string;
  value: number | string;
  href: string;
  urgent?: boolean;
}) {
  const opvallend = urgent && typeof value === "number" && value > 0;

  return (
    <Link href={href} className="block">
      <Card className="h-full transition-colors hover:border-ink">
        <CardBody>
          <p className="text-sm text-muted">{label}</p>
          <p className={`mt-1 font-display text-3xl ${opvallend ? "text-accent-strong" : ""}`}>
            {value}
          </p>
        </CardBody>
      </Card>
    </Link>
  );
}

export default async function AdminHome() {
  await requireAdmin();

  if (!hasServiceRole()) {
    return (
      <Alert tone="warning" title="SUPABASE_SERVICE_ROLE_KEY ontbreekt">
        Zonder deze sleutel kan de beheeromgeving geen gegevens ophalen. Voeg hem toe aan je
        environment variables (zie README) en herstart de applicatie.
      </Alert>
    );
  }

  const overview = await getAdminOverview();

  return (
    <>
      <h1 className="mb-6 text-[30px]">Overzicht</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Controle nodig"
          value={overview.reviewQueue}
          href="/admin/controle"
          urgent
        />
        <Tile
          label="Nieuwe gebruikers"
          value={overview.pendingMembers}
          href="/admin/gebruikers"
          urgent
        />
        <Tile
          label="Open inwisselverzoeken"
          value={overview.openRedemptions}
          href="/admin/inwisselen"
          urgent
        />
        <Tile
          label="Boekingen met vraagteken"
          value={overview.bookingsNeedingReview}
          href="/admin/boekingen?filter=review"
          urgent
        />
        <Tile
          label="Facturen zonder koppeling"
          value={overview.invoicesNeedingReview}
          href="/admin/facturen?filter=review"
          urgent
        />
        <Tile
          label="Gesprekken die controle nodig hebben"
          value={overview.threadsNeedingReview}
          href="/admin/berichten?filter=review"
          urgent
        />
      </div>

      <h2 className="mb-4 mt-8 text-[22px]">Alle klanten</h2>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Organisaties" value={overview.organizations} href="/admin/organisaties" />
        <Tile label="Gebruikers" value={overview.users} href="/admin/gebruikers" />
        <Tile label="Boekingen" value={overview.bookings} href="/admin/boekingen" />
        <Tile label="Facturen" value={overview.invoices} href="/admin/facturen" />
        <Tile
          label="Openstaand bedrag"
          value={formatEuroCents(overview.unpaidCents)}
          href="/admin/facturen?filter=unpaid"
        />
      </div>
    </>
  );
}
