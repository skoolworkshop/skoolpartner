"use server";

import { revalidatePath } from "next/cache";

import { requireMember } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { createParkingRequest } from "@/lib/tegoed/mutations";
import { validateParkingInput, type ParkingInput } from "@/lib/tegoed/regels";

export interface ParkingFormState {
  status: "idle" | "ok" | "error";
  message?: string;
  /** Een losse mededeling die niets met de aanvraag zelf te maken heeft. */
  notice?: string;
  errors?: Partial<Record<keyof ParkingInput, string>>;
}

/**
 * Verwerkt het formulier "CJP-tegoed parkeren".
 *
 * De controle uit het formulier wordt hier nog een keer gedaan. Wat de browser
 * stuurt is nooit te vertrouwen, ook niet als het scherm het al had nagekeken.
 */
export async function submitParkingRequest(
  _prev: ParkingFormState,
  formData: FormData
): Promise<ParkingFormState> {
  const session = await requireMember();
  if (session.customerPreview) {
    return { status: "error", message: "CJP-aanvragen verwerkt u vanuit het beheerportaal en niet namens de klant." };
  }
  const settings = await getSettings();

  if (!settings.cjp_parking_enabled) {
    return { status: "error", message: "CJP-tegoed parkeren is op dit moment niet beschikbaar." };
  }

  const input: ParkingInput = {
    schoolName: String(formData.get("school_name") ?? ""),
    cjpSchoolNumber: String(formData.get("cjp_school_number") ?? ""),
    holderName: String(formData.get("holder_name") ?? ""),
    holderEmail: String(formData.get("holder_email") ?? ""),
    holderPhone: String(formData.get("holder_phone") ?? ""),
    amount: String(formData.get("amount") ?? ""),
  };

  const controle = validateParkingInput(input, {
    minimumCents: settings.cjp_minimum_amount_cents,
  });

  if (!controle.ok || !controle.snapshot) {
    return {
      status: "error",
      message: "Er klopt nog iets niet. Kijk de rood gemarkeerde velden even na.",
      errors: controle.errors,
    };
  }

  const resultaat = await createParkingRequest({
    organizationId: session.activeOrganizationId,
    userId: session.userId,
    userEmail: session.email,
    snapshot: controle.snapshot,
  });

  if (!resultaat.ok) {
    return { status: "error", message: resultaat.message };
  }

  revalidatePath("/skoolpartner/cjp-tegoed");
  revalidatePath("/skoolpartner");
  revalidatePath("/account");

  return {
    status: "ok",
    message:
      "Uw aanvraag is bij ons binnen. Wij nemen hem in behandeling en laten u weten zodra het tegoed klaarstaat.",
    notice: resultaat.notice,
  };
}
