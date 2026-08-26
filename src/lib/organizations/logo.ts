import "server-only";

import { recordAudit } from "@/lib/audit";
import { createServiceSupabase } from "@/lib/supabase/server";
import {
  domeinNaarUrl,
  isBruikbareAfbeelding,
  isVeiligeUrl,
  logoBestandsnaam,
  MAX_BYTES,
  standaardFavicon,
  vindLogoKandidaten,
} from "./logo-parse";

/**
 * Het logo van een school ophalen van haar eigen domein.
 *
 * Waarom van het eigen domein en niet via een logodienst: zo weten wij zeker
 * dat het logo bij deze organisatie hoort. Het staat op goudsewaarden.nl, dus
 * het kan niet het logo van een andere school zijn. Er is ook geen externe
 * dienst nodig die morgen kan verdwijnen of geld gaat kosten.
 *
 * Wat wij binnenhalen slaan wij op in onze eigen opslag. Wij linken dus niet
 * naar de server van de school: als zij hun site verbouwen, blijft het portaal
 * gewoon werken.
 *
 * NOG EEN KEER, WANT HET IS BELANGRIJK: een logo is uitsluitend visuele
 * informatie. Het is nooit een reden om iemand toegang te geven tot de gegevens
 * van een organisatie. Dat blijft volledig aan de lidmaatschappen en RLS.
 */

export const LOGO_BUCKET = "organisatie-logos";

const TIMEOUT_MS = 6000;
const MAX_HTML_BYTES = 512 * 1024;

export interface LogoResult {
  ok: boolean;
  logoUrl?: string;
  /** Waar wij het vandaan hebben, voor in de uitleg en het audit log. */
  bron?: string;
  message?: string;
}

async function haalOp(url: string, accept: string): Promise<Response | null> {
  if (!isVeiligeUrl(url)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept,
        "user-agent": "SkoolPartner/1.0 (+https://skoolworkshop.nl)",
      },
    });
    if (!response.ok) return null;

    // Na een omleiding kan het adres alsnog ergens anders wijzen.
    if (response.url && !isVeiligeUrl(response.url)) return null;

    return response;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Het domein van deze organisatie: eerst een geverifieerd domein, dan de website. */
async function bepaalDomein(organizationId: string): Promise<string | null> {
  const supabase = createServiceSupabase();

  const { data: domeinen } = await supabase
    .from("organization_domains")
    .select("domain, is_verified")
    .eq("organization_id", organizationId)
    .order("is_verified", { ascending: false })
    .limit(5);

  for (const rij of domeinen ?? []) {
    const url = domeinNaarUrl(rij.domain);
    if (url) return url;
  }

  const { data: organisatie } = await supabase
    .from("organizations")
    .select("website")
    .eq("id", organizationId)
    .maybeSingle();

  return organisatie?.website ? domeinNaarUrl(organisatie.website) : null;
}

/**
 * Zoekt het logo en slaat het op.
 *
 * Een handmatig ingesteld logo wordt nooit overschreven. Dat is de hele reden
 * dat logo_source bestaat.
 */
