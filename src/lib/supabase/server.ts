import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { publicEnv, serverEnv } from "@/lib/env";
import type { Database } from "@/lib/types/database";

/**
 * Serverclient met de sessie van de ingelogde gebruiker.
 * Leest en schrijft onder Row Level Security: dit is de standaardclient.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Aanroep vanuit een Server Component: cookies zetten mag daar niet.
          // De middleware ververst de sessie, dus dit is veilig te negeren.
        }
      },
    },
  });
}

/**
 * Serviceclient. Bypast RLS en is uitsluitend bedoeld voor server-side
 * achtergrondwerk (integraties, webhooks, adminacties).
 *
 * Elke aanroeper MOET zelf eerst autoriseren. Zie src/lib/auth/guards.ts.
 * Deze functie werpt bewust een fout als hij per ongeluk in de browser belandt.
 */
export function createServiceSupabase() {
  if (typeof window !== "undefined") {
    throw new Error("createServiceSupabase mag nooit in de browser worden gebruikt");
  }
  if (!serverEnv.supabaseServiceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY ontbreekt. Voeg deze toe aan je environment variables."
    );
  }

  return createServerClient<Database>(publicEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    cookies: {
      getAll() {
        return [];
      },
      setAll() {
        /* service client houdt geen sessie bij */
      },
    },
  });
}
