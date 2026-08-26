import "server-only";

import { integrationMode, serverEnv } from "@/lib/env";
import { createServiceSupabase } from "@/lib/supabase/server";
import { isWithinPartnerPeriod } from "@/lib/loyalty/period";
import { getSettingsWithServiceRole } from "@/lib/settings";
import { ingestConfirmationEmail } from "@/lib/bookings/ingest";
import {
  markSyncError,
  markSyncStart,
  markSyncSuccess,
  type SyncResult,
} from "@/lib/integrations/sync-state";
import { uniqueStrings } from "@/lib/utils";
import {
  betreftMailbox,
  betreftMailboxReden,
  buildScopedQuery,
  isUitgaand,
} from "./identity";
import {
  attachmentMeta,
  extractBodies,
  GmailClient,
  hasAttachments,
  headerValue,
  parseAddress,
  parseAddressList,
  type GmailMessage,
} from "./client";
import { MOCK_GMAIL_MESSAGES } from "./mock";
import type { Json, ThreadVisibility } from "@/lib/types/database";

export interface NormalizedEmail {
  messageId: string;
  gmailMessageId: string;
  threadId: string;
  from: string | null;
  fromName: string | null;
  to: string[];
  cc: string[];
  subject: string | null;
  sentAt: string;
  snippet: string;
  bodyText: string;
  bodyHtml: string | null;
  labels: string[];
  hasAttachments: boolean;
  attachments: { filename?: string; mimeType: string; size: number }[];
  headers: Record<string, string>;
}

function normalize(message: GmailMessage): NormalizedEmail {
  const from = parseAddress(headerValue(message, "From"));
  const bodies = extractBodies(message);
  const headers: Record<string, string> = {};
  (message.payload?.headers ?? []).forEach((header) => {
    headers[header.name.toLowerCase()] = header.value;
  });

  return {
    messageId: headers["message-id"] ?? message.id,
    gmailMessageId: message.id,
    threadId: message.threadId,
    from: from.email,
    fromName: from.name,
    to: parseAddressList(headerValue(message, "To")),
    cc: parseAddressList(headerValue(message, "Cc")),
    subject: headerValue(message, "Subject"),
    sentAt: message.internalDate
      ? new Date(Number(message.internalDate)).toISOString()
      : new Date().toISOString(),
    snippet: message.snippet ?? "",
    bodyText: bodies.text,
    bodyHtml: bodies.html,
    labels: message.labelIds ?? [],
    hasAttachments: hasAttachments(message),
    attachments: attachmentMeta(message),
    headers,
  };
}

/**
 * Bepaalt of een thread zichtbaar mag zijn voor een klant.
 *
 * DIT IS DE PRIVACYGRENS. Een thread wordt alleen zichtbaar als er een
 * GEVERIFIEERDE contactpersoon van een organisatie aan deelneemt. Een match op
 * alleen het schooldomein is niet genoeg: interne of vertrouwelijke mails naar
 * hetzelfde domein blijven daardoor buiten beeld.
 */
export async function resolveThreadVisibility(participants: string[]): Promise<{
  organizationId: string | null;
  contactId: string | null;
  visibility: ThreadVisibility;
  reason: string;
}> {
  const supabase = createServiceSupabase();
  const emails = uniqueStrings(participants.map((email) => email.toLowerCase()));

  if (emails.length === 0) {
    return {
      organizationId: null,
      contactId: null,
      visibility: "blocked",
      reason: "Geen deelnemers gevonden",
    };
  }

  const { data: contacts } = await supabase
    .from("organization_contacts")
    .select("id, organization_id, email")
    .in("email", emails)
    .eq("is_verified", true);

  if (!contacts || contacts.length === 0) {
    return {
      organizationId: null,
      contactId: null,
      visibility: "blocked",
      reason: "Geen geverifieerde contactpersoon in deze thread",
    };
  }

  const organizations = uniqueStrings(contacts.map((c) => c.organization_id));
  if (organizations.length > 1) {
    return {
      organizationId: null,
      contactId: null,
      visibility: "needs_review",
      reason: "Contactpersonen van meerdere organisaties in dezelfde thread",
    };
  }

  return {
    organizationId: organizations[0],
    contactId: contacts[0].id,
    visibility: "auto_allowed",
    reason: `Geverifieerde contactpersoon ${contacts[0].email}`,
  };
}

