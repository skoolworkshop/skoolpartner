import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ActionForm } from "@/components/admin/action-form";
import { AfrondenBlok } from "@/components/admin/afronden-blok";
import { DeelnemerZoeken } from "@/components/admin/deelnemer-zoeken";
import { Inschrijflink } from "@/components/admin/inschrijflink";
import { RoosterMaker } from "@/components/admin/rooster-maker";
import { WorkshopKiezer } from "@/components/admin/workshop-kiezer";
import { StatusBadge } from "@/components/admin/inschrijving-badges";
import { LijstUpload } from "@/components/admin/lijst-upload";
import { RoosterBord } from "@/components/admin/rooster-bord";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { formatShortDate, formatTime } from "@/lib/format";
import type { ToegangRegel } from "@/lib/inschrijving/afronden";
import { bewaarUitleg, standaardBewaardatum } from "@/lib/inschrijving/bewaartermijn";
import type { Ontbrekend } from "@/lib/inschrijving/lijsten";
import type { DagDetail } from "@/lib/inschrijving/dagen";
import { aantalMet, woorden } from "@/lib/inschrijving/regels";
import type { EnrollmentStatus } from "@/lib/types/database";
import {
  bekijkIndelingAction,
  bekijkMailAction,
  bevestigIndelingAction,
  bewaarAppInfoAction,
  bewaarDagAction,
  bewaarLijstAction,
  maakClaimVrijAction,
  nieuweCodeAction,
  nieuweGedeeldeCodeAction,
  nieuweLinkAction,
  verwijderDeelnemerAction,
  zetVrijstellingAction,
  zoekDeelnemersAction,
  bewaarRondeAction,
  genereerRondesAction,
  bewaarUitvoeringAction,
  bewaarWorkshopAction,
  kopieerRondeAction,
  verwijderGroepAction,
  verwijderRondeAction,
  verwijderUitvoeringAction,
  verwijderWorkshopAction,
  voegGroepenToeAction,
  voegRondeToeAction,
  voegUitvoeringToeAction,
  voegWorkshopToeAction,
  voegWorkshopsToeAction,
  maakToegangAction,
  trekToegangInAction,
  verstuurBevestigingenAction,
  verstuurLijstenAction,
  zetGedeeldeCodeAction,
  zetKlassenAction,
  zetStatusAction,
  zetUitvoeringAction,
} from "@/app/admin/inschrijvingen/actions";

/**
 * Het scherm van een inschrijfdag.
 *
 * Los van de pagina, zodat de visuele controle in tools/harness dit kan
 * renderen met verzonnen gegevens. Zo zie je op 1280 en op 390 pixels wat een
 * drukke dag met vier rondes en twaalf workshops doet, zonder de app te hoeven
 * starten.
 */

/** De vervolgstappen per status. Concept gaat open, open gaat dicht, en terug. */
const VOLGENDE: Record<EnrollmentStatus, { status: EnrollmentStatus; label: string }[]> = {
  concept: [{ status: "open", label: "Inschrijving openzetten" }],
  open: [{ status: "gesloten", label: "Inschrijving sluiten" }],
  gesloten: [
    { status: "open", label: "Weer openzetten" },
    { status: "afgerond", label: "Dag afronden" },
  ],
  afgerond: [{ status: "gesloten", label: "Terug naar gesloten" }],
};

