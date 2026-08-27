import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";

import { ActionForm } from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { requireAdmin } from "@/lib/auth/session";
import { getReviewQueue, listOrganizations } from "@/lib/admin/queries";
import { formatDateTime } from "@/lib/format";
import { calculateBookingPoints } from "@/lib/loyalty/calc";
import { getSettings, ratesFromSettings } from "@/lib/settings";
import { approveBookingSourceAction, rejectBookingSourceAction } from "../actions";
import type { BookingSourceRow } from "@/lib/types/database";

export const metadata: Metadata = { title: "Controle nodig" };

interface ParsedPayload {
  extracted?: {
    workshopName?: string | null;
    workshopCount?: number | null;
    minutesPerWorkshop?: number | null;
    date?: string | null;
    location?: string | null;
    reference?: string | null;
    organizationName?: string | null;
  };
  signals?: string[];
  resolution_method?: string;
}

export default async function ReviewQueuePage() {
  await requireAdmin();
  const [queue, organizations, settings] = await Promise.all([
    getReviewQueue(),
    listOrganizations(),
    getSettings(),
  ]);
  const rates = ratesFromSettings(settings);

  if (queue.length === 0) {
    return (
      <>
        <h1 className="mb-6 text-[30px]">Controle nodig</h1>
        <Card>
          <EmptyState
            icon={CheckCircle2}
            title="Niets te controleren"
            description="Alle binnengekomen bevestigingen zijn verwerkt."
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-2 text-[30px]">Controle nodig</h1>
      <p className="mb-6 max-w-3xl text-[15px] text-muted">
        Deze e-mails konden niet met voldoende zekerheid automatisch worden verwerkt. Controleer de
        gegevens en keur ze goed of wijs ze af. Punten worden pas toegekend na goedkeuring.
      </p>

      <div className="space-y-5">
        {queue.map((rawSource) => {
          const source = rawSource as BookingSourceRow;
          const parsed = (source.parsed ?? {}) as ParsedPayload;
          const extracted = parsed.extracted ?? {};
          const preview = calculateBookingPoints(
            {
              workshopCount: extracted.workshopCount ?? 1,
              minutesPerWorkshop: extracted.minutesPerWorkshop ?? 0,
            },
            rates
          );

          return (
            <Card key={source.id}>
              <CardHeader
                title={source.subject ?? "Zonder onderwerp"}
                description={`${source.from_email ?? "onbekende afzender"} · ${formatDateTime(source.received_at)}`}
                action={
                  <Badge tone={source.confidence >= 0.8 ? "warning" : "danger"}>
                    Zekerheid {Math.round(source.confidence * 100)}%
                  </Badge>
                }
              />
              <CardBody className="space-y-5">
                {source.review_reasons.length > 0 ? (
                  <div>
                    <p className="text-sm font-semibold">Waarom controle nodig is</p>
                    <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-muted">
                      {source.review_reasons.map((reason, index) => (
                        <li key={index}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="rounded-card border border-line-soft px-4 py-3 text-sm">
                  Bij goedkeuring met deze waarden:{" "}
                  <strong>{preview.qualifyingMinutes} minuten</strong> ={" "}
                  <strong>{preview.points} SkoolPoints</strong>
                  {preview.warnings.length > 0 ? (
                    <span className="mt-1 block text-warning">{preview.warnings.join(" · ")}</span>
                  ) : null}
                </div>

                <ActionForm action={approveBookingSourceAction} submitLabel="Goedkeuren en boeking aanmaken">
                  <input type="hidden" name="source_id" value={source.id} />
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Organisatie" htmlFor={`org-${source.id}`} required>
                      <Select
                        id={`org-${source.id}`}
                        name="organization_id"
                        defaultValue={source.suggested_organization_id ?? ""}
                        required
                      >
                        <option value="">Kies een organisatie…</option>
                        {organizations.map((org) => (
                          <option key={org.id} value={org.id}>
                            {org.name}
                          </option>
                        ))}
                      </Select>
                    </Field>

                    <div className="text-sm"><span className="block text-muted">Workshop</span><strong>{extracted.workshopName ?? "Niet herkend"}</strong></div>
                    <input type="hidden" name="workshop_name" value={extracted.workshopName ?? "Workshop"} />

                    <Field label="Aantal rondes" htmlFor={`count-${source.id}`} required>
                      <Input
                        id={`count-${source.id}`}
                        name="workshop_count"
                        type="number"
                        min={1}
                        defaultValue={extracted.workshopCount ?? 1}
                        required
                      />
                    </Field>

                    <Field label="Duur per ronde (minuten)" htmlFor={`minutes-${source.id}`} required>
                      <Input
                        id={`minutes-${source.id}`}
                        name="minutes_per_workshop"
                        type="number"
                        min={1}
                        defaultValue={extracted.minutesPerWorkshop ?? settings.minimum_booking_minutes}
                        required
                      />
                    </Field>

                    <div className="text-sm"><span className="block text-muted">Datum en locatie uit bevestiging</span><strong>{extracted.date ?? "—"} · {extracted.location ?? "—"}</strong></div>
                    <input type="hidden" name="scheduled_date" value={extracted.date ?? ""} />
                    <input type="hidden" name="location" value={extracted.location ?? ""} />
                    <input type="hidden" name="reference" value={extracted.reference ?? ""} />
                  </div>
                </ActionForm>

                <div className="border-t border-line-soft pt-4">
                  <ActionForm
                    action={rejectBookingSourceAction}
                    submitLabel="Afwijzen"
                    variant="secondary"
                    inline
                  >
                    <input type="hidden" name="source_id" value={source.id} />
                    <Field label="Reden" htmlFor={`reason-${source.id}`} className="min-w-64 flex-1">
                      <Input
                        id={`reason-${source.id}`}
                        name="reason"
                        placeholder="Bijvoorbeeld: dit is een offerte, geen boeking"
                      />
                    </Field>
                  </ActionForm>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </>
  );
}
