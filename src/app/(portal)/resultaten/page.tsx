import type { Metadata } from "next";
import { Download, ExternalLink, FolderDown } from "lucide-react";

import { PageHeader } from "@/components/portal/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { requireMember } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { getResultsForOrganization } from "@/lib/results/service";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Resultaten" };

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

function daysLeft(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / 86_400_000);
}

export default async function ResultsPage() {
  const session = await requireMember();
  const settings = await getSettings();

  if (!settings.results_enabled) {
    return (
      <>
        <PageHeader eyebrow="Na de workshop" title="Resultaten" />
        <Card>
          <EmptyState
            icon={FolderDown}
            title="Dit onderdeel staat uit"
            description="Neem contact op met Skool Workshop als u hier wel gebruik van wilt maken."
          />
        </Card>
      </>
    );
  }

  const results = await getResultsForOrganization(session.activeOrganizationId);

  return (
    <>
      <PageHeader
        backHref="/dashboard"
        backLabel="Terug naar dashboard"
        eyebrow="Na de workshop"
        title="Resultaten"
        description={`Het werk dat tijdens uw workshops is gemaakt. Bestanden staan ${settings.results_available_days} dagen klaar, sla ze daarom meteen op een eigen plek op.`}
      />

      {results.length === 0 ? (
        <Card>
          <EmptyState
            icon={FolderDown}
            title="Nog geen resultaten"
            description="Zodra wij na een workshop iets voor u klaarzetten, krijgt u een mail en vindt u het hier terug."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {results.map((result) => {
            const resterend = daysLeft(result.expires_at);
            const verlopen = result.status === "expired";

            return (
              <Card key={result.id}>
                <CardHeader
                  title={result.title}
                  action={
                    verlopen ? (
                      <Badge tone="neutral">Verlopen</Badge>
                    ) : resterend !== null && resterend <= 2 ? (
                      <Badge tone="warning">
                        Nog {resterend} {resterend === 1 ? "dag" : "dagen"}
                      </Badge>
                    ) : (
                      <Badge tone="success">Beschikbaar</Badge>
                    )
                  }
                />
                <CardBody className="space-y-4">
                  {result.description ? (
                    <p className="text-[15px] text-muted">{result.description}</p>
                  ) : null}

                  {verlopen ? (
                    <Alert tone="info" title="Deze bestanden zijn verwijderd">
                      De downloadperiode is voorbij, daarom hebben wij de bestanden van onze
                      servers gehaald. Heeft u ze alsnog nodig? Mail ons op{" "}
                      {settings.support_email}, dan kijken we of we ze opnieuw kunnen klaarzetten.
                    </Alert>
                  ) : (
                    <>
                      <p className="text-sm text-muted">
                        Beschikbaar tot en met {formatDateTime(result.expires_at)}
                      </p>

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
                                  ? "Externe link"
                                  : formatBytes(file.size_bytes)}
                              </span>
                            </span>
                            <a
                              href={`/resultaten/bestand/${file.id}`}
                              target={file.kind === "link" ? "_blank" : undefined}
                              rel={file.kind === "link" ? "noopener noreferrer" : undefined}
                              className="inline-flex shrink-0 items-center gap-2 rounded-pill bg-accent px-4 py-2 text-sm font-semibold text-ink transition hover:bg-accent-strong hover:text-white"
                            >
                              {file.kind === "link" ? (
                                <ExternalLink aria-hidden className="size-4" />
                              ) : (
                                <Download aria-hidden className="size-4" />
                              )}
                              {file.kind === "link" ? "Openen" : "Downloaden"}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </>
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
