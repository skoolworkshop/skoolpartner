import { ActionForm } from "@/components/admin/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { LifecycleBadge, StilteBadge } from "@/components/admin/crm-badges";
import { LIFECYCLE_LABELS, contactStilte, type Lifecycle } from "@/lib/crm/regels";
import type { OrganisatieDeal } from "@/lib/crm/relaties";
import { ContactTypeBadge } from "@/components/admin/contact-badges";
import Link from "next/link";
import { formatEuroCents, formatShortDate } from "@/lib/format";
import type { CrmContactRow, CrmOrganizationProfileRow } from "@/lib/types/database";
import {
  bewaarContactAction,
  markeerContactAction,
  setRelatieProfielAction,
} from "@/app/admin/crm/actions";

/**
 * De commerciele blokken van een organisatie.
 *
 * ============================================================================
 * DRIE LOSSE ONDERDELEN, GEEN EEN GROOT BLOK
 * ============================================================================
 *
 * Ze stonden eerst als een blok onder elkaar op de beheerpagina van een
 * organisatie, tussen de punten, het tegoed, de domeinen en de facturen. Dat
 * betekende dat het commerciele en het operationele deel door elkaar liepen:
 * op hetzelfde scherm stond zowel "welke levensfase heeft deze school" als
 * "verwijder deze organisatie definitief".
 *
 * Nu staan ze los, zodat de CRM-pagina van een organisatie ze kan verdelen
 * over zijn kolommen: het profiel links, de personen en de deals rechts. Wat
 * er in staat is niet veranderd.
 */
