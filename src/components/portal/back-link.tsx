"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/**
 * Terugknop voor onderliggende pagina's.
 *
 * Kwam de bezoeker vanuit SkoolPartner zelf, dan gaat hij één stap terug in de
 * geschiedenis; dat voelt het meest natuurlijk. Kwam hij van buitenaf, bij een
 * link uit een mail bijvoorbeeld, dan zou terug hem de app uit sturen. In dat
 * geval gaan we naar het overzicht waar deze pagina bij hoort.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  const router = useRouter();

  function onClick() {
    const cameFromPortal =
      typeof document !== "undefined" &&
      document.referrer !== "" &&
      new URL(document.referrer).origin === window.location.origin;

    if (cameFromPortal && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(href);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-1 mb-4 inline-flex min-h-11 items-center gap-2 rounded-pill px-3 py-2 text-sm font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-ink"
    >
      <ArrowLeft aria-hidden className="size-4" />
      {label}
    </button>
  );
}
