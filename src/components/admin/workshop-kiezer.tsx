"use client";

import { useMemo, useState } from "react";

import { ActionForm } from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
import { Checkbox, Field, Input } from "@/components/ui/form";
import {
  SOORT_LABELS,
  STANDAARD_MAXIMUM,
  staatErAl,
  zoekWorkshops,
} from "@/lib/inschrijving/catalogus";
import type { AdminState } from "@/app/admin/actions";

/**
 * Workshops kiezen uit het eigen aanbod.
 *
 * WAT HIER WEGGAAT
 *
 *   Twaalf keer een naam intypen, met twaalf kansen op een typefout en op
 *   "Workshop DJ skills" naast "Workshop DJ Skills" op dezelfde dag.
 *
 * WAT ERVOOR IN DE PLAATS KOMT
 *
 *   Het hele aanbod staat erin, je zoekt op een woord, vinkt aan wat er die
 *   dag draait en zet ze in één keer klaar. Wat al op de dag staat is
 *   doorgestreept en niet aan te vinken, dus dubbel kan niet.
 *
 *   Staat er iets bij wat niet in de lijst staat, bijvoorbeeld een workshop
 *   die we speciaal voor die school doen, dan typ je hem onderaan gewoon zelf
 *   in. Daar verandert niets aan.
 */

export function WorkshopKiezer({
  dagId,
  bestaande,
  action,
}: {
  dagId: string;
  /** De namen die al op deze dag staan. */
  bestaande: string[];
  action: (prev: AdminState, formData: FormData) => Promise<AdminState>;
}) {
  const [zoek, setZoek] = useState("");
  const [gekozen, setGekozen] = useState<string[]>([]);
  const [maximum, setMaximum] = useState(STANDAARD_MAXIMUM);

  const gevonden = useMemo(() => zoekWorkshops(zoek), [zoek]);

  function wissel(naam: string) {
    setGekozen((huidig) =>
      huidig.includes(naam) ? huidig.filter((item) => item !== naam) : [...huidig, naam],
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Zoeken in het aanbod" htmlFor={`zoek-${dagId}`} showOptional={false}>
          <Input
            id={`zoek-${dagId}`}
            value={zoek}
            autoComplete="off"
            placeholder="dans, dj, graffiti…"
            onChange={(event) => setZoek(event.target.value)}
          />
        </Field>

        <Field
          label="Maximum per uitvoering"
          htmlFor={`max-${dagId}`}
          hint="Geldt voor alles wat je nu toevoegt. Per uitvoering later aan te passen."
          showOptional={false}
        >
          <Input
            id={`max-${dagId}`}
            type="number"
            min={1}
            max={500}
            value={maximum}
            className="w-28"
            onChange={(event) => setMaximum(Number(event.target.value))}
          />
        </Field>
      </div>

      <div className="max-h-80 overflow-y-auto rounded-card border border-line-soft bg-white">
        <ul className="divide-y divide-line-soft">
          {gevonden.map((workshop) => {
            const alAanwezig = staatErAl(workshop.naam, bestaande);
            const aangevinkt = gekozen.includes(workshop.naam);

            return (
              <li key={workshop.naam}>
                <label
                  className={`flex items-center gap-3 px-4 py-2.5 text-sm ${
                    alAanwezig ? "cursor-default opacity-60" : "cursor-pointer hover:bg-surface-2"
                  }`}
                >
                  <Checkbox
                    checked={aangevinkt}
                    disabled={alAanwezig}
                    onChange={() => wissel(workshop.naam)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate font-medium ${alAanwezig ? "line-through" : ""}`}>
                      {workshop.naam}
                    </span>
                    <span className="block text-xs text-muted">
                      {SOORT_LABELS[workshop.soort]}
                      {alAanwezig ? " · staat al op deze dag" : ""}
                    </span>
                  </span>
                  <a
                    href={workshop.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="shrink-0 text-xs font-semibold text-muted underline underline-offset-2 hover:text-ink"
                    onClick={(event) => event.stopPropagation()}
                  >
                    Bekijken
                  </a>
                </label>
              </li>
            );
          })}
          {gevonden.length === 0 ? (
            <li className="px-4 py-3 text-sm text-muted">
              Niets gevonden. Typ minder, of voeg hem hieronder met de hand toe.
            </li>
          ) : null}
        </ul>
      </div>

      {gekozen.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {gekozen.map((naam) => (
            <Badge key={naam} tone="accent">
              {naam.replace(/^Workshop /, "")}
            </Badge>
          ))}
        </div>
      ) : null}

      <ActionForm
        action={action}
        submitLabel={
          gekozen.length === 0
            ? "Kies eerst een workshop"
            : `${gekozen.length} ${gekozen.length === 1 ? "workshop" : "workshops"} toevoegen`
        }
      >
        <input type="hidden" name="event_id" value={dagId} />
        <input type="hidden" name="maximum" value={maximum} />
        {gekozen.map((naam) => (
          <input key={naam} type="hidden" name="naam" value={naam} />
        ))}
      </ActionForm>
    </div>
  );
}
