import "server-only";

import { normalizePostalCode } from "@/lib/registration";
import { createServiceSupabase } from "@/lib/supabase/server";

export interface OrganizationAddress {
  street: string;
  houseNumber: string;
  houseNumberAddition: string;
  postalCode: string;
  city: string;
}

export interface OrganizationAddressLookupResult {
  status: "ok" | "error";
  message: string;
  address?: OrganizationAddress;
}

type AddressRow = {
  name: string;
  street: string | null;
  house_number: string | null;
  house_number_addition: string | null;
  postal_code: string | null;
  city: string | null;
};

function usableAddress(row: AddressRow): row is AddressRow & {
  street: string;
  postal_code: string;
  city: string;
} {
  return Boolean(row.street && row.postal_code && row.city);
}

function toAddress(row: AddressRow & { street: string; postal_code: string; city: string }): OrganizationAddress {
  return {
    street: row.street,
    houseNumber: row.house_number ?? "",
    houseNumberAddition: row.house_number_addition ?? "",
    postalCode: row.postal_code,
    city: row.city,
  };
}

function uniqueAddresses(rows: AddressRow[]) {
  const unique = new Map<string, AddressRow & { street: string; postal_code: string; city: string }>();
  for (const row of rows.filter(usableAddress)) {
    const key = [row.street, row.house_number, row.house_number_addition, row.postal_code, row.city]
      .map((part) => (part ?? "").trim().toLowerCase())
      .join("|");
    unique.set(key, row);
  }
  return [...unique.values()];
}

/**
 * Zoekt een vestigingsadres op organisatienaam en/of postcode.
 *
 * Een postcode is bewust leidend. Dezelfde schoolnaam kan namelijk meerdere
 * vestigingen hebben. Zonder postcode vullen we alleen automatisch in als de
 * naam precies één uniek adres oplevert; anders moet de gebruiker eerst de
 * postcode toevoegen.
 */
export async function lookupOrganizationAddress(input: {
  organizationName: string;
  postalCode: string;
  houseNumber?: string;
}): Promise<OrganizationAddressLookupResult> {
  const organizationName = input.organizationName.trim();
  const postalCode = normalizePostalCode(input.postalCode);
  const enteredHouseNumber = (input.houseNumber ?? "").replace(/\D/g, "");

  if (!postalCode && organizationName.length < 2) {
    return {
      status: "error",
      message: "Vul een postcode of minstens twee letters van de organisatienaam in.",
    };
  }

  const service = createServiceSupabase();

  if (postalCode) {
    // Eerst postcode én naam. Als dezelfde organisatie meerdere vestigingen
    // heeft, komt hierdoor uitsluitend de gekozen postcode naar voren.
    let matchingRows: AddressRow[] = [];
    if (organizationName.length >= 2) {
      const { data } = await service
        .from("organizations")
        .select("name, street, house_number, house_number_addition, postal_code, city")
        .eq("postal_code", postalCode)
        .ilike("name", `%${organizationName}%`)
        .limit(10);
      matchingRows = (data ?? []) as AddressRow[];
    }

    // De postcode blijft leidend wanneer de naam net anders is geschreven.
    if (uniqueAddresses(matchingRows).length === 0) {
      const { data } = await service
        .from("organizations")
        .select("name, street, house_number, house_number_addition, postal_code, city")
        .eq("postal_code", postalCode)
        .limit(10);
      matchingRows = (data ?? []) as AddressRow[];
    }

    const knownAddresses = uniqueAddresses(matchingRows);
    if (knownAddresses.length === 1) {
      return {
        status: "ok",
        message: "Adres overgenomen van de vestiging met deze postcode.",
        address: toAddress(knownAddresses[0]),
      };
    }

    // Staat de vestiging nog niet in SkoolPartner, dan kan de openbare BAG/PDOK
    // de straat en woonplaats op postcode (en indien bekend huisnummer) vinden.
    const query = [postalCode, enteredHouseNumber].filter(Boolean).join(" ");
    const url = new URL("https://api.pdok.nl/bzk/locatieserver/search/v3_1/free");
    url.searchParams.set("q", query);
    url.searchParams.set("fq", "type:adres");
    url.searchParams.set("rows", "1");

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(6000), cache: "no-store" });
      if (!response.ok) throw new Error(`PDOK gaf status ${response.status}`);
      const payload = (await response.json()) as {
        response?: {
          docs?: Array<{
            straatnaam?: string;
            huisnummer?: number;
            huisletter?: string;
            huisnummertoevoeging?: string;
            postcode?: string;
            woonplaatsnaam?: string;
          }>;
        };
      };
      const found = payload.response?.docs?.[0];
      if (!found?.straatnaam || !found.woonplaatsnaam) {
        return { status: "error", message: "Bij deze postcode is geen adres gevonden. Vul het adres handmatig in." };
      }
      return {
        status: "ok",
        message: enteredHouseNumber
          ? "Het adres is gevonden. Controleer de gegevens nog even."
          : "Straat en woonplaats zijn gevonden. Vul en controleer het huisnummer nog even.",
        address: {
          street: found.straatnaam,
          houseNumber: enteredHouseNumber || "",
          houseNumberAddition: enteredHouseNumber
            ? [found.huisletter, found.huisnummertoevoeging].filter(Boolean).join("")
            : "",
          postalCode: found.postcode ?? postalCode,
          city: found.woonplaatsnaam,
        },
      };
    } catch (error) {
      console.error("[organisatie] adres opzoeken mislukt", error);
      return {
        status: "error",
        message: "Automatisch zoeken lukte nu niet. U kunt het adres wel handmatig invullen.",
      };
    }
  }

  const { data } = await service
    .from("organizations")
    .select("name, street, house_number, house_number_addition, postal_code, city")
    .ilike("name", `%${organizationName}%`)
    .limit(20);
  const knownAddresses = uniqueAddresses((data ?? []) as AddressRow[]);

  if (knownAddresses.length === 1) {
    return {
      status: "ok",
      message: "Adres gevonden op basis van de organisatienaam.",
      address: toAddress(knownAddresses[0]),
    };
  }
  if (knownAddresses.length > 1) {
    return {
      status: "error",
      message: "Deze organisatie heeft meerdere vestigingen. Vul de postcode in; die bepaalt welke vestiging wordt gebruikt.",
    };
  }
  return {
    status: "error",
    message: "Geen adres gevonden op deze organisatienaam. Vul een postcode in of voer het adres handmatig in.",
  };
}
