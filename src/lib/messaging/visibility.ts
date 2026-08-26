import type { BadgeTone } from "@/components/ui/badge";
import type { ThreadVisibility } from "@/lib/types/database";

/**
 * Eén plek die bepaalt wat een zichtbaarheid betekent.
 *
 * De klant ziet alleen gesprekken die op auto_allowed of manual_allowed staan.
 * Dat is precies wat getMessageThreads() in het portaal filtert. Door dat hier
 * vast te leggen, kan een label in de beheeromgeving nooit iets anders beweren
 * dan wat de klant werkelijk ziet.
 */
export const VISIBLE_TO_CUSTOMER: ThreadVisibility[] = ["auto_allowed", "manual_allowed"];

export function isVisibleToCustomer(visibility: ThreadVisibility): boolean {
  return VISIBLE_TO_CUSTOMER.includes(visibility);
}

const labels: Record<ThreadVisibility, { short: string; long: string; tone: BadgeTone }> = {
  auto_allowed: {
    short: "Zichtbaar",
    long: "Zichtbaar voor de klant, automatisch herkend",
    tone: "success",
  },
  manual_allowed: {
    short: "Zichtbaar",
    long: "Zichtbaar voor de klant, handmatig vrijgegeven",
    tone: "success",
  },
  needs_review: {
    short: "Controle",
    long: "Controle nodig, nog niet zichtbaar voor de klant",
    tone: "warning",
  },
  blocked: {
    short: "Verborgen",
    long: "Niet zichtbaar voor de klant",
    tone: "neutral",
  },
};

export function visibilityLabel(visibility: ThreadVisibility) {
  return labels[visibility] ?? labels.needs_review;
}
