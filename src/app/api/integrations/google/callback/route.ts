import { NextResponse, type NextRequest } from "next/server";

import { requireAdmin } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { safeEqual } from "@/lib/crypto";
import { serverEnv } from "@/lib/env";
import { createOAuthClient, GMAIL_SCOPES, storeGmailCredentials } from "@/lib/integrations/gmail/client";
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

    await storeGmailCredentials({
      refreshToken: tokens.refresh_token,
      accountEmail: serverEnv.google.mailbox,
      scopes: tokens.scope?.split(" ") ?? GMAIL_SCOPES,
    });

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "integration.gmail_connected",
      entityType: "integration",
      entityId: "gmail",
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
