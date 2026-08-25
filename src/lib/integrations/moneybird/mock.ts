import type { MoneybirdContact, MoneybirdSalesInvoice } from "./client";

/**
 * Voorbeelddata voor ontwikkeling zolang MONEYBIRD_API_TOKEN ontbreekt.
 * Zo is de volledige factuurstroom te bouwen en te testen zonder ooit een
 * echte factuur aan te raken.
 */
export const MOCK_CONTACTS: MoneybirdContact[] = [
  {
    id: "mb-contact-1001",
    company_name: "De Goudse Waarden",
    firstname: "Sanne",
    lastname: "de Vries",
    email: "s.devries@goudsewaarden.nl",
    customer_id: "1001",
    city: "Gouda",
    send_invoices_to_email: "administratie@goudsewaarden.nl",
  },
];

export const MOCK_INVOICES: MoneybirdSalesInvoice[] = [
  {
    id: "mb-invoice-2026-00123",
    contact_id: "mb-contact-1001",
    invoice_id: "2026-00123",
    reference: "Cultuurdag 12 maart",
    state: "paid",
    invoice_date: "2026-03-14",
    due_date: "2026-04-11",
    paid_at: "2026-03-28",
    currency: "EUR",
    total_price_excl_tax: "1033.06",
    total_price_incl_tax: "1250.00",
    total_paid: "1250.00",
    total_unpaid: "0.00",
    public_view_code: "mock-code-1",
    url: null,
    updated_at: "2026-03-28T10:15:00.000Z",
    details: [
      {
        id: "mb-line-1",
        description: "Workshop Graffiti - 4 x 90 minuten",
        amount: "4",
        price: "195.00",
        total_price_excl_tax_with_discount: "780.00",
      },
      {
        id: "mb-line-2",
        description: "Starttarief",
        amount: "1",
        price: "150.00",
        total_price_excl_tax_with_discount: "150.00",
      },
      {
        id: "mb-line-3",
        description: "Reiskosten",
        amount: "1",
        price: "45.00",
        total_price_excl_tax_with_discount: "45.00",
      },
      {
        id: "mb-line-4",
        description: "Materiaalkosten",
        amount: "1",
        price: "58.06",
        total_price_excl_tax_with_discount: "58.06",
      },
    ],
  },
  {
    id: "mb-invoice-2026-00187",
    contact_id: "mb-contact-1001",
    invoice_id: "2026-00187",
    reference: "Projectdag mei",
    state: "open",
    invoice_date: "2026-05-02",
    due_date: "2026-05-30",
    paid_at: null,
    currency: "EUR",
    total_price_excl_tax: "537.19",
    total_price_incl_tax: "650.00",
    total_paid: "0.00",
    total_unpaid: "650.00",
    public_view_code: "mock-code-2",
    url: null,
    updated_at: "2026-05-02T09:00:00.000Z",
    details: [
      {
        id: "mb-line-5",
        description: "Workshop Podcast - 2 x 90 minuten",
        amount: "2",
        price: "195.00",
        total_price_excl_tax_with_discount: "390.00",
      },
      {
        id: "mb-line-6",
        description: "Starttarief",
        amount: "1",
        price: "147.19",
        total_price_excl_tax_with_discount: "147.19",
      },
    ],
  },
];
