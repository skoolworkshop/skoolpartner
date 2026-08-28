import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut, ShieldCheck } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { MobileNav, SidebarNav } from "@/components/portal/portal-nav";
import { OrgSwitcher } from "@/components/portal/org-switcher";
import { ProfileReminder } from "@/components/portal/profile-reminder";
import { ChatFloatingButton } from "@/components/portal/chat-cta";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { requireMember } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { firstName } from "@/lib/format";
import { checkProfile } from "@/lib/account";
import { stopCustomerPreview } from "./preview-actions";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await requireMember();
  if (session.isAdmin && !session.customerPreview) redirect("/admin");
  const settings = await getSettings();

  const organizations = session.memberships.map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
    logoUrl: m.organization.logo_url,
  }));

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[268px_minmax(0,1fr)]">
      {/* Zijbalk op desktop */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line-soft bg-white px-5 py-6 lg:flex">
        <Link href="/dashboard" className="mb-7 block">
          <Logo height={28} />
        </Link>

        <OrgSwitcher organizations={organizations} activeId={session.activeOrganizationId} />

        <div className="mt-6 flex-1">
          <SidebarNav />
        </div>

        <div className="space-y-3 border-t border-line-soft pt-5">
          <ButtonLink
            href="/nieuwe-boeking"
            size="sm"
            className="w-full"
          >
            {settings.new_booking_cta_label}
          </ButtonLink>

          {session.isAdmin ? (
            <Link
              href="/admin"
              className="flex items-center gap-2 rounded-card px-3 py-2 text-sm font-semibold text-muted hover:bg-surface-3 hover:text-ink"
            >
              <ShieldCheck aria-hidden className="size-4" />
              Beheer
            </Link>
          ) : null}

          <form action="/auth/uitloggen" method="post">
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-card px-3 py-2 text-sm font-semibold text-muted hover:bg-surface-3 hover:text-ink"
            >
              <LogOut aria-hidden className="size-4" />
              Uitloggen
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Bovenbalk op mobiel */}
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line-soft bg-white px-4 py-3 lg:hidden">
          <Link href="/dashboard" aria-label="SkoolPartner dashboard">
            <Logo showPortalName={false} height={26} />
          </Link>
          <div className="flex items-center gap-2">
            {session.isAdmin ? (
              <Link
                href="/admin"
                aria-label="Beheer"
                className="rounded-card p-2 text-muted hover:bg-surface-3 hover:text-ink"
              >
                <ShieldCheck aria-hidden className="size-5" />
              </Link>
            ) : null}
            <form action="/auth/uitloggen" method="post">
              <button
                type="submit"
                aria-label="Uitloggen"
                className="rounded-card p-2 text-muted hover:bg-surface-3 hover:text-ink"
              >
                <LogOut aria-hidden className="size-5" />
              </button>
            </form>
          </div>
        </header>

        {/* Op mobiel staat de organisatie onder de bovenbalk, met hetzelfde
            logo als in de zijbalk op desktop. Bij meerdere organisaties is het
            meteen de wisselaar. */}
        <div className="border-b border-line-soft bg-white px-4 py-2 lg:hidden">
          <OrgSwitcher organizations={organizations} activeId={session.activeOrganizationId} />
        </div>

        <main
          id="hoofdinhoud"
          className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-12"
        >
          <span className="sr-only">
            Ingelogd als {firstName(session.profile?.full_name, session.email)}
          </span>

          {session.customerPreview ? (
            <Alert tone="warning" title={`Je beheert momenteel het klantportaal van ${session.customerPreview.userName}`} className="mb-5">
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0 break-all text-sm">
                  {session.customerPreview.userEmail} · klantgegevens kunnen worden aangepast
                </span>
                <form action={stopCustomerPreview}>
                  <Button type="submit" variant="secondary" size="sm" className="w-full sm:w-auto">
                    Terug naar beheer
                  </Button>
                </form>
              </div>
            </Alert>
          ) : null}

          <ProfileReminder
            status={checkProfile({
              full_name: session.profile?.full_name ?? null,
              phone: session.profile?.phone ?? null,
              email: session.email,
            })}
            supportEmail={settings.support_email}
          />

          {children}
        </main>
      </div>

      <ChatFloatingButton
        enabled={settings.chat_enabled}
        url={settings.chat_whatsapp_url}
        label={settings.chat_label}
      />

      <MobileNav />
    </div>
  );
}
