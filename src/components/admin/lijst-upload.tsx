"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/form";
import { leesDocx, naarBladen } from "@/lib/inschrijving/docx";
import {
  KOLOM_LABELS,
  leesBladen,
  maakOverzicht,
  naarTekst,
  type BladInvoer,
  type KolomSoort,
  type Lezing,
  type LijstOverzicht,
} from "@/lib/inschrijving/lijst";
import { leesPdf } from "@/lib/inschrijving/pdf";
import { leesWerkbladen, naarTabTekst } from "@/lib/inschrijving/xlsx";
import type { AdminState } from "@/app/admin/actions";

/**
 * De deelnemerslijst erin zetten.
 *
 * EERST KIJKEN, DAN OPSLAAN
 *
 *   Het bestand wordt in de browser ingelezen, zodat je meteen ziet wat erin
 *   staat: hoeveel namen, welke klassen met hoeveel leerlingen, en welke
 *   regels niet bruikbaar zijn. Pas als je op opslaan drukt gaat het naar de
 *   server, en die leest alles nog een keer zelf in. Wat hier op het scherm
 *   staat is dus een voorbeeld, geen afspraak.
 *
 * DE VERDELING STAAT ER ALTIJD BIJ
 *
 *   Een import die 353 namen vindt maar ze in twee klassen stopt, ziet er op
 *   het eerste gezicht goed uit. Pas als je "173 en 180" ziet staan terwijl de
 *   school negentien klassen heeft, valt het op. Daarom staan de klassen met
 *   hun aantallen altijd op het scherm, ook als er niets mis is.
 *
 * KLOPT HET RADEN NIET, DAN WIJS JE HET AAN
 *
 *   Onder "Kolommen aanwijzen" staat per kolom wat wij ervan gemaakt hebben,
 *   met een voorbeeld uit het bestand erbij. Zet je er iets anders bij, dan
 *   wordt het voorbeeld meteen opnieuw berekend.
 *
 * VIER SOORTEN BESTANDEN
 *
 *   Excel, Word, PDF en CSV, want scholen sturen ze alle vier. Bij een werkmap
 *   met een tabblad per klas wordt de naam van het tabblad de klas; staat er
 *   een kolom met de klas in, dan wint die altijd. In Word wordt de kop boven
 *   of onder een tabel als klas gelezen. Plakken mag ook.
 */

const beginstand: AdminState = { status: "idle" };

const KOLOM_KEUZES: KolomSoort[] = [
  "onbekend",
  "naam",
  "voornaam",
  "tussenvoegsel",
  "achternaam",
  "groep",
  "leerjaar",
  "email",
];

/** A, B, C … zoals Excel de kolommen noemt. */
function kolomLetter(index: number): string {
  let rest = index + 1;
  let letter = "";
  while (rest > 0) {
    const deel = (rest - 1) % 26;
    letter = String.fromCharCode(65 + deel) + letter;
    rest = Math.floor((rest - deel) / 26);
  }
  return letter;
}

function OpslaanKnop({ aantal }: { aantal: number }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ink" size="sm" disabled={pending || aantal === 0}>
      {pending ? "Bezig…" : `${aantal} ${aantal === 1 ? "naam" : "namen"} opslaan`}
    </Button>
  );
}

