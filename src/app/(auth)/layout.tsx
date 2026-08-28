import Link from "next/link";

import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-surface-2">
      <header className="border-b border-line-soft bg-white">
        <div className="mx-auto flex min-h-20 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link href="/" aria-label="SkoolPartner startpagina"><Logo height={32} /></Link>
          <span className="hidden text-sm text-muted sm:block">Veilige klantomgeving van Skool Workshop</span>
        </div>
      </header>
      <main id="hoofdinhoud" className="mx-auto w-full max-w-4xl px-4 py-7 sm:px-8 sm:py-12">
        <div className="rounded-card border border-line-soft bg-white p-5 shadow-sm sm:p-8 lg:p-10">
          {children}
        </div>
        <p className="mt-5 text-center text-sm text-muted">
          Hulp nodig? Mail <a className="font-semibold text-ink underline underline-offset-4" href="mailto:boekingen@skoolworkshop.nl">boekingen@skoolworkshop.nl</a>
        </p>
      </main>
    </div>
  );
}
