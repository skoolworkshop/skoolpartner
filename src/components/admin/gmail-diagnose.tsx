import { Check, TriangleAlert, CircleHelp } from "lucide-react";

import { Alert } from "@/components/ui/feedback";
import type { Diagnose, Uitkomst } from "@/lib/integrations/gmail/diagnose";

/**
 * De diagnose van de Gmail-koppeling, zichtbaar op Admin > Integraties.
 *
 * Hier staat nooit een geheime waarde in. Alleen of iets aanwezig is, of het
 * klopt, en wat je eraan doet als het niet klopt.
 */

const iconen: Record<Uitkomst, typeof Check> = {
  goed: Check,
  fout: TriangleAlert,
  onbekend: CircleHelp,
};

const kleuren: Record<Uitkomst, string> = {
  goed: "text-success",
  fout: "text-danger",
  onbekend: "text-muted",
};

export function GmailDiagnose({ diagnose }: { diagnose: Diagnose }) {
  const problemen = diagnose.regels.filter((r) => r.uitkomst === "fout");

  return (
    <div className="rounded-card border border-line-soft">
      <div className="border-b border-line-soft px-4 py-2.5">
        <p className="text-sm font-semibold">Diagnose van de koppeling</p>
        <p className="text-xs text-muted">
          Wat er nodig is om te kunnen koppelen. Er staan hier bewust geen wachtwoorden of sleutels
          in, alleen of ze kloppen.
        </p>
      </div>

      <ul className="divide-y divide-line-soft">
        {diagnose.regels.map((regel) => {
          const Icoon = iconen[regel.uitkomst];
          return (
            <li key={regel.label} className="flex items-start gap-3 px-4 py-2.5">
              <Icoon aria-hidden className={`mt-0.5 size-4 shrink-0 ${kleuren[regel.uitkomst]}`} />
              <div className="min-w-0">
                <p className="font-mono text-xs font-semibold">{regel.label}</p>
                <p className="text-sm break-words">{regel.waarde}</p>
                {regel.oplossing ? (
                  <p className="mt-0.5 text-sm break-words text-muted">{regel.oplossing}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {problemen.length > 0 ? (
        <div className="px-4 py-3">
          <Alert tone="warning">
            Koppelen gaat op dit moment niet lukken. Los eerst de {problemen.length} punt
            {problemen.length === 1 ? "" : "en"} hierboven op en deploy opnieuw, want deze waarden
            worden bij de build ingelezen.
          </Alert>
        </div>
      ) : null}
    </div>
  );
}
