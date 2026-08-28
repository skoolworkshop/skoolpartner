import Link from "next/link";
import { LogOut, ShieldCheck } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { AdminNav } from "@/components/admin/admin-nav";
import { requireAdmin } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();

  return (
    <div className="min-h-dvh bg-surface-2 lg:grid lg:grid-cols-[268px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line-soft bg-white px-5 py-6 lg:flex">
        <Link href="/admin" className="mb-7 block">
          <Logo height={28} />
        </Link>
        <div className="mb-4 flex items-center gap-2 rounded-card bg-surface-2 px-3 py-2.5">
          <ShieldCheck aria-hidden className="size-4 text-accent-strong" />
          <span className="font-semibold">Beheerportaal</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <AdminNav variant="sidebar" />
        </div>
        <div className="space-y-3 border-t border-line-soft pt-5">
          <p className="break-all px-3 text-xs text-muted">{session.email}</p>
          <form action="/auth/uitloggen" method="post">
            <button type="submit" className="flex min-h-11 w-full items-center gap-2 rounded-card px-3 py-2 text-sm font-semibold text-muted hover:bg-surface-3 hover:text-ink">
              <LogOut aria-hidden className="size-4" />
              Uitloggen
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 border-b border-line-soft bg-white lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <Link href="/admin" aria-label="Beheerdashboard">
              <Logo showPortalName={false} height={26} />
            </Link>
            <div className="flex items-center gap-2">
              <span className="font-display text-sm font-semibold">Beheer</span>
              <form action="/auth/uitloggen" method="post">
                <button type="submit" aria-label="Uitloggen" className="rounded-card p-2 text-muted hover:bg-surface-3 hover:text-ink">
                  <LogOut aria-hidden className="size-5" />
                </button>
              </form>
            </div>
          </div>
          <div className="px-4 pb-3"><AdminNav variant="mobile" /></div>
        </header>

        <main id="hoofdinhoud" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
