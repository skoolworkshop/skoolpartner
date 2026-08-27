import { formatEuroCents, formatPoints } from "@/lib/format";
import type { ParkingSnapshot } from "@/lib/tegoed/regels";

/**
 * Het samenvattingsscherm: alles nog één keer op een rij voordat de aanvraag
 * de deur uit gaat. Bewust een eigen bestand, zodat dit scherm ook los
 * gecontroleerd kan worden.
 */
export function ParkingSummary({
  snapshot,
  bonusEnabled,
  bonusPoints,
  bonusMinimumCents,
  pointsName,
}: {
  snapshot: ParkingSnapshot;
  bonusEnabled: boolean;
  bonusPoints: number;
  bonusMinimumCents: number;
  pointsName: string;
}) {
  return (
    <div className="rounded-card border border-accent/35 bg-accent-soft/25 p-5">
      <p className="font-display text-[19px] leading-snug">Klopt dit zo?</p>

      <dl className="mt-4 space-y-2 text-[15px]">
        <Rij label="Bedrag" waarde={formatEuroCents(snapshot.amountCents)} groot />
        <Rij label="School" waarde={snapshot.schoolName} />
        <Rij label="CJP-schoolnummer" waarde={snapshot.cjpSchoolNumber} />
        <Rij label="Budgethouder" waarde={snapshot.holderName} />
        <Rij label="E-mail" waarde={snapshot.holderEmail} />
        {snapshot.holderPhone ? <Rij label="Telefoon" waarde={snapshot.holderPhone} /> : null}
      </dl>

      <div className="mt-4 space-y-2 border-t border-accent/25 pt-4 text-sm text-muted">
        <p>
          Dit bedrag blijft geld en wordt niet omgezet naar {pointsName}. Het is beschikbaar
          binnen hetzelfde schooljaar.
        </p>
        {bonusEnabled && snapshot.amountCents >= bonusMinimumCents ? (
          <p>
            Zodra wij de aanvraag bevestigen, krijgt u eenmalig{" "}
            <strong className="text-ink">
              {formatPoints(bonusPoints)} {pointsName}
            </strong>{" "}
            als bonus. Deze bonus wordt maar één keer per organisatie toegekend.
          </p>
        ) : bonusEnabled ? (
          <p>De eenmalige bonus geldt vanaf {formatEuroCents(bonusMinimumCents)} geparkeerd tegoed.</p>
        ) : null}
        <p>
          U verstuurt nu een aanvraag. Er wordt nog niets afgeschreven en nog niets bijgeschreven.
        </p>
      </div>
    </div>
  );
}

function Rij({ label, waarde, groot }: { label: string; waarde: string; groot?: boolean }) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className={groot ? "font-display text-lg" : "text-right font-semibold"}>{waarde}</dd>
    </div>
  );
}