/**
 * Slaat één e-mail op als bericht in het berichtencentrum.
 *
 * oauthAccount is het Google-account waarmee is gekoppeld. Dat is bij Skool
 * Workshop een ander adres dan het boekingenadres, en wij hebben het nodig om
 * te bepalen of een bericht in- of uitgaand is.
 */
export async function storeEmail(
  email: NormalizedEmail,
  options: { oauthAccount?: string | null } = {}
): Promise<{ stored: boolean; reason?: string }> {
  const supabase = createServiceSupabase();

  const { data: existing } = await supabase
    .from("messages")
    .select("id")
    .eq("gmail_message_id", email.gmailMessageId)
    .maybeSingle();
  if (existing) return { stored: false, reason: "Al aanwezig" };

  /*
    SLOT 1: hoort dit bericht bij het boekingenadres?

    Wij koppelen met een persoonlijke Gmail-mailbox, en daar zit veel in wat
    niets met klanten te maken heeft: privémail, sollicitaties, overleg met
    docenten, post van andere klanten. Alleen wat aantoonbaar via
    boekingen@skoolworkshop.nl loopt, komt in aanmerking.

    Wij kijken daarvoor naar alle adresvelden die ertoe kunnen doen, niet
    alleen naar To. Bij een alias staat het adres soms alleen in Delivered-To,
    en bij doorgestuurde post soms alleen in Reply-To.

    Slot 2 is de geverifieerde contactpersoon hieronder. Een bericht moet door
    beide sloten heen.
  */
  const mailbox = serverEnv.google.mailbox;
  if (!betreftMailbox(email.headers, mailbox)) {
    return { stored: false, reason: betreftMailboxReden(email.headers, mailbox) };
  }

  const participants = uniqueStrings([email.from, ...email.to, ...email.cc]);
  const visibility = await resolveThreadVisibility(participants);

  // Geen geverifieerde contactpersoon: niets opslaan. Dat is dataminimalisatie
  // én de sterkste garantie dat interne mail nooit in SkoolPartner belandt.
  if (visibility.visibility === "blocked") {
    return { stored: false, reason: visibility.reason };
  }

  // Mailhistorie van vóór de deelname hoort niet bij SkoolPartner. Wij slaan
  // die niet op, ook niet verborgen: wat er niet is, kan ook niet uitlekken.
  if (visibility.organizationId) {
    const { data: account } = await supabase
      .from("loyalty_accounts")
      .select("enrolled_at")
      .eq("organization_id", visibility.organizationId)
      .maybeSingle();

    if (account?.enrolled_at && !isWithinPartnerPeriod(email.sentAt, account.enrolled_at)) {
      return { stored: false, reason: "Bericht dateert van vóór deelname aan SkoolPartner" };
    }
  }

  const { data: thread } = await supabase
    .from("message_threads")
    .upsert(
      {
        gmail_thread_id: email.threadId,
        organization_id: visibility.organizationId,
        subject: email.subject,
        participant_emails: participants,
        visibility: visibility.visibility,
        visibility_reason: visibility.reason,
        matched_contact_id: visibility.contactId,
      },
      { onConflict: "gmail_thread_id" }
    )
    .select("id, organization_id")
    .single();

  if (!thread) return { stored: false, reason: "Thread kon niet worden opgeslagen" };

  // Post van het boekingenadres én van het gekoppelde Google-account telt als
  // uitgaand. Anders zou een bericht dat Clinten per ongeluk vanaf zijn eigen
  // adres stuurt bij de klant als binnenkomend bericht verschijnen.
  const direction = isUitgaand(email.from, mailbox, options.oauthAccount ?? null)
    ? "outbound"
    : "inbound";

  const { error } = await supabase.from("messages").insert({
    thread_id: thread.id,
    gmail_message_id: email.gmailMessageId,
    direction,
    from_email: email.from,
    from_name: email.fromName,
    to_emails: email.to,
    cc_emails: email.cc,
    subject: email.subject,
    sent_at: email.sentAt,
    snippet: email.snippet.slice(0, 300),
    body_text: email.bodyText.slice(0, 50000),
    body_html: null,
    has_attachments: email.hasAttachments,
    attachment_meta: email.attachments as unknown as Json,
  });

  if (error && error.code !== "23505") {
    throw new Error(`Bericht kon niet worden opgeslagen: ${error.message}`);
  }

  return { stored: true };
}

