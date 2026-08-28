"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { requireMember } from "@/lib/auth/session";
import { sendPortalReply } from "@/lib/integrations/gmail/reply";

export interface ReplyState {
  status: "idle" | "ok" | "error";
  message?: string;
  /** Verandert bij elke geslaagde verzending, zodat het invoerveld leegt. */
  submissionId?: string;
}

export async function replyToThread(
  _prev: ReplyState,
  formData: FormData
): Promise<ReplyState> {
  const session = await requireMember();
  if (session.customerPreview) {
    return { status: "error", message: "Berichten verstuurt u vanuit het beheerportaal, zodat duidelijk blijft wie de afzender is." };
  }
  const threadId = String(formData.get("thread_id") ?? "");
  const body = String(formData.get("body") ?? "");
  const idempotencyKey = String(formData.get("idempotency_key") ?? "");

  if (!threadId || !idempotencyKey) {
    return { status: "error", message: "Er ging iets mis. Ververs de pagina en probeer opnieuw." };
  }

  const result = await sendPortalReply({
    threadId,
    userId: session.userId,
    userEmail: session.email,
    organizationId: session.activeOrganizationId,
    bodyText: body,
    idempotencyKey: `${session.userId}:${threadId}:${idempotencyKey}`,
  });

  if (!result.ok) {
    return { status: "error", message: result.message ?? "Versturen is niet gelukt." };
  }

  revalidatePath(`/berichten/${threadId}`);
  return {
    status: "ok",
    message: result.message ?? "Uw bericht is verstuurd.",
    submissionId: randomUUID(),
  };
}
