"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";

import { DealKaart } from "@/components/admin/deal-kaart";
import { formatEuroCents } from "@/lib/format";
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
  dagenInFase: number | null;
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

export function PijplijnBord({ fases, deals }: { fases: BordFase[]; deals: BordDeal[] }) {
  const router = useRouter();
  const bordRef = useRef<HTMLDivElement>(null);
  /** Wat er al is verplaatst maar nog niet door de server is bevestigd. */
  const [verplaatst, setVerplaatst] = useState<Record<string, string>>({});
  const [opslaand, setOpslaand] = useState<Record<string, true>>({});
  const [ingeklapt, setIngeklapt] = useState<Record<string, boolean>>({});
  const [sleept, setSleept] = useState<string | null>(null);
  const [boven, setBoven] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  function faseVan(deal: BordDeal): string {
    return verplaatst[deal.id] ?? deal.stageId;
  }

  async function laatLos(faseId: string, gesleepteDealId?: string) {
    const dealId = gesleepteDealId || sleept;
    setSleept(null);
    setBoven(null);
    if (!dealId || opslaand[dealId]) return;

    const deal = deals.find((d) => d.id === dealId);
    if (!deal || faseVan(deal) === faseId) return;

    const vorige = faseVan(deal);
    setFout(null);
    setVerplaatst((stand) => ({ ...stand, [dealId]: faseId }));
    setOpslaand((stand) => ({ ...stand, [dealId]: true }));

    try {
      const uitkomst = await verplaatsDealAction(dealId, faseId);
      if (!uitkomst.ok) {
        // Terug waar hij lag. Blijven staan zou betekenen dat het scherm iets
        // toont wat niet in de database staat, en dat is erger dan haperen.
        setVerplaatst((stand) => ({ ...stand, [dealId]: vorige }));
        setFout(`${uitkomst.fout} De deal is teruggezet.`);
      } else {
        // Haal de zojuist opgeslagen fase opnieuw van de server. De kaart blijft
        // intussen door de optimistische laag op zijn nieuwe plek staan.
        router.refresh();
      }
    } catch {
      setVerplaatst((stand) => ({ ...stand, [dealId]: vorige }));
      setFout("De fase kon niet worden opgeslagen. De deal is teruggezet.");
    } finally {
      setOpslaand((stand) => {
        const volgende = { ...stand };
        delete volgende[dealId];
        return volgende;
      });
    }
  }

  function scrollBordTijdensSlepen(clientX: number) {
    const bord = bordRef.current;
    if (!bord || !sleept) return;
    const kader = bord.getBoundingClientRect();
    const rand = Math.min(88, kader.width * 0.18);
    if (clientX < kader.left + rand) bord.scrollLeft -= 20;
    if (clientX > kader.right - rand) bord.scrollLeft += 20;
  }

  return (
    <div className="min-w-0 max-w-full">
      {fout ? (
        <p
          role="alert"
          className="mb-3 rounded-card border border-danger/40 bg-danger-wash px-4 py-3 text-sm font-semibold text-danger"
        >
          <span>{fout}</span>{" "}
          <button type="button" className="underline" onClick={() => setFout(null)}>
            Sluiten
          </button>
        </p>
      ) : null}

      {/*
        Het bord schuift binnen zijn eigen kader. Daarom staat de overflow hier
        en niet op de pagina: een kanban hoort opzij te kunnen, een webpagina
        niet. Op een telefoon blijft het kader binnen de pagina en swipe je
        uitsluitend de inhoud van dit bord.
      */}
      <div
        ref={bordRef}
        aria-label="Dealpijplijn"
        onDragOver={(event) => scrollBordTijdensSlepen(event.clientX)}
        className="h-[clamp(30rem,calc(100dvh-15rem),44rem)] w-full max-w-full overflow-x-auto overscroll-x-contain rounded-card border border-line-soft bg-surface-3 p-2 shadow-card [scrollbar-gutter:stable]"
      >
        <div className="flex h-full w-max min-w-full gap-2.5">
          {fases.map((fase) => {
            const inFase = deals.filter((deal) => faseVan(deal) === fase.id);
            const waarde = inFase.reduce((som, deal) => som + deal.waardeCents, 0);
            const isDoel = boven === fase.id;
            const isIngeklapt = Boolean(ingeklapt[fase.id]);

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
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                  setBoven((huidig) => (huidig === fase.id ? null : huidig));
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  void laatLos(fase.id, event.dataTransfer.getData("text/plain"));
                }}
                className={cn(
                  "flex h-full shrink-0 flex-col overflow-hidden rounded-card border bg-surface-2 transition-[width,border-color,background-color]",
                  isIngeklapt ? "w-[68px]" : "w-[286px]",
                  isDoel ? "border-dashed border-ink bg-accent-wash" : "border-line-soft"
                )}
              >
                {isIngeklapt ? (
                  <button
                    type="button"
                    aria-expanded="false"
                    aria-label={`${fase.label} uitklappen`}
                    title={`${fase.label} · ${inFase.length} deals · ${formatEuroCents(waarde)}`}
                    onClick={() => setIngeklapt((stand) => ({ ...stand, [fase.id]: false }))}
                    className="flex min-h-0 flex-1 flex-col items-center gap-3 px-2 py-3 text-muted hover:bg-white hover:text-ink"
                  >
                    <ChevronRight aria-hidden className="size-4 shrink-0" />
                    <span className="[writing-mode:vertical-rl] text-sm font-semibold">{fase.label}</span>
                    <span className="mt-auto rounded-pill bg-white px-2 py-0.5 text-xs font-semibold tabular-nums">
                      {inFase.length}
                    </span>
                    <span className="[writing-mode:vertical-rl] text-xs tabular-nums">
                      {formatEuroCents(waarde)}
                    </span>
                  </button>
                ) : (
                  <>
                    <header className="shrink-0 border-b border-line-soft bg-white px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <h2
                          className={cn(
                            "truncate text-sm font-semibold",
                            fase.isWon ? "text-success" : fase.isLost ? "text-muted" : "text-ink"
                          )}
                        >
                          {fase.label}
                        </h2>
                        <button
                          type="button"
                          aria-expanded="true"
                          aria-label={`${fase.label} inklappen`}
                          title="Kolom inklappen"
                          onClick={() => setIngeklapt((stand) => ({ ...stand, [fase.id]: true }))}
                          className="grid size-8 shrink-0 place-items-center rounded-card text-muted hover:bg-surface-2 hover:text-ink"
                        >
                          <ChevronLeft aria-hidden className="size-4" />
                        </button>
                      </div>
                    </header>

                    <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-y-contain p-2 [scrollbar-gutter:stable]">
                      {inFase.map((deal) => (
                        <DealKaart
                          key={deal.id}
                          deal={deal}
                          sleepbaar
                          bezig={Boolean(opslaand[deal.id])}
                          onSleepStart={(event) => {
                            event.dataTransfer.setData("text/plain", deal.id);
                            event.dataTransfer.effectAllowed = "move";
                            setFout(null);
                            setSleept(deal.id);
                          }}
                          onSleepEinde={() => {
                            setSleept(null);
                            setBoven(null);
                          }}
                        />
                      ))}

                      {inFase.length === 0 ? (
                        <li className="grid min-h-24 place-items-center rounded-card border border-dashed border-line px-3 text-center text-xs text-muted-soft">
                          Sleep een deal naar deze fase
                        </li>
                      ) : null}
                    </ul>

                    <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-line-soft bg-white px-3 py-2 text-xs text-muted">
                      <span className="tabular-nums">
                        {inFase.length} {inFase.length === 1 ? "deal" : "deals"}
                      </span>
                      <strong className="truncate tabular-nums text-ink">
                        {formatEuroCents(waarde)}
                      </strong>
                    </footer>
                  </>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
