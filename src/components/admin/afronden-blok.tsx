"use client";

import { useState, useTransition } from "react";

import { ActionForm } from "@/components/admin/action-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import type { IndelingVoorstel } from "@/lib/inschrijving/indeling";
import type { MailVoorbeeld, Soort } from "@/lib/inschrijving/afronden";
import type { AdminState } from "@/app/admin/actions";

/**
 * De laatste twee knoppen van een cultuurdag.
 *
 * EERST KIJKEN, DAN DOEN
 *
 *   Allebei werken ze hetzelfde: je vraagt een voorstel op, je ziet wat er
 *   gaat gebeuren, en pas daarna druk je op bevestigen. Er wordt niemand
 *   ingedeeld en er gaat geen mail de deur uit zonder dat jij het hebt gezien.
 *
 *   Het voorstel wordt bij het bevestigen opnieuw berekend op de stand van dat
 *   moment. Zat er tussendoor nog iemand te kiezen, dan klopt het alsnog.
 */

const SOORTEN: { waarde: Soort; label: string }[] = [
  { waarde: "klassen-xlsx", label: "Klassenlijsten (Excel)" },
  { waarde: "workshops-xlsx", label: "Workshoplijsten (Excel)" },
  { waarde: "klassen-pdf", label: "Klassenlijsten (PDF)" },
  { waarde: "workshops-pdf", label: "Workshoplijsten (PDF)" },
];

