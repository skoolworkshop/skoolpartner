import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";
import { contactStilte, type ContactStilte, type Lifecycle } from "@/lib/crm/regels";
import type { CrmContactRow, CrmOrganizationProfileRow } from "@/lib/types/database";

/**
 * De relatielijst van Skool Workshop.
 *
 * Dit scherm doet bewust iets anders dan Admin > Organisaties. Dat overzicht
 * beantwoordt "welke klanten hebben wij", deze lijst beantwoordt "met wie moet
 * ik iets doen": wie is nog prospect, bij wie is het lang stil geweest, en van
 * wie is er nog geen eigenaar.
 *
 * De relatiekaart zelf is er al: /admin/organisaties/[id] toont boekingen,
 * facturen, punten, CJP-tegoed, gebruikers en contactpersonen. Die bouw ik niet
 * over. Wat daar ontbrak, de commerciele kant, komt er als blok bij.
 */

export interface Relatie {
  id: string;
  name: string;
  city: string | null;
  kind: string;
  status: string;
  lifecycle: Lifecycle;
  ownerId: string | null;
  ownerNaam: string | null;
  laatsteContact: string | null;
  stilte: ContactStilte;
  volgendeActie: string | null;
  aantalBoekingen: number;
  heeftProfiel: boolean;
}

function vandaag(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Alle organisaties met hun commerciele gegevens erbij.
 *
 * Een organisatie zonder profiel telt als klant. Dat is de eerlijke aanname:
 * alles wat er nu staat is binnengekomen via een boeking of een registratie,
 * dus dat zijn geen prospects.
 */
export async function getRelaties(): Promise<Relatie[]> {
  const supabase = createServiceSupabase();

  const [{ data: organisaties }, { data: profielen }, { data: boekingen }] = await Promise.all([
    supabase
      .from("organizations")
      .select("id, name, city, kind, status")
      .order("name", { ascending: true }),
    supabase.from("crm_organization_profiles").select("*"),
    supabase.from("bookings").select("organization_id"),
  ]);

  const profielPerOrg = new Map<string, CrmOrganizationProfileRow>(
    (profielen ?? []).map((p) => [p.organization_id, p])
  );

  const eigenaarIds = [
    ...new Set((profielen ?? []).map((p) => p.owner_id).filter((id): id is string => Boolean(id))),
  ];
  const { data: eigenaren } = eigenaarIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", eigenaarIds)
    : { data: [] };
  const eigenaarPerId = new Map(
    (eigenaren ?? []).map((p) => [p.id, p.full_name ?? p.email])
  );

  const boekingenPerOrg = new Map<string, number>();
  for (const b of boekingen ?? []) {
    boekingenPerOrg.set(b.organization_id, (boekingenPerOrg.get(b.organization_id) ?? 0) + 1);
  }

  const nu = vandaag();

  return (organisaties ?? []).map((org) => {
    const profiel = profielPerOrg.get(org.id);
    return {
      id: org.id,
      name: org.name,
      city: org.city,
      kind: org.kind,
      status: org.status,
      lifecycle: (profiel?.lifecycle ?? "klant") as Lifecycle,
      ownerId: profiel?.owner_id ?? null,
      ownerNaam: profiel?.owner_id ? (eigenaarPerId.get(profiel.owner_id) ?? null) : null,
      laatsteContact: profiel?.last_contact_at ?? null,
      stilte: contactStilte(profiel?.last_contact_at ?? null, nu),
      volgendeActie: profiel?.next_action_at ?? null,
      aantalBoekingen: boekingenPerOrg.get(org.id) ?? 0,
      heeftProfiel: Boolean(profiel),
    };
  });
}

export interface RelatieFilter {
  lifecycle?: Lifecycle | "alles";
  /** Alleen relaties waar het langer dan dit aantal dagen stil is. */
  stilLanger?: number;
  zoek?: string;
}

/** Filteren gebeurt hier en niet in de database: het gaat om honderden rijen, niet om miljoenen. */
export function filterRelaties(relaties: Relatie[], filter: RelatieFilter): Relatie[] {
  const zoek = filter.zoek?.trim().toLowerCase();

  return relaties.filter((r) => {
    if (filter.lifecycle && filter.lifecycle !== "alles" && r.lifecycle !== filter.lifecycle) {
      return false;
    }
    if (filter.stilLanger !== undefined) {
      if (r.stilte.dagen === null) {
        // Nooit contact gehad telt mee als stil, want dat is juist het geval
        // waar iets aan gedaan moet worden.
        return true;
      }
      if (r.stilte.dagen < filter.stilLanger) return false;
    }
    if (zoek) {
      const hooiberg = `${r.name} ${r.city ?? ""}`.toLowerCase();
      if (!hooiberg.includes(zoek)) return false;
    }
    return true;
  });
}

/** De CRM-gegevens van een organisatie, voor het blok op de organisatiepagina. */
export async function getRelatieProfiel(organizationId: string): Promise<{
  profiel: CrmOrganizationProfileRow | null;
  eigenaarNaam: string | null;
  contacten: CrmContactRow[];
  beheerders: { id: string; naam: string }[];
}> {
  const supabase = createServiceSupabase();

  const [{ data: profiel }, { data: contacten }, { data: beheerders }] = await Promise.all([
    supabase
      .from("crm_organization_profiles")
      .select("*")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    supabase
      .from("crm_contacts")
      .select("*")
      .eq("organization_id", organizationId)
      .order("full_name", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("is_admin", true)
      .order("full_name", { ascending: true }),
  ]);

  const lijst = (beheerders ?? []).map((b) => ({ id: b.id, naam: b.full_name ?? b.email }));

  return {
    profiel: profiel ?? null,
    eigenaarNaam: profiel?.owner_id
      ? (lijst.find((b) => b.id === profiel.owner_id)?.naam ?? null)
      : null,
    contacten: contacten ?? [],
    beheerders: lijst,
  };
}
