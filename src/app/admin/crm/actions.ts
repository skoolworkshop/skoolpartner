"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/session";
import { parseMerk } from "@/lib/crm/merk";
import { MERK_COOKIE, MERK_COOKIE_MAX_AGE } from "@/lib/crm/actief-merk";

/**
 * Wisselen tussen Skool Workshop en Suri Impact.
 *
 * De keuze bepaalt alleen wat er op het scherm staat. Toch staat requireAdmin
 * hier gewoon: elke serveractie hoort zelf te controleren wie hem aanroept, en
 * "het is toch maar een weergave" is precies de redenering waarmee gaten
 * ontstaan.
 */
export async function kiesMerk(formData: FormData): Promise<void> {
  await requireAdmin();

  const merk = parseMerk(formData.get("merk"));
  const store = await cookies();

  store.set(MERK_COOKIE, merk, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MERK_COOKIE_MAX_AGE,
  });

  revalidatePath("/admin", "layout");
}
