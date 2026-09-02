import Link from "next/link";

import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { formatEuroCents, formatShortDate } from "@/lib/format";
import {
  MERK_FILTER_LABELS,
  MERK_FILTERS,
  PERIODE_KEYS,
  PERIODE_LABELS,
  formatDagen,
  formatPercentage,
  type MaandOmzet,
  type MerkFilter,
  type Periode,
} from "@/lib/crm/dashboard-berekening";
import type { DashboardGegevens } from "@/lib/crm/dashboard";
import { cn } from "@/lib/utils";

/**
 * Het commerciele dashboard.
 *
 * Losgetrokken van page.tsx zodat de visuele controle dit scherm echt kan
 * renderen, net als bij de andere CRM-schermen.
 *
 * WAT DIT SCHERM WEL EN NIET IS
 *
 *   Het dashboard vertelt hoe het ervoor staat en waar het klemt. Het is geen
 *   tweede pijplijn: er staat geen enkele deal in te slepen en er is niets te
 *   bewerken. Elk getal is een deur naar het scherm waar je het wel kunt doen.
 *
 * OVER DE KLEUREN
 *
 *   Twee series, twee merkkleuren: oranje voor Skool Workshop en groenblauw
 *   voor Suri Impact. Dezelfde kleuren als in de rest van het CRM, zodat een
 *   kleur altijd hetzelfde merk betekent en niet ineens iets anders.
 *
 *   Die twee kleuren zijn ver genoeg uit elkaar om ook bij kleurenblindheid
 *   uit elkaar te houden, maar het oranje heeft weinig contrast met een witte
 *   achtergrond. Daarom staat er nooit alleen kleur: elke staaf heeft een
 *   legenda, de bedragen staan er in tekst bij, en onder de grafiek staat
 *   dezelfde reeks als tabel. Wie de kleuren niet ziet, mist niets.
 */

// -----------------------------------------------------------------------------
// Kleine bouwstenen
// -----------------------------------------------------------------------------

function Tegel({
  label,
  waarde,
  toelichting,
  href,
  toon = "gewoon",
}: {
  label: string;
  waarde: string;
  toelichting?: string;
  href?: string;
  toon?: "gewoon" | "aandacht" | "goed";
}) {
  const inhoud = (
    <>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-soft">{label}</p>
      <p
        className={cn(
          // Op een telefoon is een tegel ongeveer 160 pixels breed. Een bedrag
          // als "€ 11.880,00" past daar op 24 pixels net niet in, en dan
          // breekt het getal middenin af. Vandaar kleiner op mobiel.
          "mt-1.5 font-display text-xl leading-none tabular-nums sm:text-2xl lg:text-[26px]",
          toon === "aandacht" && "text-danger",
          toon === "goed" && "text-success"
        )}
      >
        {waarde}
      </p>
      {toelichting ? <p className="mt-1.5 text-xs text-muted">{toelichting}</p> : null}
    </>
  );

  const klassen = "block h-full rounded-card border border-line-soft bg-white p-4 shadow-card";

  return href ? (
    <Link href={href} className={cn(klassen, "transition-colors hover:border-line")}>
      {inhoud}
    </Link>
  ) : (
    <div className={klassen}>{inhoud}</div>
  );
}

function Balkje({ deel, geheel, kleur }: { deel: number; geheel: number; kleur: string }) {
  const breedte = geheel > 0 ? Math.max((deel / geheel) * 100, deel > 0 ? 2 : 0) : 0;
  return (
    <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-pill bg-surface-3">
      <span className={cn("block h-full rounded-pill", kleur)} style={{ width: `${breedte}%` }} />
    </span>
  );
}

/** Een bedrag zonder centen, voor een label dat maar vijftig pixels breed is. */
function kortBedrag(cents: number): string {
  return `\u20ac ${new Intl.NumberFormat("nl-NL").format(Math.round(cents / 100))}`;
}

