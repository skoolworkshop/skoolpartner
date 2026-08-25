import type { Metadata } from "next";

import { ActionForm } from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { requireAdmin } from "@/lib/auth/session";
import { integrationMode, missingCredentials, publicEnv } from "@/lib/env";
import { getSyncStates } from "@/lib/integrations/sync-state";
import { formatDateTime } from "@/lib/format";
import { runSyncAction } from "../actions";
import type { IntegrationSyncStateRow } from "@/lib/types/database";

export const metadata: Metadata = { title: "Integraties" };

const LABELS: Record<string, { title: string; description: string }> = {
  gmail: {
    title: "Gmail",
    description:
      "Leest de centrale mailbox boekingen@skoolworkshop.nl. Bron voor het berichtencentrum en voor het herkennen van definitieve boekingsbevestigingen.",
  },
  moneybird: {
    title: "Moneybird",
    description:
      "Primaire financiële bron: facturen, bedragen en betaalstatus. Bepaalt wanneer SkoolPoints van 'in behandeling' naar 'beschikbaar' gaan.",
  },
  hubspot: {
    title: "HubSpot",
    description:
      "Aanvullende CRM-bron voor bedrijven en contactpersonen. Wordt nooit als enige bron voor workshopuren gebruikt.",
  },
};

export default async function AdminIntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ gekoppeld?: string; fout?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const states = (await getSyncStates()) as IntegrationSyncStateRow[];

  return (
    <>
      <h1 className="mb-6 text-[30px]">Integraties</h1>

      {params.gekoppeld === "gmail" ? (
        <Alert tone="success" className="mb-5">
          Gmail is gekoppeld. Draai een synchronisatie om de eerste berichten op te halen.
        </Alert>
      ) : null}
      {params.fout ? (
        <Alert tone="danger" className="mb-5">
          Koppelen is niet gelukt ({params.fout}). Controleer de Google-credentials en de redirect
          URI in de Google Cloud Console.
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        {(["gmail", "moneybird", "hubspot"] as const).map((name) => {
          const mode = integrationMode(name);
          const missing = missingCredentials(name);
          const state = states.find((s) => s.integration === name);

          return (
            <Card key={name}>
              <CardHeader
                title={LABELS[name].title}
                description={LABELS[name].description}
                action={
                  <Badge tone={mode === "live" ? "success" : "warning"}>
                    {mode === "live" ? "Live" : "Testmodus"}
                  </Badge>
                }
              />
              <CardBody className="space-y-4">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-muted">Status</dt>
                    <dd className="font-medium">{state?.status ?? "onbekend"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Laatste succes</dt>
                    <dd className="font-medium">{formatDateTime(state?.last_success_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Verwerkt</dt>
                    <dd className="font-medium">{state?.items_processed ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Mislukte pogingen</dt>
                    <dd className="font-medium">{state?.retry_count ?? 0}</dd>
                  </div>
                </dl>

                {state?.last_error ? (
                  <Alert tone="danger" title="Laatste fout">
                    {state.last_error}
                  </Alert>
                ) : null}

                {missing.length > 0 ? (
                  <Alert tone="warning" title="Nog toe te voegen environment variables">
                    <ul className="mt-1 list-inside list-disc font-mono text-xs">
                      {missing.map((variable) => (
                        <li key={variable}>{variable}</li>
                      ))}
                    </ul>
                  </Alert>
                ) : null}

                <div className="flex flex-wrap items-center gap-3">
                  <ActionForm action={runSyncAction} submitLabel="Nu synchroniseren" inline>
                    <input type="hidden" name="integration" value={name} />
                  </ActionForm>

                  {name === "gmail" ? (
                    <ButtonLink href="/api/integrations/google/start" variant="secondary" size="sm">
                      Gmail koppelen via Google
                    </ButtonLink>
                  ) : null}
                </div>

                {name === "gmail" ? (
                  <p className="text-xs text-muted">
                    Redirect URI voor Google Cloud:{" "}
                    <code className="break-all">
                      {publicEnv.siteUrl}/api/integrations/google/callback
                    </code>
                  </p>
                ) : null}
                {name === "moneybird" ? (
                  <p className="text-xs text-muted">
                    Webhook-URL voor Moneybird:{" "}
                    <code className="break-all">{publicEnv.siteUrl}/api/webhooks/moneybird</code>
                  </p>
                ) : null}
              </CardBody>
            </Card>
          );
        })}

        <Card>
          <CardHeader
            title="Supabase"
            description="Database, authenticatie en Row Level Security."
            action={<Badge tone="success">Actief</Badge>}
          />
          <CardBody className="text-sm text-muted">
            <p>
              Project: <code className="break-all">{publicEnv.supabaseUrl || "niet ingesteld"}</code>
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