export function RelatieProfiel({
  organizationId,
  profiel,
  beheerders,
  vandaag,
  omzetCents = 0,
  openWaardeCents = 0,
}: {
  organizationId: string;
  profiel: CrmOrganizationProfileRow | null;
  beheerders: { id: string; naam: string }[];
  omzetCents?: number;
  openWaardeCents?: number;
  /** Als "2026-09-01". Meegegeven zodat dit onderdeel testbaar en voorspelbaar blijft. */
  vandaag: string;
}) {
  const lifecycle = (profiel?.lifecycle ?? "klant") as Lifecycle;
  const stilte = contactStilte(profiel?.last_contact_at ?? null, vandaag);

  return (
    <>
      <Card>
        <CardHeader
          title="Relatie"
          description="Alleen zichtbaar in het beheerportaal. De klant ziet hier niets van."
        />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <LifecycleBadge waarde={lifecycle} />
            <StilteBadge stilte={stilte} />
            {profiel?.next_action_at ? (
              <span className="rounded-pill bg-surface-3 px-2.5 py-1 text-xs font-semibold text-muted">
                Volgende actie {formatShortDate(profiel.next_action_at)}
              </span>
            ) : null}
          </div>

          <ActionForm action={setRelatieProfielAction} submitLabel="Opslaan">
            <input type="hidden" name="organizationId" value={organizationId} />
            {/*
              Een kolom, geen twee. Deze blokken staan sinds de nieuwe indeling
              in een kolom van ongeveer 320 pixels breed. Twee velden naast
              elkaar betekent daar een datumveld dat wordt afgekapt en labels
              die over drie regels breken. Op een smalle plek is onder elkaar
              rustiger en beter leesbaar.
            */}
            <div className="grid gap-4">
              <Field label="Levensfase" htmlFor="lifecycle" required showOptional={false}>
                <Select id="lifecycle" name="lifecycle" defaultValue={lifecycle}>
                  {Object.entries(LIFECYCLE_LABELS).map(([waarde, label]) => (
                    <option key={waarde} value={waarde}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Eigenaar" htmlFor="ownerId" hint="Wie deze relatie beheert.">
                <Select id="ownerId" name="ownerId" defaultValue={profiel?.owner_id ?? ""}>
                  <option value="">Niemand</option>
                  {beheerders.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.naam}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Hoe binnengekomen" htmlFor="source" hint="Bijvoorbeeld: formulier, beurs, doorverwijzing.">
                <Input id="source" name="source" defaultValue={profiel?.source ?? ""} autoComplete="off" />
              </Field>
              <Field label="Volgende actie op" htmlFor="nextActionAt">
                <Input
                  id="nextActionAt"
                  name="nextActionAt"
                  type="date"
                  defaultValue={profiel?.next_action_at?.slice(0, 10) ?? ""}
                />
              </Field>
            </div>
            <Field label="Interne notitie" htmlFor="relatie-note">
              <Textarea id="relatie-note" name="note" rows={3} defaultValue={profiel?.note ?? ""} />
            </Field>
          </ActionForm>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line-soft pt-4 text-sm">
            <dt className="text-muted">Omzet tot nu toe</dt>
            <dd className="text-right font-semibold tabular-nums">{formatEuroCents(omzetCents)}</dd>
            <dt className="text-muted">Open dealwaarde</dt>
            <dd className="text-right font-semibold tabular-nums">
              {formatEuroCents(openWaardeCents)}
            </dd>
          </dl>

          <div className="border-t border-line-soft pt-4">
            <ActionForm
              action={markeerContactAction}
              submitLabel="Er is vandaag contact geweest"
              variant="secondary"
              inline
            >
              <input type="hidden" name="organizationId" value={organizationId} />
            </ActionForm>
          </div>
        </CardBody>
      </Card>
    </>
  );
}

export function RelatiePersonen({
  organizationId,
  contacten,
}: {
  organizationId: string;
  contacten: CrmContactRow[];
}) {
  return (
    <>
      <Card>
        <CardHeader
          title="Personen in het CRM"
          description="Losstaand van de geverifieerde contactpersonen hierboven. Iemand hier toevoegen geeft geen toegang tot e-mail."
        />
        {contacten.length > 0 ? (
          <ul>
            {contacten.map((contact) => (
              <li
                key={contact.id}
                className="border-b border-line-soft px-5 py-3 last:border-b-0"
              >
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  <Link
                    href={`/admin/crm/contacten/${contact.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {contact.full_name}
                  </Link>
                  <ContactTypeBadge type={contact.contact_type} />
                </p>
                <p className="break-words text-sm text-muted">
                  {[contact.job_title, contact.email, contact.phone].filter(Boolean).join(" · ") ||
                    "geen gegevens ingevuld"}
                </p>
                {contact.note ? (
                  <p className="mt-1 whitespace-pre-line text-sm text-muted">{contact.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {/*
          Het toevoegformulier is ingeklapt. Een persoon toevoegen doe je af en
          toe; de lijst lezen doe je elke keer.
        */}
        <details className={contacten.length > 0 ? "border-t border-line-soft" : undefined}>
          <summary className="cursor-pointer px-5 py-3 text-sm font-semibold">
            Persoon toevoegen
          </summary>
          <CardBody className="pt-0">
          <ActionForm action={bewaarContactAction} submitLabel="Persoon toevoegen" variant="secondary">
            <input type="hidden" name="organizationId" value={organizationId} />
            <div className="grid gap-4">
              <Field label="Naam" htmlFor="crm-fullName" required showOptional={false}>
                <Input id="crm-fullName" name="fullName" required autoComplete="off" />
              </Field>
              <Field label="Functie" htmlFor="crm-jobTitle">
                <Input id="crm-jobTitle" name="jobTitle" autoComplete="off" />
              </Field>
              <Field label="E-mailadres" htmlFor="crm-email">
                <Input id="crm-email" name="email" type="email" autoComplete="off" />
              </Field>
              <Field label="Telefoonnummer" htmlFor="crm-phone">
                <Input id="crm-phone" name="phone" type="tel" autoComplete="off" />
              </Field>
            </div>
          </ActionForm>
          </CardBody>
        </details>
      </Card>
    </>
  );
}

export function RelatieDeals({ deals = [] }: { deals?: OrganisatieDeal[] }) {
  return (
      <Card>
        <CardHeader
          title={`Deals (${deals.length})`}
          description="Verkoopkansen van deze organisatie. Een school kan er meerdere tegelijk hebben."
        />
        {deals.length > 0 ? (
          <ul>
            {deals.map((deal) => (
              <li key={deal.id} className="border-b border-line-soft last:border-b-0">
                <Link
                  href={`/admin/crm/deal/${deal.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-surface-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{deal.title}</span>
                    <span className="block text-sm text-muted">
                      {deal.faseLabel ?? "onbekende fase"}
                      {deal.expected_date ? ` · ${formatShortDate(deal.expected_date)}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {formatEuroCents(deal.value_cents)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <CardBody>
            <p className="text-sm text-muted">
              Nog geen deals. Een verkoopkans maak je aan bij Deals in het CRM.
            </p>
          </CardBody>
        )}
      </Card>
  );
}
