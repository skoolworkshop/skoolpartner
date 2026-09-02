import Link from "next/link";

import { Card, CardBody } from "@/components/ui/card";
import { BetaalBadge, BezettingBadge, LeeftijdBadge } from "@/components/admin/crm-badges";
import { PERIODE_STATUS_LABELS, type Bezetting } from "@/lib/crm/regels";
import { formatEuroCents, formatShortDate } from "@/lib/format";

/**
 * De kaart van een reisperiode en de regel van een deelnemer.
 *
 * Losgetrokken uit de pagina's zodat de visuele controle ze echt kan renderen,
 * inclusief de randgevallen die je in de praktijk zelden achter elkaar ziet:
 * een lege periode, een volle, en eentje met te veel aanmeldingen.
 */

export interface PeriodeKaartGegevens {
  editionId: string;
  name: string;
  startsOn: string;
  endsOn: string;
  status: keyof typeof PERIODE_STATUS_LABELS;
  capacity: number;
  priceCents: number;
  aangemeld: number;
  volledigBetaald: number;
  ontvangenCents: number;
  stand: Bezetting;
}

export function PeriodeKaart({ periode }: { periode: PeriodeKaartGegevens }) {
  return (
    <Link href={`/admin/crm/suri/periode/${periode.editionId}`} className="block">
      <Card className="h-full transition-colors hover:border-ink">
        <CardBody>
          <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-display text-lg font-bold">{periode.name}</p>
              <p className="text-sm text-muted">
                {formatShortDate(periode.startsOn)} tot {formatShortDate(periode.endsOn)}
              </p>
            </div>
            <BezettingBadge stand={periode.stand} />
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Aangemeld</dt>
            <dd className="text-right font-semibold tabular-nums">
              {periode.aangemeld} van {periode.capacity}
            </dd>
            <dt className="text-muted">Volledig betaald</dt>
            <dd className="text-right font-semibold tabular-nums">{periode.volledigBetaald}</dd>
            <dt className="text-muted">Ontvangen</dt>
            <dd className="text-right font-semibold tabular-nums">
              {formatEuroCents(periode.ontvangenCents)}
            </dd>
            <dt className="text-muted">Prijs per persoon</dt>
            <dd className="text-right font-semibold tabular-nums">
              {periode.priceCents ? formatEuroCents(periode.priceCents) : "nog niet ingesteld"}
            </dd>
          </dl>

          <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-muted-soft">
            {PERIODE_STATUS_LABELS[periode.status]}
          </p>
        </CardBody>
      </Card>
    </Link>
  );
}

export interface DeelnemerRegelGegevens {
  dealId: string;
  naam: string;
  email: string | null;
  fase: string;
  leeftijd: { leeftijd: number; toon: "goed" | "let-op" | "buiten"; bericht: string } | null;
  stand: { volledig: boolean; openCents: number; teveelCents: number };
}

export function DeelnemerRegel({ deelnemer }: { deelnemer: DeelnemerRegelGegevens }) {
  const { stand } = deelnemer;
  return (
    <li className="border-b border-line-soft last:border-b-0">
      <Link
        href={`/admin/crm/suri/deelnemer/${deelnemer.dealId}`}
        className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5 hover:bg-surface-2"
      >
        <span className="min-w-0 flex-1 basis-full sm:basis-auto">
          <span className="block truncate font-semibold text-ink">{deelnemer.naam}</span>
          <span className="block truncate text-sm text-muted">
            {deelnemer.fase}
            {deelnemer.email ? ` · ${deelnemer.email}` : ""}
          </span>
        </span>
        <LeeftijdBadge signaal={deelnemer.leeftijd} />
        <BetaalBadge
          volledig={stand.volledig}
          openCents={stand.openCents}
          teveelCents={stand.teveelCents}
          label={
            stand.volledig
              ? "Betaald"
              : stand.teveelCents
                ? "Te veel betaald"
                : `${formatEuroCents(stand.openCents)} open`
          }
        />
      </Link>
    </li>
  );
}