function Blok({ label, waarde }: { label: string; waarde: string }) {
  return (
    <div className="min-w-24">
      <div className="text-[22px] font-bold tabular-nums">{waarde}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

export interface DagExtra {
  /** Het volledige adres van de inschrijfpagina, zoals de school hem krijgt. */
  inschrijflink: string;
  ontbrekend: Ontbrekend;
  /** Naar wie de lijsten waarschijnlijk moeten, en waar dat adres vandaan komt. */
  ontvanger: { naam: string; email: string; bron: "dag" | "organisatie" | "geen" };
  toegangen: ToegangRegel[];
  verzendingen: { id: string; to_email: string; to_name: string | null; formats: string[]; sent_at: string }[];
}

export function DagScherm({ detail, extra }: { detail: DagDetail; extra: DagExtra }) {
  const { dag, rondes, groepen, workshops, waarschuwingen } = detail;
  // Een pauze staat op het rooster maar telt nergens in mee: niet in het
  // aantal rondes, niet in het rooster met workshops, en niet in de vraag of
  // iemand klaar is.
  const workshopRondes = rondes.filter((ronde) => !ronde.pauze);
  const taal = woorden(dag.audience);
  const open = dag.status === "open";
  const blokkades = waarschuwingen.filter((melding) => melding.soort === "blokkade");
  const letOp = waarschuwingen.filter((melding) => melding.soort === "let op");

  return (
    <>
      <Link
        href="/admin/inschrijvingen"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Alle inschrijvingen
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[30px]">{dag.name}</h1>
          <p className="text-[15px] text-muted">
            {detail.organisatieNaam} · {formatShortDate(dag.event_date)}
            {dag.location ? ` · ${dag.location}` : ""}
          </p>
        </div>
        <StatusBadge status={dag.status} />
      </div>

      <div className="space-y-5">
        {/* -------------------------------------------------------------------
            Status, cijfers en wat er nog niet klopt

            De blokkades staan hier en niet onderin: het zijn precies de dingen
            die een leerling straks laten vastlopen, en ze houden het
            openzetten tegen.
        ------------------------------------------------------------------- */}
        <Card>
          <CardHeader title="Status" description="Wat er nu kan, en wat de volgende stap is." />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap gap-x-8 gap-y-3">
              <Blok label={taal.deelnemers} waarde={String(detail.aantalDeelnemers)} />
              <Blok label="helemaal klaar" waarde={String(detail.aantalKlaar)} />
              <Blok label="nog niets gekozen" waarde={String(detail.aantalNietBegonnen)} />
              <Blok
                label={workshopRondes.length === 1 ? "workshopronde" : "workshoprondes"}
                waarde={String(workshopRondes.length)}
              />
              <Blok label={workshops.length === 1 ? "workshop" : "workshops"} waarde={String(workshops.length)} />
            </div>

            {blokkades.length > 0 ? (
              <Alert tone="danger">
                <p className="font-semibold">Zo kan de inschrijving niet open:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {blokkades.map((melding) => (
                    <li key={melding.tekst}>{melding.tekst}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}

            {letOp.length > 0 ? (
              <Alert tone="warning">
                <ul className="list-disc space-y-0.5 pl-5">
                  {letOp.map((melding) => (
                    <li key={melding.tekst}>{melding.tekst}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}


            <div className="flex flex-wrap gap-2">
              {VOLGENDE[dag.status].map((stap) => (
                /*
                  De sleutel bevat de stand van de dag.

                  Een foutmelding uit een eerdere poging blijft anders op het
                  scherm staan: React onthoudt het antwoord van een
                  serveractie tot de volgende keer dat je op die knop drukt.
                  Wie "Zet eerst minstens één ronde klaar" kreeg en daarna
                  rondes aanmaakte, zag die melding dus nog staan terwijl het
                  probleem al verholpen was. Verandert het aantal rondes,
                  workshops of klassen, dan begint dit formulier opnieuw en is
                  de oude melding weg.
                */
                <ActionForm
                  key={`${stap.status}-${workshopRondes.length}-${workshops.length}-${groepen.length}`}
                  action={zetStatusAction}
                  submitLabel={stap.label}
                  variant={stap.status === "open" ? "ink" : "secondary"}
                  inline
                >
                  <input type="hidden" name="event_id" value={dag.id} />
                  <input type="hidden" name="status" value={stap.status} />
                </ActionForm>
              ))}
            </div>
          </CardBody>
        </Card>

        {/* -------------------------------------------------------------------
            De inschrijflink voor de school
        ------------------------------------------------------------------- */}
        <Card>
          <CardHeader
            title="Inschrijflink"
            description={`Eén link voor de hele dag. De school deelt hem met alle ${taal.deelnemers}, samen met de persoonlijke codes.`}
          />
          <CardBody>
            <Inschrijflink
              dagId={dag.id}
              link={extra.inschrijflink}
              open={open}
              woorden={{ deelnemer: taal.deelnemer, deelnemers: taal.deelnemers }}
              gedeeldeCode={dag.shared_code}
              codeActief={dag.shared_code_active}
              toegangswijze={dag.access_mode}
              nieuweLink={nieuweLinkAction}
              nieuweGedeeldeCode={nieuweGedeeldeCodeAction}
              zetGedeeldeCode={zetGedeeldeCodeAction}
            />
          </CardBody>
        </Card>

        {/* -------------------------------------------------------------------
            De rondes: hoeveel, hoe laat, hoe heten ze
        ------------------------------------------------------------------- */}
        <section>
          <h2 className="mb-3 text-[22px]">Rondes</h2>

          <Card>
            {rondes.length === 0 ? (
              <EmptyState
                title="Nog geen rondes"
                description="Een ronde is een blok op de dag waarin alle workshops tegelijk draaien. Een nieuwe workshop komt automatisch in elke ronde te staan."
              />
            ) : (
              <ul className="divide-y divide-line-soft">
                {rondes.map((ronde) => (
                  <li key={ronde.id} className={`px-5 py-3 ${ronde.pauze ? "bg-surface-2" : ""}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className={ronde.pauze ? "text-muted" : "font-semibold"}>
                        {ronde.label}
                        {ronde.pauze ? (
                          <Badge tone="neutral" className="ml-2">
                            Pauze
                          </Badge>
                        ) : null}
                      </span>
                      <span className="text-sm text-muted">
                        {formatTime(ronde.begin)} tot {formatTime(ronde.eind)}
                      </span>
                    </div>

                    <details className="mt-1">
                      <summary className="cursor-pointer list-none text-xs font-semibold text-muted hover:text-ink">
                        Aanpassen
                      </summary>
                      <div className="mt-2 space-y-2 border-l-2 border-line-soft pl-3">
                        <ActionForm action={bewaarRondeAction} submitLabel="Opslaan" inline>
                          <input type="hidden" name="event_id" value={dag.id} />
                          <input type="hidden" name="round_id" value={ronde.id} />
                          <Field label="Naam" htmlFor={`rlabel-${ronde.id}`} required>
                            <Input id={`rlabel-${ronde.id}`} name="label" defaultValue={ronde.label} />
                          </Field>
                          <Field label="Begint" htmlFor={`rbegin-${ronde.id}`} required>
                            <Input
                              id={`rbegin-${ronde.id}`}
                              name="starts_at"
                              type="time"
                              defaultValue={formatTime(ronde.begin)}
                            />
                          </Field>
                          <Field label="Eindigt" htmlFor={`reind-${ronde.id}`} required>
                            <Input
                              id={`reind-${ronde.id}`}
                              name="ends_at"
                              type="time"
                              defaultValue={formatTime(ronde.eind)}
                            />
                          </Field>
                        </ActionForm>
                        <ActionForm
                          action={verwijderRondeAction}
                          submitLabel="Ronde verwijderen"
                          variant="danger"
                          inline
                        >
                          <input type="hidden" name="event_id" value={dag.id} />
                          <input type="hidden" name="round_id" value={ronde.id} />
                        </ActionForm>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}

            <details className="border-t border-line-soft" open={rondes.length === 0}>
              <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold hover:bg-surface-2">
                Rooster in één keer maken
              </summary>
              <CardBody className="border-t border-line-soft">
                <RoosterMaker dagId={dag.id} aantalBestaand={rondes.length} action={genereerRondesAction} />
              </CardBody>
            </details>

            <details className="border-t border-line-soft">
              <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold hover:bg-surface-2">
                Losse ronde toevoegen
              </summary>
              <CardBody className="border-t border-line-soft">
                <ActionForm action={voegRondeToeAction} submitLabel="Ronde toevoegen">
                  <input type="hidden" name="event_id" value={dag.id} />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Naam" htmlFor="label">
                      <Input id="label" name="label" placeholder={`Workshopronde ${workshopRondes.length + 1}`} />
                    </Field>
                    <Field label="Begintijd" htmlFor="starts_at" required>
                      <Input id="starts_at" name="starts_at" type="time" required />
                    </Field>
                    <Field label="Eindtijd" htmlFor="ends_at" required>
                      <Input id="ends_at" name="ends_at" type="time" required />
                    </Field>
                  </div>
                </ActionForm>
              </CardBody>
            </details>
          </Card>
        </section>

        {/* -------------------------------------------------------------------
            Het rooster: workshops, rondes, klassen en capaciteit
        ------------------------------------------------------------------- */}
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[22px]">Rooster</h2>
            {dag.allow_repeat ? <Badge tone="info">Herhaling toegestaan</Badge> : null}
          </div>

          <div className="space-y-4">
            <Card>
              <details open={workshops.length === 0}>
                <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold hover:bg-surface-2">
                  Workshops kiezen uit ons aanbod
                </summary>
                <CardBody className="border-t border-line-soft">
                  <WorkshopKiezer
                    dagId={dag.id}
                    bestaande={workshops.map((workshop) => workshop.naam)}
                    action={voegWorkshopsToeAction}
                  />
                </CardBody>
              </details>

              <details className="border-t border-line-soft">
                <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold hover:bg-surface-2">
                  Een andere workshop toevoegen
                </summary>
                <CardBody className="border-t border-line-soft">
                  <ActionForm action={voegWorkshopToeAction} submitLabel="Toevoegen">
                    <input type="hidden" name="event_id" value={dag.id} />
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label="Workshop" htmlFor="workshop_name" required className="sm:col-span-2">
                        <Input id="workshop_name" name="name" placeholder="Workshop Graffiti" required />
                      </Field>
                      <Field
                        label="Maximum"
                        htmlFor="workshop_capacity"
                        hint="Per uitvoering aan te passen."
                        required
                      >
                        <Input
                          id="workshop_capacity"
                          name="capacity"
                          type="number"
                          min={1}
                          max={500}
                          defaultValue={25}
                        />
                      </Field>
                    </div>
                    <p className="text-xs text-muted">
                      De workshop komt meteen in alle {workshopRondes.length}{" "}
                      {workshopRondes.length === 1 ? "ronde" : "rondes"} te
                      draaien. Daarna zet je uit waar hij niet doorgaat.
                    </p>
                  </ActionForm>
                </CardBody>
              </details>
            </Card>

            <RoosterBord
              dagId={dag.id}
              rondes={workshopRondes}
              groepen={groepen}
              workshops={workshops}
              taal={taal}
              acties={{
                bewaarUitvoering: bewaarUitvoeringAction,
                zetUitvoering: zetUitvoeringAction,
                zetKlassen: zetKlassenAction,
                voegUitvoeringToe: voegUitvoeringToeAction,
                verwijderUitvoering: verwijderUitvoeringAction,
                kopieerRonde: kopieerRondeAction,
                bewaarRonde: bewaarRondeAction,
                verwijderRonde: verwijderRondeAction,
                bewaarWorkshop: bewaarWorkshopAction,
                verwijderWorkshop: verwijderWorkshopAction,
                bewaarAppInfo: bewaarAppInfoAction,
              }}
            />
          </div>
        </section>

        {/* -------------------------------------------------------------------
            De klassen of teams
        ------------------------------------------------------------------- */}
        <section>
          <h2 className="mb-3 text-[22px]">
            {taal.groepen.charAt(0).toUpperCase() + taal.groepen.slice(1)}
          </h2>

          <Card>
            {groepen.length === 0 ? (
              <EmptyState
                title={`Nog geen ${taal.groepen}`}
                description={`Zet de ${taal.groepen} erin zoals de organisatie ze zelf noemt. Daarna kan de ${taal.deelnemer}lijst erbij.`}
              />
            ) : (
              <ul className="divide-y divide-line-soft">
                {groepen.map((groep) => (
                  <li key={groep.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                    <span className="font-semibold">{groep.naam}</span>
                    <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm text-muted">
                      <span className="whitespace-nowrap">
                        {aantalMet(groep.aantal, taal.deelnemer, taal.deelnemers)}
                      </span>
                      {groep.aantal === 0 ? (
                        <ActionForm
                          action={verwijderGroepAction}
                          submitLabel="Verwijderen"
                          variant="ghost"
                          inline
                        >
                          <input type="hidden" name="event_id" value={dag.id} />
                          <input type="hidden" name="group_id" value={groep.id} />
                        </ActionForm>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <details className="border-t border-line-soft">
              <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold hover:bg-surface-2">
                {taal.groepen.charAt(0).toUpperCase() + taal.groepen.slice(1)} toevoegen
              </summary>
              <CardBody className="border-t border-line-soft">
                <ActionForm action={voegGroepenToeAction} submitLabel="Toevoegen">
                  <input type="hidden" name="event_id" value={dag.id} />
                  <Field
                    label="Eén per regel"
                    htmlFor="names"
                    hint="Namen die er al staan worden overgeslagen, dus je kunt de lijst gewoon nog eens plakken."
                    required
                  >
                    <Textarea
                      id="names"
                      name="names"
                      rows={5}
                      placeholder={
                        dag.audience === "organisatie" ? "Team Zuid\nTeam Noord" : "1 HAVO\n1 VWO\n2 HAVO\n2 VWO"
                      }
                      required
                    />
                  </Field>
                </ActionForm>
              </CardBody>
            </details>
          </Card>
        </section>

        {/* -------------------------------------------------------------------
            De deelnemerslijst

            Staat bewust onder de groepen: zonder klassen heeft een lijst geen
            plek om te landen, en het voorbeeld laat dat dan ook meteen zien.
        ------------------------------------------------------------------- */}
        <section>
          <h2 className="mb-3 text-[22px]">
            {taal.deelnemers.charAt(0).toUpperCase() + taal.deelnemers.slice(1)}lijst
          </h2>

          <Card>
            <CardHeader
              title={`${aantalMet(detail.aantalDeelnemers, taal.deelnemer, taal.deelnemers)} in de lijst`}
              description="Excel, Word, PDF of CSV uit de administratie van de organisatie. Een tabblad of een tabel per klas mag ook. Je ziet eerst wat erin staat, daarna sla je op."
            />
            <CardBody>
              <LijstUpload
                dagId={dag.id}
                groepen={groepen.map((groep) => groep.naam)}
                woorden={taal}
                action={bewaarLijstAction}
              />
            </CardBody>
          </Card>

          <Card className="mt-4">
            <CardHeader
              title={`Eén ${taal.deelnemer} opzoeken`}
              description="Voor het telefoontje op de ochtend zelf: een code kwijt, iemand die niet meedoet, of een naam die er niet hoort te staan."
            />
            <CardBody>
              <DeelnemerZoeken
                dagId={dag.id}
                woord={taal.deelnemer}
                zoek={zoekDeelnemersAction}
                zetVrijstelling={zetVrijstellingAction}
                nieuweCode={nieuweCodeAction}
                maakClaimVrij={maakClaimVrijAction}
                verwijder={verwijderDeelnemerAction}
              />
            </CardBody>
          </Card>
        </section>

        {/* -------------------------------------------------------------------
            Afronden: wat ontbreekt, indelen, lijsten en versturen
        ------------------------------------------------------------------- */}
        <section>
          <h2 className="mb-3 text-[22px]">Afronden</h2>

          <div className="space-y-4">
            <Card>
              <CardHeader
                title="Wat er nog niet klopt"
                description="Het lijstje waarmee je begint als de inschrijving dicht is."
              />
              <CardBody className="space-y-3 text-sm">
                {extra.ontbrekend.nietIngedeeld.length === 0 ? (
                  <p className="text-muted">Iedereen heeft elke ronde een workshop.</p>
                ) : (
                  <details>
                    <summary className="cursor-pointer list-none font-semibold text-danger">
                      {extra.ontbrekend.nietIngedeeld.length} {taal.deelnemers} missen nog een ronde
                    </summary>
                    <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto">
                      {extra.ontbrekend.nietIngedeeld.map((regel) => (
                        <li key={`${regel.klas}-${regel.naam}`} className="flex flex-wrap justify-between gap-x-3">
                          <span>
                            {regel.naam} <span className="text-muted">· {regel.klas}</span>
                          </span>
                          <span className="text-muted">{regel.rondes.join(", ")}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {extra.ontbrekend.vrijgesteld.length > 0 ? (
                  <p className="text-muted">
                    {extra.ontbrekend.vrijgesteld.length} vrijgesteld:{" "}
                    {extra.ontbrekend.vrijgesteld
                      .slice(0, 6)
                      .map((regel) => regel.naam)
                      .join(", ")}
                    {extra.ontbrekend.vrijgesteld.length > 6 ? " en meer" : ""}
                  </p>
                ) : null}

                {extra.ontbrekend.teVol.length > 0 ? (
                  <Alert tone="danger">
                    {extra.ontbrekend.teVol
                      .map((regel) => `${regel.ronde} · ${regel.workshop}: ${regel.aantal} van ${regel.maximum}`)
                      .join(" · ")}
                  </Alert>
                ) : null}

                {extra.ontbrekend.leeg.length > 0 ? (
                  <p className="text-muted">
                    Nog niemand in: {extra.ontbrekend.leeg.map((regel) => `${regel.ronde} · ${regel.workshop}`).join(", ")}
                  </p>
                ) : null}
              </CardBody>
            </Card>

            <AfrondenBlok
              dagId={dag.id}
              contactNaam={extra.ontvanger.naam || (dag.contact_name ?? "")}
              contactEmail={extra.ontvanger.email}
              contactBron={extra.ontvanger.bron}
              bekijkIndeling={bekijkIndelingAction}
              bevestigIndeling={bevestigIndelingAction}
              bekijkMail={bekijkMailAction}
              verstuurLijsten={verstuurLijstenAction}
            />

            <Card>
              <CardHeader
                title="Inschrijfcodes uitdelen"
                description="Eén code per leerling, op een lijst per klas. Deze lijst gaat naar de mentor en niet verder: op de klassenlijst met de indeling staan geen codes."
              />
              <CardBody className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {[
                    { soort: "codes-pdf", label: "Inschrijfcodes (PDF)" },
                    { soort: "codes-xlsx", label: "Inschrijfcodes (Excel)" },
                  ].map((knop) => (
                    <a
                      key={knop.soort}
                      href={`/admin/inschrijvingen/${dag.id}/bestand/${knop.soort}`}
                      className="inline-flex min-h-9 items-center rounded-pill border border-line bg-white px-3.5 text-sm font-semibold text-ink hover:bg-surface-2"
                    >
                      {knop.label}
                    </a>
                  ))}
                </div>
                <p className="text-sm text-muted">
                  {dag.access_mode === "naam"
                    ? "Deze dag staat op inschrijven met naam. De codes bestaan wel, maar worden niet gevraagd. Zet het bij de gegevens van de dag om naar code als de school ze kan uitdelen."
                    : dag.access_mode === "schoolmail"
                      ? `Deze dag staat op een cijfercode via het schooladres. De persoonlijke codes blijven de achtervang: komt een ${taal.deelnemer} niet bij zijn mail, dan geef je hem deze code. Op de inschrijfpagina staat daarvoor "Ik kan niet bij mijn schoolmail". De dag hoeft er niet voor omgezet te worden.`
                      : `Een ${taal.deelnemer} heeft deze code nodig om zich in te schrijven. Wie hem kwijt is, zoek je op bij de ${taal.deelnemers}lijst hierboven; daar geef je ook een nieuwe code.`}
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Lijsten downloaden" description="Dezelfde bestanden als in de mail." />
              <CardBody className="flex flex-wrap gap-2">
                {[
                  { soort: "klassen-xlsx", label: "Klassenlijsten (Excel)" },
                  { soort: "workshops-xlsx", label: "Workshoplijsten (Excel)" },
                  { soort: "klassen-pdf", label: "Klassenlijsten (PDF)" },
                  { soort: "workshops-pdf", label: "Workshoplijsten (PDF)" },
                ].map((knop) => (
                  <a
                    key={knop.soort}
                    href={`/admin/inschrijvingen/${dag.id}/bestand/${knop.soort}`}
                    className="inline-flex min-h-9 items-center rounded-pill border border-line bg-white px-3.5 text-sm font-semibold text-ink hover:bg-surface-2"
                  >
                    {knop.label}
                  </a>
                ))}
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Online inzage voor de school"
                description="Een link met een losse code, die vanzelf verloopt. Geen openbare lijst met namen."
              />
              {extra.toegangen.length > 0 ? (
                <ul className="divide-y divide-line-soft">
                  {extra.toegangen.map((toegang) => {
                    const verlopen = toegang.verlopen;
                    return (
                      <li key={toegang.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                        <span>
                          <span className="font-semibold">{toegang.label}</span>
                          <span className="block text-xs text-muted">
                            {toegang.revoked_at
                              ? "ingetrokken"
                              : verlopen
                                ? "verlopen"
                                : `geldig tot ${formatShortDate(toegang.expires_at)}`}
                            {toegang.last_seen_at ? ` · laatst bekeken ${formatShortDate(toegang.last_seen_at)}` : ""}
                          </span>
                        </span>
                        {!toegang.revoked_at && !verlopen ? (
                          <ActionForm action={trekToegangInAction} submitLabel="Intrekken" variant="ghost" inline>
                            <input type="hidden" name="event_id" value={dag.id} />
                            <input type="hidden" name="access_id" value={toegang.id} />
                          </ActionForm>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              <CardBody className="border-t border-line-soft">
                <ActionForm action={maakToegangAction} submitLabel="Toegang aanmaken" inline>
                  <input type="hidden" name="event_id" value={dag.id} />
                  <Field label="Voor wie" htmlFor="toegang_label" required>
                    <Input id="toegang_label" name="label" defaultValue={dag.contact_name ?? ""} placeholder="Heleen" />
                  </Field>
                  <Field label="Dagen geldig" htmlFor="toegang_dagen" required>
                    <Input id="toegang_dagen" name="dagen" type="number" min={1} max={180} defaultValue={30} className="w-24" />
                  </Field>
                </ActionForm>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title={`Definitieve planning naar ${taal.deelnemers}`}
                description="Alleen naar wie een e-mailadres heeft en nog niets kreeg. Vooral voor wie automatisch is ingedeeld."
              />
              <CardBody className="flex flex-wrap gap-2">
                <ActionForm action={verstuurBevestigingenAction} submitLabel="Versturen" inline>
                  <input type="hidden" name="event_id" value={dag.id} />
                </ActionForm>
                <ActionForm
                  action={verstuurBevestigingenAction}
                  submitLabel="Opnieuw naar iedereen"
                  variant="secondary"
                  inline
                >
                  <input type="hidden" name="event_id" value={dag.id} />
                  <input type="hidden" name="opnieuw" value="ja" />
                </ActionForm>
              </CardBody>
            </Card>

            {extra.verzendingen.length > 0 ? (
              <Card>
                <CardHeader title="Verstuurd" description="Wat is er wanneer naar wie gegaan." />
                <ul className="divide-y divide-line-soft text-sm">
                  {extra.verzendingen.map((regel) => (
                    <li key={regel.id} className="flex flex-wrap justify-between gap-x-4 px-5 py-2">
                      <span>
                        {regel.to_email}
                        {regel.to_name ? <span className="text-muted"> · {regel.to_name}</span> : null}
                      </span>
                      <span className="text-muted">
                        {formatShortDate(regel.sent_at)} · {regel.formats.length} bijlagen
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </div>
        </section>

        {/* -------------------------------------------------------------------
            De gegevens van de dag zelf
        ------------------------------------------------------------------- */}
        <Card>
          <details>
            <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold hover:bg-surface-2">
              Gegevens van de dag
            </summary>
            <CardBody className="border-t border-line-soft">
              <ActionForm action={bewaarDagAction} submitLabel="Opslaan">
                <input type="hidden" name="event_id" value={dag.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Naam van de dag" htmlFor="name" required>
                    <Input id="name" name="name" defaultValue={dag.name} required />
                  </Field>
                  <Field label="Datum" htmlFor="event_date" required>
                    <Input id="event_date" name="event_date" type="date" defaultValue={dag.event_date} required />
                  </Field>
                  <Field label="Locatie" htmlFor="location">
                    <Input id="location" name="location" defaultValue={dag.location ?? ""} />
                  </Field>
                  <Field
                    label="Inschrijving sluit op"
                    htmlFor="closes_at"
                    hint="Laat leeg om zelf te sluiten wanneer je wilt."
                  >
                    <Input
                      id="closes_at"
                      name="closes_at"
                      type="datetime-local"
                      defaultValue={dag.closes_at ? dag.closes_at.slice(0, 16) : ""}
                    />
                  </Field>
                  <Field label="Contactpersoon" htmlFor="contact_name">
                    <Input id="contact_name" name="contact_name" defaultValue={dag.contact_name ?? ""} />
                  </Field>
                  <Field
                    label="E-mail contactpersoon"
                    htmlFor="contact_email"
                    hint="Hier stel je de lijsten naar voor."
                  >
                    <Input
                      id="contact_email"
                      name="contact_email"
                      type="email"
                      defaultValue={dag.contact_email ?? ""}
                    />
                  </Field>
                  <Field
                    label={`Hoe meldt een ${taal.deelnemer} zich aan`}
                    htmlFor="access_mode"
                    className="sm:col-span-2"
                    hint="Dit komt ná de toegangscode van de dag. Met een persoonlijke code of een cijfercode op de schoolmail kan niemand de inschrijving van een ander doen. Alleen omzetten naar naam als het echt niet anders kan."
                  >
                    <Select id="access_mode" name="access_mode" defaultValue={dag.access_mode}>
                      <option value="code">Met een persoonlijke code (aanbevolen)</option>
                      <option value="schoolmail">Met een cijfercode op het schooladres</option>
                      <option value="naam">Door alleen de eigen naam op te zoeken</option>
                    </Select>
                  </Field>
                  <Field
                    label="Leerlinggegevens bewaren tot"
                    htmlFor="purge_after"
                    className="sm:col-span-2"
                    hint={`${bewaarUitleg(dag)} Leeg laten betekent dertig dagen na de dag. Een andere datum alleen als de school daar een reden voor heeft.`}
                  >
                    <Input
                      id="purge_after"
                      name="purge_after"
                      type="date"
                      defaultValue={dag.purge_after ?? standaardBewaardatum(dag.event_date)}
                    />
                  </Field>
                  <Field label="Interne opmerking" htmlFor="note" className="sm:col-span-2">
                    <Textarea id="note" name="note" rows={3} defaultValue={dag.note ?? ""} />
                  </Field>
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox name="allow_repeat" value="ja" defaultChecked={dag.allow_repeat} />
                  <span>
                    Dezelfde workshop mag in meerdere rondes gekozen worden.
                    <span className="block text-xs text-muted">
                      Normaal uit, zodat iedereen iets anders doet per ronde.
                    </span>
                  </span>
                </label>
              </ActionForm>
            </CardBody>
          </details>
        </Card>
      </div>
    </>
  );
}
