import "server-only";

import { headers } from "next/headers";

import { publicEnv } from "@/lib/env";

/**
 * Het adres waarop SkoolPartner nu draait, voor gebruik in e-maillinks.
 *
 * Volgorde:
 *  1. NEXT_PUBLIC_SITE_URL, als die is ingesteld. Dat is de bedoelde situatie.
 *  2. Anders het domein van het binnenkomende verzoek. Dan wijst een inloglink
 *     altijd naar het adres waarop de bezoeker op dat moment zit, ook als de
 *     variabele op Vercel nog niet is ingevuld.
 *  3. Anders localhost, voor lokale ontwikkeling.
 */
export async function resolveSiteUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  try {
    const headerList = await headers();
    const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
    if (host) {
      const proto =
        headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
      return `${proto}://${host}`;
    }
  } catch {
    // Buiten een request, bijvoorbeeld tijdens de build. Val terug op hieronder.
  }

  return publicEnv.siteUrl.replace(/\/+$/, "");
}
