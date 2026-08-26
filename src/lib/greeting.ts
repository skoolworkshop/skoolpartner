/**
 * Persoonlijke begroeting en het "moment van de dag" op het dashboard.
 *
 * Alles hieronder is puur rekenwerk op gegevens die al binnen zijn. Er wordt
 * niets verzonnen: is er niets te melden, dan komt er ook geen melding.
 */

export type DagdeelGroet = "Goedemorgen" | "Goedemiddag" | "Goedenavond";

/** Het uur in Nederland, ongeacht waar de server staat. */
export function hourInAmsterdam(now: Date = new Date()): number {
  const value = new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    hour: "numeric",
    hour12: false,
  }).format(now);
  const hour = Number(value);
  return Number.isFinite(hour) ? hour % 24 : 12;
}

export function greetingForTime(now: Date = new Date()): DagdeelGroet {
  const hour = hourInAmsterdam(now);
  if (hour < 12) return "Goedemorgen";
  if (hour < 18) return "Goedemiddag";
  return "Goedenavond";
}

/** Hele dagen tussen vandaag en een datum. Negatief betekent in het verleden. */
export function daysUntil(date: string | null | undefined, now: Date = new Date()): number | null {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date(now.toISOString().slice(0, 10) + "T00:00:00");
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export type Highlight = {
  tone: "feest" | "rustig";
  title: string;
  description?: string;
  href?: string;
  linkLabel?: string;
};

export function buildHighlight(input: {
  newResultTitle?: string | null;
  newResultExpiresAt?: string | null;
  nextBookingName?: string | null;
  nextBookingDate?: string | null;
  availablePoints: number;
  pendingPoints: number;
  lastEarnedAt?: string | null;
  pointsName: string;
  loyaltyEnabled: boolean;
  now?: Date;
}): Highlight | null {
  const now = input.now ?? new Date();

  // 1. Er staan resultaten klaar. Dat is het leukste nieuws en het is ook nog
  //    eens tijdgebonden, dus dat gaat voor alles.
  const resultDagen = input.newResultExpiresAt
    ? Math.ceil((new Date(input.newResultExpiresAt).getTime() - now.getTime()) / 86_400_000)
    : null;

  if (input.newResultTitle && resultDagen !== null && resultDagen > 0) {
    const dagen = resultDagen;
    return {
      tone: "feest",
      title: `De resultaten van ${input.newResultTitle} staan klaar.`,
      description:
        dagen === 1
          ? "Nog vandaag te downloaden. Sla ze op een eigen plek op."
          : `Nog ${dagen} dagen te downloaden. Sla ze op een eigen plek op.`,
      href: "/resultaten",
      linkLabel: "Naar de resultaten",
    };
  }

  // 2. Er komt binnenkort een workshop aan.
  const dagen = daysUntil(input.nextBookingDate, now);
  if (input.nextBookingName && dagen !== null && dagen >= 0 && dagen <= 10) {
    const wanneer =
      dagen === 0 ? "vandaag" : dagen === 1 ? "morgen" : `over ${dagen} dagen`;
    return {
      tone: "feest",
      title: `${input.nextBookingName} is er ${wanneer}.`,
      description: "Alles staat klaar. Laat het ons weten als er iets wijzigt.",
      href: "/boekingen",
      linkLabel: "Bekijk de boeking",
    };
  }

  if (!input.loyaltyEnabled) return null;

  // 3. Er zijn kort geleden punten bijgeschreven.
  if (input.lastEarnedAt && input.availablePoints > 0) {
    const dagenGeleden = Math.round(
      (now.getTime() - new Date(input.lastEarnedAt).getTime()) / 86_400_000
    );
    if (dagenGeleden >= 0 && dagenGeleden <= 21) {
      return {
        tone: "feest",
        title: `Er zijn nieuwe ${input.pointsName} bijgeschreven.`,
        description: "Uw spaartegoed is bijgewerkt na de laatste workshop.",
        href: "/skoolpartner",
        linkLabel: "Bekijk uw tegoed",
      };
    }
  }

  // 4. Er staan punten klaar die nog niet beschikbaar zijn.
  if (input.pendingPoints > 0) {
    return {
      tone: "rustig",
      title: `${input.pendingPoints} ${input.pointsName} staan klaar.`,
      description: "Zodra de bijbehorende factuur is voldaan, komen ze beschikbaar.",
      href: "/skoolpartner",
      linkLabel: "Bekijk uw tegoed",
    };
  }

  return null;
}
