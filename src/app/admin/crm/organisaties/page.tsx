import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { LifecycleBadge, StilteBadge } from "@/components/admin/crm-badges";
import { MerkSchakelaar } from "@/components/admin/merk-schakelaar";
import { requireAdmin } from "@/lib/auth/session";
import { hasServiceRole } from "@/lib/env";
import { getActiefMerk } from "@/lib/crm/actief-merk";
import { filterRelaties, getRelaties, type Relatie } from "@/lib/crm/relaties";
import { LIFECYCLE_LABELS, isLifecycle, type Lifecycle } from "@/lib/crm/regels";
import { formatEuroCents } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Organisaties" };

const FILTERS: {
  key: string;
  label: string;
  lifecycle?: Lifecycle | "alles";
  stil?: number;
  deal?: boolean;
}[] = [
  { key: "alles", label: "Alles", lifecycle: "alles" },
  { key: "prospect", label: "Prospects", lifecycle: "prospect" },
  { key: "lead", label: "Leads", lifecycle: "lead" },
  { key: "klant", label: "Klanten", lifecycle: "klant" },
  { key: "stil", label: "Lang geen contact", lifecycle: "alles", stil: 90 },
  { key: "deals", label: "Met lopende deal", lifecycle: "alles", deal: true },
];

function Regel({ relatie }: { relatie: Relatie }) {
  return (
    <li>
      <Link
        href={`/admin/crm/organisaties/${relatie.id}`}
        className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-soft px-5 py-3.5 transition-colors last:border-b-0 hover:bg-surface-2"
      >
        <span className="min-w-0 flex-1 basis-full sm:basis-auto">
          <span className="block truncate font-semibold text-ink">{relatie.name}</span>
          <span className="block truncate text-sm text-muted">
            {relatie.city ?? "plaats onbekend"} · {relatie.aantalContacten}{" "}
            {relatie.aantalContacten === 1 ? "contact" : "contacten"} · {relatie.aantalBoekingen}{" "}
            {relatie.aantalBoekingen === 1 ? "boeking" : "boekingen"}
            {relatie.omzetCents > 0 ? ` · ${formatEuroCents(relatie.omzetCents)} omzet` : ""}
            {relatie.ownerNaam ? ` · ${relatie.ownerNaam}` : " · geen eigenaar"}
          </span>
        </span>
        {relatie.openDeals > 0 ? (
          <span className="inline-flex items-center rounded-pill bg-accent-wash px-2.5 py-1 text-xs font-semibold text-accent-strong whitespace-nowrap">
            {relatie.openDeals} open · {formatEuroCents(relatie.openWaardeCents)}
          </span>
        ) : null}
        <LifecycleBadge waarde={relatie.lifecycle} />
        <StilteBadge stilte={relatie.stilte} />
      </Link>
    </li>
  );
}

export default async function RelatiesPagina({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; zoek?: string }>;
}) {
  await requireAdmin();

  const merk = await getActiefMerk();

  if (!hasServiceRole()) {
    return (
      <Alert tone="warning" title="SUPABASE_SERVICE_ROLE_KEY ontbreekt">
        Zonder deze sleutel kan het CRM geen gegevens lezen.
      </Alert>
    );
  }

  if (merk === "suri_impact") {
    return (
      <>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[30px]">Organisaties</h1>
          <MerkSchakelaar actief={merk} />
        </div>
        <Card>
          <EmptyState
            title="Suri Impact werkt niet met organisaties"
            description="Het Breekjaar wordt per persoon verkocht, niet per school. Ga naar Reisperiodes om de deelnemers te zien, of zet de schakelaar op Skool Workshop."
            action={
              <Link
                href="/admin/crm/suri"
                className="inline-flex min-h-11 items-center rounded-pill bg-ink px-5 text-sm font-semibold text-white"
              >
                Naar de reisperiodes
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  const { filter = "alles", zoek } = await searchParams;
  const gekozen = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];

  const alle = await getRelaties();
  const lijst = filterRelaties(alle, {
    lifecycle: gekozen.lifecycle,
    stilLanger: gekozen.stil,
    metOpenDeal: gekozen.deal,
    zoek,
  });

  const zonderEigenaar = alle.filter((r) => !r.ownerId).length;
  const prospects = alle.filter((r) => r.lifecycle === "prospect").length;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[30px]">Organisaties</h1>
        <MerkSchakelaar actief={merk} />
      </div>


      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Relaties</p>
            <p className="mt-1 font-display text-3xl">{alle.length}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Prospects</p>
            <p className="mt-1 font-display text-3xl">{prospects}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Open dealwaarde</p>
            <p className="mt-1 font-display text-3xl tabular-nums">
              {formatEuroCents(alle.reduce((som, r) => som + r.openWaardeCents, 0))}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Zonder eigenaar</p>
            <p className={cn("mt-1 font-display text-3xl", zonderEigenaar > 0 && "text-accent-strong")}>
              {zonderEigenaar}
            </p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title={gekozen.label}
          description={`${lijst.length} van ${alle.length} relaties`}
          action={
            <form className="flex flex-wrap items-center gap-2" action="/admin/crm/organisaties">
              <label htmlFor="zoek" className="sr-only">
                Zoek op naam of plaats
              </label>
              <input
                id="zoek"
                name="zoek"
                defaultValue={zoek ?? ""}
                placeholder="Zoek op naam of plaats"
                className="h-10 min-w-0 flex-1 rounded-pill border border-surface-2 bg-surface-2 px-4 text-sm"
              />
              <input type="hidden" name="filter" value={filter} />
              <button
                type="submit"
                className="min-h-10 rounded-pill bg-ink px-4 text-sm font-semibold text-white"
              >
                Zoek
              </button>
            </form>
          }
        />

        <div className="flex flex-wrap gap-1.5 border-b border-line-soft px-5 py-3">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`/admin/crm/organisaties?filter=${f.key}${zoek ? `&zoek=${encodeURIComponent(zoek)}` : ""}`}
              aria-current={f.key === filter ? "page" : undefined}
              className={cn(
                "rounded-pill px-3.5 py-1.5 text-sm font-semibold transition-colors",
                f.key === filter ? "bg-accent-wash text-ink" : "text-muted hover:bg-surface-2 hover:text-ink"
              )}
            >
              {f.label}
            </Link>
          ))}
        </div>

        {lijst.length === 0 ? (
          <EmptyState
            title="Niets gevonden"
            description={
              zoek
                ? `Geen relatie die past bij "${zoek}".`
                : gekozen.key === "prospect"
                  ? "Er staan nog geen prospects in. Een organisatie wordt een prospect zodra je haar levensfase op de organisatiepagina aanpast."
                  : "Er staat hier niets."
            }
          />
        ) : (
          <ul>
            {lijst.map((relatie) => (
              <Regel key={relatie.id} relatie={relatie} />
            ))}
          </ul>
        )}
      </Card>

      <p className="mt-4 text-sm text-muted">
        De levensfase pas je aan op de organisatie zelf. Beschikbare fases:{" "}
        {Object.entries(LIFECYCLE_LABELS)
          .filter(([key]) => isLifecycle(key))
          .map(([, label]) => label)
          .join(", ")}
        .
      </p>
    </>
  );
}
