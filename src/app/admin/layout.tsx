import Link from "next/link";
import { ArrowLeft, LogOut } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { AdminNav } from "@/components/admin/admin-nav";
import { requireAdmin } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();

  return (
    <div className="min-h-dvh bg-surface-2">
      <header className="border-b border-line-soft bg-ink text-white">
        <div aria-hidden className="h-1 bg-accent" />
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <Logo tone="light" showPortalName={false} height={26} />
            <span className="font-display text-[13px] font-semibold uppercase tracking-[0.18em] text-accent-soft">
              Beheer
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-white/60 sm:inline">{session.email}</span>

            {/* Alleen tonen als deze beheerder ook echt bij een organisatie
                hoort. Anders leidt de knop nergens heen. */}
            {session.memberships.length > 0 ? (
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-1.5 rounded-pill border border-white/20 px-3 py-1.5 font-semibold hover:bg-white/10"
              >
                <ArrowLeft aria-hidden className="size-3.5" />
                Klantportaal
              </Link>
            ) : null}

            <form action="/auth/uitloggen" method="post">
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-pill border border-white/20 px-3 py-1.5 font-semibold hover:bg-white/10"
              >
                <LogOut aria-hidden className="size-3.5" />
                Uitloggen
              </button>
            </form>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <AdminNav />
        </div>
      </header>

      <main id="hoofdinhoud" className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
