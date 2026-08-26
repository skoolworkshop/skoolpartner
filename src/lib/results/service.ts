import "server-only";

import { integrationMode, serverEnv } from "@/lib/env";
import { recordAudit } from "@/lib/audit";
import { buildMessageMime, GmailClient } from "@/lib/integrations/gmail/client";
import { getSettingsWithServiceRole } from "@/lib/settings";
import { createServiceSupabase } from "@/lib/supabase/server";
import type {
  WorkshopResultFileRow,
  WorkshopResultRow,
} from "@/lib/types/database";
import { RESULTS_BUCKET } from "./constants";

export { RESULTS_BUCKET } from "./constants";

/** Hoe lang een downloadlink geldig is. Kort, want hij wordt per klik gemaakt. */
const DOWNLOAD_LINK_SECONDS = 300;

export interface ResultWithFiles extends WorkshopResultRow {
  files: WorkshopResultFileRow[];
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/**
 * Maakt een bestandsnaam veilig voor gebruik als opslagpad. Supabase Storage
 * accepteert lang niet alles, en een klantnaam in een pad wil je sowieso niet.
 */
export function safeFileName(name: string): string {
  const trimmed = name.trim().slice(-160);
  const cleaned = trimmed
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned.length > 0 ? cleaned : "bestand";
}

/* -------------------------------------------------------------------------- */
/* Lezen                                                                       */
/* -------------------------------------------------------------------------- */

/** Alle sets van een organisatie die de klant mag zien. */
export async function getResultsForOrganization(
  organizationId: string
): Promise<ResultWithFiles[]> {
  const supabase = createServiceSupabase();

  const { data: results } = await supabase
    .from("workshop_results")
    .select("*")
    .eq("organization_id", organizationId)
    .in("status", ["published", "expired"])
    .order("published_at", { ascending: false });

  if (!results || results.length === 0) return [];

  const { data: files } = await supabase
    .from("workshop_result_files")
    .select("*")
    .in(
      "result_id",
      results.map((r) => r.id)
    )
    .is("removed_at", null)
    .order("position", { ascending: true });

  return results.map((result) => ({
    ...result,
    files: (files ?? []).filter((f) => f.result_id === result.id),
  }));
}

/** Voor de beheeromgeving: alles, inclusief concepten. */
export async function getAllResults(limit = 100): Promise<ResultWithFiles[]> {
  const supabase = createServiceSupabase();

  const { data: results } = await supabase
    .from("workshop_results")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!results || results.length === 0) return [];

  const { data: files } = await supabase
    .from("workshop_result_files")
    .select("*")
    .in(
      "result_id",
      results.map((r) => r.id)
    )
    .order("position", { ascending: true });

  return results.map((result) => ({
    ...result,
    files: (files ?? []).filter((f) => f.result_id === result.id),
  }));
}

export async function getResult(id: string): Promise<ResultWithFiles | null> {
  const supabase = createServiceSupabase();

  const { data: result } = await supabase
    .from("workshop_results")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!result) return null;

  const { data: files } = await supabase
    .from("workshop_result_files")
    .select("*")
    .eq("result_id", id)
    .order("position", { ascending: true });

  return { ...result, files: files ?? [] };
}

/* -------------------------------------------------------------------------- */
/* Uploaden                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Geeft een tijdelijke link waarmee de browser rechtstreeks naar Supabase
 * Storage kan uploaden. Het bestand gaat dus nooit door onze eigen server.
 * De aanroeper moet vooraf hebben gecontroleerd dat dit een beheerder is.
 */
export async function createUploadTarget(params: {
  resultId: string;
  fileName: string;
}): Promise<{ path: string; token: string } | { error: string }> {
  const supabase = createServiceSupabase();

  const result = await getResult(params.resultId);
  if (!result) return { error: "Deze set resultaten bestaat niet." };
  if (result.status !== "concept") {
    return { error: "Er kunnen alleen bestanden bij een set die nog niet is gepubliceerd." };
  }

  const path = `${result.organization_id}/${result.id}/${Date.now()}-${safeFileName(
    params.fileName
  )}`;

  const { data, error } = await supabase.storage
    .from(RESULTS_BUCKET)
    .createSignedUploadUrl(path, { upsert: false });

  if (error || !data) {
    return { error: error?.message ?? "De uploadlink kon niet worden gemaakt." };
  }

  return { path: data.path, token: data.token };
}

