"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import type { VrijeDag } from "@/lib/crm/beschikbaarheid";
import { boekAfspraakAction, type BoekingState } from "@/app/afspraak/[slug]/actions";
import { cn } from "@/lib/utils";

/**
 * Kiezen en boeken, in twee stappen.
 *
 * Eerst een moment, dan je gegevens. Dat is niet alleen prettiger dan een
 * formulier met acht velden ineens; het scheelt ook dat iemand zijn
 * telefoonnummer invult voor een moment dat al bezet blijkt.
 *
 * De datums worden hier in de browser opgemaakt, met de tijdzone van de link.
 * Zo ziet een school in Nederland Nederlandse tijden, ook als hij vanaf
 * vakantie boekt.
 */

const WEEKDAG = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
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

function dagLabel(datum: string): string {
  const [jaar, maand, dag] = datum.split("-").map(Number);
  const d = new Date(Date.UTC(jaar, maand - 1, dag));
  return `${WEEKDAG[d.getUTCDay()]} ${dag} ${MAAND[maand - 1]}`;
}

function Knop({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 w-full rounded-pill bg-ink px-6 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
    >
      {pending ? "Bezig…" : label}
    </button>
  );
}

const begin: BoekingState = { status: "idle" };

export function BoekingsFormulier({
  slug,
  dagen,
  tijdzone,
  duurTekst,
}: {
  slug: string;
  dagen: VrijeDag[];
  tijdzone: string;
  duurTekst: string;
}) {
  const [gekozen, setGekozen] = useState<{ startsAt: string; label: string; datum: string } | null>(
    null
  );
  const [state, formAction] = useActionState(boekAfspraakAction, begin);

  if (state.status === "geboekt") {
    return (
      <section className="rounded-card border border-line-soft bg-white p-6 shadow-card">
        <h2 className="text-lg">De afspraak staat genoteerd</h2>
        <p className="mt-2 text-muted">{state.wanneer}</p>
        <p className="mt-4 text-sm text-muted">
          {state.bevestigingVerstuurd
            ? "Je krijgt de bevestiging per e-mail. Komt het toch niet uit, antwoord dan gewoon op die mail."
            : "De bevestigingsmail kon niet worden verstuurd, maar de afspraak staat er wel. Wij nemen contact op als er iets onduidelijk is."}
        </p>
      </section>
    );
  }

  if (dagen.length === 0) {
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

  return (
    <>
      <section className="mb-6">
        <h2 className="mb-3 text-lg">Kies een moment</h2>
        <div className="space-y-4">
          {dagen.slice(0, 14).map((dag) => (
            <div key={dag.datum}>
              <p className="mb-1.5 text-sm font-semibold text-ink">{dagLabel(dag.datum)}</p>
              <div className="flex flex-wrap gap-2">
                {dag.momenten.map((moment) => {
                  const actief = gekozen?.startsAt === moment.startsAt;
                  return (
                    <button
                      key={moment.startsAt}
                      type="button"
                      aria-pressed={actief}
                      onClick={() =>
                        setGekozen({
                          startsAt: moment.startsAt,
                          label: moment.label,
                          datum: dag.datum,
                        })
                      }
                      className={cn(
                        "min-h-11 rounded-pill border px-4 text-sm font-semibold tabular-nums transition-colors",
                        actief
                          ? "border-ink bg-ink text-white"
                          : "border-line bg-white text-ink hover:border-ink"
                      )}
                    >
                      {moment.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {gekozen ? (
        <section className="rounded-card border border-line-soft bg-white p-5 shadow-card sm:p-6">
          <h2 className="text-lg">Je gegevens</h2>
          <p className="mt-1 text-sm text-muted">
            {dagLabel(gekozen.datum)} om {gekozen.label} · {duurTekst}
          </p>

          <form action={formAction} className="mt-5 space-y-4">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="startsAt" value={gekozen.startsAt} />
            <input type="hidden" name="tijdzone" value={tijdzone} />

            {/* Een veld dat een mens nooit ziet en dus nooit invult. Een robot
                die alles invult, verraadt zichzelf hiermee.

                Bewust weggeklemd met clip en niet met een grote negatieve
                positie: dat laatste rekt de pagina op en gaf op een telefoon
                zijwaarts geschuif. */}
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
              <div>
                <label htmlFor="voornaam" className="mb-1 block text-sm font-semibold">
                  Voornaam
                </label>
                <input
                  id="voornaam"
                  name="voornaam"
                  required
                  autoComplete="given-name"
                  className="h-11 w-full rounded-card border border-line bg-white px-3 text-base"
                />
              </div>
              <div>
                <label htmlFor="achternaam" className="mb-1 block text-sm font-semibold">
                  Achternaam
                </label>
                <input
                  id="achternaam"
                  name="achternaam"
                  required
                  autoComplete="family-name"
                  className="h-11 w-full rounded-card border border-line bg-white px-3 text-base"
                />
              </div>
              <div>
                <label htmlFor="email" className="mb-1 block text-sm font-semibold">
                  Jouw e-mailadres
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  inputMode="email"
                  className="h-11 w-full rounded-card border border-line bg-white px-3 text-base"
                />
              </div>
              <div>
                <label htmlFor="telefoon" className="mb-1 block text-sm font-semibold">
                  Mobiel telefoonnummer
                </label>
                <input
                  id="telefoon"
                  name="telefoon"
                  type="tel"
                  required
                  autoComplete="tel"
                  inputMode="tel"
                  className="h-11 w-full rounded-card border border-line bg-white px-3 text-base"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="organisatie" className="mb-1 block text-sm font-semibold">
                  Naam onderneming
                </label>
                <input
                  id="organisatie"
                  name="organisatie"
                  required
                  autoComplete="organization"
                  className="h-11 w-full rounded-card border border-line bg-white px-3 text-base"
                />
              </div>
            </div>

            {state.status === "fout" ? (
              <p className="rounded-card bg-danger-wash px-4 py-3 text-sm text-danger">
                {state.melding}
              </p>
            ) : null}

            <Knop label="Afspraak vastleggen" />
          </form>
        </section>
      ) : null}
    </>
  );
}
