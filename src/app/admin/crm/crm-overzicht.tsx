import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { MerkSchakelaar } from "@/components/admin/merk-schakelaar";
import { MERK_STIJL, type FaseOverzicht, type Merk } from "@/lib/crm/merk";
import type { CrmCijfers } from "@/lib/crm/queries";
import { cn } from "@/lib/utils";

/**
 * Het CRM-overzicht, zonder database eromheen.
 *
 * Bewust losgetrokken van page.tsx: zo kan de visuele controle dit scherm echt
 * renderen in plaats van een nagebouwde versie ervan. Wat je op de
 * schermafbeelding ziet, is dan hetzelfde als wat de beheerder ziet.
 */
export function CrmOverzicht({
  merk,
  fases,
  cijfers,
}: {
  merk: Merk;
  fases: FaseOverzicht;
  cijfers: CrmCijfers;
}) {
  const stijl = MERK_STIJL[merk];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[30px]">CRM</h1>
        <MerkSchakelaar actief={merk} />
      </div>

      <p className="mb-6 max-w-2xl text-muted">
        Je kijkt naar <strong className="text-ink">{stijl.label}</strong>. {stijl.omschrijving} De
        keuze bovenaan bepaalt wat je in het hele CRM ziet en blijft staan als je naar een ander
        scherm gaat.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Personen bij dit merk</p>
            <p className="mt-1 font-display text-3xl">{cijfers.personen}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Organisaties met een profiel</p>
            <p className="mt-1 font-display text-3xl">{cijfers.metProfiel}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Organisaties zonder profiel</p>
            <p className="mt-1 font-display text-3xl">{cijfers.zonderProfiel}</p>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title={`De fases van ${stijl.label}`}
          description="Deze staan in de database en niet in de code. De twee merken hebben bewust een eigen proces, want er wordt iets heel anders verkocht."
        />
        <CardBody>
          <ol className="space-y-3">
            {fases.lopend.map((fase, index) => (
              <li key={fase.id} className="flex gap-3">
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-pill text-xs font-semibold text-white",
                    stijl.streep
                  )}
                >
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold">{fase.label}</p>
                  {fase.description ? (
                    <p className="text-sm text-muted">{fase.description}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-5 flex flex-wrap gap-2 border-t border-line-soft pt-4">
            {fases.gewonnen ? (
              <span className="rounded-pill bg-success-wash px-3 py-1 text-sm font-semibold text-success">
                Telt als gewonnen: {fases.gewonnen.label}
              </span>
            ) : null}
            {fases.verloren ? (
              <span className="rounded-pill bg-surface-3 px-3 py-1 text-sm font-semibold text-muted">
                Telt als verloren: {fases.verloren.label}
              </span>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Wat hier nog niet staat"
          description="Fase 1 legt het fundament. Deze schermen komen daarna."
        />
        <CardBody>
          <ul className="space-y-2 text-sm text-muted">
            <li>
              <strong className="text-ink">Relatiekaart per school.</strong> Boekingen, facturen,
              berichten, punten en CJP-tegoed op een scherm.
            </li>
            <li>
              <strong className="text-ink">Deelnemers en reisperiodes.</strong> Voor Suri Impact,
              inclusief de bezetting per periode.
            </li>
            <li>
              <strong className="text-ink">Activiteiten, notities en taken.</strong> Wie heeft wat
              besproken, en wie pakt het op.
            </li>
            <li>
              <strong className="text-ink">De pijplijn zelf.</strong> Deals als kaarten in de fases
              hierboven.
            </li>
          </ul>
        </CardBody>
      </Card>

      <Alert tone="info" title="Het klantportaal ziet hier niets van" className="mt-6">
        De CRM-tabellen hebben geen enkele leesregel voor ingelogde gebruikers. Dit scherm leest met
        de serviceclient, na de controle in de layout van het beheerportaal. Een klant kan deze
        gegevens dus niet opvragen, ook niet als er ooit code wordt geschreven die dat per ongeluk
        probeert.
      </Alert>
    </>
  );
}
