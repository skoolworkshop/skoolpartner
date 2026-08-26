import { NextResponse, type NextRequest } from "next/server";

import { requireAdmin } from "@/lib/auth/session";
import { createOAuthClient, GMAIL_SCOPES } from "@/lib/integrations/gmail/client";
import { generateToken } from "@/lib/crypto";
import { serverEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Start de Google OAuth-flow voor de centrale mailbox.
 * Alleen bereikbaar voor admins; de tokens komen versleuteld in de database.
 */
export async function GET(request: NextRequest) {
  await requireAdmin();

  const oauth = createOAuthClient();
  if (!oauth) {
    return NextResponse.redirect(
      new URL("/admin/integraties?fout=google-credentials", request.nextUrl.origin)
    );
  }

  /*
    Kunnen wij de token straks überhaupt bewaren?

    Deze controle staat bewust vóór de gang naar Google. Anders logt de
    beheerder eerst in, geeft toestemming, en pas dan blijkt dat er iets in de
    omgeving ontbreekt. Liever hier stoppen dan hem voor niets laten inloggen.
  */
  if (!serverEnv.appEncryptionKey) {
    return NextResponse.redirect(
      new URL("/admin/integraties?fout=sleutel-ontbreekt", request.nextUrl.origin)
    );
  }
  if (Buffer.from(serverEnv.appEncryptionKey, "base64").length !== 32) {
    return NextResponse.redirect(
      new URL("/admin/integraties?fout=sleutel-ongeldig", request.nextUrl.origin)
    );
  }
  if (!serverEnv.supabaseServiceRoleKey) {
    return NextResponse.redirect(
      new URL("/admin/integraties?fout=database-sleutel", request.nextUrl.origin)
    );
  }

  const state = generateToken(16);
  const url = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
    state,
  });

  const response = NextResponse.redirect(url);
  response.cookies.set("mijnskool.oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return response;
}
