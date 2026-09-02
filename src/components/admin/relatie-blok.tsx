import { ActionForm } from "@/components/admin/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { LifecycleBadge, StilteBadge } from "@/components/admin/crm-badges";
import { LIFECYCLE_LABELS, contactStilte, type Lifecycle } from "@/lib/crm/regels";
import { formatShortDate } from "@/lib/format";
import type { CrmContactRow, CrmOrganizationProfileRow } from "@/lib/types/database";
import {
  bewaarContactAction,
  markeerContactAction,
  setRelatieProfielAction,
} from "@/app/admin/crm/actions";

/**
 * Het commerciele blok op de organisatiepagina.
 *
 * Bewust hier en niet op een eigen relatiekaart. Admin > Organisaties toont al
 * boekingen, facturen, punten, tegoed, gebruikers en geverifieerde
 * contactpersonen. Daar nog een tweede scherm naast zetten met dezelfde
 * gegevens levert twee halve waarheden op in plaats van een hele.
 */
export function RelatieBlok({
  organizationId,
  profiel,
  contacten,
  beheerders,
  vandaag,
}: {
  organizationId: string;
  profiel: CrmOrganizationProfileRow | null;
  contacten: CrmContactRow[];
  beheerders: { id: string; naam: string }[];
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
            <div className="grid gap-4 sm:grid-cols-2">
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
                <p className="font-semibold">{contact.full_name}</p>
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
        <CardBody className={contacten.length > 0 ? "border-t border-line-soft" : undefined}>
          <ActionForm action={bewaarContactAction} submitLabel="Persoon toevoegen" variant="secondary">
            <input type="hidden" name="organizationId" value={organizationId} />
            <div className="grid gap-4 sm:grid-cols-2">
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
      </Card>
    </>
  );
}
