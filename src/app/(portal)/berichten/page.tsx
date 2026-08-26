import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquare } from "lucide-react";

import { ChatCard } from "@/components/portal/chat-cta";
import { PageHeader } from "@/components/portal/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { requireMember } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { getMessageThreads } from "@/lib/portal/queries";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Berichten" };

export default async function MessagesPage() {
  const session = await requireMember();
  const settings = await getSettings();
  const threads = await getMessageThreads(session.activeOrganizationId);

  return (
    <>
      <PageHeader
        eyebrow="Contact"
        title="Berichten"
        description={`De e-mailwisseling tussen uw organisatie en ${settings.support_email}. U ziet alleen gesprekken waar een geverifieerde contactpersoon van uw organisatie aan deelneemt.`}
      />

      <div className="mb-5">
        <ChatCard
          enabled={settings.chat_enabled}
          url={settings.chat_whatsapp_url}
          label={settings.chat_label}
          helpText={settings.chat_help_text}
        />
      </div>

      <Card>
        {threads.length > 0 ? (
          <ul className="divide-y divide-line-soft">
            {threads.map((thread) => (
              <li key={thread.id}>
                <Link
                  href={`/berichten/${thread.id}`}
                  className="flex flex-col gap-1 px-5 py-4 hover:bg-surface-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-display text-[17px]">
                      {thread.subject ?? "Zonder onderwerp"}
                    </span>
                    <span className="mt-0.5 block text-sm text-muted">
                      {thread.message_count} bericht{thread.message_count === 1 ? "" : "en"}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm text-muted">
                    {formatDateTime(thread.last_message_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={MessageSquare}
            title="Nog geen berichten"
            description="Zodra er per e-mail contact is over een boeking, vindt u dat gesprek hier terug."
          />
        )}
      </Card>
    </>
  );
}
