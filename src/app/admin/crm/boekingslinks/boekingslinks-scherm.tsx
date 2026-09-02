import { ActionForm } from "@/components/admin/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { AFSPRAAK_SOORTEN, AFSPRAAK_VORMEN, formatDuur } from "@/lib/crm/afspraken-regels";
import { WEEKDAG_NAMEN, schrijfKlok } from "@/lib/crm/beschikbaarheid";
import type { BoekingsLink } from "@/lib/crm/boekingslinks";
import {
  bewaarBoekingsLinkAction,
  zetBoekingsLinkAanAction,
} from "@/app/admin/crm/actions";
import { cn } from "@/lib/utils";

/**
 * Het beheerscherm voor boekingslinks.
 *
 * Wat hier het belangrijkst is om te zien: de link zelf, of hij aan staat, en
 * of de agenda echt wordt meegenomen. Dat laatste is geen detail. Zonder
 * agendatoestemming kan een school over een afspraak heen boeken die alleen in
 * Google staat, en dat merk je pas als er twee mensen tegelijk voor je deur
 * staan.
 */

const DAGEN = [1, 2, 3, 4, 5, 6, 0];

function VensterVelden({ link }: { link?: BoekingsLink }) {
  const perDag = new Map<number, { vanaf: string; tot: string }>();
  for (const venster of link?.vensters ?? []) {
    // Het formulier kent een venster per dag. Wie er twee heeft ingesteld, ziet
    // hier het eerste; de rest blijft in de database staan tot hij opslaat.
    if (!perDag.has(venster.weekdag)) {
      perDag.set(venster.weekdag, {
        vanaf: schrijfKlok(venster.vanafMinuut),
        tot: schrijfKlok(venster.totMinuut),
      });
    }
  }

  return (
    <fieldset className="rounded-card border border-line-soft p-4">
      <legend className="px-1 text-sm font-semibold">Wanneer ben je beschikbaar</legend>
      <p className="mb-3 text-xs text-muted">
        Laat een dag leeg om hem over te slaan. Tijden in {link?.timezone ?? "Europe/Amsterdam"}.
      </p>
      <div className="space-y-2">
        {DAGEN.map((dag) => {
          const bestaand = perDag.get(dag);
          const sleutel = `${link?.id ?? "nieuw"}-${dag}`;
          return (
            <div
              key={dag}
              // min-w-0 op de invoervelden is hier nodig: een veld van het
              // type time heeft een eigen minimumbreedte, en zonder dat een
              // 1fr-kolom mag krimpen duwt hij de kaart zijwaarts het scherm uit.
              className="grid grid-cols-[5rem_1fr_1fr] items-center gap-2 sm:grid-cols-[5.5rem_1fr_1fr]"
            >
              <label htmlFor={`vanaf-${sleutel}`} className="text-sm">
                {WEEKDAG_NAMEN[dag]}
              </label>
              <input
                id={`vanaf-${sleutel}`}
                name={`vanaf-${dag}`}
                type="time"
                defaultValue={bestaand?.vanaf ?? ""}
                className="h-10 w-full min-w-0 rounded-card border border-line bg-white px-1.5 text-sm sm:px-2"
              />
              <input
                aria-label={`${WEEKDAG_NAMEN[dag]} tot`}
                name={`tot-${dag}`}
                type="time"
                defaultValue={bestaand?.tot ?? ""}
                className="h-10 w-full min-w-0 rounded-card border border-line bg-white px-1.5 text-sm sm:px-2"
              />
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function LinkVelden({
  link,
  beheerders,
}: {
  link?: BoekingsLink;
  beheerders: { id: string; naam: string }[];
}) {
  const sleutel = link?.id ?? "nieuw";
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Naam" htmlFor={`naam-${sleutel}`} required showOptional={false}>
          <Input
            id={`naam-${sleutel}`}
            name="name"
            required
            defaultValue={link?.name ?? ""}
            placeholder="Kennismakingsgesprek"
            autoComplete="off"
          />
        </Field>
        <Field label="Wie krijgt de afspraak" htmlFor={`eigenaar-${sleutel}`} hint="Bepaalt ook wiens agenda wordt geraadpleegd.">
          <Select id={`eigenaar-${sleutel}`} name="ownerId" defaultValue={link?.ownerId ?? ""}>
            <option value="">Niemand gekozen</option>
            {beheerders.map((b) => (
              <option key={b.id} value={b.id}>
                {b.naam}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Soort afspraak" htmlFor={`soort-${sleutel}`} showOptional={false}>
          <Select id={`soort-${sleutel}`} name="meetingKind" defaultValue={link?.meetingKind ?? "kennismaking"}>
            {Object.entries(AFSPRAAK_SOORTEN).map(([waarde, label]) => (
              <option key={waarde} value={waarde}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Waar of hoe" htmlFor={`vorm-${sleutel}`} showOptional={false}>
          <Select id={`vorm-${sleutel}`} name="meetingForm" defaultValue={link?.meetingForm ?? "videobellen"}>
            {Object.entries(AFSPRAAK_VORMEN).map(([waarde, label]) => (
              <option key={waarde} value={waarde}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Adres of gesprekslink" htmlFor={`locatie-${sleutel}`} hint="Komt in de bevestiging te staan.">
          <Input id={`locatie-${sleutel}`} name="location" defaultValue={link?.location ?? ""} autoComplete="off" />
        </Field>
        <Field label="Merk" htmlFor={`merk-${sleutel}`} showOptional={false}>
          <Select id={`merk-${sleutel}`} name="brand" defaultValue={link?.brand ?? "skool_workshop"}>
            <option value="skool_workshop">Skool Workshop</option>
            <option value="suri_impact">Suri Impact</option>
          </Select>
        </Field>
      </div>

      <Field label="Wat de school te lezen krijgt" htmlFor={`intro-${sleutel}`}>
        <Textarea id={`intro-${sleutel}`} name="intro" rows={3} defaultValue={link?.intro ?? ""} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Duur" htmlFor={`duur-${sleutel}`} hint="Minuten." showOptional={false}>
          <Input
            id={`duur-${sleutel}`}
            name="durationMinutes"
            type="number"
            min={5}
            max={480}
            defaultValue={link?.durationMinutes ?? 30}
          />
        </Field>
        <Field label="Rust erna" htmlFor={`buffer-${sleutel}`} hint="Minuten." showOptional={false}>
          <Input
            id={`buffer-${sleutel}`}
            name="bufferAfterMinutes"
            type="number"
            min={0}
            max={240}
            defaultValue={link?.bufferAfterMinutes ?? 15}
          />
        </Field>
        <Field label="Minstens vooraf" htmlFor={`opzeg-${sleutel}`} hint="Uren." showOptional={false}>
          <Input
            id={`opzeg-${sleutel}`}
            name="noticeHours"
            type="number"
            min={0}
            max={720}
            defaultValue={link?.noticeHours ?? 24}
          />
        </Field>
        <Field label="Hoever vooruit" htmlFor={`horizon-${sleutel}`} hint="Dagen." showOptional={false}>
          <Input
            id={`horizon-${sleutel}`}
            name="horizonDays"
            type="number"
            min={1}
            max={365}
            defaultValue={link?.horizonDays ?? 60}
          />
        </Field>
      </div>

      <VensterVelden link={link} />
    </>
  );
}

export function BoekingsLinksScherm({
  links,
  beheerders,
  siteUrl,
  agendaWaarschuwing,
}: {
  links: BoekingsLink[];
  beheerders: { id: string; naam: string }[];
  siteUrl: string;
  agendaWaarschuwing: string | null;
}) {
  return (
    <>
      <h1 className="mb-6 text-[30px]">Boekingslinks</h1>

      {agendaWaarschuwing ? (
        <Alert tone="warning" title="Je agenda telt nu niet mee" className="mb-6">
          {agendaWaarschuwing} Vrije momenten volgen zolang alleen uit je werktijden en de
          afspraken die in het CRM staan. Je koppelt Google opnieuw bij Systeem, Integraties.
        </Alert>
      ) : (
        <Alert tone="success" title="Je agenda telt mee" className="mb-6">
          Bezette momenten uit Google Agenda worden meegenomen. Er wordt alleen gekeken wanneer je
          bezet bent; de titels en deelnemers van je afspraken komen hier nooit langs.
        </Alert>
      )}

      {links.length === 0 ? (
        <Card className="mb-6">
          <EmptyState
            title="Nog geen boekingslink"
            description="Maak er hieronder een aan. Je krijgt dan een adres dat je kunt doorsturen."
          />
        </Card>
      ) : (
        <div className="mb-6 space-y-4">
          {links.map((link) => (
            <Card key={link.id}>
              <CardHeader
                title={link.name}
                description={`${formatDuur(link.durationMinutes)} · ${AFSPRAAK_VORMEN[link.meetingForm as keyof typeof AFSPRAAK_VORMEN] ?? link.meetingForm}${link.ownerNaam ? ` · ${link.ownerNaam}` : ""}`}
                action={
                  <span
                    className={cn(
                      "rounded-pill px-3 py-1 text-xs font-semibold",
                      link.isActive ? "bg-success-wash text-success" : "bg-surface-3 text-muted"
                    )}
                  >
                    {link.isActive ? "Staat aan" : "Staat uit"}
                  </span>
                }
              />
              <CardBody className="space-y-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-soft">
                    Het adres om door te sturen
                  </p>
                  <code className="mt-1 block break-all rounded-card bg-surface-2 px-3 py-2 text-sm">
                    {siteUrl}/afspraak/{link.slug}
                  </code>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-muted">Rust erna</dt>
                    <dd className="font-semibold tabular-nums">{link.bufferAfterMinutes} min</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Minstens vooraf</dt>
                    <dd className="font-semibold tabular-nums">{link.noticeHours} uur</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Hoever vooruit</dt>
                    <dd className="font-semibold tabular-nums">{link.horizonDays} dagen</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Geboekt</dt>
                    <dd className="font-semibold tabular-nums">{link.aantalBoekingen}</dd>
                  </div>
                </dl>

                <p className="text-sm text-muted">
                  {link.vensters.length === 0
                    ? "Geen werktijden ingesteld, er valt dus niets te boeken."
                    : link.vensters
                        .map(
                          (v) =>
                            `${WEEKDAG_NAMEN[v.weekdag].slice(0, 2).toLowerCase()} ${schrijfKlok(v.vanafMinuut)}–${schrijfKlok(v.totMinuut)}`
                        )
                        .join(" · ")}
                </p>

                <div className="border-t border-line-soft pt-3">
                  <ActionForm
                    action={zetBoekingsLinkAanAction}
                    submitLabel={link.isActive ? "Zet uit" : "Zet aan"}
                    variant="secondary"
                    inline
                  >
                    <input type="hidden" name="id" value={link.id} />
                    <input type="hidden" name="actief" value={link.isActive ? "nee" : "ja"} />
                  </ActionForm>
                  <p className="mt-2 text-xs text-muted">
                    Uitzetten laat de gemaakte afspraken staan. Wie de link daarna opent, krijgt een
                    pagina die niet bestaat.
                  </p>
                </div>

                <details className="border-t border-line-soft pt-3">
                  <summary className="cursor-pointer text-sm font-semibold text-muted">
                    Aanpassen
                  </summary>
                  <div className="mt-3 border-l-2 border-line-soft pl-4">
                    <ActionForm action={bewaarBoekingsLinkAction} submitLabel="Opslaan">
                      <input type="hidden" name="id" value={link.id} />
                      <input type="hidden" name="isActive" value={link.isActive ? "ja" : "nee"} />
                      <LinkVelden link={link} beheerders={beheerders} />
                    </ActionForm>
                  </div>
                </details>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader
          title="Nieuwe boekingslink"
          description="Het adres wordt automatisch gemaakt en is niet te raden."
        />
        <CardBody>
          <ActionForm action={bewaarBoekingsLinkAction} submitLabel="Boekingslink maken">
            <input type="hidden" name="isActive" value="ja" />
            <LinkVelden beheerders={beheerders} />
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
