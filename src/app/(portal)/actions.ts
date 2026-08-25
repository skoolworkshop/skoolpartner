"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { ACTIVE_ORGANIZATION_COOKIE, requireUser } from "@/lib/auth/session";

/**
 * Wisselt van actieve organisatie.
 * De keuze wordt altijd gecontroleerd tegen de lidmaatschappen van de
 * ingelogde gebruiker; een gemanipuleerde waarde geeft dus geen toegang.
 */
export async function switchOrganization(organizationId: string): Promise<void> {
  const session = await requireUser();
  const allowed = session.memberships.some((m) => m.organization.id === organizationId);
  if (!allowed) return;

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORGANIZATION_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
}
