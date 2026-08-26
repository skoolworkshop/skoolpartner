import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { requireAdmin } from "@/lib/auth/session";
import { listMessageThreads } from "@/lib/admin/queries";
import { formatDateTime } from "@/lib/format";
import { visibilityLabel } from "@/lib/messaging/visibility";
import type { ThreadVisibility } from "@/lib/types/database";

export const metadata: Metadata = { title: "Berichten" };

interface ThreadRow {
  id: string;
  organization_id: string | null;
  subject: string | null;
  participant_emails: string[];
  visibility: ThreadVisibility;
  message_count: number;
  last_message_at: string | null;
  organizations: { name: string } | null;
}

export default async function AdminMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  await requireAdmin();
  const { filter } = await searchParams;
  const active = filter === "review" ? "review" : "all";

  const rows = (await listMessageThreads({ filter: active })) as unknown as ThreadRow[];

  return (
    <>
      <h1 className="mb-6 text-[30px]">Berichten</h1>

      <Card>
        <CardHeader
          title="E-mailgesprekken van alle organisaties"
          description="Zichtbaar voor de klant zijn alleen gesprekken met een geverifieerde contactpersoon. Hier ziet u ze allemaal."
          action={
            <div className="flex gap-3 text-sm">
              <Link
                href="/admin/berichten"
                className={active === "all" ? "font-semibold underline underline-offset-4" : "text-muted"}
              >
                Alles
              </Link>
              <Link
                href="/admin/berichten?filter=review"
                className={
                  active === "review" ? "font-semibold underline underline-offset-4" : "text-muted"
                }
              >
                Controle nodig
              </Link>
            </div>
          }
        />

        {rows.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="Geen gesprekken gevonden"
            description="Zodra de Gmail-koppeling gesprekken ophaalt, verschijnen ze hier."
          />
        ) : (
          <ul className="divide-y divide-line-soft">
            {rows.map((thread) => {
              const zichtbaarheid = visibilityLabel(thread.visibility);

              return (
                <li key={thread.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <Link
                      href={`/admin/berichten/${thread.id}`}
                      className="min-w-0 font-semibold underline underline-offset-4"
                    >
                      {thread.subject ?? "Zonder onderwerp"}
                    </Link>
                    <span className="text-sm text-muted">
                      {formatDateTime(thread.last_message_at)}
                    </span>
                  </div>

                  <p className="mt-1 truncate text-sm text-muted">
                    {thread.organization_id ? (
                      <Link
                        href={`/admin/organisaties/${thread.organization_id}`}
                        className="underline underline-offset-4"
                      >
                        {thread.organizations?.name ?? "Onbekende organisatie"}
                      </Link>
                    ) : (
                      "Nog niet aan een organisatie gekoppeld"
                    )}
                    {" · "}
                    {thread.message_count} {thread.message_count === 1 ? "bericht" : "berichten"}
                    {thread.participant_emails.length > 0
                      ? ` · ${thread.participant_emails.join(", ")}`
                      : ""}
                  </p>

                  <p className="mt-2">
                    <Badge tone={zichtbaarheid.tone}>{zichtbaarheid.long}</Badge>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
