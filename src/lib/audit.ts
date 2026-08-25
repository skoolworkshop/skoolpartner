import { headers } from "next/headers";

import { createServiceSupabase } from "@/lib/supabase/server";
import type { Json } from "@/lib/types/database";

export interface AuditEntry {
  actorId?: string | null;
  actorEmail?: string | null;
  actorRole?: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  organizationId?: string | null;
  before?: Json;
  after?: Json;
  reason?: string | null;
}

/**
 * Legt een belangrijke (admin)actie vast. Faalt nooit hard: een mislukte
 * logregel mag de daadwerkelijke actie niet blokkeren, maar wordt wel
 * gerapporteerd in de serverlog.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    let ip: string | null = null;
    let userAgent: string | null = null;
    try {
      const headerList = await headers();
      // Alleen het eerste IP bewaren, en niet meer dan nodig (dataminimalisatie).
      ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
      userAgent = headerList.get("user-agent")?.slice(0, 200) ?? null;
    } catch {
      /* buiten een request-context, bijvoorbeeld in een cron job */
    }

    const supabase = createServiceSupabase();
    await supabase.from("audit_logs").insert({
      actor_id: entry.actorId ?? null,
      actor_email: entry.actorEmail ?? null,
      actor_role: entry.actorRole ?? "admin",
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      organization_id: entry.organizationId ?? null,
      before_state: entry.before ?? null,
      after_state: entry.after ?? null,
      reason: entry.reason ?? null,
      ip_address: ip,
      user_agent: userAgent,
    });
  } catch (error) {
    console.error("[audit] kon actie niet vastleggen", entry.action, error);
  }
}
