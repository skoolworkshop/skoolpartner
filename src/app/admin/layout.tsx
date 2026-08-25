import Link from "next/link";
import { ArrowLeft } from "lucide-react";

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
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-white/60 sm:inline">{session.email}</span>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 rounded-pill border border-white/20 px-3 py-1.5 font-semibold hover:bg-white/10"
            >
              <ArrowLeft aria-hidden className="size-3.5" />
              Klantportaal
            </Link>
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
