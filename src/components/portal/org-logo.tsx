import { Building2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Het logo van een organisatie in een vaste container.
 *
 * Logo's komen in alle soorten: vierkant, rond, breed, met of zonder
 * transparantie. Daarom een vaste vierkante ruimte met object-contain, zodat
 * niets wordt uitgerekt of afgesneden. Is er geen logo, dan staat er gewoon
 * het vertrouwde gebouwicoon.
 *
 * Bewust een gewone img en geen next/image: het adres komt uit de opslag van
 * een willekeurige organisatie, en dan is de beeldoptimalisatie van Next meer
 * gedoe dan winst voor een plaatje van 32 pixels.
 */
export function OrgLogo({
  name,
  logoUrl,
  size = 24,
  className,
}: {
  name: string;
  logoUrl: string | null | undefined;
  /** Hoogte van de container in pixels. De breedte mag iets meer zijn. */
  size?: number;
  className?: string;
}) {
  // Een breed logo in een strak vierkant wordt een onleesbaar streepje. Daarom
  // ligt de hoogte vast en mag de breedte meegroeien tot ongeveer het dubbele.
  // Vierkante en ronde logo's blijven daardoor gewoon vierkant.
  const styleSize = { height: size, minWidth: size, maxWidth: Math.round(size * 1.9) };

  if (!logoUrl) {
    return (
      <span
        aria-hidden
        className={cn("flex shrink-0 items-center justify-center text-muted", className)}
        style={{ width: size, height: size }}
      >
        <Building2 className="size-full" strokeWidth={1.75} />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-white",
        className
      )}
      style={styleSize}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoUrl}
        alt={`Logo van ${name}`}
        height={size}
        loading="lazy"
        decoding="async"
        className="h-full w-auto max-w-full object-contain"
      />
    </span>
  );
}
