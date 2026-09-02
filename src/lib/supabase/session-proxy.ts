import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { publicEnv, isSupabaseConfigured } from "@/lib/env";
import type { Database } from "@/lib/types/database";

/** Routes die zonder sessie bereikbaar zijn. */
const PUBLIC_PATHS = [
  "/inloggen",
  "/registreren",
  "/auth",
  "/uitnodiging",
  "/wachten",
  "/privacy",
  // De openbare boekingspagina. Een school die een gesprek inplant, hoort geen
  // account nodig te hebben. De pagina zelf leest en schrijft via de
  // serviceclient in een serveractie, met alle controles daar.
  "/afspraak",
  "/api/webhooks",
  "/api/cron",
];

function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Ververst de Supabase-sessie en beschermt alle niet-publieke routes.
 * Dit is de eerste van meerdere lagen: pagina's en server actions controleren
 * daarnaast zelf, en de database dwingt het af via RLS.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!isSupabaseConfigured()) {
    return response;
  }

  const supabase = createServerClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/inloggen";
    url.search = "";
    if (pathname !== "/") {
      url.searchParams.set("volgende", `${pathname}${search}`);
    }
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/inloggen" || pathname === "/registreren")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
