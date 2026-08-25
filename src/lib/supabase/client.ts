"use client";

import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/types/database";

/**
 * Browserclient. Gebruikt uitsluitend de publieke anon key.
 * Alle databasetoegang blijft daardoor onder Row Level Security vallen.
 */
export function createClient() {
  return createBrowserClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
}
