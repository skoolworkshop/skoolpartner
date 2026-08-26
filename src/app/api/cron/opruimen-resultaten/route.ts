import { NextResponse, type NextRequest } from "next/server";

import { requireCronAuth, safeErrorResponse } from "@/lib/api/guards";
import { recordAudit } from "@/lib/audit";
import { cleanUpResults } from "@/lib/results/service";

export const dynamic = "force-dynamic";

/**
 * Dagelijkse opruiming van workshopresultaten.
 *
 * Stap 1: van sets waarvan de downloadperiode voorbij is, worden de bestanden
 *         echt uit de opslag verwijderd. De melding blijft nog even staan.
 * Stap 2: is ook die meldperiode voorbij, dan verdwijnt de hele set.
 *
 * Zo blijft de opslag klein en staat er nooit langer klantmateriaal dan nodig.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const summary = await cleanUpResults();

    if (summary.resultsExpired > 0 || summary.resultsPurged > 0) {
      await recordAudit({
        actorRole: "systeem",
        action: "workshop_results.cleaned",
        entityType: "workshop_results",
        after: {
          bestanden_verwijderd: summary.filesRemoved,
          sets_verlopen: summary.resultsExpired,
          sets_opgeruimd: summary.resultsPurged,
        },
      });
    }

    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
