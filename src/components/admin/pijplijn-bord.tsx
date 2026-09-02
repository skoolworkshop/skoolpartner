"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CalendarDays, CircleUser } from "lucide-react";

import { formatEuroCents, formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { verplaatsDealAction } from "@/app/admin/crm/actions";

/**
 * De pijplijn als bord waarop je kunt slepen.
 *
 * ============================================================================
 * DE KAART VERPLAATST EERST, DE DATABASE VOLGT
 * ============================================================================
 *
 * Wachten op de server voordat de kaart beweegt, voelt als haperen: je laat los
 * en er gebeurt een halve seconde niets. Daarom gaat de kaart meteen naar de
 * nieuwe kolom en gaat het verzoek daarna weg.
 *
 * Dat mag alleen als terugdraaien net zo makkelijk is als vooruit gaan. Vandaar
 * `verplaatst`: een lijstje van dealnummer naar fasenummer dat bovenop de
 * gegevens van de server ligt. Gaat het goed, dan haalt de server dezelfde
 * indeling op en verdwijnt het lijstje vanzelf. Gaat het mis, dan wordt de
 * regel eruit gehaald en ligt de kaart terug waar hij lag, met een melding
 * erboven die zegt waarom.
 *
 * ============================================================================
 * WAT ER BEWUST NIET GEBEURT
 * ============================================================================
 *
 *   Geen bibliotheek. Slepen tussen kolommen is precies wat de browser zelf
 *   kan; een pakket van tweehonderd kilobyte erbij zetten voor vijf regels
 *   logica maakt het scherm alleen langzamer.
 *
 *   Geen tweede plek waar een fasewissel wordt vastgelegd. Deze component
 *   roept dezelfde functie aan als het dealscherm, dus de faseovergang komt
 *   ook bij slepen in de tijdlijn en het audit log terecht.
 *
 *   Slepen is niet de enige weg. Wie geen muis gebruikt, zet de fase op de
 *   dealpagina zelf. Daarom staat er op elke kaart ook gewoon een link.
 */

export interface BordDeal {
  id: string;
  stageId: string;
  titel: string;
  organisatie: string | null;
  contact: string | null;
  waardeCents: number;
  datum: string | null;
  eigenaar: string | null;
  volgendeTaak: { titel: string; dueOn: string | null; teLaat: boolean } | null;
  href: string;
}

export interface BordFase {
  id: string;
  key: string;
  label: string;
  isWon: boolean;
  isLost: boolean;
}

function Kaart({
  deal,
  bezig,
  onSleepStart,
}: {
  deal: BordDeal;
  bezig: boolean;
  onSleepStart: () => void;
}) {
  return (
    <li
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", deal.id);
        event.dataTransfer.effectAllowed = "move";
        onSleepStart();
      }}
      className={cn(
        "cursor-grab active:cursor-grabbing",
        bezig && "opacity-60"
      )}
    >
      <Link
        href={deal.href}
        // Zonder dit pakt de browser de link op in plaats van de kaart, en
        // sleep je een adres naar een ander tabblad.
        draggable={false}
        className="block rounded-card border border-line-soft bg-white p-3 shadow-card transition-colors hover:border-ink"
      >
        <p className="truncate font-semibold text-ink">{deal.titel}</p>

        {deal.organisatie ?? deal.contact ? (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
            <CircleUser aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{deal.organisatie ?? deal.contact}</span>
          </p>
        ) : null}

        <p className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-semibold tabular-nums text-ink">
            {deal.waardeCents > 0 ? formatEuroCents(deal.waardeCents) : "geen bedrag"}
          </span>
          {deal.datum ? (
            <span className="flex items-center gap-1 text-xs text-muted">
              <CalendarDays aria-hidden className="size-3.5 shrink-0" />
              {formatShortDate(deal.datum)}
            </span>
          ) : null}
        </p>

        {deal.volgendeTaak ? (
          <p
            className={cn(
              "mt-2 truncate text-xs",
              deal.volgendeTaak.teLaat ? "font-semibold text-danger" : "text-muted"
            )}
            title={deal.volgendeTaak.titel}
          >
            {deal.volgendeTaak.teLaat ? "Te laat: " : ""}
            {deal.volgendeTaak.titel}
          </p>
        ) : null}

        {deal.eigenaar ? (
          <p className="mt-1 truncate text-xs text-muted-soft">{deal.eigenaar}</p>
        ) : null}
      </Link>
    </li>
  );
}

