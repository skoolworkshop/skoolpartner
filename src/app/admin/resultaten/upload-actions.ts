"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/session";
import { createUploadTarget, registerUploadedFile } from "@/lib/results/service";
import { getSettings } from "@/lib/settings";

/**
 * Twee kleine acties voor het uploaden van een bestand.
 *
 * Het bestand zelf gaat rechtstreeks van de browser naar Supabase Storage. Dat
 * is bewust: zo hoeft een video van honderden megabytes niet door de server, en
 * loop je niet tegen de limieten van een server action aan. De sleutel blijft
 * server-side; de browser krijgt alleen een tijdelijke, ondertekende link naar
 * één specifiek pad.
 */

export async function requestUploadTarget(resultId: string, fileName: string, sizeBytes: number) {
  await requireAdmin();

  const settings = await getSettings();
  const maxBytes = Math.max(1, settings.results_max_upload_mb) * 1024 * 1024;

  if (sizeBytes > maxBytes) {
    return {
      error: `Dit bestand is ${Math.round(sizeBytes / 1024 / 1024)} MB. Het maximum staat op ${settings.results_max_upload_mb} MB. Voeg een externe link toe, of verhoog de limiet nadat je Supabase-abonnement dat toestaat.`,
    };
  }

  return createUploadTarget({ resultId, fileName });
}

export async function confirmUpload(params: {
  resultId: string;
  path: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
}) {
  const session = await requireAdmin();

  const result = await registerUploadedFile({ ...params, userId: session.userId });
  revalidatePath("/admin/resultaten");
  return result;
}
