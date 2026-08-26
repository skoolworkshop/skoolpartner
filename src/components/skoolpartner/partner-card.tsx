import { formatEuroCents, formatPoints, formatShortDate } from "@/lib/format";
import { pointsToCents } from "@/lib/loyalty/calc";
import { cn } from "@/lib/utils";

/**
 * De SkoolPartner Kaart.
 *
 * Bewust géén creditcard-imitatie en geen game-achtige elementen. Wel een
 * duidelijk herkenbare, zakelijke lidmaatschapskaart in de huisstijl van
 * Skool Workshop: donkere ondergrond zoals het logo, met de oranje accentlijn
 * van de website.
 */
export function PartnerCard({
  organizationName,
  memberSince,
  availablePoints,
  pendingPoints,
  pointValueCentsPer100,
  programName = "SkoolPartner",
  pointsName = "SkoolPoints",
  className,
}: {
  organizationName: string;
  memberSince: string | null;
  availablePoints: number;
  pendingPoints: number;
  pointValueCentsPer100: number;
  programName?: string;
  pointsName?: string;
  className?: string;
}) {
  const valueCents = pointsToCents(availablePoints, pointValueCentsPer100);

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-card bg-ink text-white shadow-raise",
        className
      )}
    >
      {/* Zachte diagonale accentgloed, afgeleid van de accentkleur #F49700 */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full opacity-25 blur-3xl"
        style={{ background: "radial-gradient(circle, #f49700 0%, transparent 70%)" }}
      />
      <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-accent" />

      <div className="relative flex flex-col gap-6 p-6 sm:p-7">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="font-display text-[13px] font-semibold uppercase tracking-[0.22em] text-accent-soft">
              {programName}
            </p>
            <h2 className="mt-1.5 font-display text-xl leading-tight text-white">
              {organizationName}
            </h2>
          </div>
          <p className="text-right text-[11px] uppercase tracking-[0.14em] text-white/50">
            Skool
            <br />
            Workshop
          </p>
        </header>

        <div>
          <p className="font-display text-[40px] leading-none tracking-[-0.03em] text-white sm:text-[46px]">
            {formatPoints(availablePoints)}
          </p>
          <p className="mt-1.5 text-sm text-white/70">
            {pointsName} beschikbaar ·{" "}
            <span className="font-semibold text-white">{formatEuroCents(valueCents)}</span> Skool
            Voordeel
          </p>
        </div>

        <footer className="flex flex-wrap items-end justify-between gap-3 border-t border-white/10 pt-4 text-[13px]">
          <p className="text-white/60">
            Actief sinds{" "}
            <span className="font-semibold text-white/85">{formatShortDate(memberSince)}</span>
          </p>
          {pendingPoints > 0 ? (
            <p className="text-white/60">
              <span className="font-semibold text-white/85">{formatPoints(pendingPoints)}</span> in
              behandeling
            </p>
          ) : null}
        </footer>
      </div>
    </article>
  );
}
