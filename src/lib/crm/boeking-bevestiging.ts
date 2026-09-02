import "server-only";

import {
  GmailClient,
  buildMessageMime,
} from "@/lib/integrations/gmail/client";
import { serverEnv } from "@/lib/env";

/**
 * De bevestiging na een boeking.
 *
 * ============================================================================
 * WAAROM DIT WEL AUTOMATISCH MAG, EN EEN SEQUENCE NIET
 * ============================================================================
 *
 * Dit is transactionele post: iemand heeft zojuist zelf een afspraak gemaakt
 * en verwacht een bevestiging. Dat is iets anders dan een reeks
 * opvolgingsmails, waar een ontvanger niet om heeft gevraagd. De AVG-grond is
 * hier ook een andere: uitvoering van wat er is afgesproken, niet marketing.
 *
 * Daarom staat er in deze mail bewust geen aanbieding, geen aanbeveling en
 * geen link naar iets anders dan de afspraak zelf. Wie dat er later toch bij
 * zet, verandert de aard van het bericht.
 *
 * ============================================================================
 * WAT ER GEBEURT ALS HET NIET LUKT
 * ============================================================================
 *
 * Niets dat de boeking ongedaan maakt. De afspraak staat op dat moment al in
 * het CRM en de school heeft de bevestiging op het scherm gezien. Een mislukte
 * mail wordt teruggemeld zodat het scherm het kan zeggen, en dan weet de
 * school dat hij zelf geen bevestiging in de bus krijgt.
 */

export interface BevestigingGegevens {
  naar: string;
  voornaam: string | null;
  /** Uitgeschreven datum en tijd, in de tijdzone van de link. */
  wanneer: string;
  duurTekst: string;
  linkNaam: string;
  vormTekst: string;
  locatie: string | null;
  /** Wie de afspraak van onze kant heeft. */
  vanOns: string | null;
}

export type BevestigingUitkomst =
  | { verstuurd: true }
  | { verstuurd: false; reden: "geen-koppeling" | "verzenden-mislukt" };

export function bevestigingTekst(gegevens: BevestigingGegevens): string {
  const regels = [
    `Beste ${gegevens.voornaam ?? "relatie"},`,
    "",
    `De afspraak staat genoteerd. Hieronder de gegevens.`,
    "",
    `Wat:      ${gegevens.linkNaam}`,
    `Wanneer:  ${gegevens.wanneer}`,
    `Hoe lang: ${gegevens.duurTekst}`,
    `Waar:     ${gegevens.locatie ? `${gegevens.vormTekst}, ${gegevens.locatie}` : gegevens.vormTekst}`,
  ];

  if (gegevens.vanOns) regels.push(`Met wie:  ${gegevens.vanOns}`);

  regels.push(
    "",
    "Komt het toch niet uit? Antwoord dan op deze mail, dan zoeken we een ander moment.",
    "",
    "Met vriendelijke groet,",
    "Skool Workshop"
  );

  return regels.join("\n");
}

export async function stuurBevestiging(
  gegevens: BevestigingGegevens
): Promise<BevestigingUitkomst> {
  const client = await GmailClient.create();
  if (!client) return { verstuurd: false, reden: "geen-koppeling" };

  try {
    const mime = buildMessageMime({
      from: serverEnv.google.mailbox,
      to: [gegevens.naar],
      subject: `Bevestiging: ${gegevens.linkNaam} op ${gegevens.wanneer}`,
      bodyText: bevestigingTekst(gegevens),
    });

    await client.sendRaw(mime);
    return { verstuurd: true };
  } catch (error) {
    // Bewust geen details naar buiten: in een foutmelding van Gmail kan een
    // token of een volledig adres staan.
    console.error("[boeking-bevestiging] versturen mislukt", error);
    return { verstuurd: false, reden: "verzenden-mislukt" };
  }
}
