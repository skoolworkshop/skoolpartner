"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Alleen server-side loggen. De bezoeker krijgt nooit technische details
    // of stack traces te zien.
    console.error("[mijn-skool]", error.digest ?? error.message);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-white px-6 text-center">
      <p className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-muted">
        Er ging iets mis
      </p>
      <h1 className="mt-3 text-[32px]">We konden deze pagina niet laden</h1>
      <p className="mt-3 max-w-md text-[15px] text-muted">
        Probeer het opnieuw. Blijft dit gebeuren, mail ons dan op boekingen@skoolworkshop.nl.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-11 items-center rounded-pill bg-ink px-6 font-display font-semibold text-white hover:bg-ink-soft"
        >
          Opnieuw proberen
        </button>
        <a
          href="/dashboard"
          className="inline-flex h-11 items-center rounded-pill border border-line px-6 font-display font-semibold hover:bg-surface-2"
        >
          Naar het dashboard
        </a>
      </div>
      {error.digest ? (
        <p className="mt-6 text-xs text-muted-soft">Referentie: {error.digest}</p>
      ) : null}
    </main>
  );
}
