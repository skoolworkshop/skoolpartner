"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { formatShortDate, formatTime } from "@/lib/format";
import type { AanbodRonde, PubliekeDag } from "@/lib/inschrijving/publiek";
import type { Stand } from "@/app/inschrijven/[slug]/actions";
import { bevestigNaamAction, codeAction, kiesAction, standAction, zoekAction } from "@/app/inschrijven/[slug]/actions";

/**
 * De inschrijfpagina voor een leerling.
 *
 * DRIE STAPPEN, EEN SCHERM
 *
 *   Klas kiezen, je naam typen, en dan per ronde een workshop. Geen account,
 *   geen wachtwoord, geen mailtje om te bevestigen. Dit moet lukken op een
 *   telefoon, in de pauze, bij een leerling van tien.
 *
 * JE EIGEN CODE
 *
 *   Normaal meld je je met de persoonlijke code die je van je mentor hebt
 *   gekregen. Alleen een naam is namelijk geen bewijs: iedereen in de klas
 *   kent elkaars naam, en dan kan een klasgenoot jouw workshops omgooien.
 *   Met een code hoeft er ook geen klassenlijst op het scherm.
 *
 * WAT ER NIET OP STAAT
 *
 *   De namen van klasgenoten. Op codes staat er helemaal geen naam op het
 *   scherm tot je je eigen code hebt ingevuld. Zoekt een school toch liever
 *   op naam, dan komen er hooguit vijf namen uit je eigen klas in beeld bij
 *   een typefout.
 *
 * VOL IS VOL
 *
 *   Een volle workshop blijft staan, maar zonder knop. Weghalen zou
 *   verwarrender zijn: dan denk je dat je iets verkeerd ziet, terwijl iemand
 *   gewoon eerder was.
 */

type Stap = "wie" | "kiezen";

