"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CUSTOMER_PREVIEW_COOKIE, requireAdmin } from "@/lib/auth/session";

export async function stopCustomerPreview() {
  await requireAdmin();
  const cookieStore = await cookies();
  cookieStore.delete(CUSTOMER_PREVIEW_COOKIE);
  redirect("/admin/gebruikers");
}
