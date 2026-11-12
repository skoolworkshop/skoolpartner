import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/types/database";

/**
 * Een contactpersoon van een locatie vastleggen of bijwerken.
 *
 * WAAROM DIT EEN EIGEN FUNCTIE IS
 *
 *   Dit gebeurde eerder met een upsert op (organization_id, email). De unieke
 *   index op deze tabel staat echter op (organization_id, lower(email)), en een
 *   upsert kan zo'n index niet als doel gebruiken. De database weigerde de
 *   opdracht daardoor elke keer, en omdat het resultaat niet werd bekeken viel
 *   dat niet op: de contactpersoon kwam er gewoon niet.
 *
 *   Daarom hier in twee stappen: eerst kijken of hij er al is, dan bijwerken of
 *   toevoegen. Lopen twee aanvragen precies gelijk, dan botst de tweede op de
 *   unieke index en werkt hij alsnog de bestaande regel bij.
 *
 * WAT NIET WORDT OVERSCHREVEN
 *
 *   Velden die de aanroeper niet meegeeft blijven staan. In het bijzonder de
 *   Moneybird-koppeling: die legt alleen een beheerder vast, en mag hier nooit
 *   ongemerkt verdwijnen.
 */

type Client = SupabaseClient<Database>;

export interface ContactGegevens {
  organizationId: string;
  email: string;
  fullName?: string | null;
  userId?: string | null;
  verifiedBy?: string | null;
}

export async function bewaarGeverifieerdContact(
  supabase: Client,
  gegevens: ContactGegevens
): Promise<{ ok: boolean; id?: string; message?: string }> {
  const email = gegevens.email.trim().toLowerCase();
  if (!email) return { ok: false, message: "Geen e-mailadres" };

  const velden = wijzigingen(gegevens);

  const bestaand = await zoek(supabase, gegevens.organizationId, email);
  if (bestaand) return werkBij(supabase, bestaand, velden);

  const { data, error } = await supabase
    .from("organization_contacts")
    .insert({ organization_id: gegevens.organizationId, email, ...velden })
    .select("id")
    .maybeSingle();

  if (!error && data) return { ok: true, id: data.id };

  // 23505: de regel is er net tussendoor gekomen. Dan alsnog bijwerken.
  if (error?.code === "23505") {
    const alsnog = await zoek(supabase, gegevens.organizationId, email);
    if (alsnog) return werkBij(supabase, alsnog, velden);
  }

  console.error("[contacten] contactpersoon vastleggen mislukt", error?.message);
  return { ok: false, message: error?.message ?? "Contactpersoon kon niet worden vastgelegd" };
}

/** Alleen wat is meegegeven, plus de verificatie zelf. */
export function wijzigingen(gegevens: ContactGegevens) {
  const velden: {
    is_verified: boolean;
    verified_at: string;
    full_name?: string | null;
    user_id?: string | null;
    verified_by?: string | null;
  } = {
    is_verified: true,
    verified_at: new Date().toISOString(),
  };
  if (gegevens.fullName !== undefined && gegevens.fullName !== null) velden.full_name = gegevens.fullName;
  if (gegevens.userId !== undefined && gegevens.userId !== null) velden.user_id = gegevens.userId;
  if (gegevens.verifiedBy !== undefined && gegevens.verifiedBy !== null) velden.verified_by = gegevens.verifiedBy;
  return velden;
}

async function zoek(supabase: Client, organizationId: string, email: string): Promise<string | null> {
  // Adressen worden overal in kleine letters opgeslagen. De tweede poging is er
  // voor een regel die ooit met hoofdletters is ingevoerd.
  const { data: exact } = await supabase
    .from("organization_contacts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("email", email)
    .maybeSingle();
  if (exact) return exact.id;

  const { data: ruim } = await supabase
    .from("organization_contacts")
    .select("id, email")
    .eq("organization_id", organizationId)
    .ilike("email", email.replace(/[\\%_]/g, (teken) => `\\${teken}`));
  return (ruim ?? []).find((regel) => regel.email.toLowerCase() === email)?.id ?? null;
}

async function werkBij(
  supabase: Client,
  id: string,
  velden: ReturnType<typeof wijzigingen>
): Promise<{ ok: boolean; id?: string; message?: string }> {
  const { error } = await supabase.from("organization_contacts").update(velden).eq("id", id);
  if (error) {
    console.error("[contacten] contactpersoon bijwerken mislukt", error.message);
    return { ok: false, message: error.message };
  }
  return { ok: true, id };
}
