import { Badge, type BadgeTone } from "@/components/ui/badge";
import { STATUS_LABELS } from "@/lib/inschrijving/regels";
import type { EnrollmentStatus } from "@/lib/types/database";

const TOON: Record<EnrollmentStatus, BadgeTone> = {
  concept: "neutral",
  open: "success",
  gesloten: "warning",
  afgerond: "info",
};

export function StatusBadge({ status }: { status: EnrollmentStatus }) {
  return <Badge tone={TOON[status]}>{STATUS_LABELS[status]}</Badge>;
}

/**
 * Hoe vol een workshop zit, in één oogopslag.
 *
 * Groen zolang er ruimte is, oranje bij de laatste paar plekken, rood bij vol.
 * De kleur zegt hetzelfde als het getal ernaast, zodat het ook werkt voor wie
 * kleuren niet goed onderscheidt.
 */
export function BezettingBadge({ bezet, maximum }: { bezet: number; maximum: number }) {
  const vrij = Math.max(maximum - bezet, 0);
  const toon: BadgeTone = vrij === 0 ? "danger" : vrij <= 3 ? "warning" : "success";
  return (
    <Badge tone={toon}>
      {bezet} van {maximum}
      {vrij === 0 ? " · vol" : ""}
    </Badge>
  );
}
