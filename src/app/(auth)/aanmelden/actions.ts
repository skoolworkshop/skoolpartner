"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { completeRegistration } from "@/lib/organizations/registration";
import { searchOrganizations } from "@/lib/organizations/service";
import { validateRegistration, type FieldName, type RegistrationInput } from "@/lib/registration";

export interface JoinState {
  status: "idle" | "ok" | "error";
  message?: string;
  results?: { id: string; name: string; city: string | null; kind: string }[];
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
  const results = await searchOrganizations(query);
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

  const result = await completeRegistration({
    userId: session.userId,
    userEmail: session.email,
    values: check.values,
    organizationId,
  });

  if (!result.ok) {
    const extra =
      session.isAdmin && result.technicalReason
        ? ` (technische melding: ${result.technicalReason})`
        : "";
    return { status: "error", message: `${result.message}${extra}`, errors: {}, input };
  }

  redirect(result.state === "active" ? "/dashboard" : "/wachten");
}
