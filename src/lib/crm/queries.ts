import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";
import { sorteerFases, type Fase, type FaseOverzicht, type Merk } from "@/lib/crm/merk";
import type { CrmContactRow, CrmOrganizationProfileRow } from "@/lib/types/database";

/**
 * Leesvragen voor het CRM.
 *
 * Alles loopt via de serviceclient, want de CRM-tabellen hebben geen enkele
 * policy voor ingelogde gebruikers. Dat is met opzet: de klantkant kan er
 * daardoor niet bij, ook niet per ongeluk.
 *
 * Elke aanroeper moet zelf al geautoriseerd hebben. In de praktijk gebeurt dat
 * in de layout van het beheerportaal met requireAdmin().
 */

export async function getFases(merk: Merk): Promise<FaseOverzicht> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("crm_pipeline_stages")
    .select("id, brand, key, label, description, position, is_won, is_lost")
    .eq("brand", merk)
    .order("position", { ascending: true });

  if (error) throw new Error(`Fases ophalen mislukt: ${error.message}`);
  return sorteerFases((data ?? []) as Fase[]);
}

export interface CrmCijfers {
  /** Personen die bij dit merk horen. */
  personen: number;
  /** Daarvan: personen zonder organisatie. Bij Suri is dat het normale geval. */
  zonderOrganisatie: number;
  /** Organisaties met een ingevuld CRM-profiel. */
  metProfiel: number;
  /** Organisaties die nog geen profiel hebben. */
  zonderProfiel: number;
}

/**
 * De cijfers voor het CRM-overzicht.
 *
 * Let op: in deze fase bestaan er nog geen deals, dus een persoon hangt nog
 * niet aan een merk. Wat hier per merk wordt geteld is daarom een benadering
 * op basis van "heeft wel of geen organisatie". Zodra deals bestaan, komt de
 * telling daarvandaan. Dat staat er liever eerlijk bij dan dat er een getal
 * op het scherm komt dat iets anders betekent dan het zegt.
 */
export async function getCijfers(merk: Merk): Promise<CrmCijfers> {
  const supabase = createServiceSupabase();

  const [alleContacten, losseContacten, profielen, organisaties] = await Promise.all([
    supabase.from("crm_contacts").select("id", { count: "exact", head: true }),
    supabase
      .from("crm_contacts")
      .select("id", { count: "exact", head: true })
      .is("organization_id", null),
    supabase.from("crm_organization_profiles").select("organization_id", { count: "exact", head: true }),
    supabase.from("organizations").select("id", { count: "exact", head: true }),
  ]);

  const totaal = alleContacten.count ?? 0;
  const los = losseContacten.count ?? 0;
  const metProfiel = profielen.count ?? 0;
  const orgTotaal = organisaties.count ?? 0;

  return {
    personen: merk === "suri_impact" ? los : totaal - los,
    zonderOrganisatie: los,
    metProfiel,
    zonderProfiel: Math.max(orgTotaal - metProfiel, 0),
  };
}

/** Het CRM-profiel van een organisatie, of null als er nog geen is. */
export async function getOrganisatieProfiel(
  organizationId: string
): Promise<CrmOrganizationProfileRow | null> {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("crm_organization_profiles")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();

  return data ?? null;
}

/** De personen die bij een organisatie horen. */
export async function getContacten(organizationId: string): Promise<CrmContactRow[]> {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("crm_contacts")
    .select("*")
    .eq("organization_id", organizationId)
    .order("full_name", { ascending: true });

  return data ?? [];
}