export function InschrijfFlow({ slug, dag }: { slug: string; dag: PubliekeDag }) {
  const [stap, setStap] = useState<Stap>("wie");
  const [groepId, setGroepId] = useState("");
  const [groepNaam, setGroepNaam] = useState("");
  const [code, setCode] = useState("");
  const [naam, setNaam] = useState("");
  const [melding, setMelding] = useState<string | null>(null);
  const [suggesties, setSuggesties] = useState<{ id: string; naam: string }[]>([]);
  const [deelnemer, setDeelnemer] = useState<{ id: string; claim: string; naam: string } | null>(null);
  const [stand, setStand] = useState<Stand | null>(null);
  const [bezig, start] = useTransition();

  function opnieuw() {
    setStap("wie");
    setDeelnemer(null);
    setStand(null);
    setSuggesties([]);
    setMelding(null);
    setNaam("");
    setCode("");
  }

  /**
   * Inloggen met de eigen code.
   *
   * Eén veld, en bij een fout één nuchtere melding. Geen hint over welke klas
   * of welke naam er wel bij een code hoort.
   */
  async function meldAanMetCode() {
    setMelding(null);

    const uitkomst = await codeAction({ slug, code });

    if (uitkomst.soort === "gevonden") {
      setDeelnemer({ id: uitkomst.deelnemerId, claim: uitkomst.claim, naam: uitkomst.naam });
      setGroepId(uitkomst.groepId);
      setGroepNaam(uitkomst.groepNaam);
      setStap("kiezen");
      await haalStand(uitkomst.deelnemerId, uitkomst.claim);
      return;
    }

    if (uitkomst.soort === "vrijgesteld") {
      setMelding(`${uitkomst.naam} hoeft zich niet in te schrijven voor deze dag.`);
      return;
    }

    if (uitkomst.soort === "tevaak") {
      setMelding("Even wachten. Er zijn te veel pogingen gedaan. Probeer het over een minuut opnieuw.");
      return;
    }

    if (uitkomst.soort === "dicht") {
      setMelding("De inschrijving is inmiddels gesloten.");
      return;
    }

    setMelding("Deze code kennen we niet. Kijk hem nog een keer na, of vraag je mentor om een nieuwe.");
  }

  async function haalStand(id: string, claim: string) {
    setStand(await standAction({ slug, deelnemerId: id, claim }));
  }

  async function zoek() {
    setMelding(null);
    setSuggesties([]);

    const uitkomst = await zoekAction({ slug, groepId, naam });

    if (uitkomst.soort === "gevonden") {
      setDeelnemer({ id: uitkomst.deelnemerId, claim: uitkomst.claim, naam: uitkomst.naam });
      setGroepNaam(dag.groepen.find((groep) => groep.id === groepId)?.naam ?? "");
      setStap("kiezen");
      await haalStand(uitkomst.deelnemerId, uitkomst.claim);
      return;
    }

    if (uitkomst.soort === "bijna" || uitkomst.soort === "meerdere") {
      setSuggesties(uitkomst.kandidaten);
      setMelding(
        uitkomst.soort === "meerdere"
          ? "Er staan meerdere leerlingen met deze naam in je klas. Vraag je docent welke jij bent."
          : "Bedoel je dit?",
      );
      return;
    }

    if (uitkomst.soort === "vrijgesteld") {
      setMelding(`${uitkomst.naam} hoeft zich niet in te schrijven voor deze dag.`);
      return;
    }

    if (uitkomst.soort === "dicht") {
      setMelding("De inschrijving is inmiddels gesloten.");
      return;
    }

    setMelding(
      "Deze naam staat niet in de lijst van deze klas. Typ je naam zoals hij op school bekend is, of vraag je docent.",
    );
  }

  async function kiesNaam(id: string) {
    const uitkomst = await bevestigNaamAction({ slug, groepId, deelnemerId: id });
    if (!uitkomst.ok) {
      setMelding("Dat lukte niet. Probeer het opnieuw.");
      return;
    }
    setSuggesties([]);
    setMelding(null);
    setDeelnemer({ id, claim: uitkomst.claim, naam: uitkomst.naam });
    setGroepNaam(dag.groepen.find((groep) => groep.id === groepId)?.naam ?? "");
    setStap("kiezen");
    await haalStand(id, uitkomst.claim);
  }

  async function kies(sessieId: string) {
    if (!deelnemer) return;
    setMelding(null);
    const uitkomst = await kiesAction({ slug, deelnemerId: deelnemer.id, claim: deelnemer.claim, sessieId });
    if (uitkomst.stand) setStand(uitkomst.stand);
    if (!uitkomst.ok) setMelding(uitkomst.fout ?? "Dat lukte niet.");
  }

  const klaar = stand?.bevestiging ? stand.bevestiging.openRondes === 0 : false;

  return (
    <div className="space-y-5">
      {stap === "wie" && dag.codeModus ? (
        <section className="rounded-card border border-line-soft bg-white p-5 shadow-card">
          <h2 className="text-[22px]">Vul je code in</h2>
          <p className="mt-1 text-sm text-muted">
            Je hebt een eigen code gekregen van je mentor. Daarmee zie je straks alleen jouw eigen
            inschrijving.
          </p>

          <div className="mt-4 space-y-3">
            <Field label="Jouw code" htmlFor="code" required>
              <Input
                id="code"
                value={code}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                inputMode="text"
                className="max-w-56 font-mono text-lg tracking-[0.2em] uppercase"
                placeholder="ABCD-2345"
                onChange={(event) => setCode(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && code.trim().length >= 6) {
                    event.preventDefault();
                    start(() => void meldAanMetCode());
                  }
                }}
              />
            </Field>

            <Button
              type="button"
              variant="ink"
              disabled={bezig || code.trim().length < 6}
              onClick={() => start(() => void meldAanMetCode())}
            >
              {bezig ? "Bezig…" : "Verder"}
            </Button>

            <p className="text-sm text-muted">
              Code kwijt? Vraag je mentor. Die heeft de lijst met codes.
            </p>
          </div>

          {melding ? (
            <Alert tone="warning" className="mt-4">
              {melding}
            </Alert>
          ) : null}
        </section>
      ) : null}

      {stap === "wie" && !dag.codeModus ? (
        <section className="rounded-card border border-line-soft bg-white p-5 shadow-card">
          <h2 className="text-[22px]">Wie ben je?</h2>
          <p className="mt-1 text-sm text-muted">
            Kies je klas en typ je naam zoals hij op school bekend is.
          </p>

          <div className="mt-4 space-y-3">
            <Field label="Klas" htmlFor="groep" required>
              <Select id="groep" value={groepId} onChange={(event) => setGroepId(event.target.value)}>
                <option value="">Kies je klas</option>
                {dag.groepen.map((groep) => (
                  <option key={groep.id} value={groep.id}>
                    {groep.naam}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Je naam" htmlFor="naam" required>
              <Input
                id="naam"
                value={naam}
                autoComplete="off"
                placeholder="Bijvoorbeeld Lissa van der Velde"
                onChange={(event) => setNaam(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && groepId && naam.trim().length >= 2) {
                    event.preventDefault();
                    start(() => void zoek());
                  }
                }}
              />
            </Field>

            <Button
              type="button"
              variant="ink"
              disabled={bezig || !groepId || naam.trim().length < 2}
              onClick={() => start(() => void zoek())}
            >
              {bezig ? "Bezig…" : "Verder"}
            </Button>
          </div>

          {melding ? (
            <Alert tone={suggesties.length > 0 ? "info" : "warning"} className="mt-4">
              {melding}
            </Alert>
          ) : null}

          {suggesties.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {suggesties.map((suggestie) => (
                <li key={suggestie.id}>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={bezig}
                    onClick={() => start(() => void kiesNaam(suggestie.id))}
                  >
                    {suggestie.naam}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {stap === "kiezen" && deelnemer ? (
        <>
          <section className="rounded-card border border-line-soft bg-white p-5 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-[22px]">Hoi {deelnemer.naam.split(" ")[0]}</h2>
                <p className="text-sm text-muted">
                  {groepNaam ? `${groepNaam} · ` : ""}
                  {formatShortDate(dag.datum)}
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={opnieuw}>
                Ik ben iemand anders
              </Button>
            </div>

            {klaar ? (
              <Alert tone="success" className="mt-4">
                Je bent ingeschreven voor alle rondes. Je kunt je keuze nog wijzigen zolang de inschrijving open
                staat.
              </Alert>
            ) : (
              <Alert tone="info" className="mt-4">
                Kies per ronde een workshop. Je kunt later nog wisselen zolang de inschrijving open staat.
              </Alert>
            )}

            {melding ? (
              <Alert tone="warning" className="mt-3">
                {melding}
              </Alert>
            ) : null}
          </section>

          {(stand?.aanbod ?? []).map((ronde) => (
            <RondeKaart
              key={ronde.id}
              ronde={ronde}
              bezig={bezig}
              onKies={(sessieId) => start(() => void kies(sessieId))}
            />
          ))}

          {stand?.bevestiging ? <Bevestigingsblok bevestiging={stand.bevestiging} /> : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * Eén ronde met zijn mogelijkheden.
 *
 * Los van de rest, zodat de visuele controle in tools/harness hem kan tonen
 * met verzonnen gegevens: een volle workshop, een workshop die je al doet, en
 * een ronde waarin niets voor jouw klas draait.
 */
export function RondeKaart({
  ronde,
  bezig = false,
  onKies,
}: {
  ronde: AanbodRonde;
  bezig?: boolean;
  onKies: (sessieId: string) => void;
}) {
  return (
    <section className="rounded-card border border-line-soft bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-bold">{ronde.label}</h3>
        <span className="text-sm text-muted">
          {formatTime(ronde.begin)} tot {formatTime(ronde.eind)}
        </span>
      </div>

      {ronde.pauze ? (
        <p className="mt-2 text-sm text-muted">Pauze. Hier hoef je niets te kiezen.</p>
      ) : ronde.mogelijkheden.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          Er is in deze ronde niets voor jouw klas. Laat dit even weten aan je docent.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {ronde.mogelijkheden.map((optie) => {
            const vol = optie.vrij <= 0 && !optie.gekozen;
            const geblokkeerd = vol || optie.alGekozen;

            return (
              <li key={optie.id}>
                <button
                  type="button"
                  disabled={bezig || geblokkeerd || optie.gekozen}
                  onClick={() => onKies(optie.id)}
                  className={[
                    "flex w-full items-center justify-between gap-3 rounded-card border px-4 py-3 text-left transition-colors",
                    optie.gekozen
                      ? "border-ink bg-ink text-white"
                      : geblokkeerd
                        ? "cursor-not-allowed border-line-soft bg-surface-2 text-muted"
                        : "border-line bg-white hover:bg-surface-2",
                  ].join(" ")}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {optie.naam}
                      {optie.label ? ` · ${optie.label}` : ""}
                    </span>
                    <span className={["block text-xs", optie.gekozen ? "text-white/80" : "text-muted"].join(" ")}>
                      {optie.ruimte ? `${optie.ruimte} · ` : ""}
                      {optie.gekozen
                        ? "Dit heb je gekozen"
                        : optie.alGekozen
                          ? "Deze doe je al in een andere ronde"
                          : vol
                            ? "Vol"
                            : `nog ${optie.vrij} ${optie.vrij === 1 ? "plek" : "plekken"}`}
                    </span>
                  </span>
                  {optie.gekozen ? <span aria-hidden>✓</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** De persoonlijke planning, zoals die ook in de mail en de pdf komt. */
export function Bevestigingsblok({ bevestiging }: { bevestiging: NonNullable<Stand["bevestiging"]> }) {
  const gekozen = bevestiging.rondes.filter((ronde) => ronde.workshop !== null);
  if (gekozen.length === 0) return null;

  const apps = gekozen.filter((ronde) => ronde.app !== null);
  const spullen = gekozen.filter((ronde) => ronde.spullen);

  return (
    <section className="rounded-card border border-line-soft bg-white p-5 shadow-card print:border-0 print:shadow-none">
      <h3 className="text-lg font-bold">Jouw dag</h3>
      <p className="text-sm text-muted">
        {bevestiging.deelnemer} · {bevestiging.groep} · {bevestiging.organisatie} ·{" "}
        {formatShortDate(bevestiging.datum)}
        {bevestiging.locatie ? ` · ${bevestiging.locatie}` : ""}
      </p>

      <ul className="mt-3 divide-y divide-line-soft">
        {bevestiging.rondes.map((ronde) => (
          <li key={ronde.label} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 text-sm">
            <span className="font-semibold">{ronde.label}</span>
            <span className="text-muted">
              {formatTime(ronde.begin)} tot {formatTime(ronde.eind)}
            </span>
            <span className="w-full sm:w-auto">
              {ronde.pauze
                ? "Pauze"
                : ronde.workshop
                  ? `${ronde.workshop}${ronde.uitvoering ? ` · ${ronde.uitvoering}` : ""}${
                      ronde.ruimte ? ` · ${ronde.ruimte}` : ""
                    }`
                  : "Nog niets gekozen"}
            </span>
          </li>
        ))}
      </ul>

      {apps.length > 0 ? (
        <div className="mt-4 rounded-card bg-surface-2 p-4">
          <h4 className="font-semibold">Installeer dit vooraf</h4>
          {apps.map((ronde) => (
            <div key={ronde.label} className="mt-2 text-sm">
              <p className="font-semibold">
                {ronde.workshop}: {ronde.app?.naam}
              </p>
              {ronde.app?.uitleg ? <p className="text-muted">{ronde.app.uitleg}</p> : null}
              <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {ronde.app?.android ? (
                  <a className="font-semibold underline" href={ronde.app.android} rel="noreferrer noopener" target="_blank">
                    Android
                  </a>
                ) : null}
                {ronde.app?.ios ? (
                  <a className="font-semibold underline" href={ronde.app.ios} rel="noreferrer noopener" target="_blank">
                    iPhone
                  </a>
                ) : null}
                {ronde.app?.web ? (
                  <a className="font-semibold underline" href={ronde.app.web} rel="noreferrer noopener" target="_blank">
                    In de browser
                  </a>
                ) : null}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {spullen.length > 0 ? (
        <div className="mt-3 rounded-card bg-surface-2 p-4 text-sm">
          <h4 className="font-semibold">Neem mee</h4>
          <ul className="mt-1 list-disc pl-5">
            {spullen.map((ronde) => (
              <li key={ronde.label}>
                {ronde.workshop}: {ronde.spullen}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 print:hidden">
        <Button type="button" variant="secondary" size="sm" onClick={() => window.print()}>
          Opslaan of printen
        </Button>
      </div>
    </section>
  );
}
