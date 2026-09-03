import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, Mail, Phone, SquareCheck } from "lucide-react";

import { ActionForm } from "@/components/admin/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { DetailIndeling } from "@/components/admin/detail-indeling";
import { TemplateKiezer } from "@/components/admin/template-kiezer";
import { requireAdmin } from "@/lib/auth/session";
import { hasServiceRole } from "@/lib/env";
import {
  blokkadeVoorSequenceStart,
  getDeelnames,
  getSequence,
  DEELNAME_STANDEN,
  STAP_SOORTEN,
} from "@/lib/crm/sequences";
import { bouwTokenContext } from "@/lib/crm/fragmenten";
import { getTemplates } from "@/lib/crm/templates";
import { getContacten } from "@/lib/crm/contacten";
import { createServiceSupabase } from "@/lib/supabase/server";
import { formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  bewaarSequenceAction,
  meldAanSequenceAction,
  stapGedaanAction,
  stopDeelnameAction,
  verplaatsStapAction,
  verwijderStapAction,
  voegStapToeAction,
} from "@/app/admin/crm/actions";

export const metadata: Metadata = { title: "Sequence" };

const SOORT_ICOON = {
  email: Mail,
  taak: SquareCheck,
  bellen: Phone,
} as const;

export default async function SequencePagina({ params }: { params: Promise<{ id: string }> }) {
  const sessie = await requireAdmin();
  const { id } = await params;

  if (!hasServiceRole()) {
    return (
      <Alert tone="warning" title="SUPABASE_SERVICE_ROLE_KEY ontbreekt">
        Zonder deze sleutel kan het CRM geen gegevens lezen.
      </Alert>
    );
  }

  const reeks = await getSequence(id);
  if (!reeks) notFound();

  const supabase = createServiceSupabase();
  const [deelnames, templates, contacten, { data: beheerders }] = await Promise.all([
    getDeelnames(id),
    getTemplates({ merk: reeks.brand }),
    getContacten(),
    supabase.from("profiles").select("id, full_name, email").eq("is_admin", true).order("full_name"),
  ]);

  const lopend = deelnames.filter((d) => d.status === "actief" || d.status === "gepauzeerd");
  const klaar = deelnames.filter((d) => d.status !== "actief" && d.status !== "gepauzeerd");
  const vandaag = new Date().toISOString();

  // Wie er al in zit, hoeft er niet nog een keer bij. De database weigert het
  // ook, maar een keuzelijst die iets aanbiedt wat daarna wordt geweigerd is
  // gewoon een slechte keuzelijst.
  const alIn = new Set(lopend.map((d) => d.contactId));
  const kiesbaar = contacten.filter(
    (regel) =>
      !alIn.has(regel.contact.id) && blokkadeVoorSequenceStart(regel.contact) === null
  );

  const contextPerDeelname = new Map<
    string,
    Awaited<ReturnType<typeof bouwTokenContext>>
  >();
  await Promise.all(
    lopend
      .filter(
        (deelname) =>
          deelname.volgendeStap?.kind === "email" && deelname.volgendeStap.templateId
      )
      .map(async (deelname) => {
        try {
          const context = await bouwTokenContext(
            { dealId: deelname.dealId, contactId: deelname.contactId },
            { naam: sessie.profile?.full_name ?? null, email: sessie.email }
          );
          contextPerDeelname.set(deelname.id, context);
        } catch {
          contextPerDeelname.set(deelname.id, {});
        }
      })
  );

  return (
    <>
      <Link
        href="/admin/crm/sequences"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Terug naar sequences
      </Link>

      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h1 className="text-[30px]">{reeks.name}</h1>
        <span
          className={cn(
            "rounded-pill px-2.5 py-1 text-xs font-semibold",
            reeks.isActive ? "bg-success-wash text-success" : "bg-surface-3 text-muted"
          )}
        >
          {reeks.isActive ? "Actief" : "Uit"}
        </span>
      </div>
      <p className="mb-6 text-[15px] text-muted">
        {reeks.stappen.length} {reeks.stappen.length === 1 ? "stap" : "stappen"}
        {reeks.senderNaam ? ` · afzender ${reeks.senderNaam}` : " · nog geen afzender"}
      </p>

      <DetailIndeling
        links={
          <>
            <Card>
              <CardHeader title="De reeks" />
              <CardBody className="space-y-3">
                {reeks.description ? (
                  <p className="whitespace-pre-line text-sm text-muted">{reeks.description}</p>
                ) : null}
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted">Afzender</dt>
                  <dd className="font-medium">{reeks.senderNaam ?? "niet gekozen"}</dd>
                  <dt className="text-muted">Lopend</dt>
                  <dd className="font-medium tabular-nums">{reeks.aantalActief}</dd>
                  <dt className="text-muted">Afgerond</dt>
                  <dd className="font-medium tabular-nums">{reeks.aantalAfgerond}</dd>
                </dl>
              </CardBody>

              <details className="border-t border-line-soft">
                <summary className="cursor-pointer px-5 py-3 text-sm font-semibold">
                  Reeks aanpassen
                </summary>
                <CardBody className="pt-0">
                  <ActionForm action={bewaarSequenceAction} submitLabel="Opslaan" variant="secondary">
                    <input type="hidden" name="id" value={reeks.id} />
                    <input type="hidden" name="brand" value={reeks.brand} />
                    <div className="grid gap-4">
                      <Field label="Naam" htmlFor="naam" required showOptional={false}>
                        <Input id="naam" name="name" required defaultValue={reeks.name} />
                      </Field>
                      <Field label="Afzender" htmlFor="afzender">
                        <Select id="afzender" name="senderId" defaultValue={reeks.senderId ?? ""}>
                          <option value="">Nog niet gekozen</option>
                          {(beheerders ?? []).map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.full_name ?? b.email}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Staat aan" htmlFor="actief">
                        <Select id="actief" name="isActive" defaultValue={reeks.isActive ? "ja" : "nee"}>
                          <option value="ja">Ja</option>
                          <option value="nee">Nee</option>
                        </Select>
                      </Field>
                      <Field label="Waar is deze reeks voor" htmlFor="omschrijving">
                        <Textarea
                          id="omschrijving"
                          name="description"
                          rows={3}
                          defaultValue={reeks.description ?? ""}
                        />
                      </Field>
                    </div>
                  </ActionForm>
                </CardBody>
              </details>
            </Card>
          </>
        }
        midden={
          <Card>
            <CardHeader title="Stappen" />
            {reeks.stappen.length === 0 ? (
              <CardBody>
                <p className="text-sm text-muted">
                  Nog geen stappen. Een reeks zonder stappen kan niemand doorlopen.
                </p>
              </CardBody>
            ) : (
              <ol>
                {reeks.stappen.map((stap, index) => {
                  const Icoon = SOORT_ICOON[stap.kind];
                  return (
                    <li key={stap.id} className="border-b border-line-soft px-5 py-3.5 last:border-b-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                          <span className="font-display text-sm text-muted tabular-nums">
                            {index + 1}
                          </span>
                          <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                            <Icoon aria-hidden className="size-4 text-muted" />
                            {stap.kind === "email"
                              ? (stap.templateNaam ?? "template weg")
                              : stap.title}
                          </span>
                          <span className="rounded-pill bg-surface-3 px-2 py-0.5 text-xs text-muted">
                            {STAP_SOORTEN[stap.kind]}
                          </span>
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted">
                          <Clock aria-hidden className="size-3.5" />
                          {stap.waitDays === 0
                            ? "dezelfde dag"
                            : `${stap.waitDays} ${stap.waitDays === 1 ? "dag" : "dagen"} later`}
                        </span>
                      </div>

                      {stap.kind === "email" && stap.templateOnderwerp ? (
                        <p className="mt-1 truncate text-sm text-muted">{stap.templateOnderwerp}</p>
                      ) : null}
                      {stap.note ? (
                        <p className="mt-1 whitespace-pre-line text-sm text-muted">{stap.note}</p>
                      ) : null}

                      {reeks.aantalActief === 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {index > 0 ? (
                            <ActionForm action={verplaatsStapAction} submitLabel="Omhoog" variant="ghost" inline>
                              <input type="hidden" name="stapId" value={stap.id} />
                              <input type="hidden" name="sequenceId" value={reeks.id} />
                              <input type="hidden" name="richting" value="omhoog" />
                            </ActionForm>
                          ) : null}
                          {index < reeks.stappen.length - 1 ? (
                            <ActionForm action={verplaatsStapAction} submitLabel="Omlaag" variant="ghost" inline>
                              <input type="hidden" name="stapId" value={stap.id} />
                              <input type="hidden" name="sequenceId" value={reeks.id} />
                              <input type="hidden" name="richting" value="omlaag" />
                            </ActionForm>
                          ) : null}
                          <ActionForm action={verwijderStapAction} submitLabel="Verwijderen" variant="danger" inline>
                            <input type="hidden" name="stapId" value={stap.id} />
                            <input type="hidden" name="sequenceId" value={reeks.id} />
                          </ActionForm>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}

            {reeks.aantalActief > 0 ? (
              <p className="border-t border-line-soft bg-warning-wash px-5 py-3 text-sm text-warning">
                Stappen staan vast zolang er contacten in deze reeks lopen.
              </p>
            ) : (
            <details className="border-t border-line-soft">
              <summary className="cursor-pointer px-5 py-3 text-sm font-semibold">
                Stap toevoegen
              </summary>
              <CardBody className="pt-0">
                <ActionForm action={voegStapToeAction} submitLabel="Stap toevoegen" variant="secondary">
                  <input type="hidden" name="sequenceId" value={reeks.id} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Soort" htmlFor="stap-soort" required showOptional={false}>
                      <Select id="stap-soort" name="kind" defaultValue="email">
                        {Object.entries(STAP_SOORTEN).map(([waarde, label]) => (
                          <option key={waarde} value={waarde}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field
                      label="Wachten na de vorige stap"
                      htmlFor="stap-wachten"
                      hint="In dagen. Nul betekent dezelfde dag."
                    >
                      <Input
                        id="stap-wachten"
                        name="waitDays"
                        type="number"
                        min={0}
                        max={365}
                        defaultValue={3}
                      />
                    </Field>
                  </div>
                  <Field
                    label="Template"
                    htmlFor="stap-template"
                    hint="Alleen bij een e-mailstap."
                  >
                    <Select id="stap-template" name="templateId" defaultValue="">
                      <option value="">Geen</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label="Wat moet er gebeuren"
                    htmlFor="stap-titel"
                    hint="Alleen bij een taak of een belafspraak."
                  >
                    <Input id="stap-titel" name="title" autoComplete="off" placeholder="Nabellen over de offerte" />
                  </Field>
                  <Field label="Toelichting" htmlFor="stap-notitie">
                    <Textarea id="stap-notitie" name="note" rows={2} />
                  </Field>
                </ActionForm>
              </CardBody>
            </details>
            )}
          </Card>
        }
        rechts={
          <>
            <Card>
              <CardHeader title={`In de reeks (${lopend.length})`} />
              {lopend.length === 0 ? (
                <CardBody>
                  <p className="text-sm text-muted">Er loopt nog niemand in deze reeks.</p>
                </CardBody>
              ) : (
                <ul>
                  {lopend.map((deelname) => {
                    const teLaat = deelname.nextActionAt !== null && deelname.nextActionAt < vandaag;
                    const volgendeStap = deelname.volgendeStap;
                    return (
                      <li key={deelname.id} className="border-b border-line-soft px-5 py-3 last:border-b-0">
                        <Link
                          href={`/admin/crm/contacten/${deelname.contactId}`}
                          className="block truncate font-semibold text-ink underline-offset-4 hover:underline"
                        >
                          {deelname.contactNaam}
                        </Link>
                        <p className={cn("text-sm", teLaat ? "font-semibold text-danger" : "text-muted")}>
                          Stap {deelname.nextStep} van {deelname.aantalStappen}
                          {deelname.nextActionAt
                            ? ` · ${teLaat ? "stond klaar" : "klaar"} ${formatShortDate(deelname.nextActionAt)}`
                            : ""}
                        </p>

                        {volgendeStap ? (
                          <div className="mt-2 rounded-card border border-line-soft bg-surface-2 px-3 py-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-soft">
                              Volgende stap · {STAP_SOORTEN[volgendeStap.kind]}
                            </p>
                            <p className="mt-0.5 text-sm font-semibold text-ink">
                              {volgendeStap.kind === "email"
                                ? volgendeStap.templateNaam
                                : volgendeStap.title}
                            </p>
                            {volgendeStap.note ? (
                              <p className="mt-1 whitespace-pre-line text-xs text-muted">
                                {volgendeStap.note}
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        <div className="mt-2 h-1.5 overflow-hidden rounded-pill bg-surface-3" aria-hidden>
                          <div
                            className="h-full rounded-pill bg-accent"
                            style={{
                              width: `${Math.min(
                                100,
                                Math.max(
                                  0,
                                  ((deelname.nextStep - 1) / Math.max(deelname.aantalStappen, 1)) * 100
                                )
                              )}%`,
                            }}
                          />
                        </div>

                        {volgendeStap?.kind === "email" &&
                        volgendeStap.templateId &&
                        volgendeStap.templateNaam &&
                        volgendeStap.templateOnderwerp &&
                        volgendeStap.templateTekst ? (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs font-semibold text-muted">
                              E-mail voorbereiden
                            </summary>
                            <div className="mt-2 border-l-2 border-line-soft pl-3">
                              <TemplateKiezer
                                templates={[
                                  {
                                    id: volgendeStap.templateId,
                                    naam: volgendeStap.templateNaam,
                                    onderwerp: volgendeStap.templateOnderwerp,
                                    tekst: volgendeStap.templateTekst,
                                    categorie: null,
                                  },
                                ]}
                                context={contextPerDeelname.get(deelname.id) ?? {}}
                                naarEmail={deelname.contactEmail}
                                standaardTemplateId={volgendeStap.templateId}
                                toonKeuze={false}
                              />
                            </div>
                          </details>
                        ) : null}

                        <div className="mt-1.5 flex flex-wrap gap-2">
                          <ActionForm
                            action={stapGedaanAction}
                            submitLabel={
                              volgendeStap?.kind === "email"
                                ? "E-mail verzonden"
                                : volgendeStap?.kind === "taak"
                                  ? "Taak afgerond"
                                  : "Stap afgerond"
                            }
                            variant="secondary"
                            inline
                          >
                            <input type="hidden" name="deelnameId" value={deelname.id} />
                            <input type="hidden" name="sequenceId" value={reeks.id} />
                          </ActionForm>
                        </div>

                        <details className="mt-1.5">
                          <summary className="cursor-pointer text-xs font-semibold text-muted">
                            Uit de reeks halen
                          </summary>
                          <div className="mt-2 border-l-2 border-line-soft pl-3">
                            <ActionForm action={stopDeelnameAction} submitLabel="Stoppen" variant="ghost">
                              <input type="hidden" name="deelnameId" value={deelname.id} />
                              <input type="hidden" name="sequenceId" value={reeks.id} />
                              <Field label="Waarom" htmlFor={`reden-${deelname.id}`} required showOptional={false}>
                                <Input
                                  id={`reden-${deelname.id}`}
                                  name="reden"
                                  required
                                  autoComplete="off"
                                  placeholder="School heeft telefonisch afgezegd"
                                />
                              </Field>
                            </ActionForm>
                          </div>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              )}

              {reeks.isActive ? (
              <details className="border-t border-line-soft">
                <summary className="cursor-pointer px-5 py-3 text-sm font-semibold">
                  Contact toevoegen
                </summary>
                <CardBody className="pt-0">
                  <ActionForm action={meldAanSequenceAction} submitLabel="Toevoegen" variant="secondary">
                    <input type="hidden" name="sequenceId" value={reeks.id} />
                    <Field label="Wie" htmlFor="contact" required showOptional={false}>
                      <Select id="contact" name="contactId" required defaultValue="">
                        <option value="" disabled>
                          Kies een contact
                        </option>
                        {kiesbaar.slice(0, 500).map((regel) => (
                          <option key={regel.contact.id} value={regel.contact.id}>
                            {regel.contact.full_name}
                            {regel.organisatieNaam ? ` · ${regel.organisatieNaam}` : ""}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <p className="text-xs text-muted">
                      Alleen contacten met een e-mailadres die zich niet hebben afgemeld.
                    </p>
                  </ActionForm>
                </CardBody>
              </details>
              ) : (
                <p className="border-t border-line-soft px-5 py-3 text-sm text-muted">
                  Zet de reeks aan voordat je contacten toevoegt.
                </p>
              )}
            </Card>

            {klaar.length > 0 ? (
              <Card>
                <CardHeader title={`Klaar (${klaar.length})`} />
                <ul>
                  {klaar.slice(0, 25).map((deelname) => (
                    <li key={deelname.id} className="border-b border-line-soft px-5 py-2.5 last:border-b-0">
                      <p className="truncate text-sm font-semibold">{deelname.contactNaam}</p>
                      <p className="text-xs text-muted">
                        {DEELNAME_STANDEN[deelname.status]}
                        {deelname.stopReason ? ` · ${deelname.stopReason}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </>
        }
      />
    </>
  );
}
