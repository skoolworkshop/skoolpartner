"use server";

import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { resolveSiteUrl } from "@/lib/site-url";
import { createServerSupabase } from "@/lib/supabase/server";

export interface AuthFormState {
  status: "idle" | "sent" | "error";
  message?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  registration?: boolean;
  channel?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function sanitizeNext(value: FormDataEntryValue | null): string {
  const raw = typeof value === "string" ? value : "";
  // Alleen interne paden toestaan: voorkomt open redirects.
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

function sanitizeChannel(value: FormDataEntryValue | null): string {
  const raw = typeof value === "string" ? value : "";
  return /^[a-zA-Z0-9-]{8,80}$/.test(raw) ? raw : "";
}

/**
 * Stuurt een inloglink en een 6-cijferige code naar het opgegeven adres.
 * Er wordt bewust geen wachtwoord gebruikt.
 */
export async function sendLoginLink(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const next = sanitizeNext(formData.get("volgende"));
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const allowSignUp = String(formData.get("registreren") ?? "") === "1";
  const channel = sanitizeChannel(formData.get("kanaal"));
  const common = { email, firstName, lastName, registration: allowSignUp, channel };

  if (!EMAIL_PATTERN.test(email)) {
    return { status: "error", message: "Vul een geldig e-mailadres in.", ...common };
  }
  if (allowSignUp && (firstName.length < 2 || lastName.length < 2)) {
    return { status: "error", message: "Vul uw voor- en achternaam in.", ...common };
  }
  if (!isSupabaseConfigured()) {
    return {
      status: "error",
      message:
        "De verbinding met de database is nog niet ingesteld. Neem contact op met Skool Workshop.",
      ...common,
    };
  }

  const siteUrl = await resolveSiteUrl();
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: allowSignUp,
      emailRedirectTo: `${siteUrl}/auth/callback?volgende=${encodeURIComponent(next)}&kanaal=${encodeURIComponent(channel)}`,
      data: allowSignUp
        ? { full_name: fullName, first_name: firstName, last_name: lastName }
        : undefined,
    },
  });

  if (error) {
    // Bewust neutraal: we bevestigen nooit of een adres wel of niet bestaat.
    if (error.status === 422 || error.message.toLowerCase().includes("signups not allowed")) {
      return {
        status: "error",
        message:
          "Dit e-mailadres is nog niet bekend in SkoolPartner. Maak een account aan of neem contact met ons op.",
        ...common,
      };
    }
    if (error.status === 429) {
      return {
        status: "error",
        message: "Er zijn te veel pogingen gedaan. Probeer het over een paar minuten opnieuw.",
        ...common,
      };
    }
    // De echte oorzaak hoort niet op een openbare inlogpagina thuis, maar wel
    // in de serverlog. Zo is een SMTP-probleem terug te vinden in Vercel.
    console.error("[inloggen] versturen mislukt", {
      status: error.status,
      message: error.message,
    });
    return {
      status: "error",
      message: "Versturen is niet gelukt. Probeer het opnieuw.",
      ...common,
    };
  }

  return { status: "sent", ...common };
}

/** Controleert de 6-cijferige code als het klikken op de link niet lukt. */
export async function verifyLoginCode(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const token = String(formData.get("code") ?? "").replace(/\D/g, "");
  const next = sanitizeNext(formData.get("volgende"));

  if (token.length !== 6) {
    return { status: "error", message: "Vul de 6 cijfers uit de e-mail in.", email };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });

  if (error) {
    return {
      status: "error",
      message: "Deze code klopt niet of is verlopen. Vraag een nieuwe aan.",
      email,
    };
  }

  redirect(next);
}

export async function signOut() {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/inloggen");
}
