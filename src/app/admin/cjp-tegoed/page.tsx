import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/admin/action-form";
import { CjpParkingStatusBadge } from "@/components/portal/status-badges";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { requireAdmin } from "@/lib/auth/session";
import { formatDate, formatEuroCents, formatPoints, formatShortDate } from "@/lib/format";
import { getSettingsWithServiceRole } from "@/lib/settings";
import {
  listBookingsForSpending,
  listOrganizationsWithCredit,
  listParkingRequests,
} from "@/lib/tegoed/queries";
import { PARKING_STATUS_LABELS, PARKING_STATUS_ORDER } from "@/lib/tegoed/regels";
import {
  confirmCjpParkingAction,
  setCjpParkingStatusAction,
  spendCjpCreditAction,
} from "../actions";

export const metadata: Metadata = { title: "CJP-tegoed" };

function Regel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

export default async function AdminCjpPage() {
  await requireAdmin();

  const [aanvragen, saldi, settings] = await Promise.all([
    listParkingRequests(),
    listOrganizationsWithCredit(),
    getSettingsWithServiceRole(),
  ]);

  // De boekingen per organisatie die tegoed heeft, zodat afboeken op een
  // boeking kan zonder eerst te zoeken.
  const boekingen = new Map(
    await Promise.all(
      saldi.map(
        async (saldo) => [saldo.organization_id, await listBookingsForSpending(saldo.organization_id)] as const
      )
    )
  );

  const perStatus = PARKING_STATUS_ORDER.map((status) => ({
    status,
    rijen: aanvragen.filter((a) => a.status === status),
  }));

  const openstaand = saldi.reduce((som, rij) => som + rij.available_cents, 0);

  return (
    <>
      <h1 className="mb-2 text-[30px]">CJP-tegoed</h1>
      <p className="mb-6 max-w-3xl text-[15px] text-muted">
        Scholen parkeren hier hun resterende CJP-budget als geldtegoed bij Skool Workshop. Dat
        tegoed is een bedrag in euro&apos;s en staat helemaal los van SkoolPoints: het wordt nooit
        omgerekend naar punten. Zodra u een aanvraag bevestigt, wordt het bedrag bijgeschreven
        {settings.cjp_bonus_enabled
          ? ` en krijgt de school eenmalig ${formatPoints(settings.cjp_bonus_points)} SkoolPoints als bonus`
          : ""}
        . Er gaat niets automatisch naar Moneybird.
      </p>

      {/* Wat staat er in totaal */}
      <div className="mb-7 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Openstaand tegoed</p>
            <p className="mt-0.5 font-display text-2xl">{formatEuroCents(openstaand)}</p>
            <p className="text-sm text-muted">Bij {saldi.length} organisaties</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Te behandelen</p>
            <p className="mt-0.5 font-display text-2xl">
              {aanvragen.filter((a) => a.status === "requested" || a.status === "in_review").length}
            </p>
            <p className="text-sm text-muted">Aangevraagd of in behandeling</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Bonus</p>
            <p className="mt-0.5 font-display text-2xl">
              {settings.cjp_bonus_enabled ? formatPoints(settings.cjp_bonus_points) : "Uit"}
            </p>
            <p className="text-sm text-muted">
              {settings.cjp_bonus_enabled
                ? `Eenmalig per organisatie, vanaf ${formatEuroCents(settings.cjp_bonus_minimum_amount_cents)}`
                : "Staat uit bij de instellingen"}
            </p>
          </CardBody>
        </Card>
      </div>

      {/* Aanvragen per status */}
      {perStatus.map(({ status, rijen }) =>
        rijen.length === 0 ? null : (
          <section key={status} className="mb-8">
            <h2 className="mb-3 text-[22px]">
              {PARKING_STATUS_LABELS[status]} ({rijen.length})
            </h2>

            <div className="space-y-4">
              {rijen.map((aanvraag) => {
                const afgerond = aanvraag.status === "confirmed" || aanvraag.status === "rejected";
                return (
                  <Card key={aanvraag.id}>
                    <CardHeader
                      title={`${formatEuroCents(aanvraag.amount_cents)} · ${aanvraag.organizations?.name ?? aanvraag.school_name}`}
                      description={`Aangevraagd op ${formatShortDate(aanvraag.created_at)}${
                        aanvraag.requested_by_email ? ` door ${aanvraag.requested_by_email}` : ""
                      }`}
                      action={<CjpParkingStatusBadge status={aanvraag.status} />}
                    />

                    <div className="space-y-4 px-5 py-4">
                      {/*
                        Deze gegevens zijn de momentopname van het moment van
                        aanvragen. Verandert de contactpersoon later, dan blijft
                        hier staan wie het destijds was.
                      */}
                      <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                        <Regel label="Organisatie">
                          {aanvraag.organizations ? (
                            <Link
                              href={`/admin/organisaties/${aanvraag.organization_id}`}
                              className="underline underline-offset-4"
                            >
                              {aanvraag.organizations.name}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </Regel>
                        <Regel label="Schoolnaam bij aanvraag">{aanvraag.school_name}</Regel>
                        <Regel label="CJP-schoolnummer">{aanvraag.cjp_school_number}</Regel>
                        <Regel label="Schooljaar">{aanvraag.school_year}</Regel>
                        <Regel label="Budgethouder">{aanvraag.holder_name}</Regel>
                        <Regel label="E-mail">{aanvraag.holder_email}</Regel>
                        <Regel label="Telefoon">
                          {aanvraag.holder_phone ?? (
                            <span className="font-normal text-muted">niet opgegeven</span>
                          )}
                        </Regel>
                        <Regel label="Interne melding">
                          {aanvraag.notified_at ? (
                            `verstuurd op ${formatShortDate(aanvraag.notified_at)}`
                          ) : (
                            <span className="font-normal text-muted">niet verstuurd</span>
                          )}
                        </Regel>
                        <Regel label="Bonuspunten">
                          {aanvraag.bonus_transaction_id ? (
                            "toegekend"
                          ) : aanvraag.status === "confirmed" ? (
                            <span className="font-normal text-muted">niet toegekend</span>
                          ) : (
                            <span className="font-normal text-muted">nog niet</span>
                          )}
                        </Regel>
                      </dl>

                      {aanvraag.organizations &&
                      aanvraag.organizations.cjp_school_number &&
                      aanvraag.organizations.cjp_school_number !== aanvraag.cjp_school_number ? (
                        <p className="text-sm text-warning">
                          Let op: bij de organisatie staat CJP-nummer{" "}
                          {aanvraag.organizations.cjp_school_number}, in deze aanvraag staat{" "}
                          {aanvraag.cjp_school_number}. Controleer even welk nummer klopt.
                        </p>
                      ) : null}

                      {aanvraag.decision_note ? (
                        <p className="text-sm text-muted">Notitie beheer: {aanvraag.decision_note}</p>
                      ) : null}

                      {afgerond ? (
                        <p className="text-sm text-muted">
                          {aanvraag.status === "confirmed"
                            ? `Bevestigd op ${formatShortDate(aanvraag.decided_at ?? aanvraag.updated_at)}. Het bedrag staat op het tegoed van deze organisatie.`
                            : `Afgewezen op ${formatShortDate(aanvraag.decided_at ?? aanvraag.updated_at)}. Er is geen tegoed bijgeschreven.`}
                        </p>
                      ) : (
                        <div className="space-y-5 border-t border-line-soft pt-4">
                          {/* Eerst de hoofdactie, daarna pas de rest. */}
                          <ActionForm
                            action={confirmCjpParkingAction}
                            submitLabel="Bevestigen en bijschrijven"
                            variant="primary"
                          >
                            <input type="hidden" name="request_id" value={aanvraag.id} />
                            <Field
                              label="Notitie"
                              htmlFor={`bevestig-${aanvraag.id}`}
                              hint={`Hiermee schrijft u ${formatEuroCents(aanvraag.amount_cents)} bij op het tegoed van deze organisatie.`}
                              className="max-w-xl"
                            >
                              <Input
                                id={`bevestig-${aanvraag.id}`}
                                name="note"
                                placeholder="Bijvoorbeeld: bedrag ontvangen van CJP"
                              />
                            </Field>
                          </ActionForm>

                          <div className="border-t border-line-soft pt-5">
                            <ActionForm action={setCjpParkingStatusAction} submitLabel="Status opslaan">
                              <input type="hidden" name="request_id" value={aanvraag.id} />
                              <div className="flex flex-wrap gap-4">
                                <Field
                                  label="Status"
                                  htmlFor={`status-${aanvraag.id}`}
                                  className="w-48"
                                >
                                  <Select
                                    id={`status-${aanvraag.id}`}
                                    name="status"
                                    defaultValue="in_review"
                                  >
                                    <option value="in_review">In behandeling</option>
                                    <option value="rejected">Afwijzen</option>
                                  </Select>
                                </Field>
                                <Field
                                  label="Toelichting"
                                  htmlFor={`reden-${aanvraag.id}`}
                                  hint="Verplicht bij afwijzen. De klant ziet dit terug."
                                  className="min-w-56 flex-1"
                                >
                                  <Input id={`reden-${aanvraag.id}`} name="note" />
                                </Field>
                              </div>
                            </ActionForm>
                          </div>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        )
      )}

      {aanvragen.length === 0 ? (
        <Card className="mb-8">
          <div className="px-5 py-10 text-center text-muted">Nog geen aanvragen.</div>
        </Card>
      ) : null}

      {/* Tegoed toewijzen aan een boeking */}
      <h2 className="mb-3 text-[22px]">Tegoed toewijzen aan een boeking</h2>
      <p className="mb-4 max-w-3xl text-[15px] text-muted">
        Gebruikt een school haar tegoed voor een workshop? Boek het bedrag hier af. Meer afboeken
        dan er staat kan niet; de database weigert dat. Het factuurnummer is alleen een verwijzing
        voor de administratie, er gaat niets naar Moneybird.
      </p>

      <div className="space-y-4">
        {saldi.map((saldo) => {
          const beschikbaar = saldo.available_cents;
          const lijst = boekingen.get(saldo.organization_id) ?? [];

          return (
            <Card key={saldo.organization_id}>
              <CardHeader
                title={saldo.name}
                description={`Geparkeerd ${formatEuroCents(saldo.added_cents)} · gebruikt ${formatEuroCents(saldo.spent_cents)}`}
                action={
                  <span className="font-display text-xl">{formatEuroCents(beschikbaar)}</span>
                }
              />
              <div className="px-5 py-4">
                {beschikbaar <= 0 ? (
                  <p className="text-sm text-muted">
                    Het tegoed van deze organisatie is helemaal gebruikt.
                  </p>
                ) : (
                  <ActionForm action={spendCjpCreditAction} submitLabel="Afboeken">
                    <input type="hidden" name="organization_id" value={saldo.organization_id} />
                    <div className="flex flex-wrap gap-4">
                      <Field
                        label="Bedrag"
                        htmlFor={`bedrag-${saldo.organization_id}`}
                        className="w-40"
                        hint={`Maximaal ${formatEuroCents(beschikbaar)}.`}
                      >
                        <Input
                          id={`bedrag-${saldo.organization_id}`}
                          name="amount"
                          inputMode="decimal"
                          placeholder="250,00"
                        />
                      </Field>
                      <Field
                        label="Boeking"
                        htmlFor={`boeking-${saldo.organization_id}`}
                        className="min-w-56 flex-1"
                      >
                        <Select id={`boeking-${saldo.organization_id}`} name="booking_id">
                          <option value="">Geen boeking</option>
                          {lijst.map((boeking) => (
                            <option key={boeking.id} value={boeking.id}>
                              {boeking.workshop_name}
                              {boeking.scheduled_date
                                ? `, ${formatDate(boeking.scheduled_date)}`
                                : ""}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field
                        label="Moneybird-factuurnummer"
                        htmlFor={`factuur-${saldo.organization_id}`}
                        className="w-48"
                      >
                        <Input
                          id={`factuur-${saldo.organization_id}`}
                          name="invoice_number"
                          placeholder="2026-0044"
                        />
                      </Field>
                      <Field
                        label="Notitie"
                        htmlFor={`notitie-${saldo.organization_id}`}
                        className="min-w-48 flex-1"
                      >
                        <Input id={`notitie-${saldo.organization_id}`} name="note" />
                      </Field>
                    </div>
                  </ActionForm>
                )}
              </div>
            </Card>
          );
        })}

        {saldi.length === 0 ? (
          <Card>
            <div className="px-5 py-10 text-center text-muted">
              Er staat nog bij geen enkele organisatie tegoed.
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
