import type { Metadata } from "next";
import { FolderDown } from "lucide-react";

import { ActionForm } from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { requireAdmin } from "@/lib/auth/session";
import { listOrganizations } from "@/lib/admin/queries";
import { formatDateTime } from "@/lib/format";
import { getAllResults } from "@/lib/results/service";
import { getSettings } from "@/lib/settings";
import { createServiceSupabase } from "@/lib/supabase/server";
import {
  addResultLinkAction,
  createResultAction,
  deleteResultAction,
  deleteResultFileAction,
  publishResultAction,
} from "../actions";
import { ResultUploader } from "./uploader";

export const metadata: Metadata = { title: "Resultaten" };

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export default async function AdminResultsPage() {
  await requireAdmin();

  const supabase = createServiceSupabase();
  const [results, organizations, settings, { data: bookings }] = await Promise.all([
    getAllResults(),
    listOrganizations(),
    getSettings(),
    supabase
      .from("bookings")
      .select("id, reference, workshop_name, scheduled_date, organization_id, contact_email")
      .order("scheduled_date", { ascending: false })
      .limit(120),
  ]);

  return (
    <>
      <h1 className="mb-2 text-[30px]">Resultaten van workshops</h1>
      <p className="mb-6 max-w-3xl text-[15px] text-muted">
        Zet hier het werk klaar dat tijdens een workshop is gemaakt. Zolang een set nog concept
        is, ziet de klant niets. Bij publiceren gaat er één mail naar de contactpersoon van de
        boeking en staan de bestanden {settings.results_available_days} dagen klaar. Daarna worden
        ze echt verwijderd en blijft er nog {settings.results_notice_days} dagen een melding staan.
      </p>

      <Card className="mb-6">
        <CardHeader title="Nieuwe set aanmaken" />
        <CardBody>
          <ActionForm action={createResultAction} submitLabel="Aanmaken">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Organisatie" htmlFor="organization_id">
                <Select id="organization_id" name="organization_id" required>
                  <option value="">Kies een organisatie</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Boeking"
                htmlFor="booking_id"
                hint="Bepaalt naar welke contactpersoon de mail gaat."
              >
                <Select id="booking_id" name="booking_id">
                  <option value="">Geen boeking koppelen</option>
                  {(bookings ?? []).map((booking) => (
                    <option key={booking.id} value={booking.id}>
                      {booking.reference ? `${booking.reference} · ` : ""}
                      {booking.workshop_name}
                      {booking.scheduled_date ? ` · ${booking.scheduled_date}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label="Titel" htmlFor="title">
              <Input
                id="title"
                name="title"
                required
                placeholder="Bijvoorbeeld: Cultuurdag 14 maart"
              />
            </Field>

            <Field label="Toelichting" htmlFor="description">
              <Textarea
                id="description"
                name="description"
                rows={3}
                placeholder="Korte tekst die de klant bij de bestanden ziet."
              />
            </Field>
          </ActionForm>
        </CardBody>
      </Card>

      {results.length === 0 ? (
        <Card>
          <EmptyState
            icon={FolderDown}
            title="Nog geen sets"
            description="Maak hierboven een set aan en voeg daarna bestanden of links toe."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {results.map((result) => {
            const organization = organizations.find((o) => o.id === result.organization_id);
            const concept = result.status === "concept";

            return (
              <Card key={result.id}>
                <CardHeader
                  title={result.title}
                  action={
                    concept ? (
                      <Badge tone="neutral">Concept</Badge>
                    ) : result.status === "expired" ? (
                      <Badge tone="neutral">Verlopen</Badge>
                    ) : (
                      <Badge tone="success">Gepubliceerd</Badge>
                    )
                  }
                />
                <CardBody className="space-y-4">
                  <p className="text-sm text-muted">
                    {organization?.name ?? "Onbekende organisatie"}
                    {result.published_at
                      ? ` · gepubliceerd ${formatDateTime(result.published_at)}`
                      : ""}
                    {result.expires_at && result.status === "published"
                      ? ` · beschikbaar tot ${formatDateTime(result.expires_at)}`
                      : ""}
                  </p>

                  {result.notified_email ? (
                    <p className="text-sm text-muted">
                      Mail naar {result.notified_email}
                      {result.notified_at ? ` op ${formatDateTime(result.notified_at)}` : ""}
                    </p>
                  ) : null}

                  {result.notify_error ? (
                    <Alert tone="warning" title="Let op bij de mail">
                      {result.notify_error}
                    </Alert>
                  ) : null}

                  {result.files.length > 0 ? (
                    <ul className="divide-y divide-line-soft rounded-card border border-line-soft">
                      {result.files.map((file) => (
                        <li
                          key={file.id}
                          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{file.file_name}</span>
                            <span className="block text-sm text-muted">
                              {file.kind === "link"
                                ? file.external_url
                                : file.removed_at
                                  ? "Verwijderd"
                                  : formatBytes(file.size_bytes)}
                            </span>
                          </span>
                          {concept ? (
                            <ActionForm
                              action={deleteResultFileAction}
                              submitLabel="Verwijderen"
                              variant="ghost"
                              inline
                            >
                              <input type="hidden" name="file_id" value={file.id} />
                            </ActionForm>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted">Nog geen bestanden of links toegevoegd.</p>
                  )}

                  {concept ? (
                    <div className="space-y-4 rounded-card bg-surface-2 p-4">
                      <ResultUploader
                        resultId={result.id}
                        maxMb={settings.results_max_upload_mb}
                      />

                      <ActionForm action={addResultLinkAction} submitLabel="Link toevoegen" inline>
                        <input type="hidden" name="result_id" value={result.id} />
                        <Field label="Externe link" htmlFor={`url-${result.id}`}>
                          <Input
                            id={`url-${result.id}`}
                            name="url"
                            type="url"
                            placeholder="https://we.tl/..."
                          />
                        </Field>
                        <Field label="Omschrijving" htmlFor={`label-${result.id}`}>
                          <Input
                            id={`label-${result.id}`}
                            name="label"
                            placeholder="Videoclip via WeTransfer"
                          />
                        </Field>
                      </ActionForm>

                      <div className="flex flex-wrap gap-3">
                        <ActionForm
                          action={publishResultAction}
                          submitLabel="Publiceren en mailen"
                          inline
                        >
                          <input type="hidden" name="result_id" value={result.id} />
                        </ActionForm>

                        <ActionForm
                          action={deleteResultAction}
                          submitLabel="Set verwijderen"
                          variant="danger"
                          inline
                        >
                          <input type="hidden" name="result_id" value={result.id} />
                        </ActionForm>
                      </div>
                    </div>
                  ) : (
                    <ActionForm
                      action={deleteResultAction}
                      submitLabel="Set verwijderen"
                      variant="danger"
                      inline
                    >
                      <input type="hidden" name="result_id" value={result.id} />
                    </ActionForm>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
