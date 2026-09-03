"use client";

import { useMemo, useState } from "react";

import {
  vulFragment,
  type KiesbaarFragment,
  type TokenContext,
  type TokenNaam,
} from "@/lib/crm/fragment-tekst";
import { legFragmentGebruikVastAction } from "@/app/admin/crm/actions";
import { cn } from "@/lib/utils";

/**
 * Een fragment invoegen in een tekstveld.
 *
 * WAAROM DIT IN DE BROWSER GEBEURT EN NIET OP DE SERVER
 *
 *   Het invullen van de tokens gebeurt hier met exact dezelfde functie als op
 *   de server: fragment-tekst.ts is puur en heeft geen database nodig. Dat
 *   scheelt een rondje naar de server op het moment dat je zit te typen, en
 *   belangrijker: er is maar een implementatie, dus een voorbeeld kan niet
 *   afwijken van wat er straks echt staat.
 *
 *   De waarden komen wel van de server. De pagina heeft ze al opgehaald uit de
 *   deal, het contact en de organisatie. Er staat dus niets in de browser wat
 *   die gebruiker niet toch al op het scherm ziet.
 *
 * WAT ER GEBEURT ALS ER IETS ONTBREEKT
 *
 *   Een token zonder waarde blijft zichtbaar staan als {{voornaam}}, en je
 *   krijgt een regel te zien welke dat zijn. Zo kan er nooit "Beste ," in een
 *   mail belanden. Aanvullen doe je gewoon in het veld zelf.
 */

export type { KiesbaarFragment };

export function FragmentKiezer({
  fragmenten,
  context,
  /** Het id van het textarea waar de tekst in moet. */
  doelId,
  onderwerp,
  label = "Fragment invoegen",
  standaardOpen = false,
  gebruikVastleggen = true,
}: {
  fragmenten: KiesbaarFragment[];
  context: TokenContext;
  doelId: string;
  onderwerp: { organizationId?: string | null; contactId?: string | null; dealId?: string | null };
  label?: string;
  /** Alleen voor de visuele controle, zodat de lijst op een schermafbeelding staat. */
  standaardOpen?: boolean;
  /** Bij het samenstellen van een template is invoegen nog geen echt gebruik. */
  gebruikVastleggen?: boolean;
}) {
  const [open, setOpen] = useState(standaardOpen);
  const [zoek, setZoek] = useState("");
  const [ontbrekend, setOntbrekend] = useState<TokenNaam[]>([]);

  const gevonden = useMemo(() => {
    const naald = zoek.trim().toLowerCase();
    if (!naald) return fragmenten;
    return fragmenten.filter((f) =>
      `${f.naam} ${f.sneltoets} ${f.categorie ?? ""} ${f.tekst}`.toLowerCase().includes(naald)
    );
  }, [fragmenten, zoek]);

  if (fragmenten.length === 0) return null;

  function voegIn(fragment: KiesbaarFragment) {
    const veld = document.getElementById(doelId);
    if (!(veld instanceof HTMLTextAreaElement) && !(veld instanceof HTMLInputElement)) return;

    const gevuld = vulFragment(fragment.tekst, context);

    // Invoegen op de plek van de cursor, niet stug aan het eind plakken. Wie
    // midden in een zin zit, verwacht het daar.
    const start = veld.selectionStart ?? veld.value.length;
    const eind = veld.selectionEnd ?? veld.value.length;
    const ervoor = veld.value.slice(0, start);
    const erna = veld.value.slice(eind);
    const scheiding = ervoor && !ervoor.endsWith("\n") ? "\n" : "";

    veld.value = `${ervoor}${scheiding}${gevuld.tekst}${erna}`;
    veld.focus();
    const nieuwePositie = (ervoor + scheiding + gevuld.tekst).length;
    veld.setSelectionRange(nieuwePositie, nieuwePositie);

    // React weet niets van een waarde die we er zo in zetten. Een input-event
    // afvuren houdt eventuele luisteraars gelijk.
    veld.dispatchEvent(new Event("input", { bubbles: true }));

    setOntbrekend(gevuld.ontbrekend);
    setOpen(false);
    setZoek("");

    // De telling. Bewust zonder await en zonder foutafhandeling in beeld: of
    // dit lukt mag niemand tegenhouden.
    if (gebruikVastleggen) {
      const gegevens = new FormData();
      gegevens.set("snippetId", fragment.id);
      if (onderwerp.organizationId) gegevens.set("organizationId", onderwerp.organizationId);
      if (onderwerp.contactId) gegevens.set("contactId", onderwerp.contactId);
      if (onderwerp.dealId) gegevens.set("dealId", onderwerp.dealId);
      void legFragmentGebruikVastAction(gegevens);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-pill bg-surface-3 px-3.5 text-sm font-semibold text-ink transition-colors hover:bg-line-soft"
      >
        {label}
        <span aria-hidden className="text-xs text-muted">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open ? (
        <div className="absolute left-0 right-0 z-20 mt-1.5 max-w-sm rounded-card border border-line bg-white p-2 shadow-card">
          <label htmlFor={`${doelId}-fragment-zoek`} className="sr-only">
            Zoek een fragment
          </label>
          <input
            id={`${doelId}-fragment-zoek`}
            value={zoek}
            onChange={(e) => setZoek(e.target.value)}
            placeholder="Zoek op naam of sneltoets"
            autoComplete="off"
            className="mb-2 h-9 w-full rounded-pill border border-line bg-surface-2 px-3 text-sm"
          />

          {gevonden.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted">Geen fragment dat hierop past.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {gevonden.map((fragment) => (
                <li key={fragment.id}>
                  <button
                    type="button"
                    onClick={() => voegIn(fragment)}
                    className="block w-full rounded px-2 py-2 text-left transition-colors hover:bg-surface-2"
                  >
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-semibold text-ink">{fragment.naam}</span>
                      <span className="font-mono text-xs text-muted-soft">
                        {fragment.sneltoets}
                      </span>
                      {fragment.categorie ? (
                        <span className="rounded-pill bg-surface-3 px-2 py-0.5 text-xs text-muted">
                          {fragment.categorie}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-sm text-muted">
                      {fragment.tekst}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {ontbrekend.length > 0 ? (
        <p className={cn("mt-2 text-sm text-warning")}>
          Nog invullen: {ontbrekend.map((t) => `{{${t}}}`).join(", ")}. Die gegevens staan niet in
          het CRM, dus ze zijn blijven staan in de tekst.
        </p>
      ) : null}
    </div>
  );
}
