"use client";

import { useState } from "react";

import { BevestigForm } from "@/components/admin/bevestig-form";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import type { AdminState } from "@/app/admin/actions";

/**
 * De inschrijflink voor de school.
 *
 * ÉÉN LINK VOOR DE HELE DAG
 *
 *   De school zet deze link in Magister, Somtoday, Teams of een mail. Elke
 *   leerling opent hem en meldt zich met zijn eigen code. Geen accounts, geen
 *   wachtwoorden, geen mailadressen van minderjarigen in ons systeem.
 *
 * DE LINK IS GEEN GEHEIM, DE CODE WEL
 *
 *   In de link zit een sleutel die niemand raadt, maar hij gaat rond in een
 *   klassenapp en dat hoort ook. Wie hem heeft ziet alleen de dag en het
 *   programma. Pas met een persoonlijke code zie je een naam, en dan alleen
 *   die van jezelf. Daarom staat er bij de link ook geen lijst met namen.
 *
 * INTREKKEN KAN
 *
 *   Is de link op een verkeerde plek beland, dan maak je een nieuwe. De oude
 *   werkt dan niet meer, dus dat vraagt eerst om bevestiging. Gemaakte keuzes
 *   blijven gewoon staan.
 */

export function Inschrijflink({
  dagId,
  link,
  open,
  woorden,
  nieuweLink,
}: {
  dagId: string;
  link: string;
  open: boolean;
  woorden: { deelnemer: string; deelnemers: string };
  nieuweLink: (prev: AdminState, formData: FormData) => Promise<AdminState>;
}) {
  const [gekopieerd, setGekopieerd] = useState(false);

  async function kopieer() {
    try {
      await navigator.clipboard.writeText(link);
      setGekopieerd(true);
      window.setTimeout(() => setGekopieerd(false), 2500);
    } catch {
      // Kopiëren mag de browser weigeren, bijvoorbeeld zonder https. Dan kun
      // je de link gewoon selecteren; hij staat volledig in beeld.
      setGekopieerd(false);
    }
  }

  return (
    <div className="space-y-3">
      <code className="block break-all rounded-card border border-line-soft bg-surface-2 px-3 py-2 text-sm">
        {link}
      </code>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ink" size="sm" onClick={() => void kopieer()}>
          {gekopieerd ? "Gekopieerd" : "Inschrijflink kopiëren"}
        </Button>
        <a
          href={link}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-h-9 items-center rounded-pill border border-line bg-white px-3.5 text-sm font-semibold text-ink hover:bg-surface-2"
        >
          Openen zoals een {woorden.deelnemer} hem ziet
        </a>
      </div>

      {!open ? (
        <Alert tone="warning">
          De inschrijving staat niet open. Wie de link nu opent, krijgt te zien dat hij nog dicht is.
        </Alert>
      ) : null}

      <p className="text-sm text-muted">
        Deel deze link met de school, samen met de lijst met persoonlijke codes. De {woorden.deelnemers} hebben
        allebei nodig: zonder code komt er niemand bij een naam of een keuze.
      </p>

      <details>
        <summary className="cursor-pointer list-none text-sm font-semibold hover:text-ink">
          Link intrekken en een nieuwe maken
        </summary>
        <div className="mt-2 space-y-2 border-l-2 border-line-soft pl-3">
          <p className="text-sm text-muted">
            Gebruik dit als de link op een plek terecht is gekomen waar hij niet hoort. De oude link werkt daarna
            niet meer en de school moet de nieuwe opnieuw delen. Gemaakte keuzes en codes blijven ongewijzigd.
          </p>
          <BevestigForm
            action={nieuweLink}
            submitLabel="Nieuwe link maken"
            bevestigLabel="Ja, oude link laten vervallen"
            variant="danger"
            inline
          >
            <input type="hidden" name="event_id" value={dagId} />
          </BevestigForm>
        </div>
      </details>
    </div>
  );
}
