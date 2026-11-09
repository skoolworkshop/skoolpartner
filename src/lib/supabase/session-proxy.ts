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
  // De openbare inschrijfpagina. Een leerling heeft geen account, en een
  // school gaat er geen tweehonderd aanmaken. De beveiliging zit in de
  // sleutel in de link en in het bewijs dat de serveractie vraagt.
  "/inschrijven",
  // De inzagepagina voor de school. Beveiligd met een token in de link en een
  // losse code die apart wordt doorgegeven, niet met een account.
  "/indeling",
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
