import "server-only";

import { cookies } from "next/headers";

import { leesToegang } from "@/lib/inschrijving/afronden";

/**
 * De toegang van een school terughalen uit het cookie.
 *
 * De link alleen is niet genoeg. In het cookie staat de code die apart is
 * doorgegeven, en die wordt bij elk bezoek opnieuw tegen de database
 * gehouden. Trekt Anne de toegang in of verloopt hij, dan is het cookie
 * vanaf dat moment waardeloos.
 */
export function cookieNaam(token: string): string {
  return `indeling-${token.slice(0, 8)}`;
}

export async function huidigeToegang(token: string): Promise<{ dagId: string; label: string } | null> {
  const jar = await cookies();
  const code = jar.get(cookieNaam(token))?.value;
  if (!code) return null;
  return leesToegang({ token, code });
}
