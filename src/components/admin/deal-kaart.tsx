import type { DragEventHandler } from "react";
import Link from "next/link";
import { Building2, CalendarDays, CircleUser, Clock } from "lucide-react";

import { formatEuroCents, formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Een deal als kaart in de pijplijn.
 *
 * De vraag die deze kaart moet beantwoorden is niet "wat weten wij over deze
 * deal", maar "moet ik hier vandaag iets mee". Daarom staat de volgende taak
 * onderaan opvallend, en niet ergens tussen de gegevens.
 *
 * Vier regels informatie is het maximum. Alles wat daar niet in past, staat op
 * de dealpagina zelf. Een kolom vol dichte kaarten leest niemand meer.
 */

export interface DealKaartGegevens {
  id: string;
  titel: string;
  organisatie: string | null;
  contact: string | null;
  waardeCents: number;
  datum: string | null;
  eigenaar: string | null;
  dagenInFase: number | null;
  volgendeTaak: { titel: string; dueOn: string | null; teLaat: boolean } | null;
  /** Naar welk scherm de kaart linkt. Suri heeft een eigen deelnemerspagina. */
  href: string;
}

/**
 * Wanneer wordt "hoe lang staat dit er al" een signaal?
 *
 * Onder de twee weken is het normaal en dus ruis. Daarboven is het precies wat
 * je wilt weten, en boven de dertig dagen is het een probleem.
 */
function faseToon(dagen: number | null): { toon: string; tekst: string } | null {
  if (dagen === null || dagen < 14) return null;
  if (dagen < 30) {
    return { toon: "text-muted", tekst: `${dagen} dagen in deze fase` };
  }
  return {
    toon: "text-accent-strong font-semibold",
    tekst: dagen >= 90 ? `${Math.floor(dagen / 30)} maanden in deze fase` : `${dagen} dagen in deze fase`,
  };
}

export function DealKaart({
  deal,
  sleepbaar = false,
  bezig = false,
  onSleepStart,
  onSleepEinde,
}: {
  deal: DealKaartGegevens;
  sleepbaar?: boolean;
  bezig?: boolean;
  onSleepStart?: DragEventHandler<HTMLLIElement>;
  onSleepEinde?: DragEventHandler<HTMLLIElement>;
}) {
  const fase = faseToon(deal.dagenInFase);

  return (
    <li
      draggable={sleepbaar && !bezig}
      onDragStart={onSleepStart}
      onDragEnd={onSleepEinde}
      aria-busy={bezig || undefined}
      className={cn(
        sleepbaar && !bezig && "cursor-grab active:cursor-grabbing",
        bezig && "pointer-events-none opacity-60"
      )}
    >
      <Link
        href={deal.href}
        // De kaart zelf wordt gesleept. Zonder dit probeert de browser de link
        // als adres naar een ander tabblad te slepen.
        draggable={false}
        className="block rounded-card border border-line-soft bg-white p-3 shadow-card transition-colors hover:border-ink"
      >
        <p className="truncate font-semibold text-ink">{deal.titel}</p>

        {deal.organisatie ? (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
            <Building2 aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{deal.organisatie}</span>
          </p>
        ) : null}

        {deal.contact ? (
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
            <CircleUser aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{deal.contact}</span>
          </p>
        ) : null}

        <p className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="font-semibold tabular-nums text-ink">
            {formatEuroCents(deal.waardeCents)}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <CalendarDays aria-hidden className="size-3.5 shrink-0" />
            {deal.datum ? formatShortDate(deal.datum) : "geen datum"}
          </span>
        </p>

        {fase ? (
          <p className={cn("mt-1.5 flex items-center gap-1.5 text-xs", fase.toon)}>
            <Clock aria-hidden className="size-3.5 shrink-0" />
            {fase.tekst}
          </p>
        ) : null}

        {deal.volgendeTaak ? (
          <p
            className={cn(
              "mt-2 truncate rounded-card px-2 py-1.5 text-xs font-semibold",
              deal.volgendeTaak.teLaat ? "bg-danger-wash text-danger" : "bg-surface-2 text-muted"
            )}
            title={deal.volgendeTaak.titel}
          >
            {deal.volgendeTaak.teLaat ? "Te laat: " : ""}
            {deal.volgendeTaak.titel}
            {deal.volgendeTaak.dueOn ? ` · ${formatShortDate(deal.volgendeTaak.dueOn)}` : ""}
          </p>
        ) : null}

        {deal.eigenaar ? (
          <p className="mt-1.5 truncate text-xs text-muted-soft">{deal.eigenaar}</p>
        ) : null}
      </Link>
    </li>
  );
}
