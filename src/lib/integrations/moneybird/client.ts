import "server-only";

import { serverEnv } from "@/lib/env";
import { withRetry } from "@/lib/integrations/sync-state";

const BASE_URL = "https://moneybird.com/api/v2";

export interface MoneybirdInvoiceDetail {
  id: string;
  description: string | null;
  amount: string | null;
  price: string | null;
  total_price_excl_tax_with_discount: string | null;
}

export interface MoneybirdSalesInvoice {
  id: string;
  administration_id?: string;
  contact_id: string | null;
  invoice_id: string | null;
  reference: string | null;
  state: string;
  invoice_date: string | null;
  due_date: string | null;
  paid_at: string | null;
  currency: string | null;
  total_price_excl_tax: string | null;
  total_price_incl_tax: string | null;
  total_paid: string | null;
  total_unpaid: string | null;
  public_view_code: string | null;
  url: string | null;
  updated_at: string | null;
  details?: MoneybirdInvoiceDetail[];
  contact?: MoneybirdContact | null;
}

export interface MoneybirdContact {
  id: string;
  company_name: string | null;
  firstname: string | null;
  lastname: string | null;
  email: string | null;
  customer_id: string | null;
  city: string | null;
  send_invoices_to_email: string | null;
}

export class MoneybirdError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "MoneybirdError";
    this.status = status;
  }
}

/**
 * Moneybird is de primaire financiële bron. Alle aanroepen gebeuren
 * server-side; de klantbrowser krijgt nooit het API-token te zien.
 */
export class MoneybirdClient {
  private token: string;
  private administrationId: string;

  constructor(token: string, administrationId: string) {
    this.token = token;
    this.administrationId = administrationId;
  }

  static fromEnv(): MoneybirdClient | null {
    const { apiToken, administrationId } = serverEnv.moneybird;
    if (!apiToken || !administrationId) return null;
    return new MoneybirdClient(apiToken, administrationId);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${BASE_URL}/${this.administrationId}${path}`;
    return withRetry(async () => {
      const response = await fetch(url, {
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
        throw new MoneybirdError(
          `Moneybird ${response.status}: ${body.slice(0, 200)}`,
          response.status
        );
      }
      return (await response.json()) as T;
    });
  }

  /** Verkoopfacturen sinds een bepaald moment. Standaard gepagineerd per 100. */
  async listSalesInvoices(params: { updatedAfter?: string; page?: number } = {}) {
    const search = new URLSearchParams();
    search.set("per_page", "100");
    if (params.page) search.set("page", String(params.page));
    if (params.updatedAfter) search.set("filter", `updated_after:${params.updatedAfter}`);
    return this.request<MoneybirdSalesInvoice[]>(`/sales_invoices.json?${search.toString()}`);
  }

  async getSalesInvoice(id: string) {
    return this.request<MoneybirdSalesInvoice>(`/sales_invoices/${id}.json`);
  }

  async getContact(id: string) {
    return this.request<MoneybirdContact>(`/contacts/${id}.json`);
  }

  async listContacts(params: { query?: string; page?: number } = {}) {
    const search = new URLSearchParams();
    search.set("per_page", "100");
    if (params.page) search.set("page", String(params.page));
    if (params.query) search.set("query", params.query);
    return this.request<MoneybirdContact[]>(`/contacts.json?${search.toString()}`);
  }

  /**
   * Haalt de PDF op. Moneybird stuurt een redirect naar een URL die 30
   * seconden geldig is; die halen we hier server-side op zodat de klant
   * nooit een directe Moneybird-link krijgt.
   */
  async downloadInvoicePdf(id: string): Promise<ArrayBuffer> {
    const url = `${BASE_URL}/${this.administrationId}/sales_invoices/${id}/download_pdf`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
      redirect: "follow",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new MoneybirdError(`Moneybird PDF ${response.status}`, response.status);
    }
    return response.arrayBuffer();
  }
}

/** "1234.56" -> 123456 (centen). Voorkomt afrondingsfouten met floats. */
export function amountToCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const normalized = String(value).replace(/\s/g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}
