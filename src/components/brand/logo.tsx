import { cn } from "@/lib/utils";

/**
 * Woordmerk van Mijn Skool.
 *
 * De marketingsite gebruikt een zwart/donkerblauw woordmerk in Titillium Web.
 * Dat nemen we hier over, met "Mijn Skool" als duidelijke portaalaanduiding.
 * Zo blijft het herkenbaar Skool Workshop, maar zie je meteen dat dit de
 * klantomgeving is en niet de website.
 */
export function Logo({
  className,
  tone = "dark",
  showPortalName = true,
}: {
  className?: string;
  tone?: "dark" | "light";
  showPortalName?: boolean;
}) {
  const isLight = tone === "light";
  return (
    <span className={cn("inline-flex items-baseline gap-2", className)}>
      <span
        className={cn(
          "font-display text-[19px] font-bold leading-none tracking-[-0.04em]",
          isLight ? "text-white" : "text-ink"
        )}
      >
        SKOOL
        <span className={isLight ? "text-accent-soft" : "text-accent"}>WORKSHOP</span>
      </span>
      {showPortalName ? (
        <span
          className={cn(
            "font-display text-[13px] font-semibold uppercase leading-none tracking-[0.14em]",
            isLight ? "text-white/70" : "text-muted"
          )}
        >
          Mijn Skool
        </span>
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
        "inline-flex size-9 items-center justify-center rounded-card bg-ink font-display text-[15px] font-bold text-white",
        className
      )}
    >
      S
    </span>
  );
}
