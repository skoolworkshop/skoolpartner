import "server-only";

import { integrationMode } from "@/lib/env";
import { createServiceSupabase } from "@/lib/supabase/server";
import {
  markSyncError,
  markSyncStart,
  markSyncSuccess,
  type SyncResult,
} from "@/lib/integrations/sync-state";
import { emailDomain } from "@/lib/utils";
import {
  HubSpotClient,
  type HubSpotCompanyProps,
  type HubSpotContactProps,
  type HubSpotObject,
} from "./client";
import { MOCK_COMPANIES, MOCK_CONTACTS } from "./mock";

/**
 * Koppelt een HubSpot-company aan een organisatie in Mijn Skool.
 *
 * Nooit alleen op bedrijfsnaam: dat is te onbetrouwbaar. Een geverifieerd
 * domein is het enige signaal dat automatisch mag koppelen. Lukt dat niet, dan
 * wordt de mapping als voorstel bewaard met een lage confidence.
 */
async function mapCompany(company: HubSpotObject<HubSpotCompanyProps>) {
  const supabase = createServiceSupabase();
  const domain = company.properties.domain?.toLowerCase().replace(/^www\./, "") ?? null;

  let organizationId: string | null = null;
  let confidence = 0;

  if (domain) {
    const { data: isPublic } = await supabase
      .from("public_email_domains")
      .select("domain")
      .eq("domain", domain)
      .maybeSingle();

    if (!isPublic) {
      const { data: matches } = await supabase
        .from("organization_domains")
        .select("organization_id")
        .eq("domain", domain)
        .eq("is_verified", true);

      if (matches && matches.length === 1) {
        organizationId = matches[0].organization_id;
        confidence = 1;
      }
    }
  }

  if (!organizationId) return { mapped: false };

  await supabase.from("external_record_mappings").upsert(
    {
      system: "hubspot",
      entity_type: "company",
      internal_table: "organizations",
      internal_id: organizationId,
      external_id: company.id,
      external_label: company.properties.name ?? null,
      confidence,
      extra: { domain, city: company.properties.city ?? null },
    },
    { onConflict: "system,entity_type,external_id" }
  );

  return { mapped: true };
}

/** Koppelt een HubSpot-contact aan een bestaande contactpersoon op e-mailadres. */
async function mapContact(contact: HubSpotObject<HubSpotContactProps>) {
  const email = contact.properties.email?.toLowerCase();
  if (!email) return { mapped: false };

  const supabase = createServiceSupabase();
  const domain = emailDomain(email);
  if (!domain) return { mapped: false };

  const { data: existing } = await supabase
    .from("organization_contacts")
    .select("id, organization_id")
    .eq("email", email)
    .maybeSingle();

  if (!existing) return { mapped: false };

  await supabase
    .from("organization_contacts")
    .update({ hubspot_contact_id: contact.id })
    .eq("id", existing.id);

  await supabase.from("external_record_mappings").upsert(
    {
      system: "hubspot",
      entity_type: "contact",
      internal_table: "organization_contacts",
      internal_id: existing.id,
      external_id: contact.id,
      external_label: email,
      confidence: 1,
    },
    { onConflict: "system,entity_type,external_id" }
  );

  return { mapped: true };
}

export async function syncHubSpot(): Promise<SyncResult> {
  const mode = integrationMode("hubspot");
  await markSyncStart("hubspot");

  try {
    let companies: HubSpotObject<HubSpotCompanyProps>[];
    let contacts: HubSpotObject<HubSpotContactProps>[];

    if (mode === "mock") {
      companies = MOCK_COMPANIES;
      contacts = MOCK_CONTACTS;
    } else {
      const client = HubSpotClient.fromEnv();
      if (!client) throw new Error("HubSpot-client kon niet worden opgezet");
      companies = (await client.listCompanies()).results;
      contacts = (await client.listContacts()).results;
    }

    let mappedCompanies = 0;
    for (const company of companies) {
      const result = await mapCompany(company);
      if (result.mapped) mappedCompanies += 1;
    }

    let mappedContacts = 0;
    for (const contact of contacts) {
      const result = await mapContact(contact);
      if (result.mapped) mappedContacts += 1;
    }

    await markSyncSuccess("hubspot", {
      itemsProcessed: companies.length + contacts.length,
      metadata: { mode, companies: mappedCompanies, contacts: mappedContacts },
    });

    return {
      integration: "hubspot",
      ok: true,
      mode,
      itemsProcessed: companies.length + contacts.length,
      details: { mapped_companies: mappedCompanies, mapped_contacts: mappedContacts },
    };
  } catch (error) {
    await markSyncError("hubspot", error);
    return {
      integration: "hubspot",
      ok: false,
      mode,
      itemsProcessed: 0,
      message: error instanceof Error ? error.message : "Onbekende fout",
    };
  }
}
