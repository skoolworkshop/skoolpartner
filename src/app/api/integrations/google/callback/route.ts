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
import { safeErrorResponse } from "@/lib/api/guards";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await requireAdmin();

  try {
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    const storedState = request.cookies.get("mijnskool.oauth_state")?.value ?? null;

    if (!code || !safeEqual(state, storedState)) {
      return NextResponse.redirect(
        new URL("/admin/integraties?fout=oauth-state", request.nextUrl.origin)
      );
    }

    const oauth = createOAuthClient();
    if (!oauth) {
      return NextResponse.redirect(
        new URL("/admin/integraties?fout=google-credentials", request.nextUrl.origin)
      );
    }

    const { tokens } = await oauth.getToken(code);
    if (!tokens.refresh_token) {
      return NextResponse.redirect(
        new URL("/admin/integraties?fout=geen-refresh-token", request.nextUrl.origin)
      );
    }

    /*
      Wie heeft er zojuist ingelogd?

      Dit is bewust een aparte vraag aan Google. Voorheen werd hier GMAIL_MAILBOX
      opgeslagen als "gekoppeld account", maar dat is een aanname en bij Skool
      Workshop is die aanname onjuist: er wordt ingelogd met een persoonlijk
      account, terwijl er met een boekingenadres wordt gemaild. Wij slaan nu op
      wat er echt is gekoppeld.

      Lukt dit niet, dan gaat de koppeling gewoon door. Het account is
      informatie, geen voorwaarde.
    */
    let accountEmail: string | null = null;
    if (tokens.access_token) {
      try {
        const profiel = await GmailClient.fromAccessToken(tokens.access_token).getProfile();
        accountEmail = profiel.emailAddress ?? null;
      } catch {
        /* Het profiel is niet essentieel; de verbindingstest laat het later zien. */
      }
    }

    await storeGmailCredentials({
      refreshToken: tokens.refresh_token,
      accountEmail,
      scopes: tokens.scope?.split(" ") ?? GMAIL_SCOPES,
    });

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
  } catch (error) {
    return safeErrorResponse(error);
  }
}
