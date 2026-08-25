import Link from "next/link";
import { LogOut, ShieldCheck } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { MobileNav, SidebarNav } from "@/components/portal/portal-nav";
import { OrgSwitcher } from "@/components/portal/org-switcher";
import { ExternalButtonLink } from "@/components/ui/button";
import { requireMember } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { firstName } from "@/lib/format";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await requireMember();
  const settings = await getSettings();

  const organizations = session.memberships.map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
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
          <ExternalButtonLink
            href={settings.new_booking_cta_url}
            target="_blank"
            size="sm"
            className="w-full"
          >
            {settings.new_booking_cta_label}
          </ExternalButtonLink>

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
          <Link href="/dashboard" aria-label="Mijn Skool dashboard">
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

        {organizations.length > 1 ? (
          <div className="border-b border-line-soft bg-white px-4 py-2 lg:hidden">
            <OrgSwitcher organizations={organizations} activeId={session.activeOrganizationId} />
          </div>
        ) : null}

        <main
          id="hoofdinhoud"
          className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-12"
        >
          <span className="sr-only">
            Ingelogd als {firstName(session.profile?.full_name, session.email)}
          </span>
          {children}
        </main>
      </div>

      <MobileNav />
    </div>
  );
}
