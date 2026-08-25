import type {
  HubSpotCompanyProps,
  HubSpotContactProps,
  HubSpotObject,
} from "./client";

export const MOCK_COMPANIES: HubSpotObject<HubSpotCompanyProps>[] = [
  {
    id: "hs-company-501",
    properties: { name: "De Goudse Waarden", domain: "goudsewaarden.nl", city: "Gouda" },
    updatedAt: "2026-03-01T08:00:00.000Z",
  },
];

export const MOCK_CONTACTS: HubSpotObject<HubSpotContactProps>[] = [
  {
    id: "hs-contact-9001",
    properties: {
      email: "s.devries@goudsewaarden.nl",
      firstname: "Sanne",
      lastname: "de Vries",
      company: "De Goudse Waarden",
      associatedcompanyid: "hs-company-501",
    },
    updatedAt: "2026-03-01T08:05:00.000Z",
  },
];
