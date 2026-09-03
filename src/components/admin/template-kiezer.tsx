"use client";

import { useId, useMemo, useState } from "react";
import { Copy, Mail } from "lucide-react";

import { vulFragment, type TokenContext } from "@/lib/crm/fragment-tekst";
import { cn } from "@/lib/utils";

/**
 * Een template gebruiken vanaf een contact of een deal.
 *
 * ============================================================================
 * WAT DIT WEL EN NIET DOET
 * ============================================================================
 *
 * Het vult een template met de gegevens die op dit scherm al staan en laat het
 * resultaat zien. Er wordt niets verstuurd en niets opgeslagen. Je leest het,
 * en dan kopieer je het of open je je mailprogramma.
 *
 * Dat is dezelfde afspraak als bij de sequences: dit systeem zet klaar, een
 * mens verstuurt. Zou hier een verzendknop staan, dan zou die afspraak op de
 * ene plek wel gelden en op de andere niet.
 *
 * Het invullen gebeurt in de browser met exact dezelfde functie als op de
 * server, zodat een voorbeeld nooit kan afwijken van wat er echt komt te staan.
 * Een ontbrekende waarde blijft zichtbaar als {{voornaam}} en wordt apart
 * gemeld, zodat er geen "Beste ," de deur uit gaat.
 */

export interface KiesbaarTemplate {
  id: string;
  naam: string;
  onderwerp: string;
  tekst: string;
  categorie: string | null;
}

export function TemplateKiezer({
  templates,
  context,
  naarEmail,
  standaardTemplateId = "",
  toonKeuze = true,
}: {
  templates: KiesbaarTemplate[];
  context: TokenContext;
  /** Het adres van dit contact, als dat bekend is. */
  naarEmail?: string | null;
  /** Handig bij een sequence: daar ligt het template al vast in de stap. */
  standaardTemplateId?: string;
  toonKeuze?: boolean;
}) {
  const [gekozenId, setGekozenId] = useState<string>(standaardTemplateId);
  const [gekopieerd, setGekopieerd] = useState(false);
  const keuzeId = useId();

  const gekozen = templates.find((t) => t.id === gekozenId) ?? null;

  const gevuld = useMemo(() => {
    if (!gekozen) return null;
    const onderwerp = vulFragment(gekozen.onderwerp, context);
    const tekst = vulFragment(gekozen.tekst, context);
    return {
      onderwerp: onderwerp.tekst,
      tekst: tekst.tekst,
      ontbrekend: [...new Set([...onderwerp.ontbrekend, ...tekst.ontbrekend])],
      onbekend: [...new Set([...onderwerp.onbekend, ...tekst.onbekend])],
    };
  }, [gekozen, context]);

  if (templates.length === 0) {
    return (
      <p className="text-sm text-muted">
        Er zijn nog geen templates voor dit merk. Je maakt ze aan bij Templates.
      </p>
    );
  }

  const mailto =
    gevuld && naarEmail
      ? `mailto:${encodeURIComponent(naarEmail)}?subject=${encodeURIComponent(
          gevuld.onderwerp
        )}&body=${encodeURIComponent(gevuld.tekst)}`
      : null;

  return (
    <div className="space-y-3">
      {toonKeuze ? (
        <>
          <label className="block text-sm font-semibold" htmlFor={keuzeId}>
            Welk bericht
          </label>
          <select
            id={keuzeId}
            value={gekozenId}
            onChange={(event) => {
              setGekozenId(event.target.value);
              setGekopieerd(false);
            }}
            className="h-11 w-full rounded-card border border-line bg-white px-3 text-sm"
          >
            <option value="">Kies een template</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.naam}
                {template.categorie ? ` · ${template.categorie}` : ""}
              </option>
            ))}
          </select>
        </>
      ) : null}

      {gevuld ? (
        <>
          {gevuld.ontbrekend.length > 0 ? (
            <p className="rounded-card bg-warning-wash px-3 py-2 text-xs font-semibold text-warning">
              Nog niet ingevuld: {gevuld.ontbrekend.map((naam) => `{{${naam}}}`).join(", ")}. Die
              staan zo ook in het bericht, dus vul ze aan voordat je verstuurt.
            </p>
          ) : null}

          {gevuld.onbekend.length > 0 ? (
            <p className="rounded-card bg-danger-wash px-3 py-2 text-xs font-semibold text-danger">
              Onbekend personalisatieveld: {gevuld.onbekend.map((naam) => `{{${naam}}}`).join(", ")}.
              Corrigeer het template voordat je dit bericht gebruikt.
            </p>
          ) : null}

          <div className="rounded-card border border-line-soft bg-surface-2 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-soft">Onderwerp</p>
            <p className="font-semibold text-ink">{gevuld.onderwerp}</p>
            <p className="mt-3 text-xs uppercase tracking-wide text-muted-soft">Bericht</p>
            <p className="whitespace-pre-line text-sm text-ink">{gevuld.tekst}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`${gevuld.onderwerp}\n\n${gevuld.tekst}`);
                  setGekopieerd(true);
                } catch {
                  // Sommige browsers weigeren dit zonder toestemming. Dan blijft
                  // de tekst gewoon staan om met de hand te selecteren.
                  setGekopieerd(false);
                }
              }}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-pill border border-line bg-white px-3.5 text-sm font-semibold",
                gekopieerd ? "text-success" : "text-ink hover:bg-surface-2"
              )}
            >
              <Copy aria-hidden className="size-4 text-muted" />
              {gekopieerd ? "Gekopieerd" : "Kopieer"}
            </button>

            {mailto ? (
              <a
                href={mailto}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-pill border border-line bg-white px-3.5 text-sm font-semibold text-ink hover:bg-surface-2"
              >
                <Mail aria-hidden className="size-4 text-muted" />
                Openen in mail
              </a>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
