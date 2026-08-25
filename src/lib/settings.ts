import { cache } from "react";

import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";
import type { LoyaltyRates } from "@/lib/loyalty/calc";
import type { AppSettingRow, Json } from "@/lib/types/database";

/** Alle instellingen met hun standaardwaarde. */
export const SETTING_DEFAULTS = {
  loyalty_enabled: true,
  program_name: "SkoolPartner",
  points_name: "SkoolPoints",
  points_per_workshop_hour: 100,
  minimum_booking_minutes: 90,
  review_bonus_points: 50,
  point_value_cents_per_100: 250,
  redemption_minimum_points: 500,
  redemption_maximum_points_per_booking: 0,
  points_expiry_enabled: true,
  points_validity_months: 24,
  milestone_step_points: 500,
  new_booking_cta_url: "https://skoolworkshop.nl/offerte-aanvraag/",
  new_booking_cta_label: "Nieuwe workshop aanvragen",
  support_email: "boekingen@skoolworkshop.nl",
  rules_text: "",
  how_it_works_text: "",
  parser_enabled: true,
  parser_auto_approve_threshold: 95,
  booking_confirmation_from_domains: ["skoolworkshop.nl"] as string[],
  booking_confirmation_label: "Mijn Skool/Boekingsbevestiging",
  gmail_sync_query: "newer_than:60d -in:spam -in:trash -in:drafts",
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type Settings = { [K in SettingKey]: (typeof SETTING_DEFAULTS)[K] };

function coerce<K extends SettingKey>(key: K, raw: Json | undefined): Settings[K] {
  const fallback = SETTING_DEFAULTS[key] as Settings[K];
  if (raw === undefined || raw === null) return fallback;
  if (typeof fallback === "number") {
    const n = typeof raw === "number" ? raw : Number(raw);
    return (Number.isFinite(n) ? n : fallback) as Settings[K];
  }
  if (typeof fallback === "boolean") {
    if (typeof raw === "boolean") return raw as Settings[K];
    return (String(raw) === "true") as Settings[K];
  }
  if (Array.isArray(fallback)) {
    return (Array.isArray(raw) ? raw : fallback) as Settings[K];
  }
  return (typeof raw === "string" ? raw : String(raw)) as Settings[K];
}

function buildSettings(rows: Pick<AppSettingRow, "key" | "value">[]): Settings {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const result = {} as Settings;
  (Object.keys(SETTING_DEFAULTS) as SettingKey[]).forEach((key) => {
    // @ts-expect-error index write op generieke sleutel
    result[key] = coerce(key, map.get(key));
  });
  return result;
}

/**
 * Instellingen zoals de ingelogde gebruiker ze mag zien.
 * Onder RLS levert dit alleen de publieke sleutels op; voor admins alles.
 */
export const getSettings = cache(async (): Promise<Settings> => {
  try {
    const supabase = await createServerSupabase();
    const { data } = await supabase.from("app_settings").select("key, value");
    return buildSettings(data ?? []);
  } catch {
    return buildSettings([]);
  }
});

/** Volledige instellingen voor achtergrondtaken en integraties. */
export async function getSettingsWithServiceRole(): Promise<Settings> {
  const supabase = createServiceSupabase();
  const { data } = await supabase.from("app_settings").select("key, value");
  return buildSettings(data ?? []);
}

export function ratesFromSettings(settings: Settings): LoyaltyRates {
  return {
    pointsPerHour: settings.points_per_workshop_hour,
    pointValueCentsPer100: settings.point_value_cents_per_100,
    minimumBookingMinutes: settings.minimum_booking_minutes,
  };
}
