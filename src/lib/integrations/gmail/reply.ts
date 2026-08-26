import "server-only";

import { integrationMode, serverEnv } from "@/lib/env";
import { createServiceSupabase } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/audit";
import { buildReplyMime, GmailClient } from "./client";
import { checkSendAs } from "./identity";
import { uniqueStrings } from "@/lib/utils";

export interface ReplyResult {
  ok: boolean;
  message?: string;
  outboundId?: string;
}

/**
 * Verstuurt een antwoord van een klant vanuit SkoolPartner.
 *
 * Het bericht gaat technisch altijd via boekingen@skoolworkshop.nl en blijft
 * onderdeel van dezelfde Gmail-thread. De klant krijgt nooit rechtstreeks
 * toegang tot Gmail.
 *
 * Autorisatie gebeurt hier expliciet: de thread moet zichtbaar zijn én bij een
 * organisatie horen waar de gebruiker actief lid van is.
 */
export async function sendPortalReply(params: {
  threadId: string;
  userId: string;
  userEmail: string;
  organizationId: string;
  bodyText: string;
  idempotencyKey: string;
}): Promise<ReplyResult> {
  const supabase = createServiceSupabase();
  const body = params.bodyText.trim();

  if (body.length < 2) return { ok: false, message: "Schrijf eerst een bericht." };
  if (body.length > 10000) return { ok: false, message: "Dit bericht is te lang." };

  const { data: membership } = await supabase
    .from("organization_members")
    .select("id")
    .eq("organization_id", params.organizationId)
    .eq("user_id", params.userId)
    .eq("status", "active")
    .maybeSingle();

  if (!membership) return { ok: false, message: "Geen toegang tot deze organisatie." };

  const { data: thread } = await supabase
    .from("message_threads")
    .select("*")
    .eq("id", params.threadId)
    .eq("organization_id", params.organizationId)
    .in("visibility", ["auto_allowed", "manual_allowed"])
    .maybeSingle();

  if (!thread) return { ok: false, message: "Dit gesprek is niet beschikbaar." };

  // Idempotency: dubbel verzenden bij een dubbele klik voorkomen.
  const { data: existing } = await supabase
    .from("outbound_messages")
    .select("id, status")
    .eq("idempotency_key", params.idempotencyKey)
    .maybeSingle();

  if (existing) {
    return { ok: true, outboundId: existing.id, message: "Bericht was al verstuurd." };
  }

  const { data: lastMessage } = await supabase
    .from("messages")
    .select("gmail_message_id, from_email, to_emails, cc_emails, subject")
    .eq("thread_id", thread.id)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: outbound, error: outboundError } = await supabase
    .from("outbound_messages")
    .insert({
      thread_id: thread.id,
      organization_id: params.organizationId,
      author_id: params.userId,
      body_text: body,
      in_reply_to: lastMessage?.gmail_message_id ?? null,
      status: "queued",
      idempotency_key: params.idempotencyKey,
    })
    .select("id")
    .single();

  if (outboundError || !outbound) {
    return { ok: false, message: "Bericht kon niet in de wachtrij worden gezet." };
  }

  const mailbox = serverEnv.google.mailbox;
  const recipients = uniqueStrings(
    (thread.participant_emails ?? []).filter(
      (email: string) => email.toLowerCase() !== mailbox.toLowerCase()
    )
  );

  // De klant schrijft naar Skool Workshop; het bericht komt dus binnen in de
  // centrale mailbox en blijft in dezelfde thread staan.
  const signature = `\n\n—\nVerstuurd via SkoolPartner door ${params.userEmail}`;
  const fullBody = `${body}${signature}`;

  if (integrationMode("gmail") === "mock") {
    const fakeId = `mock-portal-${outbound.id}`;
    await supabase
      .from("outbound_messages")
      .update({ status: "sent", gmail_message_id: fakeId, attempts: 1 })
      .eq("id", outbound.id);

    await supabase.from("messages").insert({
      thread_id: thread.id,
      gmail_message_id: fakeId,
      direction: "inbound",
      from_email: params.userEmail,
      to_emails: [mailbox],
      subject: thread.subject,
      sent_at: new Date().toISOString(),
      snippet: body.slice(0, 300),
      body_text: fullBody,
      sent_from_portal: true,
      sent_by: params.userId,
    });

    return { ok: true, outboundId: outbound.id, message: "Verstuurd (testmodus)." };
  }

  try {
    const client = await GmailClient.create();
    if (!client) throw new Error("Gmail is nog niet geautoriseerd");

    /*
      Mogen wij namens het boekingenadres verzenden?

      Dit moet vóór het versturen worden gecontroleerd, niet erna. Gmail
      weigert een bericht met een onbekend From-adres namelijk niet: het
      vervangt de afzender stilletjes door het ingelogde account. Bij Skool
      Workshop zou een klant dan opeens post krijgen van het persoonlijke adres
      van Clinten in plaats van van boekingen@skoolworkshop.nl.

      Liever niet versturen dan versturen vanaf het verkeerde adres. De
      beheerder ziet in Admin > Integraties precies wat er dan moet gebeuren.
    */
    const sendAs = checkSendAs(await client.listSendAs(), mailbox);
    if (!sendAs.ready) {
      await supabase
        .from("outbound_messages")
        .update({
          status: "failed",
          last_error: `Verzenden als ${mailbox} is niet ingesteld: ${sendAs.message}`.slice(0, 500),
          attempts: 1,
        })
        .eq("id", outbound.id);

      return {
        ok: false,
        message:
          "Uw bericht is niet verstuurd. De mailkoppeling staat nog niet helemaal goed; wij hebben er bericht van gekregen en pakken het op.",
      };
    }

    const raw = buildReplyMime({
      from: `SkoolPartner <${mailbox}>`,
      to: recipients.length > 0 ? recipients : [mailbox],
      subject: thread.subject ?? "Bericht via SkoolPartner",
      inReplyTo: lastMessage?.gmail_message_id ?? null,
      references: lastMessage?.gmail_message_id ?? null,
      bodyText: fullBody,
    });

    const sent = await client.sendRaw(raw, thread.gmail_thread_id);

    await supabase
      .from("outbound_messages")
      .update({ status: "sent", gmail_message_id: sent.id, attempts: 1 })
      .eq("id", outbound.id);

    await supabase.from("messages").insert({
      thread_id: thread.id,
      gmail_message_id: sent.id,
      direction: "outbound",
      from_email: mailbox,
      to_emails: recipients,
      subject: thread.subject,
      sent_at: new Date().toISOString(),
      snippet: body.slice(0, 300),
      body_text: fullBody,
      sent_from_portal: true,
      sent_by: params.userId,
    });

    await recordAudit({
      actorId: params.userId,
      actorEmail: params.userEmail,
      actorRole: "klant",
      action: "message.replied",
      entityType: "message_thread",
      entityId: thread.id,
      organizationId: params.organizationId,
    });

    return { ok: true, outboundId: outbound.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Onbekende fout";
    await supabase
      .from("outbound_messages")
      .update({ status: "failed", last_error: message.slice(0, 500), attempts: 1 })
      .eq("id", outbound.id);
    return { ok: false, message: "Versturen is niet gelukt. Probeer het later opnieuw." };
  }
}