export function AfrondenBlok({
  dagId,
  contactNaam,
  contactEmail,
  contactBron,
  bekijkIndeling,
  bevestigIndeling,
  bekijkMail,
  verstuurLijsten,
}: {
  dagId: string;
  contactNaam: string;
  contactEmail: string;
  /** Waar het voorgestelde adres vandaan komt, zodat je het kunt nakijken. */
  contactBron: "dag" | "organisatie" | "geen";
  bekijkIndeling: (dagId: string) => Promise<IndelingVoorstel | null>;
  bevestigIndeling: (prev: AdminState, formData: FormData) => Promise<AdminState>;
  bekijkMail: (input: {
    dagId: string;
    naar: string;
    naam: string;
    opmerking: string;
    soorten: Soort[];
  }) => Promise<MailVoorbeeld | null>;
  verstuurLijsten: (prev: AdminState, formData: FormData) => Promise<AdminState>;
}) {
  const [voorstel, setVoorstel] = useState<IndelingVoorstel | null>(null);
  const [mail, setMail] = useState<MailVoorbeeld | null>(null);
  const [naar, setNaar] = useState(contactEmail);
  const [naam, setNaam] = useState(contactNaam);
  const [opmerking, setOpmerking] = useState("");
  const [gekozen, setGekozen] = useState<Soort[]>(["klassen-xlsx", "workshops-xlsx"]);
  const [toonHtml, setToonHtml] = useState(true);
  const [nogmaals, setNogmaals] = useState(false);
  const [bezig, start] = useTransition();

  function wissel(soort: Soort) {
    setMail(null);
    setGekozen((huidig) => (huidig.includes(soort) ? huidig.filter((s) => s !== soort) : [...huidig, soort]));
  }

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------------
          Automatisch indelen
      --------------------------------------------------------------- */}
      <Card>
        <CardHeader
          title="Overige deelnemers indelen"
          description="Iedereen die nog een ronde open heeft staan, krijgt een plek. Bestaande keuzes blijven staan."
        />
        <CardBody className="space-y-4">
          {voorstel === null ? (
            <Button
              type="button"
              variant="ink"
              size="sm"
              disabled={bezig}
              onClick={() => start(() => void bekijkIndeling(dagId).then(setVoorstel))}
            >
              {bezig ? "Bezig…" : "Voorstel bekijken"}
            </Button>
          ) : (
            <>
              <div className="flex flex-wrap gap-x-8 gap-y-3">
                {[
                  { label: "nog niet rond", waarde: voorstel.aantalMetGat },
                  { label: "wordt ingedeeld", waarde: voorstel.toewijzingen.length },
                  { label: "lukt niet", waarde: voorstel.nietGelukt.length },
                  { label: "vrijgesteld", waarde: voorstel.aantalVrijgesteld },
                ].map((blok) => (
                  <div key={blok.label} className="min-w-24">
                    <div className="text-[22px] font-bold tabular-nums">{blok.waarde}</div>
                    <div className="text-xs text-muted">{blok.label}</div>
                  </div>
                ))}
              </div>

              {voorstel.nietGelukt.length > 0 ? (
                <Alert tone="warning">
                  <p className="font-semibold">Deze lukken niet:</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {voorstel.nietGelukt.slice(0, 10).map((regel) => (
                      <li key={`${regel.deelnemerId}-${regel.rondeLabel}`}>
                        {regel.naam} ({regel.groepNaam}) in {regel.rondeLabel}: {regel.reden}
                      </li>
                    ))}
                    {voorstel.nietGelukt.length > 10 ? <li>en nog {voorstel.nietGelukt.length - 10}</li> : null}
                  </ul>
                </Alert>
              ) : null}

              {voorstel.toewijzingen.length > 0 ? (
                <details>
                  <summary className="cursor-pointer list-none text-sm font-semibold hover:text-ink">
                    De voorgestelde verdeling bekijken
                  </summary>
                  <div className="mt-2 max-h-72 overflow-y-auto rounded-card border border-line-soft">
                    <ul className="divide-y divide-line-soft text-sm">
                      {voorstel.toewijzingen.slice(0, 200).map((regel) => (
                        <li
                          key={`${regel.deelnemerId}-${regel.rondeId}`}
                          className="flex flex-wrap justify-between gap-x-4 px-3 py-1.5"
                        >
                          <span className="truncate">
                            {regel.naam} <span className="text-muted">· {regel.groepNaam}</span>
                          </span>
                          <span className="text-muted">
                            {regel.rondeLabel} · {regel.workshopNaam}
                          </span>
                        </li>
                      ))}
                      {voorstel.toewijzingen.length > 200 ? (
                        <li className="px-3 py-1.5 text-muted">en nog {voorstel.toewijzingen.length - 200}</li>
                      ) : null}
                    </ul>
                  </div>
                </details>
              ) : null}

              <details>
                <summary className="cursor-pointer list-none text-sm font-semibold hover:text-ink">
                  Plekken per workshop
                </summary>
                <div className="mt-2 max-h-72 overflow-y-auto rounded-card border border-line-soft">
                  <ul className="divide-y divide-line-soft text-sm">
                    {voorstel.ruimte.map((regel) => (
                      <li key={regel.sessieId} className="flex flex-wrap justify-between gap-x-4 px-3 py-1.5">
                        <span className="truncate">
                          {regel.rondeLabel} · {regel.workshopNaam}
                        </span>
                        <span className="tabular-nums text-muted">
                          {regel.bezetVoor} naar {regel.bezetNa} van {regel.maximum}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>

              <div className="flex flex-wrap items-center gap-2">
                <ActionForm action={bevestigIndeling} submitLabel="Indeling bevestigen" inline>
                  <input type="hidden" name="event_id" value={dagId} />
                </ActionForm>
                <Button type="button" variant="ghost" size="sm" onClick={() => setVoorstel(null)}>
                  Annuleren
                </Button>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      {/* ---------------------------------------------------------------
          Lijsten naar de klant
      --------------------------------------------------------------- */}
      <Card>
        <CardHeader
          title="Verstuur lijsten naar klant"
          description="De lijsten worden op dit moment gemaakt, dus ze kloppen altijd met de laatste stand."
        />
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Naar"
              htmlFor="to_email"
              hint={
                contactBron === "organisatie"
                  ? "Overgenomen van de contactpersoon van de school. Kijk hem na."
                  : contactBron === "geen"
                    ? "Niet bekend bij deze school. Vul het adres van de contactpersoon in."
                    : "De contactpersoon van deze dag."
              }
              required
            >
              <Input
                id="to_email"
                type="email"
                value={naar}
                onChange={(event) => {
                  setNaar(event.target.value);
                  setMail(null);
                }}
                placeholder="naam@school.nl"
              />
            </Field>
            <Field label="Contactpersoon" htmlFor="to_name">
              <Input
                id="to_name"
                value={naam}
                onChange={(event) => {
                  setNaam(event.target.value);
                  setMail(null);
                }}
              />
            </Field>
          </div>

          <fieldset>
            <legend className="text-sm font-semibold">Wat gaat er mee</legend>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {SOORTEN.map((soort) => (
                <label key={soort.waarde} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={gekozen.includes(soort.waarde)} onChange={() => wissel(soort.waarde)} />
                  <span>{soort.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <Field label="Opmerking erbij" htmlFor="note">
            <Textarea
              id="note"
              rows={2}
              value={opmerking}
              onChange={(event) => {
                setOpmerking(event.target.value);
                setMail(null);
              }}
              placeholder="Bijvoorbeeld iets over de lunch of de aankomsttijd."
            />
          </Field>

          {mail === null ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={bezig || gekozen.length === 0 || naar.trim().length === 0}
              onClick={() =>
                start(() =>
                  void bekijkMail({ dagId, naar, naam, opmerking, soorten: gekozen }).then(setMail),
                )
              }
            >
              {bezig ? "Bezig…" : "Mail bekijken"}
            </Button>
          ) : (
            <>
              {mail.waarschuwingen.length > 0 ? (
                <Alert tone="warning">
                  <p className="font-semibold">Dit staat nog open in de indeling:</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {mail.waarschuwingen.map((regel) => (
                      <li key={regel}>{regel}</li>
                    ))}
                  </ul>
                  <p className="mt-1">Versturen mag, maar dan klopt de lijst nog niet helemaal.</p>
                </Alert>
              ) : null}

              <div className="rounded-card border border-line-soft bg-surface-2 p-4 text-sm">
                <p>
                  <span className="text-muted">Van: </span>
                  Skool Workshop · antwoorden komen bij ons terug
                </p>
                <p>
                  <span className="text-muted">Aan: </span>
                  {mail.naar}
                </p>
                <p>
                  <span className="text-muted">Onderwerp: </span>
                  {mail.onderwerp}
                </p>
                <p className="mt-1 text-muted">Bijlagen: {mail.bijlagen.join(", ")}</p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setToonHtml(!toonHtml)}>
                    {toonHtml ? "Als platte tekst bekijken" : "Als opgemaakte mail bekijken"}
                  </Button>
                </div>

                {toonHtml ? (
                  /*
                    De mail precies zoals hij aankomt, in een eigen kadertje.
                    Een iframe met sandbox, zodat de opmaak van de mail niets
                    van het beheerscherm kan raken.
                  */
                  <iframe
                    title="Voorbeeld van de mail"
                    sandbox=""
                    srcDoc={mail.html}
                    className="mt-2 h-96 w-full rounded-card border border-line-soft bg-white"
                  />
                ) : (
                  <pre className="mt-3 whitespace-pre-wrap font-sans">{mail.tekst}</pre>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {gekozen.map((soort) => (
                  <a
                    key={soort}
                    href={`/admin/inschrijvingen/${dagId}/bestand/${soort}`}
                    className="inline-flex min-h-9 items-center rounded-pill border border-line bg-white px-3.5 text-sm font-semibold text-ink hover:bg-surface-2"
                  >
                    Bijlage bekijken: {SOORTEN.find((item) => item.waarde === soort)?.label ?? soort}
                  </a>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <ActionForm action={verstuurLijsten} submitLabel="Versturen" inline>
                  <input type="hidden" name="event_id" value={dagId} />
                  <input type="hidden" name="to_email" value={naar} />
                  <input type="hidden" name="to_name" value={naam} />
                  <input type="hidden" name="note" value={opmerking} />
                  <input type="hidden" name="nogmaals" value={nogmaals ? "ja" : "nee"} />
                  {gekozen.map((soort) => (
                    <input key={soort} type="hidden" name="soort" value={soort} />
                  ))}
                </ActionForm>
                <Button type="button" variant="ghost" size="sm" onClick={() => setMail(null)}>
                  Annuleren
                </Button>
                <label className="flex items-center gap-2 text-sm text-muted">
                  <Checkbox checked={nogmaals} onChange={() => setNogmaals(!nogmaals)} />
                  <span>Bewust nog een keer sturen</span>
                </label>
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
