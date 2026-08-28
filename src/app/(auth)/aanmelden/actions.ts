"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { completeRegistration } from "@/lib/organizations/registration";
import { lookupOrganizationAddress } from "@/lib/organizations/address-lookup";
import { searchOrganizations } from "@/lib/organizations/service";
import { validateRegistration, type FieldName, type RegistrationInput } from "@/lib/registration";

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

/** Zoekt op postcode of naam; bij meerdere vestigingen is de postcode leidend. */
export async function lookupAddressAction(
  _prev: AddressLookupState,
  formData: FormData
): Promise<AddressLookupState> {
  await requireUser();
  return lookupOrganizationAddress({
    organizationName: String(formData.get("organization_name") ?? ""),
    postalCode: String(formData.get("postal_code") ?? ""),
    houseNumber: String(formData.get("house_number") ?? ""),
  });
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