/** Volledige Gmail-synchronisatie. Draait als cron job. */
export async function syncGmail(): Promise<SyncResult> {
  const mode = integrationMode("gmail");
  await markSyncStart("gmail");

  try {
    const settings = await getSettingsWithServiceRole();
    let emails: NormalizedEmail[] = [];

    if (mode === "mock") {
      emails = MOCK_GMAIL_MESSAGES.map((message) => ({
        messageId: message.messageId,
        gmailMessageId: message.messageId,
        threadId: message.threadId ?? message.messageId,
        from: message.from,
        fromName: message.fromName ?? null,
        to: message.to,
        cc: message.cc ?? [],
        subject: message.subject,
        sentAt: message.receivedAt ?? new Date().toISOString(),
        snippet: message.bodyText.slice(0, 200),
        bodyText: message.bodyText,
        bodyHtml: null,
        labels: message.labels ?? [],
        hasAttachments: false,
        attachments: [],
        // Ook in testmodus echte headers opbouwen, anders zou de controle op
        // het boekingenadres hieronder alles wegfilteren en zie je in de
        // demo-omgeving een leeg berichtencentrum.
        headers: {
          from: message.from ?? "",
          to: message.to.join(", "),
          cc: (message.cc ?? []).join(", "),
        },
      }));
    } else {
      const client = await GmailClient.create();
      if (!client) {
        throw new Error(
          "Gmail is nog niet geautoriseerd. Doorloop eerst Admin > Integraties > Gmail koppelen."
        );
      }
      // De zoekopdracht wordt beperkt tot het boekingenadres. Wat niet bij
      // boekingen hoort, verlaat Google dus niet eens.
      const query = buildScopedQuery(serverEnv.google.mailbox, settings.gmail_sync_query);
      const list = await client.listMessages(query);
      const ids = (list.messages ?? []).map((m) => m.id);
      for (const id of ids) {
        const message = await client.getMessage(id);
        emails.push(normalize(message));
      }
    }

    // Eén keer opzoeken met welk Google-account is gekoppeld, niet per bericht.
    const { data: koppeling } = await createServiceSupabase()
      .from("integration_credentials")
      .select("account_email")
      .eq("integration", "gmail")
      .eq("label", "default")
      .maybeSingle();
    const oauthAccount = koppeling?.account_email ?? null;

    let storedCount = 0;
    let bookingCount = 0;

    for (const email of emails) {
      const result = await storeEmail(email, { oauthAccount });
      if (result.stored) storedCount += 1;

      // Bevestigingsmails apart verwerken naar boekingen.
      const looksRelevant =
        email.labels.some(
          (label) => label.toLowerCase() === settings.booking_confirmation_label.toLowerCase()
        ) || /bevestiging/i.test(email.subject ?? "");

      if (looksRelevant) {
        const outcome = await ingestConfirmationEmail({
          messageId: email.gmailMessageId,
          threadId: email.threadId,
          from: email.from,
          fromName: email.fromName,
          to: email.to,
          cc: email.cc,
          subject: email.subject,
          bodyText: email.bodyText,
          labels: email.labels,
          receivedAt: email.sentAt,
          headers: email.headers,
        });
        if (outcome.status === "created" || outcome.status === "needs_review") bookingCount += 1;
      }
    }

    await markSyncSuccess("gmail", {
      itemsProcessed: emails.length,
      metadata: { mode, stored: storedCount, bookings: bookingCount },
    });

    return {
      integration: "gmail",
      ok: true,
      mode,
      itemsProcessed: emails.length,
      details: { stored: storedCount, bookings: bookingCount },
    };
  } catch (error) {
    await markSyncError("gmail", error);
    return {
      integration: "gmail",
      ok: false,
      mode,
      itemsProcessed: 0,
      message: error instanceof Error ? error.message : "Onbekende fout",
    };
  }
}
