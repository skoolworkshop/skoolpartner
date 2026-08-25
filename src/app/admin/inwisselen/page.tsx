import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/admin/action-form";
import { RedemptionStatusBadge } from "@/components/portal/status-badges";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { requireAdmin } from "@/lib/auth/session";
import { listRedemptions } from "@/lib/admin/queries";
import { formatEuroCents, formatPoints, formatShortDate } from "@/lib/format";
import { decideRedemptionAction } from "../actions";
import type { RedemptionRequestRow } from "@/lib/types/database";

export const metadata: Metadata = { title: "Inwisselverzoeken" };

type Row = RedemptionRequestRow & {
  organizations: { name: string } | null;
  profiles: { email: string } | null;
};

export default async function AdminRedemptionsPage() {
  await requireAdmin();
  const requests = (await listRedemptions()) as unknown as Row[];

  return (
    <>
      <h1 className="mb-2 text-[30px]">Inwisselverzoeken</h1>
      <p className="mb-6 max-w-3xl text-[15px] text-muted">
        Bij een openstaand verzoek zijn de punten gereserveerd. Zet het verzoek op verwerkt zodra
        het voordeel daadwerkelijk op een boeking is toegepast; bij afwijzen komen de punten
        automatisch weer vrij.
      </p>

      <div className="space-y-4">
        {requests.map((request) => (
          <Card key={request.id}>
            <CardHeader
              title={`${formatPoints(request.points)} SkoolPoints · ${formatEuroCents(request.value_cents)}`}
              description={`${request.organizations?.name ?? "—"} · aangevraagd door ${
                request.profiles?.email ?? "onbekend"
              } op ${formatShortDate(request.created_at)}`}
              action={<RedemptionStatusBadge status={request.status} />}
            />
            <div className="space-y-4 px-5 py-4">
              {request.booking_reference ? (
                <p className="text-sm">
                  Referentie: <strong>{request.booking_reference}</strong>
                </p>
              ) : null}
              {request.note ? <p className="text-sm text-muted">“{request.note}”</p> : null}
              {request.decision_note ? (
                <p className="text-sm text-muted">Notitie beheer: {request.decision_note}</p>
              ) : null}

              {request.status === "requested" || request.status === "approved" ? (
                <ActionForm action={decideRedemptionAction} submitLabel="Opslaan" inline>
                  <input type="hidden" name="request_id" value={request.id} />
                  <Field label="Beslissing" htmlFor={`decision-${request.id}`} className="w-52">
                    <Select id={`decision-${request.id}`} name="decision" defaultValue="approved">
                      <option value="approved">Goedkeuren</option>
                      <option value="applied">Verwerkt op boeking</option>
                      <option value="rejected">Afwijzen</option>
                    </Select>
                  </Field>
                  <Field label="Notitie" htmlFor={`note-${request.id}`} className="min-w-56 flex-1">
                    <Input id={`note-${request.id}`} name="note" placeholder="Optioneel" />
                  </Field>
                </ActionForm>
              ) : (
                <p className="text-sm text-muted">
                  Afgehandeld op {formatShortDate(request.decided_at ?? request.updated_at)}.
                </p>
              )}

              <Link
                href={`/admin/organisaties/${request.organization_id}`}
                className="inline-block text-sm font-semibold underline underline-offset-4"
              >
                Organisatie bekijken
              </Link>
            </div>
          </Card>
        ))}

        {requests.length === 0 ? (
          <Card>
            <div className="px-5 py-10 text-center text-muted">Nog geen inwisselverzoeken.</div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
