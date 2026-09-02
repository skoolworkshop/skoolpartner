import { ActionForm } from "@/components/admin/action-form";
import { ZoneOffsetVeld } from "@/components/admin/zone-offset-veld";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { formatDateTime, formatShortDate } from "@/lib/format";
import {
  AFSPRAAK_SOORTEN,
  AFSPRAAK_STATUSSEN,
  AFSPRAAK_VORMEN,
  formatDuur,
  naarInvoerTijd,
  type AfspraakStatus,
} from "@/lib/crm/afspraken-regels";
import type { Afspraak } from "@/lib/crm/afspraken";
import { bewaarAfspraakAction, zetAfspraakStandAction } from "@/app/admin/crm/actions";
import { cn } from "@/lib/utils";

/**
 * Afspraken bij een deal, een contactpersoon of een organisatie.
 *
 * Drie groepen, en die volgorde is de hele bedoeling van dit blok:
 *
 *   1. Blijft liggen  gepland, maar het moment is voorbij. Niemand heeft
 *                     bijgewerkt of het is doorgegaan.
 *   2. Komt eraan     wat er nog staat.
 *   3. Geweest        wat is afgerond.
 *
 * Zonder groep 1 blijft onzichtbaar dat er iets niet is bijgewerkt, en kloppen
 * de cijfers over gehouden gesprekken niet meer.
 */

const STAND_STIJL: Record<AfspraakStatus, string> = {
  gepland: "bg-info-wash text-info",
  gehouden: "bg-success-wash text-success",
  geannuleerd: "bg-surface-3 text-muted",
  niet_verschenen: "bg-danger-wash text-danger",
};

export function StandBadge({ status }: { status: AfspraakStatus }) {
  return (
    <span className={cn("rounded-pill px-2 py-0.5 text-xs font-semibold", STAND_STIJL[status])}>
      {AFSPRAAK_STATUSSEN[status]}
    </span>
  );
}

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

export function AfspraakRegel({
  afspraak,
  onderwerp,
  toonRelatie = false,
}: {
  afspraak: Afspraak;
  onderwerp: OnderwerpVelden;
  toonRelatie?: boolean;
}) {
  const bijWie = [afspraak.organisatieNaam, afspraak.contactNaam, afspraak.dealTitel]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="border-b border-line-soft px-5 py-3.5 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-semibold text-ink">{afspraak.title}</span>
          <StandBadge status={afspraak.status} />
          <span className="rounded-pill bg-surface-3 px-2 py-0.5 text-xs text-muted">
            {AFSPRAAK_SOORTEN[afspraak.kind]}
          </span>
        </span>
        <span className="shrink-0 text-sm text-muted tabular-nums">
          {formatDateTime(afspraak.startsAt)} · {formatDuur(afspraak.duurMinuten)}
        </span>
      </div>

      <p className="mt-0.5 text-sm text-muted">
        {AFSPRAAK_VORMEN[afspraak.form]}
        {afspraak.location ? ` · ${afspraak.location}` : ""}
        {afspraak.ownerNaam ? ` · ${afspraak.ownerNaam}` : ""}
        {toonRelatie && bijWie ? ` · ${bijWie}` : ""}
      </p>

      {afspraak.note ? (
        <p className="mt-1 whitespace-pre-line text-sm text-muted">{afspraak.note}</p>
      ) : null}

      {afspraak.outcome ? (
        <p className="mt-1.5 rounded-card bg-surface-2 px-3 py-2 text-sm">
          <span className="font-semibold text-ink">Uitkomst: </span>
          <span className="whitespace-pre-line text-muted">{afspraak.outcome}</span>
        </p>
      ) : null}

      {afspraak.status === "gepland" ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-semibold text-muted">
            Afronden of afzeggen
          </summary>
          <div className="mt-3 border-l-2 border-line-soft pl-4">
            <ActionForm action={zetAfspraakStandAction} submitLabel="Vastleggen">
              <VerborgenOnderwerp onderwerp={onderwerp} />
              <input type="hidden" name="id" value={afspraak.id} />
              <Field label="Wat is er gebeurd" htmlFor={`stand-${afspraak.id}`} required showOptional={false}>
                <Select id={`stand-${afspraak.id}`} name="status" defaultValue="gehouden">
                  <option value="gehouden">Is doorgegaan</option>
                  <option value="geannuleerd">Afgezegd</option>
                  <option value="niet_verschenen">Niemand kwam opdagen</option>
                </Select>
              </Field>
              <Field
                label="Wat kwam eruit"
                htmlFor={`uitkomst-${afspraak.id}`}
                hint="Waar is over gesproken en wat is de vervolgstap?"
              >
                <Textarea id={`uitkomst-${afspraak.id}`} name="outcome" rows={3} />
              </Field>
            </ActionForm>
          </div>
        </details>
      ) : afspraak.status === "gehouden" && !afspraak.outcome ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-semibold text-warning">
            Nog vastleggen wat eruit kwam
          </summary>
          <div className="mt-3 border-l-2 border-line-soft pl-4">
            <ActionForm action={zetAfspraakStandAction} submitLabel="Opslaan">
              <VerborgenOnderwerp onderwerp={onderwerp} />
              <input type="hidden" name="id" value={afspraak.id} />
              <input type="hidden" name="status" value="gehouden" />
              <Field label="Wat kwam eruit" htmlFor={`uitkomst-${afspraak.id}`} required showOptional={false}>
                <Textarea id={`uitkomst-${afspraak.id}`} name="outcome" rows={3} required />
              </Field>
            </ActionForm>
          </div>
        </details>
      ) : null}
    </li>
  );
}

