"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { completeRegistration } from "@/lib/organizations/registration";
import { searchOrganizations } from "@/lib/organizations/service";
import { createServiceSupabase } from "@/lib/supabase/server";
import { normalizePostalCode, validateRegistration, type FieldName, type RegistrationInput } from "@/lib/registration";

export interface OrganizationOption {
  id: string;
  name: string;
  city: string | null;
  kind: string;
  street: string | null;
  houseNumber: string | null;
  houseNumberAddition: string | null;
  postalCode: string | null;
}

export interface JoinState {
  status: "idle" | "ok" | "error";
  message?: string;
  results?: OrganizationOption[];
}

export interface AddressLookupState {
  status: "idle" | "ok" | "error";
  message?: string;
  address?: { street: string; houseNumber: string; houseNumberAddition: string; postalCode: string; city: string };
}

export interface RegistrationState {
  status: "idle" | "error";
  message?: string;
  errors: Partial<Record<FieldName, string>>;
  /** Wat de gebruiker invulde, zodat een fout het formulier niet leegmaakt. */
  input?: RegistrationInput;
}

export async function searchOrganizationsAction(
  _prev: JoinState,
  formData: FormData
): Promise<JoinState> {
  await requireUser();
  const query = String(formData.get("query") ?? "");
  if (query.trim().length < 2) {
    return { status: "error", message: "Vul minstens twee letters in." };
  }
  const rows = await searchOrganizations(query);
  const results: OrganizationOption[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    city: row.city,
    kind: row.kind,
    street: row.street,
    houseNumber: row.house_number,
    houseNumberAddition: row.house_number_addition,
    postalCode: row.postal_code,
  }));
  if (results.length === 0) {
    return {
      status: "ok",
      message:
        "Geen organisatie gevonden. Vul hieronder de naam en het adres in, dan maken wij haar aan.",
      results: [],
    };
  }
  return { status: "ok", results };
}

/** Zoekt eerst in SkoolPartner en gebruikt voor een nieuw adres de openbare BAG/PDOK-service. */
export async function lookupAddressAction(
  _prev: AddressLookupState,
  formData: FormData
): Promise<AddressLookupState> {
  await requireUser();
  const organizationName = String(formData.get("organization_name") ?? "").trim();
  const postalCode = normalizePostalCode(String(formData.get("postal_code") ?? ""));
  const enteredHouseNumber = String(formData.get("house_number") ?? "").replace(/\D/g, "");

  if (organizationName.length < 2 || !postalCode) {
    return { status: "error", message: "Vul eerst de schoolnaam en een geldige postcode in." };
  }

  const service = createServiceSupabase();
  const { data: existing } = await service
    .from("organizations")
    .select("street, house_number, house_number_addition, postal_code, city")
    .ilike("name", `%${organizationName}%`)
    .eq("postal_code", postalCode)
    .limit(1)
    .maybeSingle();

  if (existing?.street && existing.city) {
    return {
      status: "ok",
      message: "Adres overgenomen van de bestaande school.",
      address: {
        street: existing.street,
        houseNumber: existing.house_number ?? enteredHouseNumber,
        houseNumberAddition: existing.house_number_addition ?? "",
        postalCode: existing.postal_code ?? postalCode,
        city: existing.city,
      },
    };
  }

  const query = [postalCode, enteredHouseNumber].filter(Boolean).join(" ");
  const url = new URL("https://api.pdok.nl/bzk/locatieserver/search/v3_1/free");
  url.searchParams.set("q", query);
  url.searchParams.set("fq", "type:adres");
  url.searchParams.set("rows", "1");

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(6000), cache: "no-store" });
    if (!response.ok) throw new Error(`PDOK gaf status ${response.status}`);
    const payload = (await response.json()) as {
      response?: { docs?: Array<{ straatnaam?: string; huisnummer?: number; huisletter?: string; huisnummertoevoeging?: string; postcode?: string; woonplaatsnaam?: string }> };
    };
    const found = payload.response?.docs?.[0];
    if (!found?.straatnaam || !found.woonplaatsnaam) {
      return { status: "error", message: "Bij deze postcode is geen adres gevonden. Vul het adres handmatig in." };
    }
    return {
      status: "ok",
      message: "Straat en plaats zijn gevonden. Controleer het huisnummer nog even.",
      address: {
        street: found.straatnaam,
        houseNumber: enteredHouseNumber || "",
        houseNumberAddition: enteredHouseNumber ? [found.huisletter, found.huisnummertoevoeging].filter(Boolean).join("") : "",
        postalCode: found.postcode ?? postalCode,
        city: found.woonplaatsnaam,
      },
    };
  } catch (error) {
    console.error("[registratie] adres opzoeken mislukt", error);
    return { status: "error", message: "Automatisch zoeken lukte nu niet. U kunt het adres wel handmatig invullen." };
  }
}

/**
 * Rondt de registratie af. Dit is het moment waarop SkoolPartner begint voor
 * een nieuwe organisatie. De echte regels staan in completeRegistration; hier
 * gebeurt alleen het uitlezen en controleren van het formulier.
 */
export async function completeRegistrationAction(
  _prev: RegistrationState,
  formData: FormData
): Promise<RegistrationState> {
  const session = await requireUser();

  const input: RegistrationInput = {
    firstName: String(formData.get("first_name") ?? ""),
    lastName: String(formData.get("last_name") ?? ""),
    jobTitle: String(formData.get("job_title") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    organizationName: String(formData.get("organization_name") ?? ""),
    street: String(formData.get("street") ?? ""),
    houseNumber: String(formData.get("house_number") ?? ""),
    houseNumberAddition: String(formData.get("house_number_addition") ?? ""),
    postalCode: String(formData.get("postal_code") ?? ""),
    city: String(formData.get("city") ?? ""),
    hasCjp: String(formData.get("has_cjp") ?? "onbekend"),
    cjpSchoolNumber: String(formData.get("cjp_school_number") ?? ""),
  };

  const check = validateRegistration(input);
  if (!check.ok || !check.values) {
    return {
      status: "error",
      message: "Er ontbreekt nog iets. Kijk hieronder welke velden zijn gemarkeerd.",
      errors: check.errors,
      input,
    };
  }

  const organizationId = String(formData.get("organization_id") ?? "").trim() || null;

  let result;
  try {
    result = await completeRegistration({
      userId: session.userId,
      userEmail: session.email,
      values: check.values,
      organizationId,
    });
  } catch (error) {
    console.error("[registratie] onverwachte fout bij afronden", error);
    return {
      status: "error",
      message: "Uw registratie kon nu niet worden afgerond. Uw invoer is bewaard; probeer het opnieuw.",
      errors: {},
      input,
    };
  }

  if (!result.ok) {
    const extra =
      session.isAdmin && result.technicalReason
        ? ` (technische melding: ${result.technicalReason})`
        : "";
    return { status: "error", message: `${result.message}${extra}`, errors: {}, input };
  }

  redirect(result.state === "active" ? "/dashboard" : "/wachten");
}
