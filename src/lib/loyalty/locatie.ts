import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/types/database";

/**
 * SkoolPoints horen bij de schoollocatie.
 *
 * Een locatie kan meerdere contactpersonen hebben. Elk van hen heeft een eigen
 * regel in loyalty_accounts, zodat bij elke toekenning vaststaat wie erbij
 * betrokken was. Het saldo, het startmoment en de deelname zijn van de locatie
 * als geheel. De functies hieronder beantwoorden de vragen op dat niveau, zodat
 * niet elke plek in de code zelf hoeft te weten dat er meerdere regels zijn.
 */

type Client = SupabaseClient<Database>;

/**
 * Het moment waarop deze locatie is gaan meedoen: de dag waarop de eerste
 * collega zich aanmeldde. Null als de locatie niet deelneemt.
 */
export async function startmomentVanLocatie(
  supabase: Client,
  organizationId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("loyalty_accounts")
    .select("enrolled_at")
    .eq("organization_id", organizationId)
    .order("enrolled_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.enrolled_at ?? null;
}

/**
 * Doet deze locatie mee, en sinds wanneer?
 *
 * Een locatie doet mee zolang er minstens één actief account is. Het
 * startmoment blijft het vroegste, ook als die eerste collega inmiddels is
 * vertrokken: de school is toen begonnen, niet de persoon.
 */
export async function deelnameVanLocatie(
  supabase: Client,
  organizationId: string
): Promise<{ neemtDeel: boolean; startmoment: string | null }> {
  const { data } = await supabase
    .from("loyalty_accounts")
    .select("enrolled_at, is_active")
    .eq("organization_id", organizationId)
    .order("enrolled_at", { ascending: true });

  const regels = data ?? [];
  return {
    neemtDeel: regels.some((regel) => regel.is_active),
    startmoment: regels[0]?.enrolled_at ?? null,
  };
}

/**
 * Het account waarop een regel zonder betrokken contactpersoon wordt geboekt,
 * bijvoorbeeld een correctie op een locatie waarvan de contactpersoon weg is.
 * Dat is het oudste account van de locatie.
 */
export async function oudsteAccountVanLocatie(
  supabase: Client,
  organizationId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("loyalty_accounts")
    .select("id")
    .eq("organization_id", organizationId)
    .order("enrolled_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}
