import { NextResponse } from "next/server";

import { getSessionContext } from "@/lib/auth/session";
import { createDownloadUrl } from "@/lib/results/service";

/**
 * Downloaden van een resultaatbestand.
 *
 * De link naar de opslag wordt pas gemaakt nadat is vastgesteld dat deze
 * gebruiker er bij mag, en is daarna maar een paar minuten geldig. Zo kan een
 * doorgestuurd adres nooit blijvend toegang geven.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionContext();

  if (!session?.userId) {
    return NextResponse.redirect(new URL("/inloggen?volgende=/resultaten", _request.url));
  }

  const result = await createDownloadUrl({
    fileId: id,
    userId: session.userId,
    isAdmin: session.isAdmin,
  });

  if ("error" in result) {
    return new NextResponse(result.error, {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return NextResponse.redirect(result.url);
}
