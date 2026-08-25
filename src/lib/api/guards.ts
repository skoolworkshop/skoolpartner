import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { serverEnv } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";

/**
 * Beschermt cron-endpoints. Vercel Cron stuurt een Authorization-header met
 * CRON_SECRET mee; handmatig aanroepen kan met dezelfde header.
 */
export function requireCronAuth(request: NextRequest): NextResponse | null {
  if (!serverEnv.cronSecret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is niet ingesteld" },
      { status: 503 }
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!safeEqual(provided, serverEnv.cronSecret)) {
    return NextResponse.json({ ok: false, error: "Niet geautoriseerd" }, { status: 401 });
  }

  return null;
}

/** Nette, veilige foutrespons: nooit stack traces of secrets naar buiten. */
export function safeErrorResponse(error: unknown, status = 500) {
  console.error("[api]", error);
  return NextResponse.json(
    { ok: false, error: "Er ging iets mis bij het verwerken van dit verzoek." },
    { status }
  );
}
