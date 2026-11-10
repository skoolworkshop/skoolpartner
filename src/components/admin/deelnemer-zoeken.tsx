"use client";

import { useState, useTransition } from "react";

import { BevestigForm } from "@/components/admin/bevestig-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import type { DeelnemerRegel } from "@/lib/inschrijving/deelnemers";
import type { AdminState } from "@/app/admin/actions";

/**
 * Eén deelnemer opzoeken.
 *
 * WAAROM ZOEKEN EN GEEN LIJST
 *
 *   Op een drukke dag staan er vierhonderd namen in. Daar scroll je niet
 *   doorheen aan de telefoon. Je typt een naam of de code die iemand
 *   voorleest, en je ziet die ene regel.
 *
 * WAT JE HIER KUNT
 *
 *   Een nieuwe code geven aan wie de zijne kwijt is, iemand vrijstellen die
 *   niet meedoet, en iemand weghalen die niet op de lijst hoort. Alle drie met
 *   een waarschuwing als er al keuzes aan hangen.
 *
 *   En: een inschrijving vrijgeven die door de verkeerde persoon is bevestigd.
 *   Je ziet dan met welk adres dat gebeurd is. Vrijgeven haalt de bevestiging
 *   eraf en maakt het bewijs in die browser ongeldig; de gemaakte keuzes
 *   blijven staan. Zijn die ook fout, dan haal je ze apart weg, zodat er nooit
 *   per ongeluk plekken vrijkomen.
 */

export function DeelnemerZoeken({
  dagId,
  woord,
  zoek,
  zetVrijstelling,
  nieuweCode,
  maakClaimVrij,
  verwijder,
}: {
  dagId: string;
  woord: string;
  zoek: (input: { dagId: string; term: string }) => Promise<DeelnemerRegel[]>;
  zetVrijstelling: (prev: AdminState, formData: FormData) => Promise<AdminState>;
  nieuweCode: (prev: AdminState, formData: FormData) => Promise<AdminState>;
  maakClaimVrij: (prev: AdminState, formData: FormData) => Promise<AdminState>;
  verwijder: (prev: AdminState, formData: FormData) => Promise<AdminState>;
}) {
  const [term, setTerm] = useState("");
  const [regels, setRegels] = useState<DeelnemerRegel[] | null>(null);
  const [bezig, start] = useTransition();

  function zoeken() {
    if (term.trim().length < 2) return;
    start(() => void zoek({ dagId, term }).then(setRegels));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Field label={`Naam of code van de ${woord}`} htmlFor="zoek_deelnemer" className="min-w-56 flex-1">
          <Input
            id="zoek_deelnemer"
            value={term}
            autoComplete="off"
            placeholder="Lissa, of ABCD-2345"
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                zoeken();
              }
            }}
          />
        </Field>
        <Button type="button" variant="ink" size="sm" disabled={bezig || term.trim().length < 2} onClick={zoeken}>
          {bezig ? "Bezig…" : "Zoeken"}
        </Button>
      </div>

      {regels === null ? null : regels.length === 0 ? (
        <p className="text-sm text-muted">Niets gevonden. Probeer een stuk van de achternaam.</p>
      ) : (
        <ul className="divide-y divide-line-soft rounded-card border border-line-soft">
          {regels.map((regel) => (
            <li key={regel.id} className="space-y-3 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{regel.naam}</p>
                  <p className="text-xs text-muted">
                    {regel.groepNaam}
                    {regel.email ? ` · ${regel.email}` : ""} · {regel.gekozen} gekozen
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded-pill bg-surface-2 px-2.5 py-1 font-mono text-sm tracking-wider">
                    {regel.code}
                  </code>
                  {regel.geclaimdDoor ? <Badge tone="info">Bevestigd</Badge> : null}
                  {regel.vrijgesteld ? <Badge tone="warning">Vrijgesteld</Badge> : null}
                </div>
              </div>

              {regel.geclaimdDoor ? (
                <p className="text-xs text-muted">
                  Bevestigd met {regel.geclaimdDoor}
                  {regel.geclaimdOp ? ` op ${new Date(regel.geclaimdOp).toLocaleString("nl-NL")}` : ""}.
                  {regel.email && regel.geclaimdDoor !== regel.email
                    ? " Dit is niet het adres uit de lijst. Kijk dat na."
                    : ""}
                </p>
              ) : null}

              <div className="flex flex-wrap items-start gap-2">
                <BevestigForm action={nieuweCode} submitLabel="Nieuwe code" variant="secondary" inline>
                  <input type="hidden" name="event_id" value={dagId} />
                  <input type="hidden" name="participant_id" value={regel.id} />
                </BevestigForm>

                <BevestigForm
                  action={zetVrijstelling}
                  submitLabel={regel.vrijgesteld ? "Laat weer meedoen" : "Vrijstellen"}
                  bevestigLabel="Toch vrijstellen"
                  variant="secondary"
                  inline
                >
                  <input type="hidden" name="event_id" value={dagId} />
                  <input type="hidden" name="participant_id" value={regel.id} />
                  <input type="hidden" name="exempt" value={regel.vrijgesteld ? "nee" : "ja"} />
                </BevestigForm>

                {regel.geclaimdDoor ? (
                  <BevestigForm
                    action={maakClaimVrij}
                    submitLabel="Inschrijving vrijgeven"
                    bevestigLabel="Ja, vrijgeven"
                    variant="secondary"
                    inline
                  >
                    <input type="hidden" name="event_id" value={dagId} />
                    <input type="hidden" name="participant_id" value={regel.id} />
                  </BevestigForm>
                ) : null}

                <BevestigForm
                  action={verwijder}
                  submitLabel="Verwijderen"
                  bevestigLabel="Toch verwijderen"
                  variant="ghost"
                  inline
                >
                  <input type="hidden" name="event_id" value={dagId} />
                  <input type="hidden" name="participant_id" value={regel.id} />
                </BevestigForm>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
