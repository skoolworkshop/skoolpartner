import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/admin/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { PeriodeKaart } from "@/components/admin/periode-kaart";
import { MerkSchakelaar } from "@/components/admin/merk-schakelaar";
import { requireAdmin } from "@/lib/auth/session";
import { hasServiceRole } from "@/lib/env";
import { getActiefMerk } from "@/lib/crm/actief-merk";
import { getDeelnemersZonderPeriode, getPeriodes, type Periode } from "@/lib/crm/suri";
import { PERIODE_STATUS_LABELS } from "@/lib/crm/regels";
import { formatEuroCents } from "@/lib/format";
import { bewaarPeriodeAction } from "@/app/admin/crm/actions";

export const metadata: Metadata = { title: "Reisperiodes" };

/** Van de databaseview naar wat de kaart nodig heeft. */
function naarKaart(periode: Periode) {
  return {
    editionId: periode.edition_id,
    name: periode.name,
    startsOn: periode.starts_on,
    endsOn: periode.ends_on,
    status: periode.status,
    capacity: Number(periode.capacity),
    priceCents: Number(periode.price_cents),
    aangemeld: Number(periode.aangemeld),
    volledigBetaald: Number(periode.volledig_betaald),
    ontvangenCents: Number(periode.ontvangen_cents),
    stand: periode.stand,
  };
}

export default async function SuriOverzicht() {
  await requireAdmin();
  const merk = await getActiefMerk();

  if (!hasServiceRole()) {
    return (
      <Alert tone="warning" title="SUPABASE_SERVICE_ROLE_KEY ontbreekt">
        Zonder deze sleutel kan het CRM geen gegevens lezen.
      </Alert>
    );
  }

  const [periodes, zwevend] = await Promise.all([getPeriodes(), getDeelnemersZonderPeriode()]);

  const vandaag = new Date().toISOString().slice(0, 10);
  const komend = periodes.filter((p) => p.ends_on >= vandaag);
  const geweest = periodes.filter((p) => p.ends_on < vandaag);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[30px]">Reisperiodes</h1>
        <MerkSchakelaar actief={merk} />
      </div>

      <p className="mb-6 max-w-2xl text-muted">
        Het Breekjaar wordt per persoon verkocht, met een vast aantal plaatsen per periode. De
        bezetting hieronder wordt berekend uit de aanmeldingen, dus je hoeft nergens een teller bij
        te houden.
      </p>

      {komend.length === 0 ? (
        <Card>
          <EmptyState
            title="Er staat nog geen reisperiode klaar"
            description="Maak hieronder de eerste periode aan. Daarna kun je er deelnemers bij zetten."
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {komend.map((periode) => (
            <PeriodeKaart key={periode.edition_id} periode={naarKaart(periode)} />
          ))}
        </div>
      )}

      {zwevend.length > 0 ? (
        <Card className="mt-6">
          <CardHeader
            title="Aanmeldingen zonder reisperiode"
            description="Deze mensen staan nergens ingedeeld. Open de aanmelding om er een periode aan te hangen."
          />
          <ul>
            {zwevend.map(({ deal, contact }) => (
              <li key={deal.id} className="border-b border-line-soft last:border-b-0">
                <Link
                  href={`/admin/crm/suri/deelnemer/${deal.id}`}
                  className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-2"
                >
                  <span className="min-w-0 truncate font-semibold">
                    {contact?.full_name ?? deal.title}
                  </span>
                  <span className="shrink-0 text-sm text-muted">{contact?.email ?? "geen adres"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {geweest.length > 0 ? (
        <Card className="mt-6">
          <CardHeader title="Geweest" description="Periodes waarvan de einddatum voorbij is." />
          <ul>
            {geweest.map((periode) => (
              <li key={periode.edition_id} className="border-b border-line-soft last:border-b-0">
                <Link
                  href={`/admin/crm/suri/periode/${periode.edition_id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-surface-2"
                >
                  <span className="font-semibold">{periode.name}</span>
                  <span className="text-sm text-muted">
                    {periode.aangemeld} deelnemers ·{" "}
                    {formatEuroCents(Number(periode.ontvangen_cents))} ontvangen
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="mt-6">
        <CardHeader
          title="Nieuwe reisperiode"
          description="Vijftien plaatsen is de standaard. Je kunt dat per periode aanpassen."
        />
        <CardBody>
          <ActionForm action={bewaarPeriodeAction} submitLabel="Reisperiode aanmaken">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Naam" htmlFor="name" required hint="Bijvoorbeeld: Maart 2027">
                <Input id="name" name="name" required placeholder="Maart 2027" />
              </Field>
              <Field label="Status" htmlFor="status" required showOptional={false}>
                <Select id="status" name="status" defaultValue="concept">
                  {Object.entries(PERIODE_STATUS_LABELS).map(([waarde, label]) => (
                    <option key={waarde} value={waarde}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Startdatum" htmlFor="startsOn" required showOptional={false}>
                <Input id="startsOn" name="startsOn" type="date" required />
              </Field>
              <Field label="Einddatum" htmlFor="endsOn" required showOptional={false}>
                <Input id="endsOn" name="endsOn" type="date" required />
              </Field>
              <Field label="Aantal plaatsen" htmlFor="capacity" required showOptional={false}>
                <Input id="capacity" name="capacity" type="number" min={1} max={200} defaultValue={15} />
              </Field>
              <Field
                label="Prijs per deelnemer"
                htmlFor="price"
                hint="In euro's. Laat leeg als de prijs nog niet vaststaat."
              >
                <Input id="price" name="price" inputMode="decimal" placeholder="4250,00" />
              </Field>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
