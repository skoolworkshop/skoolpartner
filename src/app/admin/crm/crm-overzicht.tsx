import Link from "next/link";

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
        <CardHeader title="Waar je heen kunt" />
        <CardBody>
          <div className="flex flex-wrap gap-2">
            {merk === "skool_workshop" ? (
              <>
                <Link
                  href="/admin/crm/contacten"
                  className="inline-flex min-h-11 items-center rounded-pill bg-ink px-5 text-sm font-semibold text-white"
                >
                  Contacten
                </Link>
                <Link
                  href="/admin/crm/pijplijn"
                  className="inline-flex min-h-11 items-center rounded-pill bg-surface-3 px-5 text-sm font-semibold text-ink"
                >
                  Deals
                </Link>
                <Link
                  href="/admin/crm/organisaties"
                  className="inline-flex min-h-11 items-center rounded-pill bg-surface-3 px-5 text-sm font-semibold text-ink"
                >
                  Organisaties
                </Link>
              </>
            ) : (
              <Link
                href="/admin/crm/suri"
                className="inline-flex min-h-11 items-center rounded-pill bg-ink px-5 text-sm font-semibold text-white"
              >
                Reisperiodes en deelnemers
              </Link>
            )}
            <Link
              href="/admin/crm/taken"
              className="inline-flex min-h-11 items-center rounded-pill bg-surface-3 px-5 text-sm font-semibold text-ink"
            >
              Taken
            </Link>
          </div>
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Wat hier nog niet staat"
          description="Wat er nu is, dekt relaties, deelnemers, de pijplijn en de taken. Dit staat nog open."
        />
        <CardBody>
          <ul className="space-y-2 text-sm text-muted">
            <li>
              <strong className="text-ink">Eigen formulieren.</strong> Nu komen nieuwe aanvragen nog
              bij HubSpot binnen en niet in dit systeem.
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
