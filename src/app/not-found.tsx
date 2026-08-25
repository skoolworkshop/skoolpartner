import Link from "next/link";

import { Logo } from "@/components/brand/logo";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-white px-6 text-center">
      <Logo className="mb-10" />
      <p className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-muted">
        Pagina niet gevonden
      </p>
      <h1 className="mt-3 text-[32px]">Deze pagina bestaat niet</h1>
      <p className="mt-3 max-w-md text-[15px] text-muted">
        Misschien is de link verouderd of heeft u geen toegang meer tot dit onderdeel.
      </p>
      <Link
        href="/dashboard"
        className="mt-8 inline-flex h-11 items-center rounded-pill bg-ink px-6 font-display font-semibold text-white hover:bg-ink-soft"
      >
        Naar het dashboard
      </Link>
    </main>
  );
}
