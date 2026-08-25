import { NextResponse, type NextRequest } from "next/server";

import { requireCronAuth, safeErrorResponse } from "@/lib/api/guards";
import { syncGmail } from "@/lib/integrations/gmail/sync";
import { syncHubSpot } from "@/lib/integrations/hubspot/sync";
import { syncMoneybirdInvoices } from "@/lib/integrations/moneybird/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Draait alle synchronisaties achter elkaar.
 * Elke integratie vangt zijn eigen fouten af, zodat een storing bij één
 * systeem de andere niet blokkeert.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const only = request.nextUrl.searchParams.get("only");

    const results = [];
    if (!only || only === "gmail") results.push(await syncGmail());
    if (!only || only === "moneybird") results.push(await syncMoneybirdInvoices());
    if (!only || only === "hubspot") results.push(await syncHubSpot());

    return NextResponse.json({ ok: results.every((r) => r.ok), results });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
