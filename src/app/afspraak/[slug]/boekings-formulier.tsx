"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import type { VrijeDag } from "@/lib/crm/beschikbaarheid";
import { boekAfspraakAction, type BoekingState } from "@/app/afspraak/[slug]/actions";
import { cn } from "@/lib/utils";

/**
 * Kiezen en boeken, in twee stappen.
 *
 * ============================================================================
 * DE OPBOUW KOMT VAN DE HUBSPOT-PLANNER, DE VORMGEVING NIET
 * ============================================================================
 *
 * Wat is overgenomen omdat het werkt:
 *   - twee stappen met een balkje bovenaan, zodat je weet waar je bent;
 *   - een echte maandkalender in plaats van een lange lijst met dagen, met
 *     alleen de dagen aanklikbaar waarop iets vrij is;
 *   - de tijden naast de kalender, in een lijst die scrollt;
 *   - duur en locatie bovenaan, zodat je weet waar je ja tegen zegt;
 *   - de tijdzone er expliciet bij;
 *   - terug kunnen naar je gekozen moment zonder het formulier kwijt te raken.
 *
 * Wat bewust anders is:
 *   - geen HubSpot-kleuren of -vormen, maar die van Skool Workshop;
 *   - "Naam onderneming" is optioneel, precies zoals op de schermafbeelding
 *     (daar staat geen sterretje bij) en anders dan in mijn eerste versie;
 *   - geen reCAPTCHA. Dat stuurt het gedrag van elke bezoeker naar Google en
 *     is voor dit volume niet nodig; er is een verborgen veld en een
 *     dagmaximum per link.
 *
 * ============================================================================
 * WAAROM DE MAANDKALENDER IN DE BROWSER WORDT OPGEBOUWD
 * ============================================================================
 *
 * De server levert de dagen met vrije momenten. Welke maand je bekijkt en welke
 * dag je hebt aangeklikt is iets van het scherm, niet van de server: daarvoor
 * telkens opnieuw naar de server gaan maakt het klikken traag zonder dat er
 * iets aan het antwoord verandert.
 */

const WEEKDAG_KORT = ["ma.", "di.", "wo.", "do.", "vr.", "za.", "zo."];
const WEEKDAG_LANG = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const MAAND = [
  "januari",
  "februari",
  "maart",
  "april",
  "mei",
  "juni",
  "juli",
  "augustus",
  "september",
  "oktober",
  "november",
  "december",
];

function ontleed(datum: string): { jaar: number; maand: number; dag: number } {
  const [jaar, maand, dag] = datum.split("-").map(Number);
  return { jaar, maand, dag };
}

function maandSleutel(datum: string): string {
  return datum.slice(0, 7);
}

function dagLabel(datum: string): string {
  const { jaar, maand, dag } = ontleed(datum);
  const d = new Date(Date.UTC(jaar, maand - 1, dag));
  return `${WEEKDAG_LANG[d.getUTCDay()]} ${dag} ${MAAND[maand - 1]} ${jaar}`;
}

/** De weken van een maand, met maandag als eerste dag. */
function maandRooster(sleutel: string): (string | null)[][] {
  const [jaar, maand] = sleutel.split("-").map(Number);
  const eerste = new Date(Date.UTC(jaar, maand - 1, 1));
  const dagenInMaand = new Date(Date.UTC(jaar, maand, 0)).getUTCDate();

  // getUTCDay: 0 is zondag. Met maandag vooraan wordt zondag kolom zes.
  const start = (eerste.getUTCDay() + 6) % 7;

  const vakjes: (string | null)[] = Array(start).fill(null);
  for (let dag = 1; dag <= dagenInMaand; dag += 1) {
    vakjes.push(`${jaar}-${String(maand).padStart(2, "0")}-${String(dag).padStart(2, "0")}`);
  }
  while (vakjes.length % 7 !== 0) vakjes.push(null);

  const weken: (string | null)[][] = [];
  for (let i = 0; i < vakjes.length; i += 7) weken.push(vakjes.slice(i, i + 7));
  return weken;
}

function Knop({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-pill bg-ink px-6 text-sm font-semibold text-white disabled:opacity-60"
    >
      {pending ? "Bezig…" : label}
    </button>
  );
}