/**
 * De omzet per maand als gestapelde staven.
 *
 * Twaalf maanden op een telefoon wordt een pindarij van onleesbare streepjes,
 * dus daar staan de laatste zes. Niet horizontaal scrollen: dat is precies wat
 * je op een telefoon niet wilt doen om een basisgetal te zien.
 */
function OmzetGrafiek({ reeks, merk }: { reeks: MaandOmzet[]; merk: MerkFilter }) {
  const hoogste = Math.max(...reeks.map((r) => r.totaalCents), 0);
  const beste = reeks.reduce((a, b) => (b.totaalCents > a.totaalCents ? b : a), reeks[0]);

  if (hoogste === 0) {
    return (
      <EmptyState
        title="Nog geen betaalde omzet"
        description="Zodra er een factuur is betaald of een deelnemer heeft betaald, verschijnt hier de reeks per maand."
      />
    );
  }

  const toonSkool = merk !== "suri_impact";
  const toonSuri = merk !== "skool_workshop";

  return (
    <div>
      {/* Een dunne grondlijn, zodat de staven ergens op staan in plaats van te
          zweven. Bewust lichtgrijs: de lijn hoort niet op te vallen. */}
      <div
        className="flex items-end gap-1.5 border-b border-line-soft sm:gap-2"
        style={{ height: "180px" }}
      >
        {reeks.map((maand, index) => {
          const hoogte = (maand.totaalCents / hoogste) * 100;
          const suriDeel =
            maand.totaalCents > 0 ? (maand.suriImpactCents / maand.totaalCents) * 100 : 0;
          const isBeste = maand.maand === beste.maand;

          return (
            <div
              key={maand.maand}
              className={cn(
                "flex h-full min-w-0 flex-1 flex-col justify-end",
                // De eerste zes maanden pas vanaf een breder scherm.
                index < reeks.length - 6 && "hidden sm:flex"
              )}
              title={`${maand.label}: ${formatEuroCents(maand.totaalCents)}`}
            >
              {isBeste ? (
                <p className="mb-1 truncate text-center text-[10px] font-semibold tabular-nums text-muted">
                  {kortBedrag(maand.totaalCents)}
                </p>
              ) : null}
              <div
                className="flex w-full flex-col justify-end overflow-hidden rounded-t"
                style={{ height: `${Math.max(hoogte, maand.totaalCents > 0 ? 2 : 0)}%` }}
              >
                {toonSuri && maand.suriImpactCents > 0 ? (
                  <span
                    className="w-full shrink-0 rounded-t bg-suri"
                    style={{ height: `${suriDeel}%` }}
                  />
                ) : null}
                {toonSkool && maand.skoolWorkshopCents > 0 ? (
                  <span
                    className={cn(
                      "w-full flex-1 bg-accent",
                      // Twee pixels wit ertussen, zodat de twee merken ook bij
                      // gelijke hoogte niet in elkaar overlopen.
                      maand.suriImpactCents > 0 && toonSuri ? "mt-[2px]" : "rounded-t"
                    )}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* De maandnamen in een eigen rij onder de grondlijn, met dezelfde
          verdeling en dezelfde regel over welke maanden op een telefoon
          zichtbaar zijn. */}
      <div className="mt-1.5 flex gap-1.5 sm:gap-2">
        {reeks.map((maand, index) => (
          <p
            key={maand.maand}
            className={cn(
              "min-w-0 flex-1 truncate text-center text-[10px] text-muted-soft",
              index < reeks.length - 6 && "hidden sm:block"
            )}
          >
            {maand.label}
          </p>
        ))}
      </div>

      {merk === "alles" ? (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[2px] bg-accent" />
            Skool Workshop
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[2px] bg-suri" />
            Suri Impact
          </span>
        </div>
      ) : null}

      <details className="mt-4 border-t border-line-soft pt-3">
        <summary className="cursor-pointer text-sm font-semibold text-muted">
          Dezelfde reeks als tabel
        </summary>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted-soft">
              <th className="py-1.5 font-semibold">Maand</th>
              {merk === "alles" ? (
                <>
                  <th className="py-1.5 text-right font-semibold">Skool</th>
                  <th className="py-1.5 text-right font-semibold">Suri</th>
                </>
              ) : null}
              <th className="py-1.5 text-right font-semibold">Totaal</th>
            </tr>
          </thead>
          <tbody>
            {reeks.map((maand) => (
              <tr key={maand.maand} className="border-t border-line-soft">
                <td className="py-1.5 text-muted">{maand.label}</td>
                {merk === "alles" ? (
                  <>
                    <td className="py-1.5 text-right tabular-nums text-muted">
                      {formatEuroCents(maand.skoolWorkshopCents)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted">
                      {formatEuroCents(maand.suriImpactCents)}
                    </td>
                  </>
                ) : null}
                <td className="py-1.5 text-right font-semibold tabular-nums">
                  {formatEuroCents(maand.totaalCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Het scherm
// -----------------------------------------------------------------------------

export function DashboardScherm({
  cijfers,
  periode,
  merk,
  vandaag,
  aangepast,
}: {
  cijfers: DashboardGegevens;
  periode: Periode;
  merk: MerkFilter;
  vandaag: string;
  aangepast: { vanaf: string | null; tot: string | null };
}) {
  const { kpis, pijplijn, faseDoorlooptijden, maandOmzet, klanten, klantenbehoud, opvolging } =
    cijfers;

  const link = (extra: { periode?: string; merk?: string }) => {
    const p = new URLSearchParams();
    const samen = {
      periode: extra.periode ?? periode.key,
      merk: extra.merk ?? merk,
      vanaf: aangepast.vanaf ?? undefined,
      tot: aangepast.tot ?? undefined,
    };
    for (const [k, v] of Object.entries(samen)) {
      if (v && v !== "alles" && v !== "deze-maand") p.set(k, v);
    }
    const s = p.toString();
    return `/admin/crm${s ? `?${s}` : ""}`;
  };

  const naam = (id: string) => cijfers.organisatieNamen.get(id) ?? "Onbekende organisatie";

  return (
    <>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[30px]">Dashboard</h1>
      </div>
      <p className="mb-5 max-w-3xl text-muted">
        Alles op dit scherm komt uit het CRM zelf. Omzet is wat er daadwerkelijk is betaald, niet
        wat een deal beloofde. Klik door op een getal om te zien waar het vandaan komt.
      </p>

      {/* De twee filters, in een rij boven de cijfers. */}
      <div className="mb-5 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-muted-soft">
            Merk
          </span>
          {MERK_FILTERS.map((optie) => (
            <Link
              key={optie}
              href={link({ merk: optie })}
              aria-current={optie === merk ? "true" : undefined}
              className={cn(
                "rounded-pill px-3.5 py-1.5 text-sm font-semibold transition-colors",
                optie === merk
                  ? optie === "suri_impact"
                    ? "bg-suri-wash text-ink ring-1 ring-suri/40"
                    : optie === "skool_workshop"
                      ? "bg-accent-wash text-ink ring-1 ring-accent/40"
                      : "bg-ink text-white"
                  : "text-muted hover:bg-surface-2 hover:text-ink"
              )}
            >
              {MERK_FILTER_LABELS[optie]}
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-muted-soft">
            Periode
          </span>
          {PERIODE_KEYS.filter((k) => k !== "aangepast").map((optie) => (
            <Link
              key={optie}
              href={link({ periode: optie })}
              aria-current={optie === periode.key ? "true" : undefined}
              className={cn(
                "rounded-pill px-3.5 py-1.5 text-sm font-semibold transition-colors",
                optie === periode.key
                  ? "bg-accent-wash text-ink"
                  : "text-muted hover:bg-surface-2 hover:text-ink"
              )}
            >
              {PERIODE_LABELS[optie]}
            </Link>
          ))}
        </div>

        <form
          action="/admin/crm"
          className="flex flex-wrap items-end gap-2 rounded-card border border-line-soft bg-surface-2 px-3 py-2"
        >
          <input type="hidden" name="periode" value="aangepast" />
          <input type="hidden" name="merk" value={merk} />
          <div>
            <label htmlFor="vanaf" className="block text-xs text-muted">
              Van
            </label>
            <input
              id="vanaf"
              name="vanaf"
              type="date"
              defaultValue={aangepast.vanaf ?? periode.vanaf}
              className="h-9 rounded-pill border border-line bg-white px-3 text-sm"
            />
          </div>
          <div>
            <label htmlFor="tot" className="block text-xs text-muted">
              Tot en met
            </label>
            <input
              id="tot"
              name="tot"
              type="date"
              defaultValue={aangepast.tot ?? periode.tot}
              className="h-9 rounded-pill border border-line bg-white px-3 text-sm"
            />
          </div>
          <button
            type="submit"
            className="h-9 rounded-pill bg-ink px-4 text-sm font-semibold text-white"
          >
            Toon
          </button>
          <p className="w-full text-xs text-muted sm:w-auto sm:self-center">
            Je kijkt nu naar <strong className="text-ink">{periode.label}</strong> (
            {formatShortDate(periode.vanaf)} tot en met {formatShortDate(periode.tot)}).
          </p>
        </form>
      </div>

      {!cijfers.heeftDeals ? (
        <Alert tone="info" title="Er staan nog geen deals in het CRM" className="mb-5">
          De cijfers hieronder blijven leeg tot er aanvragen in de pijplijn staan. Betaalde
          facturen worden wel gewoon meegeteld, want die komen uit Moneybird.
        </Alert>
      ) : null}

      {/* -------------------------------------------------------------------
          De kerncijfers
          ------------------------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tegel
          label="Gewonnen omzet"
          waarde={formatEuroCents(kpis.omzet.totaalCents)}
          toelichting={
            merk === "alles" && kpis.omzet.totaalCents > 0
              ? `${formatEuroCents(kpis.omzet.skoolWorkshopCents)} Skool, ${formatEuroCents(kpis.omzet.suriImpactCents)} Suri`
              : "Betaald in deze periode"
          }
        />
        <Tegel
          label="Open pijplijn"
          waarde={formatEuroCents(kpis.openWaardeCents)}
          toelichting={`${kpis.openDeals} lopende deal${kpis.openDeals === 1 ? "" : "s"}`}
          href="/admin/crm/pijplijn"
        />
        <Tegel
          label="Nieuwe deals"
          waarde={String(kpis.nieuweDeals)}
          toelichting={
            kpis.nieuweDeals > 0 ? formatEuroCents(kpis.nieuweDealsWaardeCents) : "in deze periode"
          }
          href="/admin/crm/pijplijn"
        />
        <Tegel
          label="Conversie"
          waarde={formatPercentage(kpis.conversiePercentage)}
          toelichting={`${kpis.gewonnenDeals} gewonnen, ${kpis.verlorenDeals} verloren`}
          toon={kpis.conversiePercentage !== null && kpis.conversiePercentage >= 50 ? "goed" : "gewoon"}
        />
        <Tegel
          label="Gewonnen deals"
          waarde={String(kpis.gewonnenDeals)}
          toelichting="afgesloten in deze periode"
        />
        <Tegel
          label="Verloren deals"
          waarde={String(kpis.verlorenDeals)}
          toelichting="afgesloten in deze periode"
        />
        <Tegel
          label="Gemiddelde dealwaarde"
          waarde={
            kpis.gemiddeldeDealwaardeCents === null
              ? "—"
              : formatEuroCents(kpis.gemiddeldeDealwaardeCents)
          }
          toelichting="van de gewonnen deals"
        />
        {/* Bij te weinig metingen staat er een streepje en geen getal. De
            uitleg staat eronder, want "onvoldoende data" in koptekst leest als
            een storing terwijl het gewoon een eerlijk antwoord is. */}
        <Tegel
          label="Doorlooptijd"
          waarde={kpis.doorlooptijd.voldoendeData ? formatDagen(kpis.doorlooptijd) : "—"}
          toelichting={
            kpis.doorlooptijd.voldoendeData
              ? `aanvraag tot gewonnen, ${kpis.doorlooptijd.aantal} metingen`
              : `onvoldoende data: ${kpis.doorlooptijd.aantal} gewonnen deal${kpis.doorlooptijd.aantal === 1 ? "" : "s"} in deze periode`
          }
        />
        <Tegel
          label="Openstaande taken"
          waarde={String(kpis.openstaandeTaken)}
          toelichting="op dit moment"
          href="/admin/crm/taken"
        />
        <Tegel
          label="Achterstallige taken"
          waarde={String(kpis.achterstalligeTaken)}
          toon={kpis.achterstalligeTaken > 0 ? "aandacht" : "gewoon"}
          toelichting="datum verstreken"
          href="/admin/crm/taken"
        />
        <Tegel
          label="Deals die stilstaan"
          waarde={String(pijplijn.teLangTotaal)}
          toon={pijplijn.teLangTotaal > 0 ? "aandacht" : "gewoon"}
          toelichting={`langer dan ${pijplijn.drempelDagen} dagen in dezelfde fase`}
          href="/admin/crm/pijplijn"
        />
        <Tegel
          label="Oudste lopende deal"
          waarde={pijplijn.oudste ? `${pijplijn.oudste.dagen} dgn` : "—"}
          toelichting={pijplijn.oudste?.title}
          href={pijplijn.oudste ? `/admin/crm/deal/${pijplijn.oudste.id}` : undefined}
        />
      </div>

      {kpis.omzet.zonderDatumCents > 0 ? (
        <p className="mt-3 text-xs text-muted">
          {cijfers.facturenZonderDatum} betaalde factuur
          {cijfers.facturenZonderDatum === 1 ? "" : "en"} heeft geen betaaldatum en telt daarom in
          geen enkele periode mee ({formatEuroCents(kpis.omzet.zonderDatumCents)}). Dat komt uit
          Moneybird en wordt hier bewust niet geraden.
        </p>
      ) : null}

      {/* -------------------------------------------------------------------
          Wat vandaag moet gebeuren
          ------------------------------------------------------------------- */}
      <Card className="mt-6">
        <CardHeader
          title="Wat er nu ligt"
          description="Niet wat er is gebeurd, maar wat er wacht. Dit is de lijst waar je 's ochtends mee begint."
          action={
            <Link
              href="/admin/crm/taken"
              className="inline-flex min-h-9 items-center rounded-pill bg-surface-3 px-4 text-sm font-semibold text-ink"
            >
              Alle taken
            </Link>
          }
        />
        <CardBody className="grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">
              Achterstallig ({opvolging.achterstalligeTaken.length})
            </h3>
            {opvolging.achterstalligeTaken.length === 0 ? (
              <p className="text-sm text-muted">Niets achterstallig.</p>
            ) : (
              <ul className="space-y-1.5">
                {opvolging.achterstalligeTaken.map((taak) => (
                  <li key={taak.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">
                      {taak.dealId ? (
                        <Link
                          href={`/admin/crm/deal/${taak.dealId}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {taak.title}
                        </Link>
                      ) : (
                        taak.title
                      )}
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-danger tabular-nums">
                      {formatShortDate(taak.dueOn)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {opvolging.takenVandaag.length > 0 ? (
              <>
                <h3 className="mb-2 mt-4 text-sm font-semibold text-ink">
                  Vandaag ({opvolging.takenVandaag.length})
                </h3>
                <ul className="space-y-1.5">
                  {opvolging.takenVandaag.map((taak) => (
                    <li key={taak.id} className="truncate text-sm">
                      {taak.dealId ? (
                        <Link
                          href={`/admin/crm/deal/${taak.dealId}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {taak.title}
                        </Link>
                      ) : (
                        taak.title
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">
              Deals die te lang stilstaan ({opvolging.stilstaandeDeals.length})
            </h3>
            {opvolging.stilstaandeDeals.length === 0 ? (
              <p className="text-sm text-muted">
                Alles beweegt binnen {pijplijn.drempelDagen} dagen. Zo hoort het.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {opvolging.stilstaandeDeals.map((deal) => (
                  <li key={deal.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <Link
                      href={`/admin/crm/deal/${deal.id}`}
                      className="min-w-0 truncate underline-offset-4 hover:underline"
                    >
                      {deal.title}
                    </Link>
                    <span className="shrink-0 text-xs text-muted tabular-nums">{deal.reden}</span>
                  </li>
                ))}
              </ul>
            )}

            {opvolging.dealsZonderTaak.length > 0 ? (
              <>
                <h3 className="mb-2 mt-4 text-sm font-semibold text-ink">
                  Lopende deals zonder vervolgstap ({opvolging.dealsZonderTaak.length})
                </h3>
                <ul className="space-y-1.5">
                  {opvolging.dealsZonderTaak.map((deal) => (
                    <li key={deal.id} className="flex items-baseline justify-between gap-3 text-sm">
                      <Link
                        href={`/admin/crm/deal/${deal.id}`}
                        className="min-w-0 truncate underline-offset-4 hover:underline"
                      >
                        {deal.title}
                      </Link>
                      <span className="shrink-0 text-xs text-muted tabular-nums">
                        {formatEuroCents(deal.waardeCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </CardBody>
      </Card>

      {/* -------------------------------------------------------------------
          Omzet
          ------------------------------------------------------------------- */}
      <Card className="mt-6">
        <CardHeader
          title="Omzet per maand"
          description="Betaalde facturen van scholen en ontvangen deelnemersbetalingen van Suri. De laatste twaalf maanden, los van het periodefilter."
        />
        <CardBody>
          <OmzetGrafiek reeks={maandOmzet} merk={merk} />
        </CardBody>
      </Card>

      {/* -------------------------------------------------------------------
          De pijplijn
          ------------------------------------------------------------------- */}
      <Card className="mt-6">
        <CardHeader
          title="De pijplijn per fase"
          description={`${pijplijn.totaalOpen} lopende deal${pijplijn.totaalOpen === 1 ? "" : "s"} met een verwachte waarde van ${formatEuroCents(pijplijn.totaalWaardeCents)}.`}
          action={
            <Link
              href="/admin/crm/pijplijn"
              className="inline-flex min-h-9 items-center rounded-pill bg-surface-3 px-4 text-sm font-semibold text-ink"
            >
              Open de pijplijn
            </Link>
          }
        />

        {pijplijn.fases.length === 0 ? (
          <EmptyState
            title="Geen fases gevonden"
            description="Voor dit merk staan er geen lopende fases ingesteld."
          />
        ) : (
          <>
            {/* Tabel op desktop. */}
            <div className="hidden lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line-soft text-left text-xs uppercase tracking-wider text-muted-soft">
                    <th className="px-5 py-2.5 font-semibold">Fase</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Deals</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Waarde</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Staat er gem.</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Blijft er gem.</th>
                    <th className="px-5 py-2.5 font-semibold">Oudste</th>
                  </tr>
                </thead>
                <tbody>
                  {pijplijn.fases.map((regel) => {
                    const doorloop = faseDoorlooptijden.find((d) => d.fase.id === regel.fase.id);
                    return (
                      <tr key={regel.fase.id} className="border-b border-line-soft last:border-b-0">
                        <td className="px-5 py-3">
                          <Link
                            href={`/admin/crm/pijplijn#fase-${regel.fase.key}`}
                            className="font-semibold text-ink underline-offset-4 hover:underline"
                          >
                            {regel.fase.label}
                          </Link>
                          {regel.teLang > 0 ? (
                            <span className="ml-2 rounded-pill bg-danger-wash px-2 py-0.5 text-xs font-semibold text-danger">
                              {regel.teLang} te lang
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{regel.aantal || "—"}</td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {regel.waardeCents > 0 ? formatEuroCents(regel.waardeCents) : "—"}
                          <Balkje
                            deel={regel.waardeCents}
                            geheel={pijplijn.totaalWaardeCents}
                            kleur={regel.fase.brand === "suri_impact" ? "bg-suri" : "bg-accent"}
                          />
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-muted">
                          {regel.gemiddeldDagenInFase === null
                            ? "—"
                            : `${regel.gemiddeldDagenInFase} dgn`}
                        </td>
                        <td className="px-3 py-3 text-right text-muted">
                          {doorloop ? (
                            <span
                              className={cn(!doorloop.meting.voldoendeData && "text-muted-soft")}
                            >
                              {formatDagen(doorloop.meting)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="max-w-[220px] truncate px-5 py-3 text-muted">
                          {regel.oudste ? (
                            <Link
                              href={`/admin/crm/deal/${regel.oudste.id}`}
                              className="underline-offset-4 hover:text-ink hover:underline"
                            >
                              {regel.oudste.title} ({regel.oudste.dagen} dgn)
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Kaartjes op mobiel: geen horizontaal geschuif voor een basisgetal. */}
            <ul className="lg:hidden">
              {pijplijn.fases.map((regel) => {
                const doorloop = faseDoorlooptijden.find((d) => d.fase.id === regel.fase.id);
                return (
                  <li key={regel.fase.id} className="border-b border-line-soft px-5 py-3 last:border-b-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <Link
                        href={`/admin/crm/pijplijn#fase-${regel.fase.key}`}
                        className="min-w-0 truncate font-semibold text-ink"
                      >
                        {regel.fase.label}
                      </Link>
                      <span className="shrink-0 text-sm tabular-nums text-muted">
                        {regel.aantal} · {formatEuroCents(regel.waardeCents)}
                      </span>
                    </div>
                    <Balkje
                      deel={regel.waardeCents}
                      geheel={pijplijn.totaalWaardeCents}
                      kleur={regel.fase.brand === "suri_impact" ? "bg-suri" : "bg-accent"}
                    />
                    <p className="mt-1.5 text-xs text-muted">
                      {regel.gemiddeldDagenInFase === null
                        ? "nog niets in deze fase"
                        : `staat er nu gemiddeld ${regel.gemiddeldDagenInFase} dagen`}
                      {doorloop?.meting.voldoendeData
                        ? ` · blijft er meestal ${formatDagen(doorloop.meting)}`
                        : ""}
                      {regel.teLang > 0 ? ` · ${regel.teLang} te lang` : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>

      {/* -------------------------------------------------------------------
          Klanten
          ------------------------------------------------------------------- */}
      {merk === "suri_impact" ? null : (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Waar de omzet vandaan komt"
              description={`Betaald in ${periode.label.toLowerCase()}. Nieuw betekent: de eerste betaling ooit van deze school valt in deze periode.`}
            />
            {klanten.perOrganisatie.length === 0 ? (
              <EmptyState
                title="Geen betalingen in deze periode"
                description="Kies een ruimere periode om te zien wie er heeft betaald."
              />
            ) : (
              <>
                <CardBody className="border-b border-line-soft">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <dt className="text-muted">Nieuwe klanten</dt>
                    <dd className="text-right font-semibold tabular-nums">
                      {klanten.nieuweKlanten} · {formatEuroCents(klanten.omzetNieuwCents)}
                    </dd>
                    <dt className="text-muted">Bestaande klanten</dt>
                    <dd className="text-right font-semibold tabular-nums">
                      {klanten.bestaandeKlanten} · {formatEuroCents(klanten.omzetBestaandCents)}
                    </dd>
                  </dl>
                </CardBody>
                <ul>
                  {klanten.perOrganisatie.slice(0, 10).map((org) => (
                    <li
                      key={org.organizationId}
                      className="flex items-baseline justify-between gap-3 border-b border-line-soft px-5 py-2.5 text-sm last:border-b-0"
                    >
                      <Link
                        href={`/admin/organisaties/${org.organizationId}`}
                        className="min-w-0 truncate underline-offset-4 hover:underline"
                      >
                        {naam(org.organizationId)}
                        {org.nieuw ? (
                          <span className="ml-2 rounded-pill bg-success-wash px-2 py-0.5 text-xs font-semibold text-success">
                            nieuw
                          </span>
                        ) : null}
                      </Link>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {formatEuroCents(org.omzetCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Komen ze terug?"
              description="Herhaalomzet is goedkoper dan een nieuwe school vinden. Dit is de lijst waar die vandaan komt."
            />
            <CardBody className="border-b border-line-soft">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted">Scholen met een gewonnen deal</dt>
                <dd className="text-right font-semibold tabular-nums">
                  {klantenbehoud.klantenMetWinst}
                </dd>
                <dt className="text-muted">Daarvan meer dan een</dt>
                <dd className="text-right font-semibold tabular-nums">
                  {klantenbehoud.herhaalklanten} ({formatPercentage(klantenbehoud.herhaalPercentage)})
                </dd>
              </dl>
            </CardBody>

            <CardBody>
              <h3 className="mb-2 text-sm font-semibold text-ink">
                Al een jaar stil, en niets loopt ({klantenbehoud.slapend.length})
              </h3>
              {klantenbehoud.slapend.length === 0 ? (
                <p className="text-sm text-muted">
                  Bij elke school die ooit iets afnam loopt nog iets, of het is nog geen jaar
                  geleden.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {klantenbehoud.slapend.slice(0, 8).map((org) => (
                    <li
                      key={org.organizationId}
                      className="flex items-baseline justify-between gap-3 text-sm"
                    >
                      <Link
                        href={`/admin/organisaties/${org.organizationId}`}
                        className="min-w-0 truncate underline-offset-4 hover:underline"
                      >
                        {naam(org.organizationId)}
                      </Link>
                      <span className="shrink-0 text-xs text-muted tabular-nums">
                        {formatShortDate(org.laatsteWinst)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      <Card className="mt-6">
        <CardHeader title="Waar deze getallen vandaan komen" />
        <CardBody>
          <ul className="space-y-2 text-sm text-muted">
            <li>
              <strong className="text-ink">Omzet</strong> is voor Skool Workshop het betaalde bedrag
              op de facturen uit Moneybird, en voor Suri Impact het ontvangen bedrag van de
              deelnemers. De waarde van een deal telt hier nooit in mee: dat is een verwachting en
              geen omzet. Zo kan dezelfde euro niet twee keer worden geteld.
            </li>
            <li>
              <strong className="text-ink">Doorlooptijd</strong> komt uit de echte fasehistorie van
              de deals. Staat er &quot;onvoldoende data&quot;, dan zijn er te weinig metingen om er
              iets zinnigs over te zeggen. Er wordt geen gemiddelde verzonnen om het vakje te
              vullen.
            </li>
            <li>
              <strong className="text-ink">Vandaag</strong> is {formatShortDate(vandaag)}. De
              periode loopt van {formatShortDate(periode.vanaf)} tot en met{" "}
              {formatShortDate(periode.tot)}, beide dagen meegerekend.
            </li>
          </ul>
        </CardBody>
      </Card>
    </>
  );
}
