import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Paperclip } from "lucide-react";

import { BackLink } from "@/components/portal/back-link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requireMember } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { getThreadWithMessages } from "@/lib/portal/queries";
import { getSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { ReplyForm } from "./reply-form";

export const metadata: Metadata = { title: "Bericht" };

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireMember();
  const settings = await getSettings();

  const result = await getThreadWithMessages(session.activeOrganizationId, id);
  if (!result) notFound();

  const { thread, messages } = result;

  return (
    <>
      <BackLink href="/berichten" label="Terug naar berichten" />

      <h1 className="mb-6 text-[26px] leading-tight sm:text-[30px]">
        {thread.subject ?? "Zonder onderwerp"}
      </h1>

      <div className="space-y-4">
        {messages.map((message) => {
          const fromSkool = message.direction === "outbound";
          return (
            <article
              key={message.id}
              className={cn(
                "rounded-card border px-5 py-4",
                fromSkool ? "border-line-soft bg-white" : "border-accent/25 bg-accent-wash/60"
              )}
            >
              <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold">
                  {fromSkool ? "Skool Workshop" : (message.from_name ?? message.from_email)}
                </p>
                <p className="text-sm text-muted">
                  <time dateTime={message.sent_at}>{formatDateTime(message.sent_at)}</time>
                </p>
              </header>
              <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
                {message.body_text ?? message.snippet}
              </div>
              {message.has_attachments ? (
                <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted">
                  <Paperclip aria-hidden className="size-4" />
                  Dit bericht bevat bijlagen. Vraag ze op via {settings.support_email}.
                </p>
              ) : null}
            </article>
          );
        })}
      </div>

      <Card className="mt-6">
        <CardHeader title="Reageren" />
        <CardBody>
          <ReplyForm threadId={thread.id} supportEmail={settings.support_email} />
        </CardBody>
      </Card>
    </>
  );
}