function Stappen({ stap }: { stap: 1 | 2 }) {
  return (
    <ol className="mx-auto mb-8 flex max-w-sm items-start justify-center gap-0 text-center">
      {(
        [
          { nummer: 1, label: "Tijd kiezen" },
          { nummer: 2, label: "Jouw gegevens" },
        ] as const
      ).map((s, index) => (
        <li key={s.nummer} className="flex flex-1 items-start">
          {index > 0 ? (
            <span
              aria-hidden
              className={cn(
                "mt-[11px] h-0.5 flex-1",
                stap >= s.nummer ? "bg-accent" : "bg-line"
              )}
            />
          ) : null}
          <span className="flex flex-col items-center px-2">
            <span
              aria-hidden
              className={cn(
                "flex size-6 items-center justify-center rounded-pill border-2 text-xs font-semibold",
                stap > s.nummer
                  ? "border-accent bg-accent text-white"
                  : stap === s.nummer
                    ? "border-accent bg-white text-accent-strong"
                    : "border-line bg-white text-muted-soft"
              )}
            >
              {stap > s.nummer ? "✓" : ""}
            </span>
            <span
              className={cn(
                "mt-1.5 text-xs font-semibold uppercase tracking-wide",
                stap >= s.nummer ? "text-ink" : "text-muted-soft"
              )}
            >
              {s.label}
            </span>
          </span>
          {index === 0 ? (
            <span
              aria-hidden
              className={cn("mt-[11px] h-0.5 flex-1", stap > 1 ? "bg-accent" : "bg-line")}
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

const begin: BoekingState = { status: "idle" };

export function BoekingsFormulier({
  slug,
  dagen,
  tijdzone,
  tijdzoneLabel,
  duurTekst,
  locatie,
  vormTekst,
  eigenaarNaam,
}: {
  slug: string;
  dagen: VrijeDag[];
  tijdzone: string;
  tijdzoneLabel: string;
  duurTekst: string;
  locatie: string | null;
  vormTekst: string;
  eigenaarNaam: string | null;
}) {
  const [state, formAction] = useActionState(boekAfspraakAction, begin);

  const perDag = useMemo(() => new Map(dagen.map((d) => [d.datum, d])), [dagen]);
  const maanden = useMemo(
    () => [...new Set(dagen.map((d) => maandSleutel(d.datum)))].sort(),
    [dagen]
  );

  const [maandIndex, setMaandIndex] = useState(0);
  const [gekozenDag, setGekozenDag] = useState<string | null>(dagen[0]?.datum ?? null);
  const [gekozenMoment, setGekozenMoment] = useState<{ startsAt: string; label: string } | null>(
    null
  );
  const [gasten, setGasten] = useState<string[]>([]);
  const [gastInvoer, setGastInvoer] = useState("");

  if (state.status === "geboekt") {
    return (
      <section className="rounded-card border border-line-soft bg-white p-6 shadow-card sm:p-8">
        <span
          aria-hidden
          className="mb-3 flex size-10 items-center justify-center rounded-pill bg-success-wash text-lg text-success"
        >
          ✓
        </span>
        <h2 className="text-xl">De afspraak staat genoteerd</h2>
        <p className="mt-2 font-semibold text-ink">{state.wanneer}</p>
        <p className="mt-1 text-muted">
          {vormTekst}
          {locatie ? ` · ${locatie}` : ""}
          {eigenaarNaam ? ` · met ${eigenaarNaam}` : ""}
        </p>
        <p className="mt-5 text-sm text-muted">
          {state.bevestigingVerstuurd
            ? "Je krijgt de bevestiging per e-mail. Komt het toch niet uit, antwoord dan gewoon op die mail."
            : "De bevestigingsmail kon niet worden verstuurd, maar de afspraak staat er wel. Wij nemen contact op als er iets onduidelijk is."}
        </p>
      </section>
    );
  }

  if (dagen.length === 0 || maanden.length === 0) {
    return (
      <section className="rounded-card border border-line-soft bg-white p-6 shadow-card">
        <h2 className="text-lg">Geen vrije momenten</h2>
        <p className="mt-2 text-muted">
          Er staat op dit moment niets vrij in de agenda. Mail naar{" "}
          <a href="mailto:info@skoolworkshop.nl" className="underline underline-offset-2">
            info@skoolworkshop.nl
          </a>{" "}
          en dan zoeken we samen een moment.
        </p>
      </section>
    );
  }

  // ---------------------------------------------------------------------------
  // Stap 2: de gegevens
  // ---------------------------------------------------------------------------
  if (gekozenMoment && gekozenDag) {
    return (
      <>
        <Stappen stap={2} />
        <section className="rounded-card border border-line-soft bg-white p-5 shadow-card sm:p-6">
          <h2 className="text-lg">Jouw informatie</h2>
          <p className="mt-2 font-semibold text-ink">
            {dagLabel(gekozenDag)} om {gekozenMoment.label}{" "}
            <button
              type="button"
              onClick={() => setGekozenMoment(null)}
              className="ml-1 text-sm font-semibold text-accent-strong underline underline-offset-2"
            >
              Bewerken
            </button>
          </p>
          <p className="mt-0.5 text-sm text-muted">
            {duurTekst} · {vormTekst}
            {locatie ? ` · ${locatie}` : ""}
          </p>

          <form action={formAction} className="mt-6 space-y-4">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="startsAt" value={gekozenMoment.startsAt} />
            <input type="hidden" name="tijdzone" value={tijdzone} />
            <input type="hidden" name="gasten" value={gasten.join(",")} />

            {/* Een veld dat een mens nooit ziet en dus nooit invult. Een robot
                die alles invult, verraadt zichzelf hiermee. Weggeklemd met clip
                en niet met een grote negatieve positie: dat laatste rekt de
                pagina op en gaf op een telefoon zijwaarts geschuif. */}
            <div
              aria-hidden
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                overflow: "hidden",
                clipPath: "inset(50%)",
                whiteSpace: "nowrap",
              }}
            >
              <label htmlFor="website">Laat dit veld leeg</label>
              <input id="website" name="website" tabIndex={-1} autoComplete="off" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Veld id="voornaam" label="Voornaam" verplicht autoComplete="given-name" />
              <Veld id="achternaam" label="Achternaam" verplicht autoComplete="family-name" />
              <div className="sm:col-span-2">
                <Veld
                  id="email"
                  label="Jouw e-mailadres"
                  verplicht
                  type="email"
                  autoComplete="email"
                />
              </div>
              <div className="sm:col-span-2">
                <Veld
                  id="telefoon"
                  label="Mobiel telefoonnummer"
                  verplicht
                  type="tel"
                  autoComplete="tel"
                />
              </div>
              <div className="sm:col-span-2">
                {/* Op de HubSpot-schermafbeelding staat hier geen sterretje.
                    Dus optioneel, en niet verplicht zoals ik het eerst had. */}
                <Veld id="organisatie" label="Naam onderneming" autoComplete="organization" />
              </div>
            </div>

            <fieldset className="border-t border-line-soft pt-4">
              <legend className="sr-only">Gasten toevoegen</legend>
              <p className="text-sm font-semibold text-ink">Iemand meenemen?</p>
              <p className="mb-2 text-sm text-muted">
                Vul het e-mailadres in van een collega die erbij wil zijn. Maximaal tien.
              </p>

              {gasten.length > 0 ? (
                <ul className="mb-2 flex flex-wrap gap-1.5">
                  {gasten.map((adres) => (
                    <li
                      key={adres}
                      className="flex items-center gap-1.5 rounded-pill bg-surface-2 py-1 pl-3 pr-1.5 text-sm"
                    >
                      <span className="break-all">{adres}</span>
                      <button
                        type="button"
                        onClick={() => setGasten((was) => was.filter((a) => a !== adres))}
                        aria-label={`${adres} weghalen`}
                        className="flex size-5 shrink-0 items-center justify-center rounded-pill text-muted hover:bg-surface-3 hover:text-ink"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <label htmlFor="gast" className="sr-only">
                  E-mailadres van een gast
                </label>
                <input
                  id="gast"
                  type="email"
                  value={gastInvoer}
                  onChange={(e) => setGastInvoer(e.target.value)}
                  placeholder="collega@school.nl"
                  disabled={gasten.length >= 10}
                  className="h-11 min-w-0 flex-1 rounded-card border border-line bg-white px-3 text-base"
                />
                <button
                  type="button"
                  disabled={gasten.length >= 10 || !gastInvoer.includes("@")}
                  onClick={() => {
                    const schoon = gastInvoer.trim().toLowerCase();
                    if (!schoon.includes("@") || gasten.includes(schoon)) return;
                    setGasten((was) => [...was, schoon].slice(0, 10));
                    setGastInvoer("");
                  }}
                  className="min-h-11 rounded-pill bg-surface-3 px-4 text-sm font-semibold text-ink disabled:opacity-50"
                >
                  Toevoegen
                </button>
              </div>
            </fieldset>

            {state.status === "fout" ? (
              <p className="rounded-card bg-danger-wash px-4 py-3 text-sm text-danger">
                {state.melding}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-4">
              <button
                type="button"
                onClick={() => setGekozenMoment(null)}
                className="min-h-11 rounded-pill border border-line px-5 text-sm font-semibold text-ink"
              >
                Terug
              </button>
              <Knop label="Bevestigen" />
            </div>
          </form>
        </section>
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Stap 1: kalender en tijden
  // ---------------------------------------------------------------------------
  const huidigeMaand = maanden[Math.min(maandIndex, maanden.length - 1)];
  const weken = maandRooster(huidigeMaand);
  const dagVanKalender = gekozenDag && maandSleutel(gekozenDag) === huidigeMaand ? gekozenDag : null;
  const momenten = dagVanKalender ? (perDag.get(dagVanKalender)?.momenten ?? []) : [];
  const [jaar, maand] = huidigeMaand.split("-").map(Number);

  return (
    <>
      <Stappen stap={1} />

      <section className="overflow-hidden rounded-card border border-line-soft bg-white shadow-card">
        <div className="grid lg:grid-cols-2">
          {/* De kalender. Donker vlak, zoals op de schermafbeelding, maar dan
              met onze eigen inkt in plaats van HubSpot-zwart. */}
          <div className="bg-ink px-4 py-6 text-white sm:px-6">
            {eigenaarNaam ? (
              <p className="mb-4 text-center text-lg">Afspraak met {eigenaarNaam}</p>
            ) : null}

            <div className="mb-4 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setMaandIndex((i) => Math.max(i - 1, 0))}
                disabled={maandIndex === 0}
                aria-label="Vorige maand"
                className="flex size-9 items-center justify-center rounded-pill text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
              >
                ‹
              </button>
              <p className="min-w-[10rem] text-center font-semibold">
                {MAAND[maand - 1]} {jaar}
              </p>
              <button
                type="button"
                onClick={() => setMaandIndex((i) => Math.min(i + 1, maanden.length - 1))}
                disabled={maandIndex >= maanden.length - 1}
                aria-label="Volgende maand"
                className="flex size-9 items-center justify-center rounded-pill text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
              >
                ›
              </button>
            </div>

            <table className="w-full table-fixed">
              <caption className="sr-only">
                Kies een dag in {MAAND[maand - 1]} {jaar}. Alleen dagen met vrije tijden zijn
                aanklikbaar.
              </caption>
              <thead>
                <tr>
                  {WEEKDAG_KORT.map((dag) => (
                    <th
                      key={dag}
                      scope="col"
                      className="pb-2 text-center text-xs font-semibold uppercase text-white/60"
                    >
                      {dag}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weken.map((week, i) => (
                  <tr key={i}>
                    {week.map((datum, j) => {
                      if (!datum) return <td key={j} className="p-1" />;
                      const beschikbaar = perDag.has(datum);
                      const actief = datum === dagVanKalender;
                      return (
                        <td key={j} className="p-1 text-center">
                          <button
                            type="button"
                            disabled={!beschikbaar}
                            aria-pressed={actief}
                            aria-label={dagLabel(datum)}
                            onClick={() => {
                              setGekozenDag(datum);
                              setGekozenMoment(null);
                            }}
                            className={cn(
                              "flex size-10 items-center justify-center rounded-pill text-sm tabular-nums transition-colors",
                              actief
                                ? "bg-white font-semibold text-ink"
                                : beschikbaar
                                  ? "font-semibold text-white hover:bg-white/15"
                                  : "cursor-default text-white/25"
                            )}
                          >
                            {ontleed(datum).dag}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* De tijden. */}
          <div className="px-4 py-6 sm:px-6">
            <p className="text-sm font-semibold text-ink">Waar</p>
            <p className="mb-4 text-muted">
              {vormTekst}
              {locatie ? ` · ${locatie}` : ""}
            </p>

            <p className="text-sm font-semibold text-ink">Hoe lang</p>
            <p className="mb-4">
              <span className="inline-flex rounded-pill bg-surface-2 px-3 py-1 text-sm font-semibold">
                {duurTekst}
              </span>
            </p>

            <p className="text-sm font-semibold text-ink">Welke tijd komt het best uit?</p>
            <p className="text-muted">
              {dagVanKalender ? (
                <>Tijden voor {dagLabel(dagVanKalender)}</>
              ) : (
                <>Kies eerst een dag in de kalender.</>
              )}
            </p>
            <p className="mb-3 mt-1 text-xs text-muted-soft">{tijdzoneLabel}</p>

            {momenten.length > 0 ? (
              <ul className="max-h-[22rem] space-y-2 overflow-y-auto pr-1">
                {momenten.map((moment) => (
                  <li key={moment.startsAt}>
                    <button
                      type="button"
                      onClick={() =>
                        setGekozenMoment({ startsAt: moment.startsAt, label: moment.label })
                      }
                      className="min-h-11 w-full rounded-card border border-line bg-white text-sm font-semibold tabular-nums transition-colors hover:border-ink"
                    >
                      {moment.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : dagVanKalender ? (
              <p className="text-sm text-muted">Op deze dag is niets meer vrij.</p>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}

function Veld({
  id,
  label,
  verplicht = false,
  type = "text",
  autoComplete,
}: {
  id: string;
  label: string;
  verplicht?: boolean;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">
        {label}
        {verplicht ? <span className="ml-0.5 text-accent-strong">*</span> : null}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        required={verplicht}
        autoComplete={autoComplete}
        inputMode={type === "email" ? "email" : type === "tel" ? "tel" : undefined}
        className="h-11 w-full rounded-card border border-line bg-white px-3 text-base"
      />
    </div>
  );
}
