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
  aantalContacten: number;
  openDeals: number;
  openWaardeCents: number;
  gewonnenDeals: number;
  omzetCents: number;
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

  const [
    { data: organisaties },
    { data: profielen },
    { data: boekingen },
    { data: contacten },
    { data: deals },
    { data: fases },
    { data: facturen },
  ] = await Promise.all([
    supabase
      .from("organizations")
      .select("id, name, city, kind, status")
      .order("name", { ascending: true }),
    supabase.from("crm_organization_profiles").select("*"),
    supabase.from("bookings").select("organization_id"),
    supabase.from("crm_contacts").select("organization_id"),
    supabase.from("crm_deals").select("organization_id, stage_id, value_cents"),
    supabase.from("crm_pipeline_stages").select("id, is_won, is_lost"),
    // Omzet komt uit de betaalde facturen, niet uit de dealwaarde. Een deal is
    // een verwachting; een betaalde factuur is een feit.
    supabase.from("invoices").select("organization_id, total_paid_cents"),
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

  const contactenPerOrg = new Map<string, number>();
  for (const c of contacten ?? []) {
    if (c.organization_id) {
      contactenPerOrg.set(c.organization_id, (contactenPerOrg.get(c.organization_id) ?? 0) + 1);
    }
  }

  const faseSoort = new Map((fases ?? []).map((f) => [f.id, f]));
  const openPerOrg = new Map<string, { aantal: number; waarde: number }>();
  const gewonnenPerOrg = new Map<string, number>();
  for (const deal of deals ?? []) {
    if (!deal.organization_id) continue;
    const fase = faseSoort.get(deal.stage_id);
    if (fase?.is_won) {
      gewonnenPerOrg.set(deal.organization_id, (gewonnenPerOrg.get(deal.organization_id) ?? 0) + 1);
    } else if (!fase?.is_lost) {
      const huidig = openPerOrg.get(deal.organization_id) ?? { aantal: 0, waarde: 0 };
      openPerOrg.set(deal.organization_id, {
        aantal: huidig.aantal + 1,
        waarde: huidig.waarde + deal.value_cents,
      });
    }
  }

  // Omzet is wat er daadwerkelijk is betaald, niet wat er is gefactureerd en
  // zeker niet wat een deal ooit beloofde.
  const omzetPerOrg = new Map<string, number>();
  for (const factuur of facturen ?? []) {
    if (!factuur.organization_id) continue;
    omzetPerOrg.set(
      factuur.organization_id,
      (omzetPerOrg.get(factuur.organization_id) ?? 0) + (factuur.total_paid_cents ?? 0)
    );
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
      aantalContacten: contactenPerOrg.get(org.id) ?? 0,
      openDeals: openPerOrg.get(org.id)?.aantal ?? 0,
      openWaardeCents: openPerOrg.get(org.id)?.waarde ?? 0,
      gewonnenDeals: gewonnenPerOrg.get(org.id) ?? 0,
      omzetCents: omzetPerOrg.get(org.id) ?? 0,
      heeftProfiel: Boolean(profiel),
    };
  });
}

export interface RelatieFilter {
  lifecycle?: Lifecycle | "alles";
  /** Alleen relaties waar het langer dan dit aantal dagen stil is. */
  stilLanger?: number;
  /** Alleen relaties met een lopende deal. */
  metOpenDeal?: boolean;
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
    if (filter.metOpenDeal && r.openDeals === 0) return false;
    if (zoek) {
      const hooiberg = `${r.name} ${r.city ?? ""}`.toLowerCase();
      if (!hooiberg.includes(zoek)) return false;
    }
    return true;
  });
}

export interface OrganisatieDeal {
  id: string;
  title: string;
  value_cents: number;
  expected_date: string | null;
  faseLabel: string | null;
  afgesloten: "gewonnen" | "verloren" | null;
}

/** De CRM-gegevens van een organisatie, voor het blok op de organisatiepagina. */
export async function getRelatieProfiel(organizationId: string): Promise<{
  profiel: CrmOrganizationProfileRow | null;
  eigenaarNaam: string | null;
  contacten: CrmContactRow[];
  beheerders: { id: string; naam: string }[];
  deals: OrganisatieDeal[];
  omzetCents: number;
  openWaardeCents: number;
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

  const [{ data: dealRijen }, { data: fases }, { data: facturen }] = await Promise.all([
    supabase
      .from("crm_deals")
      .select("id, title, value_cents, expected_date, stage_id")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false }),
    supabase.from("crm_pipeline_stages").select("id, label, is_won, is_lost"),
    supabase.from("invoices").select("total_paid_cents").eq("organization_id", organizationId),
  ]);

  const fasePerId = new Map((fases ?? []).map((f) => [f.id, f]));
  const deals: OrganisatieDeal[] = (dealRijen ?? []).map((d) => {
    const fase = fasePerId.get(d.stage_id);
    return {
      id: d.id,
      title: d.title,
      value_cents: d.value_cents,
      expected_date: d.expected_date,
      faseLabel: fase?.label ?? null,
      afgesloten: fase?.is_won ? "gewonnen" : fase?.is_lost ? "verloren" : null,
    };
  });

  return {
    deals,
    omzetCents: (facturen ?? []).reduce((som, f) => som + (f.total_paid_cents ?? 0), 0),
    openWaardeCents: deals
      .filter((d) => d.afgesloten === null)
      .reduce((som, d) => som + d.value_cents, 0),
    profiel: profiel ?? null,
    eigenaarNaam: profiel?.owner_id
      ? (lijst.find((b) => b.id === profiel.owner_id)?.naam ?? null)
      : null,
    contacten: contacten ?? [],
    beheerders: lijst,
  };
}
