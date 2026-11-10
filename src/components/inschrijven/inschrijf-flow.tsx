"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { formatShortDate, formatTime } from "@/lib/format";
import type { AanbodRonde, PubliekeDag } from "@/lib/inschrijving/publiek";
import type { Stand } from "@/app/inschrijven/[slug]/actions";
import {
  bevestigCodeAction,
  bevestigNaamAction,
  codeAction,
  kiesAction,
  mailZoekAction,
  poortAction,
  standAction,
  vraagCodeAction,
  zoekAction,
} from "@/app/inschrijven/[slug]/actions";

/**
 * De inschrijfpagina voor een leerling.
 *
 * TWEE DEUREN, EEN SCHERM
 *
 *   Eerst de toegangscode van de dag. Die krijgt de hele klas van de docent,
 *   samen met de link. Hij zegt alleen dat je bij deze dag hoort.
 *
 *   Daarna bewijzen wie je bent. Dat gaat op één van twee manieren, en welke
 *   het is bepaalt de beheerder per dag:
 *
 *     je persoonlijke code, die je van je mentor hebt gekregen, of
 *     een cijfercode die naar je schoolmail gaat.
 *
 *   Alleen je naam aanklikken kan ook, maar dat staat standaard uit. Iedereen
 *   in de klas kent namelijk elkaars naam, en dan kan een klasgenoot jouw
 *   workshops omgooien.
 *
 * WAT ER NIET OP STAAT
 *
 *   De namen van klasgenoten. Op codes staat er helemaal geen naam op het
 *   scherm tot je je eigen code hebt ingevuld. Gaat het via de schoolmail, dan
 *   komen er hooguit vijf namen uit je eigen klas in beeld bij een typefout,
 *   en daar komt niets achter vandaan zonder de code uit de mail.
 *
 * OP EEN TELEFOON
 *
 *   Eén veld per stap, grote knoppen, en het juiste toetsenbord: cijfers bij
 *   een cijfercode. Dit moet lukken in de pauze, op een schoolplein, bij een
 *   leerling van tien.
 *
 * VOL IS VOL
 *
 *   Een volle workshop blijft staan, maar zonder knop. Weghalen zou
 *   verwarrender zijn: dan denk je dat je iets verkeerd ziet, terwijl iemand
 *   gewoon eerder was.
 */

type Stap = "poort" | "wie" | "mailcode" | "kiezen";

