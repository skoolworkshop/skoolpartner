import Image from "next/image";

import logoDark from "@/../public/brand/skool-workshop-logo.png";
import logoLight from "@/../public/brand/skool-workshop-logo-wit.png";
import { cn } from "@/lib/utils";

/**
 * Het woordmerk van Skool Workshop, met daarnaast de aanduiding van het
 * portaal. Op donkere vlakken gebruiken we de lichte variant, precies zoals
 * op skoolworkshop.nl.
 */
export function Logo({
  className,
  tone = "dark",
  showPortalName = true,
  height = 30,
}: {
  className?: string;
  tone?: "dark" | "light";
  showPortalName?: boolean;
  height?: number;
}) {
  const isLight = tone === "light";
  const source = isLight ? logoLight : logoDark;

  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <Image
        src={source}
        alt="Skool Workshop"
        height={height}
        width={Math.round(height * 3.106)}
        priority
        style={{ height, width: "auto" }}
      />
      {showPortalName ? (
        <>
          <span
            aria-hidden
            className={cn("h-6 w-px", isLight ? "bg-white/25" : "bg-line")}
          />
          <span
            className={cn(
              "font-display text-[13px] font-semibold uppercase leading-none tracking-[0.16em]",
              isLight ? "text-white/70" : "text-muted"
            )}
          >
            Mijn Skool
          </span>
        </>
      ) : null}
    </span>
  );
}

/** Compact beeldmerk voor smalle schermen en avatars. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-card bg-ink font-display text-[15px] font-bold text-accent",
        className
      )}
    >
      S
    </span>
  );
}