export function PijplijnBord({ fases, deals }: { fases: BordFase[]; deals: BordDeal[] }) {
  /** Wat er al is verplaatst maar nog niet door de server is bevestigd. */
  const [verplaatst, setVerplaatst] = useState<Record<string, string>>({});
  const [sleept, setSleept] = useState<string | null>(null);
  const [boven, setBoven] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, startOvergang] = useTransition();

  function faseVan(deal: BordDeal): string {
    return verplaatst[deal.id] ?? deal.stageId;
  }

  function laatLos(faseId: string) {
    const dealId = sleept;
    setSleept(null);
    setBoven(null);
    if (!dealId) return;

    const deal = deals.find((d) => d.id === dealId);
    if (!deal || faseVan(deal) === faseId) return;

    const vorige = faseVan(deal);
    setFout(null);
    setVerplaatst((stand) => ({ ...stand, [dealId]: faseId }));

    startOvergang(async () => {
      const uitkomst = await verplaatsDealAction(dealId, faseId);
      if (!uitkomst.ok) {
        // Terug waar hij lag. Blijven staan zou betekenen dat het scherm iets
        // toont wat niet in de database staat, en dat is erger dan haperen.
        setVerplaatst((stand) => ({ ...stand, [dealId]: vorige }));
        setFout(uitkomst.fout);
      }
    });
  }

  return (
    <div>
      {fout ? (
        <p
          role="alert"
          className="mb-3 rounded-card border border-danger/40 bg-danger-wash px-4 py-3 text-sm font-semibold text-danger"
        >
          {fout}
        </p>
      ) : null}

      {/*
        Het bord schuift binnen zijn eigen kader. Daarom staat de overflow hier
        en niet op de pagina: een kanban hoort opzij te kunnen, een webpagina
        niet. De negatieve marge laat het bord op een telefoon tot de rand van
        het scherm lopen, zodat de eerste kolom niet half wegvalt.
      */}
      <div className="-mx-4 overflow-x-auto overscroll-x-contain px-4 pb-3 sm:mx-0 sm:px-0">
        <div className="flex gap-3">
          {fases.map((fase) => {
            const inFase = deals.filter((deal) => faseVan(deal) === fase.id);
            const waarde = inFase.reduce((som, deal) => som + deal.waardeCents, 0);
            const isDoel = boven === fase.id;

            return (
              <section
                key={fase.id}
                id={`fase-${fase.key}`}
                onDragOver={(event) => {
                  // Zonder dit weigert de browser de kaart hier los te laten.
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (boven !== fase.id) setBoven(fase.id);
                }}
                onDragLeave={() => setBoven((huidig) => (huidig === fase.id ? null : huidig))}
                onDrop={(event) => {
                  event.preventDefault();
                  laatLos(fase.id);
                }}
                className={cn(
                  "flex w-[272px] shrink-0 flex-col rounded-card border border-transparent p-1 transition-colors",
                  isDoel && "border-dashed border-ink bg-surface-2"
                )}
              >
                <header className="px-2 pb-2 pt-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2
                      className={cn(
                        "truncate text-sm font-semibold",
                        fase.isWon ? "text-success" : fase.isLost ? "text-muted" : "text-ink"
                      )}
                    >
                      {fase.label}
                    </h2>
                    <span className="shrink-0 text-xs tabular-nums text-muted">{inFase.length}</span>
                  </div>
                  <p className="mt-0.5 text-xs tabular-nums text-muted">
                    {waarde > 0 ? formatEuroCents(waarde) : "—"}
                  </p>
                </header>

                <ul className="flex flex-col gap-2 px-1 pb-1">
                  {inFase.map((deal) => (
                    <Kaart
                      key={deal.id}
                      deal={deal}
                      bezig={bezig && verplaatst[deal.id] === fase.id}
                      onSleepStart={() => setSleept(deal.id)}
                    />
                  ))}
                </ul>

                {inFase.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-muted-soft">Geen deals</p>
                ) : null}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
