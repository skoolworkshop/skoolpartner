import { ActionForm } from "@/components/admin/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { formatDateTime, formatShortDate } from "@/lib/format";
import { ACTIVITEIT_LABELS, HANDMATIGE_SOORTEN, type Taak, type TijdlijnRegel } from "@/lib/crm/tijdlijn";
import { legActiviteitVastAction, maakTaakAction, zetTaakAfAction } from "@/app/admin/crm/actions";
import { cn } from "@/lib/utils";

/**
 * De tijdlijn en de taken van een onderwerp.
 *
 * Een onderdeel voor drie schermen: de organisatie, een aanvraag en een
 * deelnemer. Wat er gebeurt is overal hetzelfde, dus het hoort ook overal
 * hetzelfde te werken.
 */

export interface OnderwerpVelden {
  organizationId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
}

function VerborgenOnderwerp({ onderwerp }: { onderwerp: OnderwerpVelden }) {
  return (
    <>
      {onderwerp.organizationId ? (
        <input type="hidden" name="organizationId" value={onderwerp.organizationId} />
      ) : null}
      {onderwerp.contactId ? (
        <input type="hidden" name="contactId" value={onderwerp.contactId} />
      ) : null}
      {onderwerp.dealId ? <input type="hidden" name="dealId" value={onderwerp.dealId} /> : null}
    </>
  );
}

