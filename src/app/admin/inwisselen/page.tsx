import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/admin/action-form";
import { RedemptionStatusBadge } from "@/components/portal/status-badges";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { requireAdmin } from "@/lib/auth/session";
import { listRedemptions } from "@/lib/admin/queries";
import { formatDate, formatEuroCents, formatPoints, formatShortDate } from "@/lib/format";
import { decideRedemptionAction } from "../actions";
import type { RedemptionRequestRow } from "@/lib/types/database";

export const metadata: Metadata = { title: "Inwisselverzoeken" };

type Row = RedemptionRequestRow & {
  organizations: { name: string } | null;
  profiles: { email: string; full_name: string | null } | null;
  bookings: { workshop_name: string; scheduled_date: string | null; reference: string | null } | null;
};

function Regel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

export default async function AdminRedemptionsPage() {
  await requireAdmin();
  const requests = (await listRedemptions()) as unknown as Row[];

  const open = requests.filter((r) => r.status === "requested" || r.status === "approved");
  const afgehandeld = requests.filter((r) => r.status !== "requested" && r.status !== "approved");

  return (
    <>
      <h1 className="mb-2 text-[30px]">Inwisselverzoeken</h1>
      <p className="mb-6 max-w-3xl text-[15px] text-muted">
        Bij een openstaand verzoek zijn de punten gereserveerd, maar nog niet afgeschreven. Zet het
        verzoek op verwerkt zodra de korting daadwerkelijk op de factuur staat, en vul dan het
        factuurnummer in. Wijst u af, dan komen de punten automatisch weer vrij.
      </p>

      {open.length > 0 ? (
        <h2 className="mb-3 text-[22px]">Openstaand ({open.length})</h2>
      ) : null}

      <div className="space-y-4">
        {[...open, ...afgehandeld].map((request) => {
          const afgerond = request.status !== "requested" && request.status !== "approved";

          return (
            <Card key={request.id}>
              <CardHeader
                title={`${formatPoints(request.points)} SkoolPoints · ${formatEuroCents(request.value_cents)}`}
                description={`${request.organizations?.name ?? "—"} · aangevraagd door ${
                  request.profiles?.full_name ?? request.profiles?.email ?? "onbekend"
                } op ${formatShortDate(request.created_at)}`}
                action={<RedemptionStatusBadge status={request.status} />}
              />

              <div className="space-y-4 px-5 py-4">
                <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                  <Regel label="Klant">
                    {request.profiles?.email ?? "onbekend"}
                  </Regel>
                  <Regel label="Organisatie">
                    <Link
                      href={`/admin/organisaties/${request.organization_id}`}
                      className="underline underline-offset-4"
                    >
                      {request.organizations?.name ?? "—"}
                    </Link>
                  </Regel>
                  <Regel label="Boeking">
                    {request.bookings
                      ? request.bookings.workshop_name
                      : (request.booking_reference ?? "geen boeking gekoppeld")}
                  </Regel>
                  <Regel label="Workshopdatum">
                    {request.bookings?.scheduled_date
                      ? formatDate(request.bookings.scheduled_date)
                      : "—"}
                  </Regel>
                  <Regel label="Punten">{formatPoints(request.points)}</Regel>
                  <Regel label="Waarde">
                    {formatEuroCents(request.value_cents)}{" "}
                    <span className="font-normal text-muted">
                      (koers destijds: 100 punten = {formatEuroCents(request.point_value_cents_per_100)})
                    </span>
                  </Regel>
                  <Regel label="Aangevraagd op">{formatShortDate(request.created_at)}</Regel>
                  <Regel label="Factuur">
                    {request.invoice_number ? (
                      request.invoice_number
                    ) : (
                      <span className="font-normal text-muted">nog niet gekoppeld</span>
                    )}
                  </Regel>
                </dl>

                {request.note ? (
                  <p className="text-sm text-muted">Opmerking van de klant: “{request.note}”</p>
                ) : null}
                {request.decision_note ? (
                  <p className="text-sm text-muted">Notitie beheer: {request.decision_note}</p>
                ) : null}

                {afgerond ? (
                  <p className="text-sm text-muted">
                    {request.status === "applied"
                      ? `Verwerkt op ${formatShortDate(request.applied_at ?? request.updated_at)}.`
                      : `Afgehandeld op ${formatShortDate(request.decided_at ?? request.updated_at)}.`}
                  </p>
                ) : (
                  <ActionForm action={decideRedemptionAction} submitLabel="Opslaan">
                    <input type="hidden" name="request_id" value={request.id} />
                    <div className="flex flex-wrap gap-4">
                      <Field label="Beslissing" htmlFor={`decision-${request.id}`} className="w-52">
                        <Select id={`decision-${request.id}`} name="decision" defaultValue="approved">
                          <option value="approved">Goedkeuren</option>
                          <option value="applied">Verwerkt op de factuur</option>
                          <option value="rejected">Afwijzen</option>
                        </Select>
                      </Field>
                      <Field
                        label="Factuurnummer"
                        htmlFor={`invoice-${request.id}`}
                        className="w-52"
                        hint="Verplicht bij verwerkt."
                      >
                        <Input
                          id={`invoice-${request.id}`}
                          name="invoice_number"
                          defaultValue={request.invoice_number ?? ""}
                          placeholder="2026-0044"
                        />
                      </Field>
                      <Field
                        label="Notitie"
                        htmlFor={`note-${request.id}`}
                        className="min-w-56 flex-1"
                      >
                        <Input id={`note-${request.id}`} name="note" placeholder="Optioneel" />
                      </Field>
                    </div>
                  </ActionForm>
                )}
              </div>
            </Card>
          );
        })}

        {requests.length === 0 ? (
          <Card>
            <div className="px-5 py-10 text-center text-muted">Nog geen inwisselverzoeken.</div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
