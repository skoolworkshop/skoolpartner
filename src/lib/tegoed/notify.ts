import "server-only";

import { buildMessageMime, GmailClient } from "@/lib/integrations/gmail/client";
import { integrationMode, serverEnv } from "@/lib/env";
import { formatCentsPlain } from "@/lib/tegoed/regels";
import { getSettingsWithServiceRole } from "@/lib/settings";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { CjpParkingRequestRow } from "@/lib/types/database";

/**
 * Meldt een nieuwe CJP-aanvraag intern bij Skool Workshop.
 *
 * Dit is een bericht van ons aan onszelf. Er gaat niets naar de klant en niets
 * naar een derde. Het adres komt uit de instelling cjp_notify_email, en als
 * die leeg is uit support_email. Er staat dus nergens een persoonlijk
 * e-mailadres in de code.
 *
 * De melding mag de aanvraag nooit tegenhouden: als er geen Gmail gekoppeld is
 * of het versturen mislukt, blijft de aanvraag gewoon staan en blijft
 * notified_at leeg. In het adminscherm is dan te zien dat er nog geen melding
 * uit is gegaan.
 */
export async function notifyNewParkingRequest(
  request: CjpParkingRequestRow,
  organizationName: string
): Promise<{ sent: boolean; reason?: string }> {
  const supabase = createServiceSupabase();

  try {
    const settings = await getSettingsWithServiceRole();
    const ontvanger = (settings.cjp_notify_email || settings.support_email || "").trim();

    if (!ontvanger) {
      return { sent: false, reason: "Er is geen adres ingesteld om de melding naartoe te sturen." };
    }

    const onderwerp = `Nieuwe aanvraag CJP-tegoed: ${organizationName} (${formatCentsPlain(request.amount_cents)})`;
    const regels = [
      `${organizationName} wil CJP-tegoed parkeren bij Skool Workshop.`,
      "",
      `Bedrag              € ${formatCentsPlain(request.amount_cents)}`,
      `CJP-schoolnummer    ${request.cjp_school_number}`,
      `School              ${request.school_name}`,
      `Budgethouder        ${request.holder_name}`,
      `E-mail              ${request.holder_email}`,
      ...(request.holder_phone ? [`Telefoon            ${request.holder_phone}`] : []),
      ...(request.requested_by_email ? [`Ingediend door      ${request.requested_by_email}`] : []),
      "",
      "De aanvraag staat op Aangevraagd. Er is nog geen tegoed bijgeschreven en er",
      "zijn nog geen bonuspunten toegekend. Dat gebeurt pas zodra jij hem in",
      "SkoolPartner bevestigt.",
      "",
      "Bekijken: Admin > CJP-tegoed",
    ];

    if (integrationMode("gmail") === "mock") {
      console.info("[cjp] melding (testmodus) naar", ontvanger, "-", onderwerp);
      await markeerGemeld(request.id);
      return { sent: true };
    }

    const client = await GmailClient.create();
    if (!client) {
      return { sent: false, reason: "Gmail is nog niet gekoppeld in Admin > Integraties." };
    }

    const mailbox = serverEnv.google.mailbox;
    await client.sendRaw(
      buildMessageMime({
        from: `SkoolPartner <${mailbox}>`,
        to: [ontvanger],
        subject: onderwerp,
        bodyText: regels.join("\n"),
      })
    );

    await markeerGemeld(request.id);
    return { sent: true };
  } catch (error) {
    // Nooit de foutmelding zelf doorgeven: daar kunnen tokens of adressen in staan.
    console.error("[cjp] melding kon niet worden verstuurd", error);
    return { sent: false, reason: "De interne melding kon niet worden verstuurd." };
  }

  async function markeerGemeld(id: string) {
    await supabase
      .from("cjp_parking_requests")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", id);
  }
}
