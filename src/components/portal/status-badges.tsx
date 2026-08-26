import { Badge, type BadgeTone } from "@/components/ui/badge";
import type {
  BookingStatus,
  CjpParkingStatus,
  InvoiceState,
  LoyaltyTransactionStatus,
  LoyaltyTransactionType,
  RedemptionStatus,
} from "@/lib/types/database";

const bookingLabels: Record<BookingStatus, { label: string; tone: BadgeTone }> = {
  concept: { label: "In voorbereiding", tone: "neutral" },
  confirmed: { label: "Bevestigd", tone: "success" },
  completed: { label: "Afgerond", tone: "neutral" },
  cancelled: { label: "Geannuleerd", tone: "danger" },
};

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const item = bookingLabels[status] ?? bookingLabels.concept;
  return <Badge tone={item.tone}>{item.label}</Badge>;
}

const invoiceLabels: Record<InvoiceState, { label: string; tone: BadgeTone }> = {
  draft: { label: "Concept", tone: "neutral" },
  open: { label: "Openstaand", tone: "warning" },
  pending_payment: { label: "Betaling onderweg", tone: "info" },
  late: { label: "Vervallen", tone: "danger" },
  reminded: { label: "Herinnering verstuurd", tone: "warning" },
  partially_paid: { label: "Deels betaald", tone: "warning" },
  paid: { label: "Betaald", tone: "success" },
  uncollectible: { label: "Oninbaar", tone: "danger" },
  unknown: { label: "Onbekend", tone: "neutral" },
};

export function InvoiceStatusBadge({ state }: { state: InvoiceState }) {
  const item = invoiceLabels[state] ?? invoiceLabels.unknown;
  return <Badge tone={item.tone}>{item.label}</Badge>;
}

const loyaltyLabels: Record<LoyaltyTransactionStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: "In behandeling", tone: "warning" },
  available: { label: "Beschikbaar", tone: "success" },
  reserved: { label: "Gereserveerd", tone: "info" },
  redeemed: { label: "Ingewisseld", tone: "neutral" },
  expired: { label: "Verlopen", tone: "neutral" },
  reversed: { label: "Teruggedraaid", tone: "danger" },
  cancelled: { label: "Geannuleerd", tone: "neutral" },
};

export function LoyaltyStatusBadge({ status }: { status: LoyaltyTransactionStatus }) {
  const item = loyaltyLabels[status] ?? loyaltyLabels.pending;
  return <Badge tone={item.tone}>{item.label}</Badge>;
}

/**
 * Waar komen deze punten vandaan? De beheerder zag hier tot nu toe de
 * technische naam uit de database staan, bijvoorbeeld earn_workshop. Dat leest
 * niemand prettig en het maakt het lastig om in één oogopslag onderscheid te
 * zien tussen verdiende punten, een correctie en een reservering.
 */
const loyaltyTypeLabels: Record<LoyaltyTransactionType, string> = {
  earn_workshop: "Verdiend met workshops",
  earn_review: "Bonus voor een review",
  welcome_bonus: "Welkomstbonus",
  manual_adjustment: "Handmatige correctie",
  redemption_reserve: "Ingewisseld",
  expiry: "Verlopen",
  reversal: "Teruggedraaid",
  cjp_bonus: "Bonus bij geparkeerd CJP-tegoed",
};

export function loyaltyTypeLabel(type: LoyaltyTransactionType): string {
  return loyaltyTypeLabels[type] ?? type;
}

const redemptionLabels: Record<RedemptionStatus, { label: string; tone: BadgeTone }> = {
  requested: { label: "Aangevraagd", tone: "warning" },
  approved: { label: "Goedgekeurd", tone: "info" },
  rejected: { label: "Afgewezen", tone: "danger" },
  applied: { label: "Verwerkt", tone: "success" },
  cancelled: { label: "Geannuleerd", tone: "neutral" },
};

export function RedemptionStatusBadge({ status }: { status: RedemptionStatus }) {
  const item = redemptionLabels[status] ?? redemptionLabels.requested;
  return <Badge tone={item.tone}>{item.label}</Badge>;
}

/**
 * De status van een aanvraag om CJP-tegoed te parkeren. Bewust dezelfde
 * kleuren als bij de inwisselverzoeken, zodat het herkenbaar blijft.
 */
const parkingLabels: Record<CjpParkingStatus, { label: string; tone: BadgeTone }> = {
  requested: { label: "Aangevraagd", tone: "warning" },
  in_review: { label: "In behandeling", tone: "info" },
  confirmed: { label: "Bevestigd", tone: "success" },
  rejected: { label: "Afgewezen", tone: "danger" },
};

export function CjpParkingStatusBadge({ status }: { status: CjpParkingStatus }) {
  const item = parkingLabels[status] ?? parkingLabels.requested;
  return <Badge tone={item.tone}>{item.label}</Badge>;
}
