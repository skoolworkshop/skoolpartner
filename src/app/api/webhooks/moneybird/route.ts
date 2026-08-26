import { NextResponse, type NextRequest } from "next/server";

import { safeErrorResponse } from "@/lib/api/guards";
import { safeEqual, verifyMoneybirdSignature } from "@/lib/crypto";
import { serverEnv } from "@/lib/env";
import { createServiceSupabase } from "@/lib/supabase/server";
import { MoneybirdClient } from "@/lib/integrations/moneybird/client";
import { upsertInvoice } from "@/lib/integrations/moneybird/sync";
import type { Json } from "@/lib/types/database";

export const dynamic = "force-dynamic";

interface MoneybirdWebhookPayload {
  administration_id?: string;
  webhook_id?: string;
  webhook_token?: string;
  entity_type?: string;
  entity_id?: string;
  state?: string;
  action?: string;
  entity?: Record<string, unknown>;
}

/**
 * Ontvangt Moneybird-webhooks.
 *
 * Beveiliging, twee lagen:
 *
 *   1. De webhook_token uit de payload moet overeenkomen met
 *      MONEYBIRD_WEBHOOK_TOKEN. Die token krijg je van Moneybird bij het
 *      aanmaken van de webhook.
 *   2. Staat MONEYBIRD_WEBHOOK_SECRET ingevuld, dan controleren wij daarbovenop
 *      de Moneybird-Signature. Dat is de sterkere controle, want die bewijst
 *      ook dat de inhoud onderweg niet is aangepast. Ontbreekt het secret, dan
 *      blijft laag 1 gewoon werken.
 *
 * Idempotency: elk event wordt één keer verwerkt, afgedwongen met een unieke
 * index op (provider, external_event_id).
 */
export async function POST(request: NextRequest) {
  try {
    // Byte voor byte zoals hij binnenkwam. Opnieuw omzetten naar JSON zou de
    // handtekening kapotmaken.
    const rawBody = await request.text();
    const payload = JSON.parse(rawBody) as MoneybirdWebhookPayload;

    if (!serverEnv.moneybird.webhookToken) {
      return NextResponse.json(
        { ok: false, error: "Webhook is nog niet geconfigureerd" },
        { status: 503 }
      );
    }
    if (!safeEqual(payload.webhook_token ?? null, serverEnv.moneybird.webhookToken)) {
      return NextResponse.json({ ok: false, error: "Niet geautoriseerd" }, { status: 401 });
    }

    if (serverEnv.moneybird.webhookSecret) {
      const geldig = verifyMoneybirdSignature({
        header: request.headers.get("moneybird-signature"),
        rawBody,
        secret: serverEnv.moneybird.webhookSecret,
      });
      if (!geldig) {
        return NextResponse.json(
          { ok: false, error: "Handtekening klopt niet" },
          { status: 401 }
        );
      }
    }

    const idempotencyKey =
      request.headers.get("idempotency-key") ??
      `${payload.entity_type ?? "unknown"}:${payload.entity_id ?? "unknown"}:${payload.action ?? "unknown"}:${payload.state ?? ""}`;

    const supabase = createServiceSupabase();

    const { error: insertError } = await supabase.from("webhook_events").insert({
      provider: "moneybird",
      external_event_id: idempotencyKey,
      event_type: `${payload.entity_type ?? ""}.${payload.action ?? ""}`,
      payload: payload as unknown as Json,
      status: "received",
    });

    // Al eerder ontvangen: netjes bevestigen zonder opnieuw te verwerken.
    if (insertError?.code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    if (insertError) throw new Error(insertError.message);

    if (payload.entity_type !== "SalesInvoice" || !payload.entity_id) {
      await supabase
        .from("webhook_events")
        .update({ status: "ignored", processed_at: new Date().toISOString() })
        .eq("provider", "moneybird")
        .eq("external_event_id", idempotencyKey);
      return NextResponse.json({ ok: true, ignored: true });
    }

    const client = MoneybirdClient.fromEnv();
    if (!client) throw new Error("Moneybird-credentials ontbreken");

    const invoice = await client.getSalesInvoice(payload.entity_id);
    const result = await upsertInvoice(invoice);

    await supabase
      .from("webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("provider", "moneybird")
      .eq("external_event_id", idempotencyKey);

    return NextResponse.json({ ok: true, released: result.releasedTransactions });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
