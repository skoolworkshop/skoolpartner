import { NextResponse, type NextRequest } from "next/server";

import { requireCronAuth, safeErrorResponse } from "@/lib/api/guards";
import { createServiceSupabase } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Laat verlopen SkoolPoints vervallen. De historie blijft volledig bewaard:
 * er wordt een transactie van het type 'expiry' toegevoegd.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase.rpc("expire_loyalty_points");
    if (error) throw new Error(error.message);

    const organizations = typeof data === "number" ? data : 0;
    if (organizations > 0) {
      await recordAudit({
        actorRole: "systeem",
        action: "loyalty.points_expired",
        entityType: "loyalty_transaction",
        after: { organizations },
      });
    }

    return NextResponse.json({ ok: true, organizations });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