export function LijstUpload({
  dagId,
  groepen,
  woorden,
  action,
}: {
  dagId: string;
  groepen: string[];
  woorden: { groep: string; groepen: string; deelnemer: string; deelnemers: string };
  action: (prev: AdminState, formData: FormData) => Promise<AdminState>;
}) {
  const [state, formAction] = useActionState(action, beginstand);
  const [lezing, setLezing] = useState<Lezing | null>(null);
  const [standaardGroep, setStandaardGroep] = useState("");
  const [kolommen, setKolommen] = useState<KolomSoort[] | null>(null);
  const [bestandsnaam, setBestandsnaam] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [vervangen, setVervangen] = useState<"nee" | "zonder-keuzes" | "alles">("nee");
  const [bezig, startLezen] = useTransition();
  const bron = useRef<BladInvoer[]>([]);

  function verwerk(bladen: BladInvoer[], groep: string, eigenKolommen: KolomSoort[] | null) {
    bron.current = bladen;
    const iets = bladen.some((blad) => blad.tekst.trim().length > 0);
    setLezing(iets ? leesBladen(bladen, groep || null, eigenKolommen) : null);
  }

  async function kiesBestand(bestand: File | null) {
    setFout(null);
    setKolommen(null);
    if (!bestand) return;
    setBestandsnaam(bestand.name);

    try {
      const buffer = await bestand.arrayBuffer();

      if (/\.xlsx$/i.test(bestand.name)) {
        const bladen = await leesWerkbladen(buffer);
        verwerk(
          bladen.map((blad) => ({ naam: blad.naam, tekst: naarTabTekst(blad.rijen) })),
          standaardGroep,
          null,
        );
      } else if (/\.docx$/i.test(bestand.name)) {
        verwerk(naarBladen(await leesDocx(buffer)), standaardGroep, null);
      } else if (/\.pdf$/i.test(bestand.name)) {
        verwerk([{ naam: "", tekst: await leesPdf(buffer) }], standaardGroep, null);
      } else if (/\.xls$/i.test(bestand.name)) {
        throw new Error(
          "Dit is een oud Excel-bestand (.xls). Open het in Excel, kies Opslaan als en bewaar het als .xlsx.",
        );
      } else if (/\.doc$/i.test(bestand.name)) {
        throw new Error(
          "Dit is een oud Word-bestand (.doc). Open het in Word, kies Opslaan als en bewaar het als .docx.",
        );
      } else {
        verwerk([{ naam: "", tekst: await bestand.text() }], standaardGroep, null);
      }
    } catch (error) {
      setLezing(null);
      setFout(
        error instanceof Error
          ? `${error.message} Je kunt de namen hieronder ook plakken.`
          : "Dit bestand kon niet gelezen worden.",
      );
    }
  }

  function zetKolom(index: number, soort: KolomSoort) {
    const huidig = [...(kolommen ?? lezing?.kolommen ?? [])];
    huidig[index] = soort;
    setKolommen(huidig);
    verwerk(bron.current, standaardGroep, huidig);
  }

  const overzicht = lezing ? maakOverzicht(lezing) : null;

  const nieuweGroepen = lezing
    ? [...new Set(lezing.regels.map((regel) => regel.groep ?? ""))].filter(
        (naam) => naam && !groepen.some((bestaand) => bestaand.trim().toLowerCase() === naam.trim().toLowerCase()),
      )
    : [];

  const meerBladen = (lezing?.bladen ?? []).filter((blad) => blad.naam.length > 0).length > 1;
  const huidigeKolommen = kolommen ?? lezing?.kolommen ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Bestand"
          htmlFor={`bestand-${dagId}`}
          hint="Excel, Word, PDF of CSV. De kolommen mogen in elke volgorde staan."
          showOptional={false}
        >
          <div className="flex flex-wrap items-center gap-2">
            {/*
              De knop van de browser zelf staat in het Engels en is niet te
              vertalen. Daarom een eigen knop, met het echte invoerveld
              eronder verstopt maar wel bereikbaar met het toetsenbord.
            */}
            <label
              htmlFor={`bestand-${dagId}`}
              className="inline-flex min-h-9 cursor-pointer items-center rounded-pill border border-line bg-white px-3.5 text-sm font-semibold text-ink hover:bg-surface-2 focus-within:outline focus-within:outline-2"
            >
              Bestand kiezen
              <input
                id={`bestand-${dagId}`}
                type="file"
                accept=".xlsx,.docx,.pdf,.csv,.txt,.tsv"
                className="sr-only"
                onChange={(event) => startLezen(() => void kiesBestand(event.target.files?.[0] ?? null))}
              />
            </label>
            <span className="min-w-0 flex-1 truncate text-sm text-muted">
              {bestandsnaam ?? "Geen bestand gekozen"}
            </span>
          </div>
        </Field>

        <Field
          label={`Alles in één ${woorden.groep}`}
          htmlFor={`groep-${dagId}`}
          hint={`Alleen nodig als de ${woorden.groep} nergens in het bestand staat.`}
          showOptional={false}
        >
          <Select
            id={`groep-${dagId}`}
            value={standaardGroep}
            onChange={(event) => {
              setStandaardGroep(event.target.value);
              verwerk(bron.current, event.target.value, kolommen);
            }}
          >
            <option value="">Uit het bestand halen</option>
            {groepen.map((groep) => (
              <option key={groep} value={groep}>
                {groep}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="Of plakken"
        htmlFor={`plak-${dagId}`}
        hint="Bijvoorbeeld twee kolommen rechtstreeks uit Excel."
        showOptional={false}
      >
        <Textarea
          id={`plak-${dagId}`}
          rows={4}
          placeholder={"Lissa van der Velde\tGroep 3/4\nJan-Peter Bakker\tGroep 5"}
          onChange={(event) => {
            setKolommen(null);
            verwerk([{ naam: "", tekst: event.target.value }], standaardGroep, null);
          }}
        />
      </Field>

      {bezig ? <p className="text-sm text-muted">Bezig met lezen…</p> : null}
      {fout ? <Alert tone="danger">{fout}</Alert> : null}

      {lezing && overzicht ? (
        <LijstVoorbeeld
          lezing={lezing}
          overzicht={overzicht}
          woorden={woorden}
          nieuweGroepen={nieuweGroepen}
          meerBladen={meerBladen}
          kolommen={huidigeKolommen}
          onKolom={zetKolom}
        />
      ) : null}

      <form action={formAction} className="space-y-3">
        <input type="hidden" name="event_id" value={dagId} />
        <input type="hidden" name="rows" value={lezing ? naarTekst(lezing.regels) : ""} />
        <input type="hidden" name="vervangen" value={vervangen} />

        {nieuweGroepen.length > 0 ? (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="maak_groepen" value="ja" defaultChecked />
            <span>
              {nieuweGroepen.length === 1
                ? `${woorden.groep} ${nieuweGroepen[0]} aanmaken`
                : `${nieuweGroepen.length} nieuwe ${woorden.groepen} aanmaken`}
            </span>
          </label>
        ) : null}

        {/* -------------------------------------------------------------
            Een verkeerde import rechtzetten
        ------------------------------------------------------------- */}
        {lezing ? (
          <Field
            label="Wat te doen met wie er al staat"
            htmlFor={`vervangen-${dagId}`}
            hint="Gebruik vervangen als een eerdere import verkeerd ging."
            showOptional={false}
          >
            <Select
              id={`vervangen-${dagId}`}
              value={vervangen}
              onChange={(event) => setVervangen(event.target.value as typeof vervangen)}
            >
              <option value="nee">Aanvullen, niets weghalen</option>
              <option value="zonder-keuzes">
                Vervangen: wie nog niets gekozen heeft eerst weghalen
              </option>
              <option value="alles">Alles vervangen, ook gemaakte keuzes</option>
            </Select>
          </Field>
        ) : null}

        {vervangen === "alles" ? (
          <Alert tone="warning">
            Hiermee verdwijnen ook de workshops die {woorden.deelnemers} al hebben gekozen. Gebruik dit alleen als
            de hele lijst opnieuw moet.
          </Alert>
        ) : null}

        <OpslaanKnop aantal={lezing?.regels.length ?? 0} />

        {state.status === "ok" ? <Alert tone="success">{state.message}</Alert> : null}
        {state.status === "error" ? <Alert tone="danger">{state.message}</Alert> : null}
      </form>
    </div>
  );
}


/**
 * Wat er in het bestand gevonden is.
 *
 * Apart gezet zodat de visuele controle in tools/harness dit scherm kan tonen
 * met een verzonnen lijst erin. Anders is het alleen te zien door echt een
 * bestand te kiezen, en dan wordt het nooit op 390 pixels bekeken.
 */
export function LijstVoorbeeld({
  lezing,
  overzicht,
  woorden,
  nieuweGroepen,
  meerBladen,
  kolommen,
  onKolom,
}: {
  lezing: Lezing;
  overzicht: LijstOverzicht;
  woorden: { groep: string; groepen: string; deelnemer: string; deelnemers: string };
  nieuweGroepen: string[];
  meerBladen: boolean;
  kolommen: KolomSoort[];
  onKolom: (index: number, soort: KolomSoort) => void;
}) {
  const huidigeKolommen = kolommen;
  return (

        <div className="space-y-3 rounded-card border border-line-soft bg-surface-2 p-4">
          <div>
            <p className="font-semibold">
              {overzicht.aantal} {overzicht.aantal === 1 ? woorden.deelnemer : woorden.deelnemers} in{" "}
              {overzicht.klassen.length} {overzicht.klassen.length === 1 ? woorden.groep : woorden.groepen}
            </p>
            <p className="text-sm text-muted">
              {lezing.kopregel ? "Kopregel herkend" : "Geen kopregel gevonden"}
              {meerBladen ? ` · ${lezing.bladen?.length} tabbladen` : ""}
              {overzicht.leerjaren.length > 0
                ? ` · leerjaar ${overzicht.leerjaren.map((regel) => `${regel.naam} (${regel.aantal})`).join(", ")}`
                : ""}
            </p>
          </div>

          {/* ---------------------------------------------------------------
              De verdeling over de klassen. Hier zie je of het klopt.
          --------------------------------------------------------------- */}
          {overzicht.klassen.length > 0 ? (
            <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {overzicht.klassen.map((klas) => (
                <li key={klas.naam} className="flex justify-between gap-3 border-b border-line-soft pb-0.5">
                  <span className="truncate font-medium">{klas.naam}</span>
                  <span className="shrink-0 tabular-nums text-muted">{klas.aantal}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {lezing.regels.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-sm font-semibold hover:text-ink">
                De eerste namen bekijken
              </summary>
              <ul className="mt-2 space-y-0.5 text-sm">
                {lezing.regels.slice(0, 8).map((regel) => (
                  <li key={`${regel.groep}-${regel.regel}-${regel.naam}`} className="truncate">
                    {regel.naam}{" "}
                    <span className="text-muted">
                      · {regel.groep}
                      {regel.leerjaar ? ` · leerjaar ${regel.leerjaar}` : ""}
                    </span>
                  </li>
                ))}
                {lezing.regels.length > 8 ? (
                  <li className="text-muted">en nog {lezing.regels.length - 8}…</li>
                ) : null}
              </ul>
            </details>
          ) : null}

          {/* ---------------------------------------------------------------
              Kolommen aanwijzen als het raden niet klopt
          --------------------------------------------------------------- */}
          {huidigeKolommen.length > 1 ? (
            <details>
              <summary className="cursor-pointer text-sm font-semibold hover:text-ink">
                Kolommen aanwijzen
                {overzicht.ongebruikteKolommen.length > 0
                  ? ` · ${overzicht.ongebruikteKolommen.length} kolom${
                      overzicht.ongebruikteKolommen.length === 1 ? "" : "men"
                    } niet gebruikt`
                  : ""}
              </summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {huidigeKolommen.map((soort, index) => {
                  const titel = lezing.kolomTitels?.[index]?.trim();
                  const voorbeeld = (lezing.voorbeeldRijen ?? [])
                    .map((rij) => (rij[index] ?? "").trim())
                    .filter(Boolean)
                    .slice(0, 2)
                    .join(", ");
                  return (
                    <label key={index} className="flex items-center gap-2 text-sm">
                      <span className="w-28 shrink-0 truncate text-muted">
                        {kolomLetter(index)}
                        {titel ? ` · ${titel}` : ""}
                      </span>
                      <Select
                        value={soort}
                        className="min-w-0 flex-1"
                        onChange={(event) => onKolom(index, event.target.value as KolomSoort)}
                      >
                        {KOLOM_KEUZES.map((keuze) => (
                          <option key={keuze} value={keuze}>
                            {KOLOM_LABELS[keuze]}
                          </option>
                        ))}
                      </Select>
                      {voorbeeld ? (
                        <span className="hidden w-28 shrink-0 truncate text-xs text-muted sm:block">{voorbeeld}</span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </details>
          ) : null}

          {nieuweGroepen.length > 0 ? (
            <p className="text-sm">
              Nieuw: {nieuweGroepen.slice(0, 12).join(", ")}
              {nieuweGroepen.length > 12 ? ` en nog ${nieuweGroepen.length - 12}` : ""}
            </p>
          ) : null}

          {overzicht.dubbel.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-warning">
                {overzicht.dubbel.length} mogelijk dubbel
              </summary>
              <ul className="mt-2 space-y-0.5 text-sm text-muted">
                {overzicht.dubbel.slice(0, 15).map((regel, index) => (
                  <li key={`${regel.naam}-${index}`}>
                    {regel.naam} ({regel.groep}) · regels {regel.regels.join(" en ")}
                  </li>
                ))}
                {overzicht.dubbel.length > 15 ? <li>en nog {overzicht.dubbel.length - 15}…</li> : null}
              </ul>
            </details>
          ) : null}

          {overzicht.overgeslagen.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-danger">
                {overzicht.overgeslagen.length} {overzicht.overgeslagen.length === 1 ? "regel" : "regels"} niet
                gebruikt
              </summary>
              <ul className="mt-2 space-y-1 text-sm text-muted">
                {overzicht.overgeslagen.slice(0, 25).map((probleem, index) => (
                  <li key={`${probleem.blad ?? ""}-${probleem.regel}-${index}`} className="break-words">
                    {probleem.blad ? `${probleem.blad}, regel ` : "Regel "}
                    {probleem.regel}: {probleem.reden}
                    {probleem.tekst ? ` · ${probleem.tekst}` : ""}
                  </li>
                ))}
                {overzicht.overgeslagen.length > 25 ? (
                  <li>en nog {overzicht.overgeslagen.length - 25}…</li>
                ) : null}
              </ul>
            </details>
          ) : null}
        </div>
  );
}
