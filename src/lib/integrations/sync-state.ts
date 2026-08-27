import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";
import type { IntegrationSystem, Json } from "@/lib/types/database";

export interface SyncResult {
  integration: IntegrationSystem;
  ok: boolean;
  mode: "live" | "mock";
  itemsProcessed: number;
  message?: string;
  details?: Record<string, unknown>;
}

export async function markSyncStart(integration: IntegrationSystem, key = "default") {
  const supabase = createServiceSupabase();
  await supabase.from("integration_sync_state").upsert(
    {
      integration,
      key,
      status: "running",
      last_run_at: new Date().toISOString(),
    },
    { onConflict: "integration,key" }
  );
}

export async function markSyncSuccess(
  integration: IntegrationSystem,
  params: { key?: string; itemsProcessed?: number; cursor?: string | null; metadata?: Json } = {}
) {
  const supabase = createServiceSupabase();
  await supabase.from("integration_sync_state").upsert(
    {
      integration,
      key: params.key ?? "default",
      status: "ok",
      last_success_at: new Date().toISOString(),
      last_error: null,
      retry_count: 0,
      items_processed: params.itemsProcessed ?? 0,
      ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
      ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
    },
    { onConflict: "integration,key" }
  );
}

/**
 * Registreert een fout zonder data te beschadigen. Een tijdelijke storing bij
 * Gmail of Moneybird laat de bestaande gegevens dus ongemoeid.
 */
export async function markSyncError(
  integration: IntegrationSystem,
  error: unknown,
  key = "default"
) {
  const supabase = createServiceSupabase();
  const message = error instanceof Error ? error.message : String(error);

  const { data: current } = await supabase
    .from("integration_sync_state")
    .select("retry_count")
    .eq("integration", integration)
    .eq("key", key)
    .maybeSingle();

  await supabase.from("integration_sync_state").upsert(
    {
      integration,
      key,
      status: "error",
      last_error_at: new Date().toISOString(),
      last_error: message.slice(0, 500),
      retry_count: (current?.retry_count ?? 0) + 1,
    },
    { onConflict: "integration,key" }
  );
}

export async function getSyncStates() {
  const supabase = createServiceSupabase();
  const { data } = await supabase.from("integration_sync_state").select("*").order("integration");
  return data ?? [];
}

/**
 * Eenvoudige retry met exponentiële wachttijd voor tijdelijke netwerkfouten.
 * Bij 4xx-fouten heeft opnieuw proberen geen zin, dus die gaan direct door.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, baseDelayMs = 400 }: { attempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number })?.status;
      if (typeof status === "number" && status >= 400 && status < 500 && status !== 429) {
        throw error;
      }
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
      }
    }
  }
  throw lastError;
}
