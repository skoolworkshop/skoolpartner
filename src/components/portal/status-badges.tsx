import { Badge, type BadgeTone } from "@/components/ui/badge";
import type {
  BookingStatus,
  InvoiceState,
  LoyaltyTransactionStatus,
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
