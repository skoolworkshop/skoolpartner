import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ActionForm } from "@/components/admin/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { BezettingBadge } from "@/components/admin/crm-badges";
import { DeelnemerRegel } from "@/components/admin/periode-kaart";
import { requireAdmin } from "@/lib/auth/session";
import { getDeelnemers, getPeriode, getPeriodeRij } from "@/lib/crm/suri";
import { PERIODE_STATUS_LABELS } from "@/lib/crm/regels";
import { formatEuroCents, formatShortDate } from "@/lib/format";
import { bewaarPeriodeAction, meldDeelnemerAanAction } from "@/app/admin/crm/actions";

export const metadata: Metadata = { title: "Reisperiode" };

export default async function PeriodePagina({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const [periode, rij, deelnemers] = await Promise.all([
    getPeriode(id),
    getPeriodeRij(id),
    getDeelnemers(id),
  ]);

  if (!periode || !rij) notFound();

  const euro = (centen: number) => (centen / 100).toFixed(2).replace(".", ",");

  return (
    <>
      <Link
        href="/admin/crm/suri"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Terug naar reisperiodes
      </Link>

      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h1 className="text-[30px]">{periode.name}</h1>
        <BezettingBadge stand={periode.stand} />
      </div>
      <p className="mb-6 text-[15px] text-muted">
        {formatShortDate(periode.starts_on)} tot {formatShortDate(periode.ends_on)} ·{" "}
        {PERIODE_STATUS_LABELS[periode.status]} ·{" "}
        {periode.price_cents ? `${formatEuroCents(periode.price_cents)} per persoon` : "prijs nog niet ingesteld"}
      </p>

      {periode.stand.toon === "over" ? (
        <Alert tone="warning" title="Er staan meer deelnemers dan plaatsen" className="mb-5">
          {periode.stand.label}. Dat mag, maar het is een bewuste keuze en geen vergissing die het
          systeem zelf oplost.
        </Alert>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Aangemeld</p>
            <p className="mt-1 font-display text-3xl tabular-nums">{periode.aangemeld}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Vrij</p>
            <p className="mt-1 font-display text-3xl tabular-nums">{periode.vrij}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Afgehaakt</p>
            <p className="mt-1 font-display text-3xl tabular-nums">{periode.afgehaakt}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Ontvangen</p>
            <p className="mt-1 font-display text-3xl tabular-nums">
              {formatEuroCents(Number(periode.ontvangen_cents))}
            </p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Deelnemers"
          description="Op volgorde van de fase waarin ze staan."
        />
        {deelnemers.length === 0 ? (
          <EmptyState
            title="Nog geen deelnemers"
            description="Meld hieronder de eerste aanmelding aan."
          />
        ) : (
          <ul>
            {deelnemers.map((d) => (
              <DeelnemerRegel
                key={d.deal.id}
                deelnemer={{
                  dealId: d.deal.id,
                  naam: d.contact.full_name,
                  email: d.contact.email,
                  fase: d.fase.label,
                  leeftijd: d.leeftijd,
                  stand: d.stand,
                }}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Deelnemer aanmelden"
          description="Alleen wat nodig is om te verkopen en te plannen. Medische gegevens, dieetwensen en paspoortgegevens horen niet in het CRM."
        />
        <CardBody>
          <ActionForm action={meldDeelnemerAanAction} submitLabel="Aanmelden">
            <input type="hidden" name="editionId" value={periode.edition_id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Naam" htmlFor="fullName" required showOptional={false}>
                <Input id="fullName" name="fullName" required autoComplete="off" />
              </Field>
              <Field label="Geboortedatum" htmlFor="birthDate" hint="Voor de leeftijd bij vertrek.">
                <Input id="birthDate" name="birthDate" type="date" />
              </Field>
              <Field label="E-mailadres" htmlFor="email">
                <Input id="email" name="email" type="email" autoComplete="off" />
              </Field>
              <Field label="Telefoonnummer" htmlFor="phone">
                <Input id="phone" name="phone" type="tel" autoComplete="off" />
              </Field>
              <Field
                label="Naam ouder of verzorger"
                htmlFor="guardianName"
                hint="Nodig als iemand bij vertrek nog geen achttien is."
              >
                <Input id="guardianName" name="guardianName" autoComplete="off" />
              </Field>
              <Field label="E-mailadres ouder" htmlFor="guardianEmail">
                <Input id="guardianEmail" name="guardianEmail" type="email" autoComplete="off" />
              </Field>
              <Field label="Telefoon ouder" htmlFor="guardianPhone">
                <Input id="guardianPhone" name="guardianPhone" type="tel" autoComplete="off" />
              </Field>
              <Field
                label="Interesse vrijwilligerswerk"
                htmlFor="interest"
                hint="Bijvoorbeeld onderwijs, sport of media."
              >
                <Input id="interest" name="interest" autoComplete="off" />
              </Field>
            </div>
            <Field label="Notitie" htmlFor="note">
              <Textarea id="note" name="note" rows={3} />
            </Field>
          </ActionForm>
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Reisperiode aanpassen" />
        <CardBody>
          <ActionForm action={bewaarPeriodeAction} submitLabel="Opslaan" variant="secondary">
            <input type="hidden" name="editionId" value={rij.id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Naam" htmlFor="edit-name" required showOptional={false}>
                <Input id="edit-name" name="name" defaultValue={rij.name} required />
              </Field>
              <Field label="Status" htmlFor="edit-status" required showOptional={false}>
                <Select id="edit-status" name="status" defaultValue={rij.status}>
                  {Object.entries(PERIODE_STATUS_LABELS).map(([waarde, label]) => (
                    <option key={waarde} value={waarde}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Startdatum" htmlFor="edit-start" required showOptional={false}>
                <Input id="edit-start" name="startsOn" type="date" defaultValue={rij.starts_on} required />
              </Field>
              <Field label="Einddatum" htmlFor="edit-eind" required showOptional={false}>
                <Input id="edit-eind" name="endsOn" type="date" defaultValue={rij.ends_on} required />
              </Field>
              <Field label="Aantal plaatsen" htmlFor="edit-capacity" required showOptional={false}>
                <Input
                  id="edit-capacity"
                  name="capacity"
                  type="number"
                  min={1}
                  max={200}
                  defaultValue={rij.capacity}
                />
              </Field>
              <Field
                label="Prijs per deelnemer"
                htmlFor="edit-price"
                hint="Een prijswijziging verandert niets aan bestaande aanmeldingen. Die houden het bedrag dat bij hun aanmelding gold."
              >
                <Input
                  id="edit-price"
                  name="price"
                  inputMode="decimal"
                  defaultValue={rij.price_cents ? euro(rij.price_cents) : ""}
                />
              </Field>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
