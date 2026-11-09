"use server";

import { cookies } from "next/headers";

import { leesToegang } from "@/lib/inschrijving/afronden";

/**
 * De code van de school controleren.
 *
 * Klopt hij, dan onthoudt de browser hem acht uur in een cookie dat javascript
 * niet kan lezen. Daardoor hoeft de code niet in het adres te staan en staat
 * hij dus ook niet in de geschiedenis of in een doorgestuurde link.
 */
export async function meldAanAction(
  _prev: { fout?: string },
  formData: FormData,
): Promise<{ fout?: string }> {
  const token = String(formData.get("token") ?? "");
  const code = String(formData.get("code") ?? "").trim();

  const toegang = await leesToegang({ token, code });
  if (!toegang) return { fout: "Deze code klopt niet, of de toegang is verlopen." };

  const jar = await cookies();
  jar.set(`indeling-${token.slice(0, 8)}`, code.toUpperCase(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 8,
    path: `/indeling/${token}`,
  });

  return {};
}
