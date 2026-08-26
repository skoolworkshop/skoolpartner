import Link from "next/link";
import { ArrowRight, CalendarCheck, Sparkles } from "lucide-react";

import type { Highlight } from "@/lib/greeting";
import { cn } from "@/lib/utils";

/**
 * Eén korte, opgewekte regel bovenaan het dashboard. Er is er hooguit één en
 * hij verschijnt alleen als er echt iets te melden is.
 */
export function DashboardHighlight({ highlight }: { highlight: Highlight | null }) {
  if (!highlight) return null;

  const feest = highlight.tone === "feest";
  const Icon = feest ? Sparkles : CalendarCheck;

  return (
    <div
      className={cn(
        "mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border p-4 sm:px-5",
        feest
          ? "border-accent/35 bg-accent-soft/25"
          : "border-line-soft bg-surface-2"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-pill",
          feest ? "bg-accent text-ink" : "bg-surface-3 text-muted"
        )}
      >
        <Icon className="size-5" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="font-display text-[17px] leading-snug">{highlight.title}</p>
        {highlight.description ? (
          <p className="mt-0.5 text-sm text-muted">{highlight.description}</p>
        ) : null}
      </div>

      {highlight.href && highlight.linkLabel ? (
        <Link
          href={highlight.href}
          className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-semibold text-ink underline underline-offset-4"
        >
          {highlight.linkLabel}
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      ) : null}
    </div>
  );
}
