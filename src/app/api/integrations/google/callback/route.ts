import { NextResponse, type NextRequest } from "next/server";

import { requireAdmin } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { safeEqual } from "@/lib/crypto";
import { serverEnv } from "@/lib/env";
import {
  createOAuthClient,
  GmailClient,
  GMAIL_SCOPES,
  storeGmailCredentials,
} from "@/lib/integrations/gmail/client";

export const dynamic = "force-dynamic";

/**
 * Vangt de terugkomst uit Google op.
 *
 * Belangrijk: hier komt de beheerder met zijn browser terecht, geen machine.
 * Wat er ook misgaat, hij hoort terug te komen in Admin > Integraties met een
 * begrijpelijke melding. Nooit een pagina met rauwe JSON.
 *
 * De reden gaat mee als korte code in de URL. Nooit de foutmelding van Google
 * zelf, want daar kan een client secret of een token in staan.
 */
function terug(request: NextRequest, reden: string) {
  return NextResponse.redirect(
    new URL(`/admin/integraties?fout=${encodeURIComponent(reden)}`, request.nextUrl.origin)
  );
}

/**
 * Vertaalt de fout van Google naar een korte code.
 *
 * Wij lezen alleen het veld "error" uit het antwoord. De omschrijving
 * daarnaast laten wij bewust liggen: die kan de aanroep bevatten, inclusief
 * client secret.
 */
function classificeerGoogleFout(error: unknown): string {
  const respons = (error as { response?: { data?: { error?: string } } })?.response;
  const code = respons?.data?.error ?? "";
  const tekst = `${code} ${error instanceof Error ? error.message : ""}`.toLowerCase();

  if (tekst.includes("invalid_client")) return "google-client";
  if (tekst.includes("redirect_uri_mismatch")) return "google-redirect";
  if (tekst.includes("invalid_grant")) return "google-verlopen";
  if (tekst.includes("invalid_scope")) return "google-scopes";
  return "google-fout";
}

export async function GET(request: NextRequest) {
  const session = await requireAdmin();

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const googleFout = request.nextUrl.searchParams.get("error");
  const storedState = request.cookies.get("mijnskool.oauth_state")?.value ?? null;

  // Op Annuleren geklikt, of Google weigerde de toestemming.
  if (googleFout) {
    return terug(request, googleFout === "access_denied" ? "google-geweigerd" : "google-fout");
  }

  if (!safeEqual(state, storedState)) return terug(request, "oauth-state");
  if (!code) return terug(request, "geen-code");

  const oauth = createOAuthClient();
  if (!oauth) return terug(request, "google-credentials");

  /*
    Eerst controleren of wij de token straks überhaupt kunnen bewaren.

    Dit gebeurt bewust vóór het omwisselen van de code. Zou de sleutel niet
    kloppen, dan is de code inmiddels verbruikt en moet de hele flow opnieuw.
    Nu weet de beheerder het meteen en is er niets verspild.
  */
  if (!serverEnv.appEncryptionKey) return terug(request, "sleutel-ontbreekt");
  if (Buffer.from(serverEnv.appEncryptionKey, "base64").length !== 32) {
    return terug(request, "sleutel-ongeldig");
  }

  // 1. Code omwisselen voor tokens.
  let tokens: { refresh_token?: string | null; access_token?: string | null; scope?: string | null };
  try {
    ({ tokens } = await oauth.getToken(code));
  } catch (error) {
    console.error("[google-callback] token omwisselen mislukt:", classificeerGoogleFout(error));
    return terug(request, classificeerGoogleFout(error));
  }

  if (!tokens.refresh_token) return terug(request, "geen-refresh-token");

  /*
    2. Wie heeft er zojuist ingelogd?

    Bewust een aparte vraag aan Google. Voorheen werd hier GMAIL_MAILBOX
    opgeslagen als "gekoppeld account", maar dat is een aanname, en bij Skool
    Workshop is die aanname onjuist: er wordt ingelogd met een persoonlijk
    account terwijl er met een boekingenadres wordt gemaild.

    Lukt dit niet, dan gaat de koppeling gewoon door. Het account is
    informatie, geen voorwaarde.
  */
  let accountEmail: string | null = null;
  if (tokens.access_token) {
    try {
      const profiel = await GmailClient.fromAccessToken(tokens.access_token).getProfile();
      accountEmail = profiel.emailAddress ?? null;
    } catch (error) {
      console.error("[google-callback] profiel ophalen lukte niet", error);
    }
  }

  // 3. Versleuteld opslaan. Mislukt dit, dan is er niets gekoppeld, en dan moet
  //    de beheerder dat weten in plaats van een groen vinkje te zien.
  const opslag = await storeGmailCredentials({
    refreshToken: tokens.refresh_token,
    accountEmail,
    scopes: tokens.scope?.split(" ") ?? GMAIL_SCOPES,
  });

  if (!opslag.ok) {
    console.error("[google-callback] opslaan mislukt:", opslag.error);
    return terug(request, opslag.reason ?? "opslaan-mislukt");
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "integration.gmail_connected",
    entityType: "integration",
    entityId: "gmail",
    after: {
      // Nooit de token zelf, alleen wat er functioneel is gekoppeld.
      account_email: accountEmail,
      mailbox: serverEnv.google.mailbox,
      scopes: tokens.scope?.split(" ") ?? GMAIL_SCOPES,
    },
  });

  const response = NextResponse.redirect(
    new URL("/admin/integraties?gekoppeld=gmail", request.nextUrl.origin)
  );
  response.cookies.delete("mijnskool.oauth_state");
  return response;
}
