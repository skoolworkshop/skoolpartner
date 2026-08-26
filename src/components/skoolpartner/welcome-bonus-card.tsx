import { Sparkles } from "lucide-react";

import { formatEuroCents, formatPoints } from "@/lib/format";
import { pointsToCents } from "@/lib/loyalty/calc";

/**
 * Het welkomsttegoed, kort na de registratie.
 *
 * Bewust in de huisstijl van de SkoolPartner-kaart en niet als schreeuwerige
 * banner. Hij verdwijnt vanzelf na twee weken; daarna staat het tegoed gewoon
 * in de puntenhistorie.
 */
export function WelcomeBonusCard({
  points,
  pointValueCentsPer100,
  pointsName,
  programName,
}: {
  points: number;
  pointValueCentsPer100: number;
  pointsName: string;
  programName: string;
}) {
  return (
    <article className="mb-5 overflow-hidden rounded-card border border-accent/40 bg-accent-soft/30">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-5 sm:px-6">
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-pill bg-accent text-ink"
        >
          <Sparkles className="size-6" />
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[21px] leading-snug">Welkom bij {programName}</h2>
          <p className="mt-1 text-[15px] text-muted">
            Uw eerste {formatPoints(points)} {pointsName} staan klaar. Vanaf nu spaart u erbij met
            elke nieuwe workshopboeking.
          </p>
        </div>

        <dl className="flex shrink-0 gap-6 border-t border-accent/25 pt-4 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
          <div>
            <dt className="text-sm text-muted">Tegoed</dt>
            <dd className="font-display text-2xl">{formatPoints(points)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Waarde</dt>
            <dd className="font-display text-2xl">
              {formatEuroCents(pointsToCents(points, pointValueCentsPer100))}
            </dd>
          </div>
        </dl>
      </div>
    </article>
  );
}
