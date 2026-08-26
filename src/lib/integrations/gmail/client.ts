import "server-only";

import { OAuth2Client } from "google-auth-library";

import { serverEnv } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { createServiceSupabase } from "@/lib/supabase/server";
import { withRetry } from "@/lib/integrations/sync-state";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Minimale scopes: lezen en versturen. Meer is niet nodig. */
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailMessagePart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
}

export class GmailError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GmailError";
    this.status = status;
  }
}

export function createOAuthClient(): OAuth2Client | null {
  const { clientId, clientSecret, redirectUri } = serverEnv.google;
  if (!clientId || !clientSecret) return null;
  return new OAuth2Client({ clientId, clientSecret, redirectUri: redirectUri ?? undefined });
}

/** Bewaart de refresh token versleuteld. De token verlaat nooit de server. */
export async function storeGmailCredentials(params: {
  refreshToken: string;
  accountEmail: string | null;
  scopes: string[];
}) {
  const supabase = createServiceSupabase();
  await supabase.from("integration_credentials").upsert(
    {
      integration: "gmail",
      label: "default",
      account_email: params.accountEmail,
      encrypted_payload: encryptSecret(JSON.stringify({ refresh_token: params.refreshToken })),
      scopes: params.scopes,
    },
    { onConflict: "integration,label" }
  );
}

async function loadRefreshToken(): Promise<string | null> {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("integration_credentials")
    .select("encrypted_payload")
    .eq("integration", "gmail")
    .eq("label", "default")
    .maybeSingle();

  if (!data?.encrypted_payload) return null;
  try {
    const payload = JSON.parse(decryptSecret(data.encrypted_payload)) as { refresh_token?: string };
    return payload.refresh_token ?? null;
  } catch {
    return null;
  }
}

export class GmailClient {
  private accessToken: string;

  private constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  static async create(): Promise<GmailClient | null> {
    const oauth = createOAuthClient();
    if (!oauth) return null;

    const refreshToken = await loadRefreshToken();
    if (!refreshToken) return null;

    oauth.setCredentials({ refresh_token: refreshToken });
    const { token } = await oauth.getAccessToken();
    if (!token) return null;

    return new GmailClient(token);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    return withRetry(async () => {
      const response = await fetch(`${GMAIL_API}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
        cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new GmailError(`Gmail ${response.status}: ${body.slice(0, 200)}`, response.status);
      }
      return (await response.json()) as T;
    });
  }

  /**
   * Het profiel van de gekoppelde mailbox. Alleen lezen, en meteen het bewijs
   * dat de refresh token nog werkt: zonder geldige token komen wij hier niet.
   */
  async getProfile() {
    return this.request<{
      emailAddress: string;
      messagesTotal: number;
      threadsTotal: number;
      historyId: string;
    }>("/profile");
  }

  async listLabels() {
    return this.request<{ labels: { id: string; name: string }[] }>("/labels");
  }

  async listMessages(query: string, pageToken?: string) {
    const search = new URLSearchParams({ q: query, maxResults: "50" });
    if (pageToken) search.set("pageToken", pageToken);
    return this.request<{
      messages?: { id: string; threadId: string }[];
      nextPageToken?: string;
      resultSizeEstimate?: number;
    }>(`/messages?${search.toString()}`);
  }

  async getMessage(id: string) {
    return this.request<GmailMessage>(`/messages/${id}?format=full`);
  }

  async getThread(id: string) {
    return this.request<{ id: string; messages: GmailMessage[] }>(`/threads/${id}?format=full`);
  }

  /** Verstuurt een bericht als antwoord binnen een bestaande thread. */
  async sendRaw(rawBase64Url: string, threadId?: string) {
    return this.request<{ id: string; threadId: string }>("/messages/send", {
      method: "POST",
      body: JSON.stringify({ raw: rawBase64Url, ...(threadId ? { threadId } : {}) }),
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Hulpfuncties voor het uitpakken van Gmail-berichten                         */
/* -------------------------------------------------------------------------- */

export function headerValue(message: GmailMessage, name: string): string | null {
  const headers = message.payload?.headers ?? [];
  const found = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return found?.value ?? null;
}

export function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

export function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function collectParts(part: GmailMessagePart | undefined, acc: GmailMessagePart[] = []) {
  if (!part) return acc;
  acc.push(part);
  (part.parts ?? []).forEach((child) => collectParts(child, acc));
  return acc;
}

export function extractBodies(message: GmailMessage): { text: string; html: string | null } {
  const parts = collectParts(message.payload);
  const textPart = parts.find((p) => p.mimeType === "text/plain" && p.body?.data);
  const htmlPart = parts.find((p) => p.mimeType === "text/html" && p.body?.data);

  const text = textPart?.body?.data ? decodeBase64Url(textPart.body.data) : "";
  const html = htmlPart?.body?.data ? decodeBase64Url(htmlPart.body.data) : null;

  if (!text && html) {
    return { text: stripHtml(html), html };
  }
  return { text, html };
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function hasAttachments(message: GmailMessage): boolean {
  return collectParts(message.payload).some(
    (part) => Boolean(part.filename && part.filename.length > 0 && part.body?.attachmentId)
  );
}

export function attachmentMeta(message: GmailMessage) {
  return collectParts(message.payload)
    .filter((part) => part.filename && part.filename.length > 0)
    .map((part) => ({
      filename: part.filename,
      mimeType: part.mimeType ?? "application/octet-stream",
      size: part.body?.size ?? 0,
    }));
}

/** "Sanne <s@school.nl>" -> { name: "Sanne", email: "s@school.nl" } */
export function parseAddress(value: string | null): { name: string | null; email: string | null } {
  if (!value) return { name: null, email: null };
  const match = value.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (match) {
    return { name: match[1].trim() || null, email: match[2].trim().toLowerCase() };
  }
  const plain = value.trim().toLowerCase();
  return { name: null, email: plain.includes("@") ? plain : null };
}

export function parseAddressList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => parseAddress(entry).email)
    .filter((email): email is string => Boolean(email));
}

/** Bouwt een RFC 2822-bericht dat correct in de bestaande thread blijft. */
export function buildReplyMime(params: {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  inReplyTo?: string | null;
  references?: string | null;
  bodyText: string;
}): string {
  const subject = params.subject.toLowerCase().startsWith("re:")
    ? params.subject
    : `Re: ${params.subject}`;

  const lines = [
    `From: ${params.from}`,
    `To: ${params.to.join(", ")}`,
    ...(params.cc && params.cc.length > 0 ? [`Cc: ${params.cc.join(", ")}`] : []),
    `Subject: =?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`,
    ...(params.inReplyTo ? [`In-Reply-To: ${params.inReplyTo}`] : []),
    ...(params.references ? [`References: ${params.references}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(params.bodyText, "utf8").toString("base64"),
  ];

  return encodeBase64Url(lines.join("\r\n"));
}

/** Bouwt een gewoon nieuw bericht, zonder "Re:" voor het onderwerp. */
export function buildMessageMime(params: {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  bodyText: string;
}): string {
  const lines = [
    `From: ${params.from}`,
    `To: ${params.to.join(", ")}`,
    ...(params.cc && params.cc.length > 0 ? [`Cc: ${params.cc.join(", ")}`] : []),
    `Subject: =?UTF-8?B?${Buffer.from(params.subject, "utf8").toString("base64")}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(params.bodyText, "utf8").toString("base64"),
  ];

  return encodeBase64Url(lines.join("\r\n"));
}