export function TijdlijnBlok({
  onderwerp,
  regels,
  titel = "Tijdlijn",
}: {
  onderwerp: OnderwerpVelden;
  regels: TijdlijnRegel[];
  titel?: string;
}) {
  return (
    <Card>
      <CardHeader
        title={titel}
        description="Wat er is gebeurd. Regels met Automatisch schrijft het systeem zelf."
      />
      {regels.length > 0 ? (
        <ul>
          {regels.map((regel) => (
            <li key={regel.id} className="border-b border-line-soft px-5 py-3 last:border-b-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span
                  className={cn(
                    "rounded-pill px-2 py-0.5 text-xs font-semibold",
                    regel.is_system ? "bg-surface-3 text-muted" : "bg-accent-wash text-accent-strong"
                  )}
                >
                  {ACTIVITEIT_LABELS[regel.kind]}
                </span>
                <span className="min-w-0 flex-1 font-semibold">{regel.summary}</span>
              </div>
              <p className="mt-0.5 text-sm text-muted">
                {formatDateTime(regel.occurred_at)}
                {regel.actorNaam ? ` · ${regel.actorNaam}` : ""}
              </p>
              {regel.body ? (
                <p className="mt-1 whitespace-pre-line text-sm text-muted">{regel.body}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <CardBody>
          <p className="text-sm text-muted">Er is nog niets vastgelegd.</p>
        </CardBody>
      )}

      <CardBody className="border-t border-line-soft">
        <ActionForm action={legActiviteitVastAction} submitLabel="Vastleggen">
          <VerborgenOnderwerp onderwerp={onderwerp} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Soort" htmlFor="activiteit-kind" required showOptional={false}>
              <Select id="activiteit-kind" name="kind" defaultValue="notitie">
                {HANDMATIGE_SOORTEN.map((soort) => (
                  <option key={soort} value={soort}>
                    {ACTIVITEIT_LABELS[soort]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Wanneer" htmlFor="activiteit-wanneer" hint="Leeg laten betekent nu.">
              <Input id="activiteit-wanneer" name="occurredAt" type="datetime-local" />
            </Field>
          </div>
          <Field label="Samenvatting" htmlFor="activiteit-summary" required showOptional={false}>
            <Input
              id="activiteit-summary"
              name="summary"
              required
              autoComplete="off"
              placeholder="Gebeld over de offerte"
            />
          </Field>
          <Field label="Toelichting" htmlFor="activiteit-body">
            <Textarea id="activiteit-body" name="body" rows={3} />
          </Field>
        </ActionForm>
      </CardBody>
    </Card>
  );
}

export function TakenBlok({
  onderwerp,
  taken,
  beheerders,
  titel = "Taken",
}: {
  onderwerp: OnderwerpVelden;
  taken: Taak[];
  beheerders: { id: string; naam: string }[];
  titel?: string;
}) {
  const open = taken.filter((t) => !t.done_at);
  const afgerond = taken.filter((t) => t.done_at);

  return (
    <Card>
      <CardHeader title={titel} description="Wat er nog moet gebeuren." />

      {open.length > 0 ? (
        <ul>
          {open.map((taak) => (
            <TaakRegel key={taak.id} taak={taak} onderwerp={onderwerp} />
          ))}
        </ul>
      ) : (
        <CardBody>
          <p className="text-sm text-muted">Er staat niets open.</p>
        </CardBody>
      )}

      {afgerond.length > 0 ? (
        <div className="border-t border-line-soft">
          <p className="px-5 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-soft">
            Afgerond
          </p>
          <ul>
            {afgerond.slice(0, 5).map((taak) => (
              <TaakRegel key={taak.id} taak={taak} onderwerp={onderwerp} />
            ))}
          </ul>
        </div>
      ) : null}

      <CardBody className="border-t border-line-soft">
        <ActionForm action={maakTaakAction} submitLabel="Taak toevoegen" variant="secondary">
          <VerborgenOnderwerp onderwerp={onderwerp} />
          <Field label="Wat moet er gebeuren" htmlFor="taak-title" required showOptional={false}>
            <Input id="taak-title" name="title" required autoComplete="off" placeholder="Offerte nabellen" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Vervaldatum" htmlFor="taak-dueOn">
              <Input id="taak-dueOn" name="dueOn" type="date" />
            </Field>
            <Field label="Wie pakt het op" htmlFor="taak-ownerId" hint="Leeg laten betekent jijzelf.">
              <Select id="taak-ownerId" name="ownerId" defaultValue="">
                <option value="">Ikzelf</option>
                {beheerders.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.naam}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </ActionForm>
      </CardBody>
    </Card>
  );
}

export function TaakRegel({
  taak,
  onderwerp,
  toonRelatie = false,
}: {
  taak: Taak;
  onderwerp?: OnderwerpVelden;
  toonRelatie?: boolean;
}) {
  const teLaat = !taak.done_at && taak.dagenTotVervaldatum !== null && taak.dagenTotVervaldatum < 0;
  const vandaag = !taak.done_at && taak.dagenTotVervaldatum === 0;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-soft px-5 py-3 last:border-b-0">
      <span className="min-w-0 flex-1">
        <span className={cn("block font-semibold", taak.done_at && "text-muted line-through")}>
          {taak.title}
        </span>
        <span className="block text-sm text-muted">
          {taak.due_on ? formatShortDate(taak.due_on) : "geen datum"}
          {taak.ownerNaam ? ` · ${taak.ownerNaam}` : ""}
          {toonRelatie && taak.organisatieNaam ? ` · ${taak.organisatieNaam}` : ""}
        </span>
      </span>

      {teLaat ? (
        <span className="rounded-pill bg-danger-wash px-2.5 py-1 text-xs font-semibold text-danger">
          {Math.abs(taak.dagenTotVervaldatum ?? 0)} dagen te laat
        </span>
      ) : vandaag ? (
        <span className="rounded-pill bg-warning-wash px-2.5 py-1 text-xs font-semibold text-warning">
          Vandaag
        </span>
      ) : null}

      <ActionForm
        action={zetTaakAfAction}
        submitLabel={taak.done_at ? "Heropenen" : "Afvinken"}
        variant="ghost"
        inline
      >
        <input type="hidden" name="taskId" value={taak.id} />
        <input type="hidden" name="af" value={taak.done_at ? "nee" : "ja"} />
        {onderwerp ? <VerborgenOnderwerp onderwerp={onderwerp} /> : null}
      </ActionForm>
    </li>
  );
}
