import { ActionForm } from "@/components/admin/action-form";
import { BevestigForm } from "@/components/admin/bevestig-form";
import { BezettingBadge } from "@/components/admin/inschrijving-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { formatTime } from "@/lib/format";
import type { GroepRegel, RondeRegel, UitvoeringRegel, WorkshopRegel } from "@/lib/inschrijving/dagen";
import type { Woorden } from "@/lib/inschrijving/regels";
import type { AdminState } from "@/app/admin/actions";

/**
 * Het rooster van een inschrijfdag.
 *
 * BOVEN EEN OVERZICHT, DAARONDER DE KNOPPEN
 *
 *   Bovenaan staat de tabel die je in je hoofd hebt: workshops als rijen,
 *   rondes als kolommen. Die is om te kijken, niet om te klikken. Daaronder
 *   staat per workshop wat er in elke ronde gebeurt, met de instellingen
 *   achter een knop. Zo past het ook op een telefoon, waar een tabel van vier
 *   rondes naast twaalf workshops nooit gaat passen.
 *
 * LEEG IS ALLE KLASSEN
 *
 *   Vink je geen enkele klas aan, dan mag iedereen erin. Dat is bewust
 *   andersom dan je zou verwachten: vergeten aanvinken levert zo nooit een
 *   workshop op waar niemand in kan.
 */

export interface RoosterActies {
  bewaarUitvoering: (prev: AdminState, formData: FormData) => Promise<AdminState>;
  zetUitvoering: (prev: AdminState, formData: FormData) => Promise<AdminState>;
  zetKlassen: (prev: AdminState, formData: FormData) => Promise<AdminState>;
  voegUitvoeringToe: (prev: AdminState, formData: FormData) => Promise<AdminState>;
  verwijderUitvoering: (prev: AdminState, formData: FormData) => Promise<AdminState>;
  kopieerRonde: (prev: AdminState, formData: FormData) => Promise<AdminState>;
  bewaarRonde: (prev: AdminState, formData: FormData) => Promise<AdminState>;
  verwijderRonde: (prev: AdminState, formData: FormData) => Promise<AdminState>;
  bewaarWorkshop: (prev: AdminState, formData: FormData) => Promise<AdminState>;
  verwijderWorkshop: (prev: AdminState, formData: FormData) => Promise<AdminState>;
  bewaarAppInfo: (prev: AdminState, formData: FormData) => Promise<AdminState>;
}

function klasTekst(uitvoering: UitvoeringRegel, groepen: GroepRegel[], taal: Woorden): string {
  if (uitvoering.klassen.length === 0) return `alle ${taal.groepen}`;
  const namen = groepen.filter((groep) => uitvoering.klassen.includes(groep.id)).map((groep) => groep.naam);
  return namen.join(", ");
}