export function InschrijfFlow({
  slug,
  dag,
  beginStap = "poort",
}: {
  slug: string;
  dag: PubliekeDag;
  /**
   * Alleen voor de visuele controle in tools/harness: daarmee is elke stap op
   * 390 pixels te bekijken zonder dat er een echte code ingevuld hoeft te
   * worden. In de app begint het altijd bij de toegangscode van de dag.
   */
  beginStap?: Stap;
}) {
  const [stap, setStap] = useState<Stap>(beginStap);
  const [toegang, setToegang] = useState("");
  const [poortCode, setPoortCode] = useState("");
  const [groepId, setGroepId] = useState("");
  const [groepNaam, setGroepNaam] = useState("");
  const [code, setCode] = useState("");
  const [naam, setNaam] = useState("");
  const [melding, setMelding] = useState<string | null>(null);
  const [suggesties, setSuggesties] = useState<{ id: string; naam: string }[]>([]);
  const [wachtOpMail, setWachtOpMail] = useState<{ id: string; naam: string; adres: string } | null>(null);
  const [mailCode, setMailCode] = useState("");
  const [deelnemer, setDeelnemer] = useState<{ id: string; claim: string; naam: string } | null>(null);
  const [stand, setStand] = useState<Stand | null>(null);
  const [bezig, start] = useTransition();

  function opnieuw() {
    setStap("wie");
    setDeelnemer(null);
    setStand(null);
    setSuggesties([]);
    setWachtOpMail(null);
    setMailCode("");
    setMelding(null);
    setNaam("");
    setCode("");
  }

  /**
   * De toegangscode van de dag.
   *
   * Eén code voor de hele school. Hij wordt bij elke volgende stap opnieuw
   * meegestuurd en opnieuw gecontroleerd, dus hij blijft hier staan.
   */
  async function doePoort() {
    setMelding(null);
    const uitkomst = await poortAction({ slug, code: poortCode });

    if (uitkomst.ok) {
      setToegang(poortCode);
      setStap("wie");
      return;
    }

    if (uitkomst.reden === "tevaak") {
      setMelding("Even wachten. Er zijn te veel pogingen gedaan. Probeer het over tien minuten opnieuw.");
      return;
    }
    if (uitkomst.reden === "uit") {
      setMelding("Voor deze dag staat nog geen toegangscode klaar. Vraag je docent om hem op te vragen bij ons.");
      return;
    }
    if (uitkomst.reden === "dicht") {
      setMelding("De inschrijving is inmiddels gesloten.");
      return;
    }
    setMelding("Deze toegangscode klopt niet. Kijk hem nog een keer na bij je docent.");
  }

  /** De naam opzoeken om een cijfercode naar de schoolmail te sturen. */
  async function zoekVoorMail() {
    setMelding(null);
    setSuggesties([]);

    const uitkomst = await mailZoekAction({ slug, toegang, groepId, naam });

    if (uitkomst.soort === "verificatie") {
      await vraagMailCode(uitkomst.deelnemerId, uitkomst.naam);
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

    if (uitkomst.soort === "geen-adres") {
      setMelding("Van jou staat geen e-mailadres in de lijst. Vraag je docent om je in te schrijven.");
      return;
    }

    if (uitkomst.soort === "vrijgesteld") {
      setMelding(`${uitkomst.naam} hoeft zich niet in te schrijven voor deze dag.`);
      return;
    }

    if (uitkomst.soort === "tevaak") {
      setMelding("Even wachten. Er zijn te veel pogingen gedaan. Probeer het over tien minuten opnieuw.");
      return;
    }

    if (uitkomst.soort === "dicht" || uitkomst.soort === "poort") {
      setMelding("De inschrijving is inmiddels gesloten.");
      return;
    }

    setMelding(
      "Deze naam staat niet in de lijst van deze klas. Typ je naam zoals hij op school bekend is, of vraag je docent.",
    );
  }

  /** De cijfercode laten versturen naar het adres dat de school van je heeft. */
  async function vraagMailCode(id: string, wie: string) {
    setMelding(null);
    const uitkomst = await vraagCodeAction({ slug, toegang, deelnemerId: id });

    if (!uitkomst.ok) {
      setMelding(uitkomst.reden);
      return;
    }

    setSuggesties([]);
    setWachtOpMail({ id, naam: wie, adres: uitkomst.adres });
    setMailCode("");
    setStap("mailcode");
  }

  /** De cijfercode uit de mail controleren. */
  async function bevestigMailCode() {
    if (!wachtOpMail) return;
    setMelding(null);

    const uitkomst = await bevestigCodeAction({
      slug,
      toegang,
      deelnemerId: wachtOpMail.id,
      code: mailCode,
    });

    if (!uitkomst.ok) {
      setMelding(uitkomst.reden);
      return;
    }

    setDeelnemer({ id: uitkomst.deelnemerId, claim: uitkomst.claim, naam: uitkomst.naam });
    setGroepNaam(uitkomst.groepNaam);
    setWachtOpMail(null);
    setStap("kiezen");
    await haalStand(uitkomst.deelnemerId, uitkomst.claim);
  }

  /**
   * Inloggen met de eigen code.
   *
   * Eén veld, en bij een fout één nuchtere melding. Geen hint over welke klas
   * of welke naam er wel bij een code hoort.
   */
  async function meldAanMetCode() {
    setMelding(null);

    const uitkomst = await codeAction({ slug, toegang, code });

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
      setMelding("Even wachten. Er zijn te veel pogingen gedaan. Probeer het over tien minuten opnieuw.");
      return;
    }

    if (uitkomst.soort === "dicht" || uitkomst.soort === "poort") {
      setMelding("De inschrijving is inmiddels gesloten.");
      return;
    }

    setMelding("Deze code kennen we niet. Kijk hem nog een keer na, of vraag je mentor om een nieuwe.");
  }

  async function haalStand(id: string, claim: string) {
    setStand(await standAction({ slug, toegang, deelnemerId: id, claim }));
  }

  async function zoek() {
    setMelding(null);
    setSuggesties([]);

    const uitkomst = await zoekAction({ slug, toegang, groepId, naam });

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

    if (uitkomst.soort === "tevaak") {
      setMelding("Even wachten. Er zijn te veel pogingen gedaan. Probeer het over tien minuten opnieuw.");
      return;
    }

    if (uitkomst.soort === "dicht" || uitkomst.soort === "poort") {
      setMelding("De inschrijving is inmiddels gesloten.");
      return;
    }

    setMelding(
      "Deze naam staat niet in de lijst van deze klas. Typ je naam zoals hij op school bekend is, of vraag je docent.",
    );
  }

  async function kiesNaam(id: string) {
    const uitkomst = await bevestigNaamAction({ slug, toegang, groepId, deelnemerId: id });
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
    const uitkomst = await kiesAction({
      slug,
      toegang,
      deelnemerId: deelnemer.id,
      claim: deelnemer.claim,
      sessieId,
    });
    if (uitkomst.stand) setStand(uitkomst.stand);
    if (!uitkomst.ok) setMelding(uitkomst.fout ?? "Dat lukte niet.");
  }

  const klaar = stand?.bevestiging ? stand.bevestiging.openRondes === 0 : false;

  const opNaam = dag.toegangswijze === "naam" || dag.toegangswijze === "schoolmail";

  return (
    <div className="space-y-5">
      {stap === "poort" ? (
        <section className="rounded-card border border-line-soft bg-white p-5 shadow-card">
          {dag.gedeeldeCodeNodig ? (
            <>
              <h2 className="text-[22px]">Toegangscode van de dag</h2>
              <p className="mt-1 text-sm text-muted">
                Deze code heeft je docent gekregen. Hij is voor je hele klas hetzelfde.
              </p>

              <div className="mt-4 space-y-3">
                <Field label="Toegangscode" htmlFor="poort" required>
                  <Input
                    id="poort"
                    value={poortCode}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    className="max-w-56 font-mono text-lg uppercase tracking-[0.2em]"
                    placeholder="ABCD-2345"
                    onChange={(event) => setPoortCode(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && poortCode.trim().length >= 6) {
                        event.preventDefault();
                        start(() => void doePoort());
                      }
                    }}
                  />
                </Field>

                <Button
                  type="button"
                  variant="ink"
                  disabled={bezig || poortCode.trim().length < 6}
                  onClick={() => start(() => void doePoort())}
                >
                  {bezig ? "Bezig…" : "Verder"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-[22px]">Nog even wachten</h2>
              <p className="mt-1 text-sm text-muted">
                Voor deze dag staat nog geen toegangscode klaar. Je docent krijgt hem van ons, samen met deze
                link.
              </p>
            </>
          )}

          {melding ? (
            <Alert tone="warning" className="mt-4">
              {melding}
            </Alert>
          ) : null}
        </section>
      ) : null}

      {stap === "wie" && dag.toegangswijze === "code" ? (
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

      {stap === "wie" && opNaam ? (
        <section className="rounded-card border border-line-soft bg-white p-5 shadow-card">
          <h2 className="text-[22px]">Wie ben je?</h2>
          <p className="mt-1 text-sm text-muted">
            Kies je klas en typ je naam zoals hij op school bekend is.
            {dag.toegangswijze === "schoolmail"
              ? " Je krijgt daarna een cijfercode op je schoolmail."
              : ""}
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
                    start(() => void (dag.toegangswijze === "schoolmail" ? zoekVoorMail() : zoek()));
                  }
                }}
              />
            </Field>

            <Button
              type="button"
              variant="ink"
              disabled={bezig || !groepId || naam.trim().length < 2}
              onClick={() => start(() => void (dag.toegangswijze === "schoolmail" ? zoekVoorMail() : zoek()))}
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
                    onClick={() =>
                      start(() =>
                        void (dag.toegangswijze === "schoolmail"
                          ? vraagMailCode(suggestie.id, suggestie.naam)
                          : kiesNaam(suggestie.id)),
                      )
                    }
                  >
                    {suggestie.naam}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}

          {/*
            De achtervang.

            Niet iedereen komt bij zijn schoolmail: een vergeten wachtwoord, een
            account dat nog niet werkt, een telefoon zonder mail erop. Dan kan
            de mentor de persoonlijke code geven. Die is net zo veilig, want hij
            hoort bij precies één leerling. Staat weggeklapt, zodat het scherm
            voor de meeste leerlingen één vraag blijft.
          */}
          {dag.toegangswijze === "schoolmail" ? (
            <details className="mt-4">
              <summary className="cursor-pointer list-none text-sm font-semibold underline">
                Ik kan niet bij mijn schoolmail
              </summary>
              <div className="mt-3 space-y-3 border-l-2 border-line-soft pl-3">
                <p className="text-sm text-muted">
                  Vraag je mentor om je persoonlijke code. Daarmee kun je ook naar binnen.
                </p>
                <Field label="Jouw persoonlijke code" htmlFor="eigen_code">
                  <Input
                    id="eigen_code"
                    value={code}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    className="max-w-56 font-mono text-lg uppercase tracking-[0.2em]"
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
                  variant="secondary"
                  disabled={bezig || code.trim().length < 6}
                  onClick={() => start(() => void meldAanMetCode())}
                >
                  {bezig ? "Bezig…" : "Verder met mijn code"}
                </Button>
              </div>
            </details>
          ) : null}
        </section>
      ) : null}

      {/*
        De cijfercode uit de mail.

        Zes cijfers, een cijfertoetsenbord, en het adres half verborgen erbij.
        Dat laatste is belangrijk: zo ziet een leerling dat de mail naar zijn
        eigen schooladres is gegaan en niet naar dat van een klasgenoot.
      */}
      {stap === "mailcode" && wachtOpMail ? (
        <MailCodeKaart
          adres={wachtOpMail.adres}
          code={mailCode}
          bezig={bezig}
          melding={melding}
          onCode={setMailCode}
          onVerder={() => start(() => void bevestigMailCode())}
          onNogmaals={() => start(() => void vraagMailCode(wachtOpMail.id, wachtOpMail.naam))}
          onAnder={() => {
            setWachtOpMail(null);
            setMailCode("");
            setMelding(null);
            setStap("wie");
          }}
        />
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
 * De cijfercode uit de mail.
 *
 * Zes cijfers, een cijfertoetsenbord, en het adres half verborgen erbij. Dat
 * laatste is belangrijk: zo ziet een leerling dat de mail naar zijn eigen
 * schooladres is gegaan en niet naar dat van een klasgenoot.
 *
 * Los van de rest, zodat de visuele controle in tools/harness hem kan tonen
 * zonder dat er een echte mail de deur uit hoeft.
 */
export function MailCodeKaart({
  adres,
  code,
  bezig = false,
  melding = null,
  onCode,
  onVerder,
  onNogmaals,
  onAnder,
}: {
  adres: string;
  code: string;
  bezig?: boolean;
  melding?: string | null;
  onCode: (waarde: string) => void;
  onVerder: () => void;
  onNogmaals: () => void;
  onAnder: () => void;
}) {
  return (
    <section className="rounded-card border border-line-soft bg-white p-5 shadow-card">
      <h2 className="text-[22px]">Kijk in je mail</h2>
      <p className="mt-1 text-sm text-muted">
        We hebben een code van zes cijfers gestuurd naar {adres}. Hij is tien minuten geldig.
      </p>

      <div className="mt-4 space-y-3">
        <Field label="Code uit de mail" htmlFor="mailcode" required>
          <Input
            id="mailcode"
            value={code}
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            spellCheck={false}
            className="max-w-40 font-mono text-2xl tracking-[0.3em]"
            placeholder="123456"
            onChange={(event) => onCode(event.target.value.replace(/\D/g, ""))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && code.length === 6) {
                event.preventDefault();
                onVerder();
              }
            }}
          />
        </Field>

        <Button type="button" variant="ink" disabled={bezig || code.length !== 6} onClick={onVerder}>
          {bezig ? "Bezig…" : "Verder"}
        </Button>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <button type="button" className="font-semibold underline" disabled={bezig} onClick={onNogmaals}>
            Stuur de code nog een keer
          </button>
          <button type="button" className="text-muted underline" onClick={onAnder}>
            Ik ben iemand anders
          </button>
        </div>
      </div>

      {melding ? (
        <Alert tone="warning" className="mt-4">
          {melding}
        </Alert>
      ) : null}
    </section>
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
