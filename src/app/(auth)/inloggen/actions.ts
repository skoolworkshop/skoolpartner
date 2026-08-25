"use server";

import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { resolveSiteUrl } from "@/lib/site-url";
import { createServerSupabase } from "@/lib/supabase/server";

export interface AuthFormState {
  status: "idle" | "sent" | "error";
  message?: string;
  email?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function sanitizeNext(value: FormDataEntryValue | null): string {
  const raw = typeof value === "string" ? value : "";
  // Alleen interne paden toestaan: voorkomt open redirects.
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
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
  const fullName = String(formData.get("full_name") ?? "").trim();
  const allowSignUp = String(formData.get("registreren") ?? "") === "1";

  if (!EMAIL_PATTERN.test(email)) {
    return { status: "error", message: "Vul een geldig e-mailadres in.", email };
  }
  if (allowSignUp && fullName.length < 2) {
    return { status: "error", message: "Vul uw naam in.", email };
  }
  if (!isSupabaseConfigured()) {
    return {
      status: "error",
      message:
        "De verbinding met de database is nog niet ingesteld. Neem contact op met Skool Workshop.",
      email,
    };
  }

  const siteUrl = await resolveSiteUrl();
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: allowSignUp,
      emailRedirectTo: `${siteUrl}/auth/callback?volgende=${encodeURIComponent(next)}`,
      data: allowSignUp ? { full_name: fullName } : undefined,
    },
  });

  if (error) {
    // Bewust neutraal: we bevestigen nooit of een adres wel of niet bestaat.
    if (error.status === 422 || error.message.toLowerCase().includes("signups not allowed")) {
      return {
        status: "error",
        message:
          "Dit e-mailadres is nog niet bekend in Mijn Skool. Registreer u eerst of neem contact met ons op.",
        email,
      };
    }
    if (error.status === 429) {
      return {
        status: "error",
        message: "Er zijn te veel pogingen gedaan. Probeer het over een paar minuten opnieuw.",
        email,
      };
    }
    return {
      status: "error",
      message: "Versturen is niet gelukt. Probeer het opnieuw.",
      email,
    };
  }

  return { status: "sent", email };
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
