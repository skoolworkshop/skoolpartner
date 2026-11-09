"use client";

import { useState } from "react";

import { BevestigForm } from "@/components/admin/bevestig-form";
import { Field, Input, Select } from "@/components/ui/form";
import { maakRooster, vatSamen } from "@/lib/inschrijving/rondes";
import type { AdminState } from "@/app/admin/actions";

/**
 * Het dagrooster in één formulier.
 *
 * WAT JE INVULT
 *
 *   Hoeveel rondes, hoe laat de eerste begint, hoe lang een ronde duurt en
 *   hoeveel pauze ertussen zit. Eventueel een langere pauze voor de lunch.
 *
 * WAT JE METEEN ZIET
 *
 *   Het hele rooster, met de tijden uitgerekend, nog voordat er iets wordt
 *   opgeslagen. Klopt het niet, dan draai je aan een getal en kijk je opnieuw.
 *   Pas als je op de knop drukt gaat het naar de server, en die rekent het
 *   daar nog een keer uit. Wat hier staat is dus een voorbeeld, geen afspraak.
 *
 * BESTAANDE RONDES
 *
 *   Staan er al rondes, dan kies je zelf of dit erbij komt of ze vervangt.
 *   Vervangen vraagt eerst om bevestiging en lukt niet meer zodra er een
 *   leerling iets heeft gekozen.
 */

const DUREN = [30, 45, 60, 75, 90, 120];

export function RoosterMaker({
  dagId,
  aantalBestaand,
  action,
}: {
  dagId: string;
  aantalBestaand: number;
  action: (prev: AdminState, formData: FormData) => Promise<AdminState>;
}) {
  const [aantal, setAantal] = useState(3);
  const [start, setStart] = useState("09:15");
  const [duur, setDuur] = useState(60);
  const [pauze, setPauze] = useState(15);
  const [langePauzeNa, setLangePauzeNa] = useState("");
  const [langePauze, setLangePauze] = useState(45);
  const [vervangen, setVervangen] = useState(false);

  const rooster = maakRooster({
    aantal,
    start,
    duurMinuten: duur,
    pauzeMinuten: pauze,
    langePauzeNa: langePauzeNa ? Number(langePauzeNa) : null,
    langePauzeMinuten: langePauzeNa ? langePauze : null,
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Aantal rondes" htmlFor={`aantal-${dagId}`} required>
          <Select
            id={`aantal-${dagId}`}
            value={String(aantal)}
            onChange={(event) => setAantal(Number(event.target.value))}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8].map((getal) => (
              <option key={getal} value={getal}>
                {getal}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Eerste ronde begint" htmlFor={`start-${dagId}`} required>
          <Input
            id={`start-${dagId}`}
            type="time"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </Field>

        <Field label="Duur per ronde" htmlFor={`duur-${dagId}`} required>
          <Select
            id={`duur-${dagId}`}
            value={String(duur)}
            onChange={(event) => setDuur(Number(event.target.value))}
          >
            {DUREN.map((minuten) => (
              <option key={minuten} value={minuten}>
                {minuten} minuten
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Pauze ertussen" htmlFor={`pauze-${dagId}`} required>
          <Select
            id={`pauze-${dagId}`}
            value={String(pauze)}
            onChange={(event) => setPauze(Number(event.target.value))}
          >
            {[0, 5, 10, 15, 20, 30].map((minuten) => (
              <option key={minuten} value={minuten}>
                {minuten === 0 ? "Geen pauze" : `${minuten} minuten`}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Langere pauze na ronde"
          htmlFor={`lpna-${dagId}`}
          hint="Voor de lunch. Laat leeg als alle pauzes even lang zijn."
        >
          <Select
            id={`lpna-${dagId}`}
            value={langePauzeNa}
            onChange={(event) => setLangePauzeNa(event.target.value)}
          >
            <option value="">Geen langere pauze</option>
            {Array.from({ length: Math.max(aantal - 1, 0) }, (_waarde, index) => index + 1).map((nummer) => (
              <option key={nummer} value={nummer}>
                Na ronde {nummer}
              </option>
            ))}
          </Select>
        </Field>

        {langePauzeNa ? (
          <Field label="Hoe lang" htmlFor={`lp-${dagId}`} required>
            <Select
              id={`lp-${dagId}`}
              value={String(langePauze)}
              onChange={(event) => setLangePauze(Number(event.target.value))}
            >
              {[30, 40, 45, 60, 75, 90].map((minuten) => (
                <option key={minuten} value={minuten}>
                  {minuten} minuten
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>

      {/* -----------------------------------------------------------------
          Het rooster zoals het wordt
      ----------------------------------------------------------------- */}
      <div className="rounded-card border border-line-soft bg-surface-2 p-4">
        {rooster.fouten.length > 0 ? (
          <ul className="space-y-1 text-sm text-danger">
            {rooster.fouten.map((fout) => (
              <li key={fout}>{fout}</li>
            ))}
          </ul>
        ) : (
          <>
            <p className="font-semibold">{vatSamen(rooster)}</p>
            <ul className="mt-2 divide-y divide-line-soft text-sm">
              {rooster.regels.map((regel) => (
                <li
                  key={`${regel.label}-${regel.begin}`}
                  className={`flex flex-wrap justify-between gap-x-4 py-1.5 ${
                    regel.pauze ? "text-muted" : ""
                  }`}
                >
                  <span className={regel.pauze ? "" : "font-medium"}>{regel.label}</span>
                  <span className="tabular-nums">
                    {regel.begin} tot {regel.eind}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">
              Pauzes komen als eigen regel op het rooster te staan. Daar valt niets te kiezen, en de school ziet
              ze op de lijsten terug. Losse tijden pas je achteraf per ronde aan.
            </p>
          </>
        )}
      </div>

      <BevestigForm
        action={action}
        submitLabel={aantalBestaand > 0 && vervangen ? "Rooster vervangen" : "Rooster aanmaken"}
        bevestigLabel="Toch vervangen"
      >
        <input type="hidden" name="event_id" value={dagId} />
        <input type="hidden" name="aantal" value={aantal} />
        <input type="hidden" name="start" value={start} />
        <input type="hidden" name="duur" value={duur} />
        <input type="hidden" name="pauze" value={pauze} />
        <input type="hidden" name="lange_pauze_na" value={langePauzeNa} />
        <input type="hidden" name="lange_pauze" value={langePauzeNa ? langePauze : ""} />
        <input type="hidden" name="vervangen" value={vervangen ? "ja" : "nee"} />

        {aantalBestaand > 0 ? (
          <Field label="Er staan al rondes klaar" htmlFor={`verv-${dagId}`} showOptional={false}>
            <Select
              id={`verv-${dagId}`}
              value={vervangen ? "ja" : "nee"}
              onChange={(event) => setVervangen(event.target.value === "ja")}
            >
              <option value="nee">Dit rooster erachter zetten</option>
              <option value="ja">De bestaande rondes vervangen</option>
            </Select>
          </Field>
        ) : null}
      </BevestigForm>
    </div>
  );
}