function Groep({
  titel,
  toon,
  afspraken,
  onderwerp,
  toonRelatie,
}: {
  titel: string;
  toon?: string;
  afspraken: Afspraak[];
  onderwerp: OnderwerpVelden;
  toonRelatie?: boolean;
}) {
  if (afspraken.length === 0) return null;
  return (
    <>
      <p className="border-b border-line-soft bg-surface-2 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
        {titel} ({afspraken.length}){toon ? <span className="normal-case"> · {toon}</span> : null}
      </p>
      <ul>
        {afspraken.map((afspraak) => (
          <AfspraakRegel
            key={afspraak.id}
            afspraak={afspraak}
            onderwerp={onderwerp}
            toonRelatie={toonRelatie}
          />
        ))}
      </ul>
    </>
  );
}

export function AfsprakenBlok({
  onderwerp,
  indeling,
  beheerders,
  titel = "Afspraken",
}: {
  onderwerp: OnderwerpVelden;
  indeling: {
    komend: Afspraak[];
    achterstallig: Afspraak[];
    geweest: Afspraak[];
  };
  beheerders: { id: string; naam: string }[];
  titel?: string;
}) {
  const totaal =
    indeling.komend.length + indeling.achterstallig.length + indeling.geweest.length;

  return (
    <Card>
      <CardHeader
        title={titel}
        description="Gesprekken, bezoeken en belafspraken. Er gaat vanuit dit scherm geen uitnodiging de deur uit."
      />

      {totaal === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">Er staat nog geen afspraak.</p>
        </CardBody>
      ) : (
        <>
          <Groep
            titel="Blijft liggen"
            toon="het moment is geweest, maar er is niets bijgewerkt"
            afspraken={indeling.achterstallig}
            onderwerp={onderwerp}
          />
          <Groep titel="Komt eraan" afspraken={indeling.komend} onderwerp={onderwerp} />
          <Groep titel="Geweest" afspraken={indeling.geweest} onderwerp={onderwerp} />
        </>
      )}

      <CardBody className="border-t border-line-soft">
        <ActionForm action={bewaarAfspraakAction} submitLabel="Afspraak inplannen" variant="secondary">
          <VerborgenOnderwerp onderwerp={onderwerp} />
          <ZoneOffsetVeld />
          <Field label="Waar gaat het over" htmlFor="afspraak-titel" required showOptional={false}>
            <Input
              id="afspraak-titel"
              name="title"
              required
              autoComplete="off"
              placeholder="Kennismaking over de cultuurdag"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Begint" htmlFor="afspraak-start" required showOptional={false}>
              <Input id="afspraak-start" name="startsAt" type="datetime-local" required />
            </Field>
            <Field label="Eindigt" htmlFor="afspraak-eind" required showOptional={false}>
              <Input id="afspraak-eind" name="endsAt" type="datetime-local" required />
            </Field>
            <Field label="Soort" htmlFor="afspraak-soort" showOptional={false}>
              <Select id="afspraak-soort" name="kind" defaultValue="kennismaking">
                {Object.entries(AFSPRAAK_SOORTEN).map(([waarde, label]) => (
                  <option key={waarde} value={waarde}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Waar of hoe" htmlFor="afspraak-vorm" showOptional={false}>
              <Select id="afspraak-vorm" name="form" defaultValue="op_locatie">
                {Object.entries(AFSPRAAK_VORMEN).map(([waarde, label]) => (
                  <option key={waarde} value={waarde}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Adres of link"
              htmlFor="afspraak-locatie"
              hint="Een adres, een lokaal of de link naar het gesprek."
            >
              <Input id="afspraak-locatie" name="location" autoComplete="off" />
            </Field>
            <Field label="Wie van ons" htmlFor="afspraak-eigenaar">
              <Select id="afspraak-eigenaar" name="ownerId" defaultValue="">
                <option value="">Niemand gekozen</option>
                {beheerders.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.naam}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Voorbereiding" htmlFor="afspraak-notitie">
            <Textarea id="afspraak-notitie" name="note" rows={2} />
          </Field>
        </ActionForm>
      </CardBody>
    </Card>
  );
}

/** Alleen gebruikt bij het bewerken van een bestaande afspraak op het overzicht. */
export function afspraakInvoerWaarden(afspraak: Afspraak, offsetMinuten: number) {
  return {
    start: naarInvoerTijd(afspraak.startsAt, offsetMinuten),
    eind: naarInvoerTijd(afspraak.endsAt, offsetMinuten),
    datum: formatShortDate(afspraak.startsAt),
  };
}