export async function fetchOrganizationLogo(params: {
  organizationId: string;
  actorId?: string | null;
  actorEmail?: string | null;
  /** Alleen true als een beheerder er bewust om vraagt. */
  force?: boolean;
}): Promise<LogoResult> {
  const supabase = createServiceSupabase();

  const { data: organisatie } = await supabase
    .from("organizations")
    .select("id, name, logo_url, logo_source")
    .eq("id", params.organizationId)
    .maybeSingle();

  if (!organisatie) return { ok: false, message: "Organisatie niet gevonden." };

  if (organisatie.logo_source === "handmatig" && !params.force) {
    return { ok: false, message: "Deze organisatie heeft een handmatig ingesteld logo." };
  }

  const basisUrl = await bepaalDomein(params.organizationId);

  // Ook als er niets te vinden is, leggen wij vast dat wij gekeken hebben.
  // Anders zouden wij bij elke registratie opnieuw het internet op gaan.
  const stempel = { logo_checked_at: new Date().toISOString() };

  if (!basisUrl) {
    await supabase.from("organizations").update(stempel).eq("id", params.organizationId);
    return { ok: false, message: "Van deze organisatie is nog geen website of domein bekend." };
  }

  const pagina = await haalOp(basisUrl, "text/html,application/xhtml+xml");
  const kandidaten = [];

  if (pagina) {
    const html = (await pagina.text()).slice(0, MAX_HTML_BYTES);
    kandidaten.push(...vindLogoKandidaten(html, pagina.url || basisUrl));
  }

  const favicon = standaardFavicon(basisUrl);
  if (favicon) kandidaten.push({ url: favicon, score: 10, reason: "favicon.ico" });

  for (const kandidaat of kandidaten.slice(0, 6)) {
    const afbeelding = await haalOp(kandidaat.url, "image/*");
    if (!afbeelding) continue;

    const buffer = await afbeelding.arrayBuffer();
    const contentType = afbeelding.headers.get("content-type");

    if (!isBruikbareAfbeelding(contentType, buffer.byteLength)) continue;
    if (buffer.byteLength > MAX_BYTES) continue;

    const pad = logoBestandsnaam(params.organizationId, contentType!);
    const { error: uploadFout } = await supabase.storage
      .from(LOGO_BUCKET)
      .upload(pad, buffer, { contentType: contentType!, upsert: true });

    if (uploadFout) {
      console.error("[logo] opslaan mislukt", { organisatie: organisatie.name, uploadFout });
      continue;
    }

    const { data: publiek } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(pad);
    // Een tijdstempel erachter, zodat een vervangen logo meteen zichtbaar is en
    // niet uit de browsercache blijft komen.
    const logoUrl = `${publiek.publicUrl}?v=${Date.now()}`;

    await supabase
      .from("organizations")
      .update({ ...stempel, logo_url: logoUrl, logo_source: "automatisch" })
      .eq("id", params.organizationId);

    await recordAudit({
      actorId: params.actorId ?? null,
      actorEmail: params.actorEmail ?? null,
      actorRole: params.actorId ? "admin" : "systeem",
      action: "organization.logo_found",
      entityType: "organization",
      entityId: params.organizationId,
      organizationId: params.organizationId,
      before: { logo_url: organisatie.logo_url },
      after: { logo_url: logoUrl, gevonden_via: kandidaat.reason, bron: kandidaat.url },
    });

    return { ok: true, logoUrl, bron: kandidaat.reason };
  }

  await supabase.from("organizations").update(stempel).eq("id", params.organizationId);
  return {
    ok: false,
    message: "Op de website van deze organisatie is geen bruikbaar logo gevonden.",
  };
}

/** Een logo dat door beheer of de school zelf is aangeleverd. Gaat altijd voor. */
export async function setOrganizationLogo(params: {
  organizationId: string;
  file: ArrayBuffer;
  contentType: string;
  actorId: string;
  actorEmail: string;
  actorRole?: "admin" | "klant";
}): Promise<LogoResult> {
  if (!isBruikbareAfbeelding(params.contentType, params.file.byteLength)) {
    return {
      ok: false,
      message: "Kies een PNG, JPG of WEBP van maximaal 2 MB. SVG kunnen wij niet gebruiken.",
    };
  }

  const supabase = createServiceSupabase();
  const { data: vorige } = await supabase
    .from("organizations")
    .select("logo_url")
    .eq("id", params.organizationId)
    .maybeSingle();

  const pad = logoBestandsnaam(params.organizationId, params.contentType);
  const { error } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(pad, params.file, { contentType: params.contentType, upsert: true });

  if (error) return { ok: false, message: "Het logo kon niet worden opgeslagen." };

  const { data: publiek } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(pad);
  const logoUrl = `${publiek.publicUrl}?v=${Date.now()}`;

  await supabase
    .from("organizations")
    .update({
      logo_url: logoUrl,
      logo_source: "handmatig",
      logo_checked_at: new Date().toISOString(),
    })
    .eq("id", params.organizationId);

  await recordAudit({
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    actorRole: params.actorRole ?? "admin",
    action: "organization.logo_set",
    entityType: "organization",
    entityId: params.organizationId,
    organizationId: params.organizationId,
    before: { logo_url: vorige?.logo_url ?? null },
    after: { logo_url: logoUrl, bron: "handmatig" },
  });

  return { ok: true, logoUrl };
}

/** Terug naar het standaardicoon. */
export async function clearOrganizationLogo(params: {
  organizationId: string;
  actorId: string;
  actorEmail: string;
}): Promise<LogoResult> {
  const supabase = createServiceSupabase();
  const { data: vorige } = await supabase
    .from("organizations")
    .select("logo_url")
    .eq("id", params.organizationId)
    .maybeSingle();

  await supabase
    .from("organizations")
    .update({ logo_url: null, logo_source: null })
    .eq("id", params.organizationId);

  await recordAudit({
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    action: "organization.logo_cleared",
    entityType: "organization",
    entityId: params.organizationId,
    organizationId: params.organizationId,
    before: { logo_url: vorige?.logo_url ?? null },
    after: { logo_url: null },
  });

  return { ok: true };
}