/** Eén cel in de overzichtstabel. */
function Cel({
  uitvoeringen,
  groepen,
  taal,
}: {
  uitvoeringen: UitvoeringRegel[];
  groepen: GroepRegel[];
  taal: Woorden;
}) {
  if (uitvoeringen.length === 0) {
    return <span className="text-muted-soft">—</span>;
  }

  return (
    <div className="space-y-1">
      {uitvoeringen.map((uitvoering) => (
        <div key={uitvoering.id} className="text-xs">
          {uitvoering.actief ? (
            <>
              <span className="font-semibold tabular-nums">
                {uitvoering.bezet}/{uitvoering.maximum}
              </span>
              {uitvoering.label ? <span className="text-muted"> · {uitvoering.label}</span> : null}
              <div className="truncate text-muted">{klasTekst(uitvoering, groepen, taal)}</div>
            </>
          ) : (
            <span className="text-muted-soft">uit</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function RoosterBord({
  dagId,
  rondes,
  groepen,
  workshops,
  taal,
  acties,
}: {
  dagId: string;
  rondes: RondeRegel[];
  groepen: GroepRegel[];
  workshops: WorkshopRegel[];
  taal: Woorden;
  acties: RoosterActies;
}) {
  if (rondes.length === 0 || workshops.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Nog geen rooster"
          description="Zet eerst de rondes klaar met hun tijden, en voeg daarna de workshops toe. Een nieuwe workshop draait meteen in alle rondes."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------------
          Het overzicht. Scrollt bij veel rondes mee in zijn eigen kader,
          zodat de pagina zelf niet opzij schuift.
      --------------------------------------------------------------- */}
      <Card>
        <CardHeader
          title="Overzicht"
          description={`${workshops.length} workshops in ${rondes.length} ${rondes.length === 1 ? "ronde" : "rondes"}`}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line-soft">
                <th className="sticky left-0 bg-white px-5 py-2 text-left font-semibold">Workshop</th>
                {rondes.map((ronde) => (
                  <th key={ronde.id} className="px-3 py-2 text-left font-semibold">
                    <div>{ronde.label}</div>
                    <div className="text-xs font-normal text-muted">
                      {formatTime(ronde.begin)} tot {formatTime(ronde.eind)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {workshops.map((workshop) => (
                <tr key={workshop.id} className="border-b border-line-soft last:border-0 align-top">
                  <th className="sticky left-0 bg-white px-5 py-2 text-left font-semibold">
                    <a href={`#workshop-${workshop.id}`} className="hover:underline">
                      {workshop.naam}
                    </a>
                  </th>
                  {rondes.map((ronde) => (
                    <td key={ronde.id} className="px-3 py-2">
                      <Cel
                        uitvoeringen={workshop.uitvoeringen.filter((u) => u.rondeId === ronde.id)}
                        groepen={groepen}
                        taal={taal}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <CardBody className="border-t border-line-soft">
          <details>
            <summary className="cursor-pointer list-none text-sm font-semibold hover:text-ink">
              Een ronde kopiëren naar een andere
            </summary>
            <div className="mt-3">
              <ActionForm action={acties.kopieerRonde} submitLabel="Kopiëren" inline>
                <input type="hidden" name="event_id" value={dagId} />
                <Field label="Van" htmlFor="van_ronde" required>
                  <Select id="van_ronde" name="van_ronde" defaultValue={rondes[0]?.id}>
                    {rondes.map((ronde) => (
                      <option key={ronde.id} value={ronde.id}>
                        {ronde.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Naar" htmlFor="naar_ronde" required>
                  <Select id="naar_ronde" name="naar_ronde" defaultValue={rondes[rondes.length - 1]?.id}>
                    {rondes.map((ronde) => (
                      <option key={ronde.id} value={ronde.id}>
                        {ronde.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </ActionForm>
              <p className="mt-2 text-xs text-muted">
                Maximum, ruimte, docent, aan of uit en de {taal.groepen} worden overgenomen. Een maximum dat lager
                uitkomt dan wat er al bezet is, wordt overgeslagen.
              </p>
            </div>
          </details>
        </CardBody>
      </Card>

      {/* ---------------------------------------------------------------
          Per workshop: wat er in elke ronde gebeurt, met de instellingen.
      --------------------------------------------------------------- */}
      {workshops.map((workshop) => (
        <Card key={workshop.id} id={`workshop-${workshop.id}`} className="scroll-mt-4">
          <CardHeader
            title={workshop.naam}
            description={`Standaard ${workshop.standaardMaximum} per uitvoering`}
            action={
              <Badge tone={workshop.uitvoeringen.some((u) => u.actief) ? "neutral" : "warning"}>
                {new Set(workshop.uitvoeringen.filter((u) => u.actief).map((u) => u.rondeId)).size} van{" "}
                {rondes.length} rondes
              </Badge>
            }
          />

          <CardBody className="space-y-3">
            {rondes.map((ronde) => {
              const uitvoeringen = workshop.uitvoeringen.filter((u) => u.rondeId === ronde.id);

              return (
                <div key={ronde.id} className="rounded-card border border-line-soft">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                    <span className="font-semibold">{ronde.label}</span>
                    <span className="text-xs text-muted">
                      {formatTime(ronde.begin)} tot {formatTime(ronde.eind)}
                    </span>
                  </div>

                  {uitvoeringen.length === 0 ? (
                    <div className="border-t border-line-soft px-4 py-3 text-sm text-muted">
                      Draait niet in deze ronde.
                    </div>
                  ) : null}

                  {uitvoeringen.map((uitvoering) => (
                    <div key={uitvoering.id} className="border-t border-line-soft px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm">
                            {uitvoering.label ? <span className="font-semibold">{uitvoering.label} · </span> : null}
                            <span className="text-muted">{klasTekst(uitvoering, groepen, taal)}</span>
                          </p>
                          {uitvoering.ruimte || uitvoering.docent ? (
                            <p className="truncate text-xs text-muted">
                              {[uitvoering.ruimte, uitvoering.docent].filter(Boolean).join(" · ")}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          {uitvoering.actief ? (
                            <BezettingBadge bezet={uitvoering.bezet} maximum={uitvoering.maximum} />
                          ) : (
                            <Badge tone="neutral">Staat uit</Badge>
                          )}
                          <BevestigForm
                            action={acties.zetUitvoering}
                            submitLabel={uitvoering.actief ? "Uitzetten" : "Aanzetten"}
                            bevestigLabel="Toch uitzetten"
                            variant="ghost"
                            inline
                          >
                            <input type="hidden" name="event_id" value={dagId} />
                            <input type="hidden" name="session_id" value={uitvoering.id} />
                            <input type="hidden" name="actief" value={uitvoering.actief ? "nee" : "ja"} />
                          </BevestigForm>
                        </div>
                      </div>

                      <details className="mt-2">
                        <summary className="cursor-pointer list-none text-xs font-semibold text-muted hover:text-ink">
                          Instellen
                        </summary>

                        <div className="mt-3 space-y-4 border-l-2 border-line-soft pl-3">
                          <ActionForm action={acties.bewaarUitvoering} submitLabel="Opslaan">
                            <input type="hidden" name="event_id" value={dagId} />
                            <input type="hidden" name="session_id" value={uitvoering.id} />
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Field label="Maximum" htmlFor={`max-${uitvoering.id}`} required>
                                <Input
                                  id={`max-${uitvoering.id}`}
                                  name="capacity"
                                  type="number"
                                  min={1}
                                  max={500}
                                  defaultValue={uitvoering.maximum}
                                />
                              </Field>
                              <Field label="Ruimte" htmlFor={`ruimte-${uitvoering.id}`}>
                                <Input
                                  id={`ruimte-${uitvoering.id}`}
                                  name="room"
                                  defaultValue={uitvoering.ruimte ?? ""}
                                  placeholder="Gymzaal"
                                />
                              </Field>
                              <Field label="Docent" htmlFor={`docent-${uitvoering.id}`}>
                                <Input
                                  id={`docent-${uitvoering.id}`}
                                  name="teacher"
                                  defaultValue={uitvoering.docent ?? ""}
                                />
                              </Field>
                              <Field
                                label="Naam van deze uitvoering"
                                htmlFor={`label-${uitvoering.id}`}
                                hint="Alleen nodig bij twee uitvoeringen naast elkaar."
                              >
                                <Input
                                  id={`label-${uitvoering.id}`}
                                  name="label"
                                  defaultValue={uitvoering.label ?? ""}
                                  placeholder="Groep A"
                                />
                              </Field>
                            </div>
                          </ActionForm>

                          <BevestigForm
                            action={acties.zetKlassen}
                            submitLabel={`Deze ${taal.groepen} opslaan`}
                            bevestigLabel="Toch beperken"
                          >
                            <input type="hidden" name="event_id" value={dagId} />
                            <input type="hidden" name="session_id" value={uitvoering.id} />
                            <fieldset>
                              <legend className="text-sm font-semibold">
                                Wie mag erin
                                <span className="ml-2 font-normal text-muted">
                                  niets aanvinken is alle {taal.groepen}
                                </span>
                              </legend>
                              <div className="mt-2 grid gap-1 sm:grid-cols-2">
                                {groepen.map((groep) => (
                                  <label key={groep.id} className="flex items-center gap-2 text-sm">
                                    <Checkbox
                                      name="groep"
                                      value={groep.id}
                                      defaultChecked={uitvoering.klassen.includes(groep.id)}
                                    />
                                    <span className="truncate">{groep.naam}</span>
                                  </label>
                                ))}
                              </div>
                            </fieldset>
                          </BevestigForm>

                          {uitvoering.bezet === 0 ? (
                            <ActionForm
                              action={acties.verwijderUitvoering}
                              submitLabel="Deze uitvoering verwijderen"
                              variant="danger"
                              inline
                            >
                              <input type="hidden" name="event_id" value={dagId} />
                              <input type="hidden" name="session_id" value={uitvoering.id} />
                            </ActionForm>
                          ) : null}
                        </div>
                      </details>
                    </div>
                  ))}

                  <details className="border-t border-line-soft">
                    <summary className="cursor-pointer list-none px-4 py-2 text-xs font-semibold text-muted hover:text-ink">
                      {uitvoeringen.length === 0 ? "Hier laten draaien" : "Nog een uitvoering in deze ronde"}
                    </summary>
                    <div className="border-t border-line-soft px-4 py-3">
                      <ActionForm action={acties.voegUitvoeringToe} submitLabel="Toevoegen">
                        <input type="hidden" name="event_id" value={dagId} />
                        <input type="hidden" name="workshop_id" value={workshop.id} />
                        <input type="hidden" name="round_id" value={ronde.id} />
                        <div className="grid gap-3 sm:grid-cols-3">
                          <Field
                            label="Naam"
                            htmlFor={`nieuw-label-${workshop.id}-${ronde.id}`}
                            hint="Bijvoorbeeld Groep B."
                            required
                          >
                            <Input
                              id={`nieuw-label-${workshop.id}-${ronde.id}`}
                              name="label"
                              placeholder="Groep B"
                              required
                            />
                          </Field>
                          <Field label="Maximum" htmlFor={`nieuw-max-${workshop.id}-${ronde.id}`} required>
                            <Input
                              id={`nieuw-max-${workshop.id}-${ronde.id}`}
                              name="capacity"
                              type="number"
                              min={1}
                              max={500}
                              defaultValue={workshop.standaardMaximum}
                            />
                          </Field>
                          <Field label="Ruimte" htmlFor={`nieuw-ruimte-${workshop.id}-${ronde.id}`}>
                            <Input id={`nieuw-ruimte-${workshop.id}-${ronde.id}`} name="room" />
                          </Field>
                        </div>
                      </ActionForm>
                    </div>
                  </details>
                </div>
              );
            })}

            <details>
              <summary className="cursor-pointer list-none text-sm font-semibold hover:text-ink">
                Voorbereiding: app en benodigdheden
                {workshop.appNodig ? <Badge tone="info" className="ml-2">App nodig</Badge> : null}
              </summary>
              <div className="mt-3 border-t border-line-soft pt-3">
                <ActionForm action={acties.bewaarAppInfo} submitLabel="Opslaan">
                  <input type="hidden" name="event_id" value={dagId} />
                  <input type="hidden" name="workshop_id" value={workshop.id} />

                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox name="app_required" value="ja" defaultChecked={workshop.appNodig} />
                    <span>
                      Voor deze workshop is een app nodig
                      <span className="block text-xs text-muted">
                        Deze informatie komt automatisch in de bevestiging van de deelnemer.
                      </span>
                    </span>
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Naam van de app" htmlFor={`appnaam-${workshop.id}`}>
                      <Input
                        id={`appnaam-${workshop.id}`}
                        name="app_name"
                        defaultValue={workshop.appNaam ?? ""}
                        placeholder="CapCut"
                      />
                    </Field>
                    <Field
                      label="Webversie"
                      htmlFor={`appweb-${workshop.id}`}
                      hint="Als de app ook in de browser werkt."
                    >
                      <Input
                        id={`appweb-${workshop.id}`}
                        name="app_web_url"
                        defaultValue={workshop.web ?? ""}
                        placeholder="https://"
                      />
                    </Field>
                    <Field
                      label="Android"
                      htmlFor={`appandroid-${workshop.id}`}
                      hint="Moet beginnen met https://play.google.com/"
                    >
                      <Input
                        id={`appandroid-${workshop.id}`}
                        name="app_android_url"
                        defaultValue={workshop.android ?? ""}
                        placeholder="https://play.google.com/store/apps/details?id="
                      />
                    </Field>
                    <Field
                      label="iPhone"
                      htmlFor={`appios-${workshop.id}`}
                      hint="Moet beginnen met https://apps.apple.com/"
                    >
                      <Input
                        id={`appios-${workshop.id}`}
                        name="app_ios_url"
                        defaultValue={workshop.ios ?? ""}
                        placeholder="https://apps.apple.com/nl/app/"
                      />
                    </Field>
                    <Field label="Korte uitleg" htmlFor={`appuitleg-${workshop.id}`} className="sm:col-span-2">
                      <Textarea
                        id={`appuitleg-${workshop.id}`}
                        name="app_instructions"
                        rows={2}
                        defaultValue={workshop.appUitleg ?? ""}
                        placeholder="Installeer de app voor de workshop begint en maak een account aan."
                      />
                    </Field>
                    <Field label="Zelf meenemen" htmlFor={`spullen-${workshop.id}`} className="sm:col-span-2">
                      <Textarea
                        id={`spullen-${workshop.id}`}
                        name="materials"
                        rows={2}
                        defaultValue={workshop.spullen ?? ""}
                        placeholder="Oude kleren, een koptelefoon"
                      />
                    </Field>
                  </div>
                </ActionForm>
              </div>
            </details>

            <details>
              <summary className="cursor-pointer list-none text-sm font-semibold hover:text-ink">
                Workshop aanpassen of verwijderen
              </summary>
              <div className="mt-3 space-y-3 border-t border-line-soft pt-3">
                <ActionForm action={acties.bewaarWorkshop} submitLabel="Opslaan" inline>
                  <input type="hidden" name="event_id" value={dagId} />
                  <input type="hidden" name="workshop_id" value={workshop.id} />
                  <Field label="Naam" htmlFor={`wnaam-${workshop.id}`} required>
                    <Input id={`wnaam-${workshop.id}`} name="name" defaultValue={workshop.naam} />
                  </Field>
                  <Field label="Standaard maximum" htmlFor={`wmax-${workshop.id}`} required>
                    <Input
                      id={`wmax-${workshop.id}`}
                      name="capacity"
                      type="number"
                      min={1}
                      max={500}
                      defaultValue={workshop.standaardMaximum}
                      className="w-24"
                    />
                  </Field>
                </ActionForm>

                {workshop.uitvoeringen.every((u) => u.bezet === 0) ? (
                  <ActionForm
                    action={acties.verwijderWorkshop}
                    submitLabel="Workshop verwijderen"
                    variant="danger"
                    inline
                  >
                    <input type="hidden" name="event_id" value={dagId} />
                    <input type="hidden" name="workshop_id" value={workshop.id} />
                  </ActionForm>
                ) : (
                  <p className="text-xs text-muted">
                    Deze workshop kan niet weg zolang er deelnemers in zitten. Zet de uitvoeringen uit.
                  </p>
                )}
              </div>
            </details>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
