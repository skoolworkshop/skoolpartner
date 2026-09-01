"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect, RedirectType } from "next/navigation";
import { after } from "next/server";

import { ACTIVE_ORGANIZATION_COOKIE, requireUser } from "@/lib/auth/session";
import { completeRegistration } from "@/lib/organizations/registration";
import { lookupOrganizationAddress } from "@/lib/organizations/address-lookup";
import { fetchOrganizationLogo } from "@/lib/organizations/logo";
import { searchOrganizations } from "@/lib/organizations/service";
import { validateRegistration, type FieldName, type RegistrationInput } from "@/lib/registration";
import { createServerSupabase } from "@/lib/supabase/server";

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
      message: "Het afronden van je registratie is niet gelukt. Probeer het opnieuw.",
      errors: {},
      input,
    };
  }

  if (!result.ok) {
    const extra =
      session.isAdmin && result.technicalReason
        ? ` (technische melding: ${result.technicalReason})`
        : "";
    return {
      status: "error",
      message: session.isAdmin
        ? `${result.message}${extra}`
        : "Het afronden van je registratie is niet gelukt. Probeer het opnieuw.",
      errors: {},
      input,
    };
  }

  if (result.state === "active") {
    // De Auth-gebruiker moet na de database-write nog steeds aantoonbaar de
    // ingelogde gebruiker zijn. We markeren onboarding in user_metadata voor
    // een duurzame UX-status; autorisatie blijft uitsluitend gebaseerd op het
    // server-side gecontroleerde actieve lidmaatschap.
    const authClient = await createServerSupabase();
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser();

    if (userError || !user || user.id !== session.userId) {
      console.error("[registratie] Auth-sessie kon na opslaan niet worden bevestigd", {
        expectedUserId: session.userId,
        actualUserId: user?.id ?? null,
        message: userError?.message ?? null,
      });
      return {
        status: "error",
        message: "Het afronden van je registratie is niet gelukt. Probeer het opnieuw.",
        errors: {},
        input,
      };
    }

    const completedAt = new Date().toISOString();
    const {
      data: { user: updatedUser },
      error: metadataError,
    } = await authClient.auth.updateUser({
      data: {
        ...user.user_metadata,
        onboarding_completed: true,
        onboarding_completed_at: completedAt,
      },
    });

    if (
      metadataError ||
      !updatedUser ||
      updatedUser.id !== session.userId ||
      updatedUser.user_metadata?.onboarding_completed !== true
    ) {
      console.error("[registratie] onboardingstatus in Auth opslaan mislukt", {
        userId: session.userId,
        returnedUserId: updatedUser?.id ?? null,
        completed: updatedUser?.user_metadata?.onboarding_completed ?? null,
        message: metadataError?.message ?? null,
      });
      return {
        status: "error",
        message: "Het afronden van je registratie is niet gelukt. Probeer het opnieuw.",
        errors: {},
        input,
      };
    }

    // Het zetten van deze cookie maakt de nieuwe organisatie ondubbelzinnig
    // actief en zorgt er in Next.js tevens voor dat de huidige Router Cache
    // niet met de oude onboardingweergave blijft werken.
    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_ORGANIZATION_COOKIE, result.organizationId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

    // requireUser() heeft aan het begin van deze Server Action nog de oude
    // sessiecontext zonder lidmaatschap gelezen. Wis daarom vóór de redirect
    // alle route-/layoutpayloads die die oude toestand kunnen bevatten.
    revalidatePath("/", "layout");
    revalidatePath("/aanmelden");
    revalidatePath("/dashboard");

    // Een externe schoolwebsite kan traag of onbereikbaar zijn. Het logo wordt
    // daarom pas na het antwoord opgehaald en houdt de registratie nooit tegen.
    after(async () => {
      try {
        await fetchOrganizationLogo({
          organizationId: result.organizationId,
          actorId: session.userId,
          actorEmail: session.email,
        });
      } catch (error) {
        console.error("[registratie] logo ophalen na afronden mislukt", error);
      }
    });

    // Server Actions gebruiken standaard push. Replace voorkomt dat de
    // afgeronde onboarding met de terugknop opnieuw actief wordt.
    redirect("/dashboard", RedirectType.replace);
  }

  revalidatePath("/wachten");
  redirect("/wachten", RedirectType.replace);
}
