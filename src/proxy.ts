import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/session-proxy";

/**
 * Next.js 16 noemt de vroegere "middleware" nu "proxy".
 * Hier verversen we de Supabase-sessie en blokkeren we niet-publieke routes.
 *
 * Let op: dit is een optimistische controle. De echte autorisatie gebeurt in
 * de pagina's/server actions en uiteindelijk in de database via RLS.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
