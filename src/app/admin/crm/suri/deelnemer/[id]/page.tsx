import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ActionForm } from "@/components/admin/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { BetaalBadge, LeeftijdBadge } from "@/components/admin/crm-badges";
import { requireAdmin } from "@/lib/auth/session";
import { getDeelnemer, getPeriodes } from "@/lib/crm/suri";
import { BETALING_LABELS } from "@/lib/crm/regels";
import { formatEuroCents, formatShortDate } from "@/lib/format";
import {
  bewaarBetalingAction,
  verplaatsNaarPeriodeAction,
  zetFaseAction,
} from "@/app/admin/crm/actions";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Deelnemer" };

export default async function DeelnemerPagina({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const deelnemer = await getDeelnemer(id);
  if (!deelnemer) notFound();

  const periodes = await getPeriodes();
  const { contact, deal, fase, profiel, periode, betalingen, stand, leeftijd } = deelnemer;
  const alleFases = [...deelnemer.fases.lopend, deelnemer.fases.gewonnen, deelnemer.fases.verloren]
    .filter((f) => f !== null)
    .map((f) => f);

  return (
    <>
      <Link
        href={periode ? `/admin/crm/suri/periode/${periode.edition_id}` : "/admin/crm/suri"}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {periode ? `Terug naar ${periode.name}` : "Terug naar reisperiodes"}
      </Link>

      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h1 className="text-[30px]">{contact.full_name}</h1>
        <LeeftijdBadge signaal={leeftijd} />
        <BetaalBadge
          volledig={stand.volledig}
          openCents={stand.openCents}
          teveelCents={stand.teveelCents}
          label={stand.label}
        />
      </div>
      <p className="mb-6 text-[15px] text-muted">
        {fase.label} · {periode ? periode.name : "nog geen reisperiode"}
        {contact.email ? ` · ${contact.email}` : ""}
        {contact.phone ? ` · ${contact.phone}` : ""}
      </p>

      {leeftijd && leeftijd.toon !== "goed" ? (
        <Alert
          tone={leeftijd.toon === "buiten" ? "warning" : "info"}
          title="Let op de leeftijd bij vertrek"
          className="mb-5"
        >
          {leeftijd.bericht}
          {leeftijd.leeftijd < 18 && !profiel?.guardian_email
            ? " Er staan nog geen contactgegevens van een ouder of verzorger bij."
            : ""}
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Fase" description="Elke wisseling wordt vastgelegd in de historie." />
          <CardBody>
            <ActionForm action={zetFaseAction} submitLabel="Fase bijwerken">
              <input type="hidden" name="dealId" value={deal.id} />
              <Field label="Fase" htmlFor="stageId" required showOptional={false}>
                <Select id="stageId" name="stageId" defaultValue={fase.id}>
                  {alleFases.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Notitie" htmlFor="fase-note" hint="Wordt bij deze wisseling bewaard.">
                <Input id="fase-note" name="note" autoComplete="off" />
              </Field>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Betaalstand" />
          <CardBody>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted">Prijs</dt>
              <dd className="text-right font-semibold tabular-nums">
                {stand.prijsCents ? formatEuroCents(stand.prijsCents) : "nog niet ingesteld"}
              </dd>
              <dt className="text-muted">Ontvangen</dt>
              <dd className="text-right font-semibold tabular-nums">
                {formatEuroCents(stand.betaaldCents)}
              </dd>
              <dt className="text-muted">Open</dt>
              <dd
                className={cn(
                  "text-right font-semibold tabular-nums",
                  stand.openCents > 0 && "text-accent-strong"
                )}
              >
                {formatEuroCents(stand.openCents)}
              </dd>
              {stand.teveelCents ? (
                <>
                  <dt className="text-danger">Te veel betaald</dt>
                  <dd className="text-right font-semibold tabular-nums text-danger">
                    {formatEuroCents(stand.teveelCents)}
                  </dd>
                </>
              ) : null}
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Betalingen" />
          {betalingen.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">Er is nog niets vastgelegd.</p>
            </CardBody>
          ) : (
            <ul>
              {betalingen.map((betaling) => (
                <li
                  key={betaling.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line-soft px-5 py-3 last:border-b-0"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold">{BETALING_LABELS[betaling.kind]}</span>
                    <span className="block text-sm text-muted">
                      {formatShortDate(betaling.received_on)}
                      {betaling.note ? ` · ${betaling.note}` : ""}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 font-semibold tabular-nums",
                      betaling.amount_cents < 0 && "text-danger"
                    )}
                  >
                    {formatEuroCents(betaling.amount_cents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <CardBody className="border-t border-line-soft">
            <ActionForm action={bewaarBetalingAction} submitLabel="Betaling vastleggen">
              <input type="hidden" name="dealId" value={deal.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Soort" htmlFor="kind" required showOptional={false}>
                  <Select id="kind" name="kind" defaultValue="aanbetaling">
                    {Object.entries(BETALING_LABELS).map(([waarde, label]) => (
                      <option key={waarde} value={waarde}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Bedrag" htmlFor="amount" required showOptional={false}>
                  <Input id="amount" name="amount" inputMode="decimal" placeholder="500,00" required />
                </Field>
                <Field label="Ontvangen op" htmlFor="receivedOn" required showOptional={false}>
                  <Input
                    id="receivedOn"
                    name="receivedOn"
                    type="date"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                  />
                </Field>
                <Field
                  label="Kenmerk"
                  htmlFor="externalReference"
                  hint="Bijvoorbeeld het factuurnummer. Voorkomt dat dezelfde betaling twee keer wordt ingelezen."
                >
                  <Input id="externalReference" name="externalReference" autoComplete="off" />
                </Field>
              </div>
              <Field label="Toelichting" htmlFor="betaling-note" hint="Verplicht bij een correctie.">
                <Input id="betaling-note" name="note" autoComplete="off" />
              </Field>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Gegevens"
            description="Bewust beperkt: geen medische gegevens, dieetwensen of paspoortgegevens."
          />
          <CardBody>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">Geboortedatum</dt>
              <dd className="font-medium">
                {profiel?.birth_date ? formatShortDate(profiel.birth_date) : "onbekend"}
              </dd>
              <dt className="text-muted">Opleiding</dt>
              <dd className="font-medium">{profiel?.education_level ?? "onbekend"}</dd>
              <dt className="text-muted">Interesse</dt>
              <dd className="font-medium">{profiel?.interest ?? "onbekend"}</dd>
              <dt className="text-muted">Ouder of verzorger</dt>
              <dd className="font-medium break-words">
                {profiel?.guardian_name ?? "niet ingevuld"}
                {profiel?.guardian_email ? ` · ${profiel.guardian_email}` : ""}
                {profiel?.guardian_phone ? ` · ${profiel.guardian_phone}` : ""}
              </dd>
              <dt className="text-muted">Samen met</dt>
              <dd className="font-medium">{profiel?.together_with ?? "niet ingevuld"}</dd>
            </dl>
            {profiel?.note ? (
              <p className="mt-4 whitespace-pre-line border-t border-line-soft pt-4 text-sm text-muted">
                {profiel.note}
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Reisperiode"
            description="Verplaatsen kan zolang de deelnemer nog niet is vertrokken."
          />
          <CardBody>
            <ActionForm
              action={verplaatsNaarPeriodeAction}
              submitLabel="Verplaatsen"
              variant="secondary"
              inline
            >
              <input type="hidden" name="dealId" value={deal.id} />
              <Field label="Naar periode" htmlFor="editionId" required showOptional={false}>
                <Select id="editionId" name="editionId" defaultValue={periode?.edition_id ?? ""}>
                  {periodes.map((p) => (
                    <option key={p.edition_id} value={p.edition_id}>
                      {p.name} · {p.stand.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </ActionForm>
            {deal.note ? (
              <p className="mt-4 whitespace-pre-line text-sm text-muted">{deal.note}</p>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
