import { cn } from "@/lib/utils";
import { LIFECYCLE_LABELS, type Bezetting, type ContactStilte, type Lifecycle } from "@/lib/crm/regels";
import { MERK_STIJL, type Merk } from "@/lib/crm/merk";

/**
 * De kleine gekleurde labeltjes van het CRM.
 *
 * Op een plek, zodat dezelfde toestand op elk scherm hetzelfde eruitziet. Een
 * levensfase die op de ene pagina groen is en op de andere grijs, kost meer
 * aandacht dan hij waard is.
 */

const basis =
  "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-semibold whitespace-nowrap";

const LIFECYCLE_STIJL: Record<Lifecycle, string> = {
  prospect: "bg-info-wash text-info",
  lead: "bg-warning-wash text-warning",
  klant: "bg-success-wash text-success",
  oud_klant: "bg-surface-3 text-muted",
};

export function LifecycleBadge({ waarde }: { waarde: Lifecycle }) {
  return <span className={cn(basis, LIFECYCLE_STIJL[waarde])}>{LIFECYCLE_LABELS[waarde]}</span>;
}

export function MerkBadge({ merk }: { merk: Merk }) {
  const stijl = MERK_STIJL[merk];
  return (
    <span className={cn(basis, stijl.chip)}>
      <span aria-hidden className={cn("size-1.5 rounded-pill", stijl.streep)} />
      {stijl.label}
    </span>
  );
}

const BEZETTING_STIJL: Record<Bezetting["toon"], string> = {
  ruimte: "bg-success-wash text-success",
  "bijna-vol": "bg-warning-wash text-warning",
  vol: "bg-surface-3 text-muted",
  over: "bg-danger-wash text-danger",
};

export function BezettingBadge({ stand }: { stand: Bezetting }) {
  return <span className={cn(basis, BEZETTING_STIJL[stand.toon])}>{stand.label}</span>;
}

export function StilteBadge({ stilte }: { stilte: ContactStilte }) {
  const stijl =
    stilte.toon === "recent"
      ? "bg-success-wash text-success"
      : stilte.toon === "lang"
        ? "bg-warning-wash text-warning"
        : "bg-surface-3 text-muted";
  return <span className={cn(basis, stijl)}>{stilte.label}</span>;
}

export function BetaalBadge({
  volledig,
  openCents,
  teveelCents,
  label,
}: {
  volledig: boolean;
  openCents: number;
  teveelCents: number;
  label: string;
}) {
  const stijl = teveelCents
    ? "bg-danger-wash text-danger"
    : volledig
      ? "bg-success-wash text-success"
      : openCents > 0
        ? "bg-warning-wash text-warning"
        : "bg-surface-3 text-muted";
  return <span className={cn(basis, stijl)}>{label}</span>;
}

/**
 * De leeftijdsmelding bij een deelnemer.
 *
 * Toont niets als er geen geboortedatum of geen vertrekdatum bekend is. Een
 * leeg vakje met een streepje suggereert dat er iets gecontroleerd is, en dat
 * is hier juist niet zo.
 */
export function LeeftijdBadge({
  signaal,
}: {
  signaal: { leeftijd: number; toon: "goed" | "let-op" | "buiten"; bericht: string } | null;
}) {
  if (!signaal) return null;
  const stijl =
    signaal.toon === "goed"
      ? "bg-success-wash text-success"
      : signaal.toon === "let-op"
        ? "bg-warning-wash text-warning"
        : "bg-danger-wash text-danger";
  return (
    <span className={cn(basis, stijl)} title={signaal.bericht}>
      {signaal.leeftijd} jaar
    </span>
  );
}