/** Legt vast dat een geüpload bestand bij een set hoort. */
export async function registerUploadedFile(params: {
  resultId: string;
  path: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  userId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = createServiceSupabase();

  const { count } = await supabase
    .from("workshop_result_files")
    .select("id", { count: "exact", head: true })
    .eq("result_id", params.resultId);

  const { error } = await supabase.from("workshop_result_files").insert({
    result_id: params.resultId,
    kind: "file",
    storage_path: params.path,
    file_name: params.fileName,
    mime_type: params.mimeType,
    size_bytes: params.sizeBytes,
    position: count ?? 0,
    created_by: params.userId,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Voegt een externe link toe, bijvoorbeeld WeTransfer voor een grote video. */
export async function addExternalLink(params: {
  resultId: string;
  url: string;
  label: string;
  userId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const url = params.url.trim();
  if (!/^https:\/\/\S+$/i.test(url)) {
    return { ok: false, error: "Vul een volledig adres in dat met https:// begint." };
  }

  const supabase = createServiceSupabase();
  const { count } = await supabase
    .from("workshop_result_files")
    .select("id", { count: "exact", head: true })
    .eq("result_id", params.resultId);

  const { error } = await supabase.from("workshop_result_files").insert({
    result_id: params.resultId,
    kind: "link",
    external_url: url,
    file_name: params.label.trim() || "Externe link",
    position: count ?? 0,
    created_by: params.userId,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Downloaden                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Maakt een korte downloadlink, maar alleen als deze gebruiker er echt bij mag.
 * De toegangscontrole zit hier bewust in dezelfde functie als het maken van de
 * link, zodat het nooit los van elkaar kan worden aangeroepen.
 */
export async function createDownloadUrl(params: {
  fileId: string;
  userId: string;
  isAdmin: boolean;
}): Promise<{ url: string } | { error: string }> {
  const supabase = createServiceSupabase();

  const { data: file } = await supabase
    .from("workshop_result_files")
    .select("*")
    .eq("id", params.fileId)
    .maybeSingle();

  if (!file || file.removed_at) return { error: "Dit bestand is niet meer beschikbaar." };
  if (file.kind === "link" && file.external_url) return { url: file.external_url };
  if (!file.storage_path) return { error: "Dit bestand is niet meer beschikbaar." };

  const { data: result } = await supabase
    .from("workshop_results")
    .select("*")
    .eq("id", file.result_id)
    .maybeSingle();

  if (!result) return { error: "Dit bestand is niet meer beschikbaar." };

  if (!params.isAdmin) {
    if (result.status !== "published") return { error: "Dit bestand is niet beschikbaar." };

    const { data: membership } = await supabase
      .from("organization_members")
      .select("id")
      .eq("organization_id", result.organization_id)
      .eq("user_id", params.userId)
      .eq("status", "active")
      .maybeSingle();

    if (!membership) return { error: "U heeft geen toegang tot dit bestand." };
  }

  const { data, error } = await supabase.storage
    .from(RESULTS_BUCKET)
    .createSignedUrl(file.storage_path, DOWNLOAD_LINK_SECONDS, {
      download: file.file_name,
    });

  if (error || !data) return { error: "De downloadlink kon niet worden gemaakt." };
  return { url: data.signedUrl };
}

/* -------------------------------------------------------------------------- */
/* Publiceren                                                                  */
/* -------------------------------------------------------------------------- */

function buildEmailBody(params: {
  contactName: string | null;
  title: string;
  organizationName: string;
  availableDays: number;
  expiresOn: string;
  portalUrl: string;
  supportEmail: string;
}): string {
  const aanhef = params.contactName ? `Beste ${params.contactName},` : "Beste,";
  return [
    aanhef,
    "",
    `De resultaten van ${params.title} staan klaar in SkoolPartner.`,
    "",
    `U kunt ze ${params.availableDays} dagen downloaden, tot en met ${params.expiresOn}.`,
    "Daarna verwijderen wij de bestanden van onze servers.",
    "",
    `Bekijk en download ze hier: ${params.portalUrl}/resultaten`,
    "",
    "Sla de bestanden op een eigen plek op, dan heeft u ze altijd bij de hand.",
    "",
    `Vragen? Mail ons gerust op ${params.supportEmail}.`,
    "",
    "Met vriendelijke groet,",
    "Team Skool Workshop",
  ].join("\n");
}

/**
 * Publiceert een set: zichtbaar voor de klant, vervaldatum vastleggen en de
 * contactpersoon van de boeking een mail sturen.
 *
 * De mail gaat uitsluitend naar de contactpersoon van de boeking, zoals
 * afgesproken. Mislukt het versturen, dan blijft de set wel gepubliceerd en
 * wordt de fout vastgelegd, zodat je hem in de beheeromgeving kunt zien.
 */
export async function publishResult(params: {
  resultId: string;
  userId: string;
  portalUrl: string;
}): Promise<{ ok: boolean; message: string }> {
  const supabase = createServiceSupabase();
  const settings = await getSettingsWithServiceRole();

  const result = await getResult(params.resultId);
  if (!result) return { ok: false, message: "Deze set bestaat niet." };
  if (result.status !== "concept") {
    return { ok: false, message: "Deze set is al gepubliceerd." };
  }
  if (result.files.length === 0) {
    return { ok: false, message: "Voeg eerst minstens één bestand of link toe." };
  }

  const beschikbaar = Math.max(1, settings.results_available_days);
  const melding = Math.max(0, settings.results_notice_days);
  const expiresAt = daysFromNow(beschikbaar);
  const purgeAt = daysFromNow(beschikbaar + melding);

  const { data: organization } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", result.organization_id)
    .maybeSingle();

  let contactEmail: string | null = null;
  let contactName: string | null = null;

  if (result.booking_id) {
    const { data: booking } = await supabase
      .from("bookings")
      .select("contact_email, contact_name")
      .eq("id", result.booking_id)
      .maybeSingle();
    contactEmail = booking?.contact_email ?? null;
    contactName = booking?.contact_name ?? null;
  }

  if (!contactEmail) {
    const { data: organizationRow } = await supabase
      .from("organizations")
      .select("contact_email")
      .eq("id", result.organization_id)
      .maybeSingle();
    contactEmail = organizationRow?.contact_email ?? null;
  }

  await supabase
    .from("workshop_results")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      expires_at: expiresAt,
      purge_at: purgeAt,
    })
    .eq("id", result.id);

  await recordAudit({
    actorId: params.userId,
    action: "workshop_result.published",
    entityType: "workshop_results",
    entityId: result.id,
    organizationId: result.organization_id,
    after: { titel: result.title, bestanden: result.files.length },
  });

  if (!contactEmail) {
    await supabase
      .from("workshop_results")
      .update({ notify_error: "Geen contactpersoon gevonden bij deze boeking." })
      .eq("id", result.id);
    return {
      ok: true,
      message:
        "Gepubliceerd. Er is geen mail verstuurd, want bij deze boeking staat geen contactpersoon.",
    };
  }

  const body = buildEmailBody({
    contactName,
    title: result.title,
    organizationName: organization?.name ?? "uw organisatie",
    availableDays: beschikbaar,
    expiresOn: new Intl.DateTimeFormat("nl-NL", {
      day: "numeric",
      month: "long",
      timeZone: "Europe/Amsterdam",
    }).format(new Date(expiresAt)),
    portalUrl: params.portalUrl.replace(/\/+$/, ""),
    supportEmail: settings.support_email,
  });

  if (integrationMode("gmail") === "mock") {
    await supabase
      .from("workshop_results")
      .update({
        notified_at: new Date().toISOString(),
        notified_email: contactEmail,
        notify_error: "Testmodus: er is geen echte mail verstuurd.",
      })
      .eq("id", result.id);
    return {
      ok: true,
      message: `Gepubliceerd. Gmail staat in testmodus, dus er ging geen echte mail naar ${contactEmail}.`,
    };
  }

  try {
    const client = await GmailClient.create();
    if (!client) throw new Error("Gmail is nog niet geautoriseerd");

    const raw = buildMessageMime({
      from: `Skool Workshop <${serverEnv.google.mailbox}>`,
      to: [contactEmail],
      subject: settings.results_email_subject,
      bodyText: body,
    });

    await client.sendRaw(raw);

    await supabase
      .from("workshop_results")
      .update({
        notified_at: new Date().toISOString(),
        notified_email: contactEmail,
        notify_error: null,
      })
      .eq("id", result.id);

    return { ok: true, message: `Gepubliceerd en gemaild naar ${contactEmail}.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Onbekende fout";
    await supabase
      .from("workshop_results")
      .update({ notified_email: contactEmail, notify_error: message })
      .eq("id", result.id);
    return {
      ok: true,
      message: `Gepubliceerd, maar de mail kon niet worden verstuurd: ${message}`,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Opruimen                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Dagelijkse opruiming, in twee stappen:
 *   1. verlopen sets: de bestanden echt uit de opslag halen, melding laten staan
 *   2. sets waarvan ook de meldperiode voorbij is: helemaal verwijderen
 */
export async function cleanUpResults(): Promise<{
  filesRemoved: number;
  resultsExpired: number;
  resultsPurged: number;
}> {
  const supabase = createServiceSupabase();
  const now = new Date().toISOString();
  let filesRemoved = 0;

  const { data: expired } = await supabase
    .from("workshop_results")
    .select("id")
    .eq("status", "published")
    .lt("expires_at", now);

  for (const result of expired ?? []) {
    const { data: files } = await supabase
      .from("workshop_result_files")
      .select("id, storage_path")
      .eq("result_id", result.id)
      .is("removed_at", null);

    const paths = (files ?? [])
      .map((f) => f.storage_path)
      .filter((p): p is string => Boolean(p));

    if (paths.length > 0) {
      await supabase.storage.from(RESULTS_BUCKET).remove(paths);
      filesRemoved += paths.length;
    }

    await supabase
      .from("workshop_result_files")
      .update({ removed_at: now })
      .eq("result_id", result.id)
      .is("removed_at", null);

    await supabase
      .from("workshop_results")
      .update({ status: "expired", files_removed_at: now })
      .eq("id", result.id);
  }

  const { data: purged } = await supabase
    .from("workshop_results")
    .select("id")
    .eq("status", "expired")
    .lt("purge_at", now);

  for (const result of purged ?? []) {
    await supabase.from("workshop_results").delete().eq("id", result.id);
  }

  return {
    filesRemoved,
    resultsExpired: expired?.length ?? 0,
    resultsPurged: purged?.length ?? 0,
  };
}
