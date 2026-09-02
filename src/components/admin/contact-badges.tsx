import Link from "next/link";

import { cn } from "@/lib/utils";
import { CONTACT_TYPE_LABELS, type PortalStatus } from "@/lib/crm/contacten";
import type { CrmContactType } from "@/lib/types/database";

const basis =
  "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-semibold whitespace-nowrap";

export function ContactTypeBadge({ type }: { type: CrmContactType | null }) {
  if (!type) return null;
  return <span className={cn(basis, "bg-surface-3 text-muted")}>{CONTACT_TYPE_LABELS[type]}</span>;
}

/**
 * Of iemand toegang heeft tot het klantportaal.
 *
 * Drie standen, en het verschil ertussen doet ertoe:
 *
 *   gekoppeld  Vastgelegd. Dit is deze persoon.
 *   gevonden   Er bestaat een account met hetzelfde e-mailadres. Waarschijnlijk
 *              dezelfde persoon, maar niemand heeft dat bevestigd. Daarom staat
 *              er "waarschijnlijk" en niet "ja".
 *   geen       Geen account. Dit is de normale situatie en verdient geen
 *              waarschuwing: de meeste contacten horen geen login te hebben.
 */
export function PortalBadge({ portal }: { portal: PortalStatus }) {
  if (portal.stand === "geen") {
    return <span className={cn(basis, "bg-surface-3 text-muted-soft")}>Geen account</span>;
  }
  if (portal.stand === "gekoppeld") {
    return <span className={cn(basis, "bg-success-wash text-success")}>Account actief</span>;
  }
  return (
    <span className={cn(basis, "bg-info-wash text-info")} title={`Er bestaat een account met ${portal.email}`}>
      Account gevonden
    </span>
  );
}

/**
 * Het blok op de contactkaart dat vertelt wat de klantportaalstatus betekent.
 *
 * Hier staat bewust uitleg bij. Dit is het punt waar de twee begrippen door
 * elkaar gaan lopen, en dan helpt een zin meer dan een vinkje.
 */
export function PortalUitleg({
  portal,
  organizationId,
}: {
  portal: PortalStatus;
  organizationId: string | null;
}) {
  if (portal.stand === "geen") {
    return (
      <div className="rounded-card bg-surface-2 px-4 py-3 text-sm">
        <p className="font-semibold text-ink">Geen SkoolPartner-account</p>
        <p className="mt-0.5 text-muted">
          Dat is normaal. De meeste contacten in het CRM hebben geen login, en dat hoeft ook niet:
          een contact is iemand die je kent, een account is toegang tot het klantportaal.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-card px-4 py-3 text-sm",
        portal.stand === "gekoppeld" ? "bg-success-wash" : "bg-info-wash"
      )}
    >
      <p className="font-semibold text-ink">
        {portal.stand === "gekoppeld"
          ? "SkoolPartner-account actief"
          : "Er bestaat een account met dit e-mailadres"}
      </p>
      <p className="mt-0.5 text-ink/80">
        {portal.naam ?? portal.email}
        {portal.stand === "gevonden"
          ? ". Waarschijnlijk dezelfde persoon, maar dat is niet vastgelegd. Koppel het hieronder als het klopt."
          : "."}
      </p>
      {organizationId ? (
        <Link
          href={`/admin/organisaties/${organizationId}`}
          className="mt-2 inline-flex min-h-9 items-center rounded-pill bg-white px-4 text-sm font-semibold text-ink"
        >
          Naar de organisatie
        </Link>
      ) : null}
    </div>
  );
}
