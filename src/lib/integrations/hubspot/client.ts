import "server-only";

import { serverEnv } from "@/lib/env";
import { withRetry } from "@/lib/integrations/sync-state";

const BASE_URL = "https://api.hubapi.com";

export interface HubSpotObject<T> {
  id: string;
  properties: T;
  updatedAt?: string;
  archived?: boolean;
}

export interface HubSpotCompanyProps {
  name?: string | null;
  domain?: string | null;
  city?: string | null;
  hs_object_id?: string;
}

export interface HubSpotContactProps {
  email?: string | null;
  firstname?: string | null;
  lastname?: string | null;
  company?: string | null;
  associatedcompanyid?: string | null;
}

export interface HubSpotDealProps {
  dealname?: string | null;
  dealstage?: string | null;
  closedate?: string | null;
  amount?: string | null;
  pipeline?: string | null;
}

export class HubSpotError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "HubSpotError";
    this.status = status;
  }
}

/**
 * HubSpot is een AANVULLENDE bron. Boekingen en workshopuren komen nooit
 * uitsluitend uit HubSpot; de definitieve bevestigingsmail blijft leidend.
 */
export class HubSpotClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  static fromEnv(): HubSpotClient | null {
    return serverEnv.hubspot.token ? new HubSpotClient(serverEnv.hubspot.token) : null;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    return withRetry(async () => {
      const response = await fetch(`${BASE_URL}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
        cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new HubSpotError(`HubSpot ${response.status}: ${body.slice(0, 200)}`, response.status);
      }
      return (await response.json()) as T;
    });
  }

  async listCompanies(after?: string) {
    const search = new URLSearchParams({ limit: "100", properties: "name,domain,city" });
    if (after) search.set("after", after);
    return this.request<{
      results: HubSpotObject<HubSpotCompanyProps>[];
      paging?: { next?: { after: string } };
    }>(`/crm/v3/objects/companies?${search.toString()}`);
  }

  async listContacts(after?: string) {
    const search = new URLSearchParams({
      limit: "100",
      properties: "email,firstname,lastname,company,associatedcompanyid",
    });
    if (after) search.set("after", after);
    return this.request<{
      results: HubSpotObject<HubSpotContactProps>[];
      paging?: { next?: { after: string } };
    }>(`/crm/v3/objects/contacts?${search.toString()}`);
  }

  async listDeals(after?: string) {
    const search = new URLSearchParams({
      limit: "100",
      properties: "dealname,dealstage,closedate,amount,pipeline",
    });
    if (after) search.set("after", after);
    return this.request<{
      results: HubSpotObject<HubSpotDealProps>[];
      paging?: { next?: { after: string } };
    }>(`/crm/v3/objects/deals?${search.toString()}`);
  }
}
