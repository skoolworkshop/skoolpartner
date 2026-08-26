import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Paperclip } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/lib/auth/session";
import { getMessageThreadForAdmin } from "@/lib/admin/queries";
import { formatDateTime } from "@/lib/format";
import { visibilityLabel } from "@/lib/messaging/visibility";
import type { ThreadVisibility } from "@/lib/types/database";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Bericht" };

interface AdminThread {
  id: string;
  subject: string | null;
  visibility: ThreadVisibility;
  participant_emails: string[];
  organizations: { id: string; name: string } | null;
}

interface AdminMessage {
  id: string;
  direction: string;
  from_email: string | null;
  from_name: string | null;
  to_emails: string[];
  sent_at: string;
  snippet: string | null;
  body_text: string | null;
  has_attachments: boolean;
}

export default async function AdminThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin();

  const result = await getMessageThreadForAdmin(id);
  if (!result) notFound();

  const thread = result.thread as unknown as AdminThread;
  const messages = result.messages as unknown as AdminMessage[];

  return (
    <>
      <Link
        href="/admin/berichten"
        className="-ml-1 mb-4 inline-flex min-h-11 items-center gap-2 rounded-pill px-3 py-2 text-sm font-semibold text-muted hover:bg-surface-3 hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Terug naar berichten
      </Link>

      <h1 className="mb-2 text-[26px] leading-tight sm:text-[30px]">
        {thread.subject ?? "Zonder onderwerp"}
      </h1>

      <p className="mb-6 text-sm text-muted">
        {thread.organizations ? (
          <Link
            href={`/admin/organisaties/${thread.organizations.id}`}
            className="underline underline-offset-4"
          >
            {thread.organizations.name}
          </Link>
        ) : (
          "Nog niet aan een organisatie gekoppeld"
        )}
        {thread.participant_emails.length > 0 ? ` · ${thread.participant_emails.join(", ")}` : ""}
      </p>

      <div className="space-y-4">
        {messages.map((message) => {
          const vanSkool = message.direction === "outbound";
          return (
            <article
              key={message.id}
              className={cn(
                "rounded-card border px-5 py-4",
                vanSkool ? "border-line-soft bg-white" : "border-accent/25 bg-accent-wash/60"
              )}
            >
              <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold">
                  {message.from_name ?? message.from_email ?? (vanSkool ? "Skool Workshop" : "Klant")}
                </p>
                <p className="text-sm text-muted">
                  <time dateTime={message.sent_at}>{formatDateTime(message.sent_at)}</time>
                </p>
              </header>

              {message.to_emails.length > 0 ? (
                <p className="mb-2 text-sm text-muted">Aan: {message.to_emails.join(", ")}</p>
              ) : null}

              <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
                {message.body_text ?? message.snippet}
              </div>

              {message.has_attachments ? (
                <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted">
                  <Paperclip aria-hidden className="size-4" />
                  Dit bericht bevat bijlagen. Die staan in Gmail.
                </p>
              ) : null}
            </article>
          );
        })}

        {messages.length === 0 ? (
          <p className="rounded-card border border-line-soft bg-white px-5 py-8 text-center text-muted">
            Dit gesprek bevat nog geen opgehaalde berichten.
          </p>
        ) : null}
      </div>

      <p className="mt-6">
        <Badge tone={visibilityLabel(thread.visibility).tone}>
          {visibilityLabel(thread.visibility).long}
        </Badge>
      </p>
    </>
  );
}
