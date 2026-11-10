"use client";

import { useState } from "react";

import { ActionForm } from "@/components/admin/action-form";
import { BevestigForm } from "@/components/admin/bevestig-form";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import type { AdminState } from "@/app/admin/actions";

/**
 * De inschrijflink en de toegangscode voor de school.
 *
 * ÉÉN LINK EN ÉÉN CODE VOOR DE HELE DAG
 *
 *   De school zet de link in Magister, Somtoday, Teams of een mail, en geeft
 *   de toegangscode mee. Elke leerling opent de link, vult de code in, en
 *   bewijst daarna wie hij is. Geen accounts, geen wachtwoorden.
 *
 * DE CODE IS DE DEUR, NIET HET PASPOORT
 *
 *   De toegangscode kent straks een hele school, dus het is geen geheim en we
 *   doen ook niet alsof. Hij zegt alleen: jij hoort bij deze dag. Wie iemand
 *   is wordt daarna apart vastgesteld, met de persoonlijke code van de mentor
 *   of met een cijfercode naar de schoolmail. Zonder die tweede stap zou een
 *   klasgenoot de inschrijving van iemand anders kunnen doen.
 *
 * INTREKKEN KAN, OP TWEE MANIEREN
 *
 *   De code uitzetten is de noodrem: er komt dan niemand meer binnen, ook niet
 *   wie het scherm nog open heeft staan. Een nieuwe code maken kan ook; dan
 *   moet de school hem opnieuw delen. Gemaakte keuzes blijven in beide
 *   gevallen gewoon staan.
 */

/** Met een streepje in het midden is een code makkelijker voorlezen. */
function metStreepje(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export function Inschrijflink({
  dagId,
  link,
  open,
  woorden,
  gedeeldeCode,
  codeActief,
  toegangswijze,
  nieuweLink,
  nieuweGedeeldeCode,
  zetGedeeldeCode,
}: {
  dagId: string;
  link: string;
  open: boolean;
  woorden: { deelnemer: string; deelnemers: string };
  gedeeldeCode: string | null;
  codeActief: boolean;
  toegangswijze: "code" | "schoolmail" | "naam";
  nieuweLink: (prev: AdminState, formData: FormData) => Promise<AdminState>;
  nieuweGedeeldeCode: (prev: AdminState, formData: FormData) => Promise<AdminState>;
  zetGedeeldeCode: (prev: AdminState, formData: FormData) => Promise<AdminState>;
}) {
  const [gekopieerd, setGekopieerd] = useState<"link" | "code" | "beide" | null>(null);

  const leesbareCode = gedeeldeCode ? metStreepje(gedeeldeCode) : null;

  async function kopieer(wat: "link" | "code" | "beide") {
    const tekst =
      wat === "link"
        ? link
        : wat === "code"
          ? (leesbareCode ?? "")
          : `${link}\n\nToegangscode: ${leesbareCode ?? ""}`;

    try {
      await navigator.clipboard.writeText(tekst);
      setGekopieerd(wat);
      window.setTimeout(() => setGekopieerd(null), 2500);
    } catch {
      // Kopiëren mag de browser weigeren, bijvoorbeeld zonder https. Dan kun
      // je het gewoon selecteren; alles staat volledig in beeld.
      setGekopieerd(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <code className="block break-all rounded-card border border-line-soft bg-surface-2 px-3 py-2 text-sm">
          {link}
        </code>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ink" size="sm" onClick={() => void kopieer("beide")}>
            {gekopieerd === "beide" ? "Gekopieerd" : "Link en code kopiëren"}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => void kopieer("link")}>
            {gekopieerd === "link" ? "Gekopieerd" : "Alleen de link"}
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
      </div>

      {/* ---------------------------------------------------------------------
          De toegangscode van de dag
      --------------------------------------------------------------------- */}
      <div className="rounded-card border border-line-soft bg-surface-2 p-4">
        <h3 className="text-base font-bold">Toegangscode van de dag</h3>

        {leesbareCode ? (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <code
                className={`rounded-card border border-line bg-white px-4 py-2 font-mono text-xl tracking-[0.2em] ${
                  codeActief ? "" : "text-muted line-through"
                }`}
              >
                {leesbareCode}
              </code>
              <Button type="button" variant="secondary" size="sm" onClick={() => void kopieer("code")}>
                {gekopieerd === "code" ? "Gekopieerd" : "Code kopiëren"}
              </Button>
            </div>

            {!codeActief ? (
              <Alert tone="warning" className="mt-3">
                Deze code staat uit. Er kan nu niemand inschrijven of wijzigen, ook niet wie de pagina nog open
                heeft staan.
              </Alert>
            ) : null}
          </>
        ) : (
          <Alert tone="warning" className="mt-2">
            Er staat nog geen toegangscode klaar. Zonder code komt er geen {woorden.deelnemer} binnen.
          </Alert>
        )}

        <p className="mt-3 text-sm text-muted">
          {toegangswijze === "code"
            ? `Deze code is voor de hele school hetzelfde. Daarna vult iedere ${woorden.deelnemer} zijn eigen persoonlijke code in, dus geef ook de lijst met codes mee aan de mentoren.`
            : toegangswijze === "schoolmail"
              ? `Deze code is voor de hele school hetzelfde. Daarna krijgt iedere ${woorden.deelnemer} een cijfercode op het schooladres dat de school heeft aangeleverd.`
              : `Deze code is voor de hele school hetzelfde. Daarna hoeft er alleen een naam gekozen te worden. Dat is de lichtste manier: een klasgenoot kan dan de inschrijving van iemand anders doen.`}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {leesbareCode ? (
            <ActionForm
              action={zetGedeeldeCode}
              submitLabel={codeActief ? "Code uitzetten" : "Code weer aanzetten"}
              variant={codeActief ? "secondary" : "ink"}
              inline
            >
              <input type="hidden" name="event_id" value={dagId} />
              <input type="hidden" name="actief" value={codeActief ? "nee" : "ja"} />
            </ActionForm>
          ) : null}

          <BevestigForm
            action={nieuweGedeeldeCode}
            submitLabel={leesbareCode ? "Nieuwe code maken" : "Code klaarzetten"}
            bevestigLabel="Ja, oude code laten vervallen"
            variant={leesbareCode ? "secondary" : "ink"}
            inline
          >
            <input type="hidden" name="event_id" value={dagId} />
          </BevestigForm>
        </div>
      </div>

      {!open ? (
        <Alert tone="warning">
          De inschrijving staat niet open. Wie de link nu opent, krijgt te zien dat hij nog dicht is.
        </Alert>
      ) : null}

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
