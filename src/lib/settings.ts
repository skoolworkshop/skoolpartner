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
  welcome_bonus_enabled: true,
  welcome_bonus_points: 100,
  point_value_cents_per_100: 250,
  redemption_minimum_points: 500,
  redemption_maximum_points_per_booking: 0,
  points_expiry_enabled: true,
  points_validity_months: 24,
  milestone_step_points: 500,
  new_booking_cta_url: "/nieuwe-boeking",
  new_booking_cta_label: "Nieuwe workshop aanvragen",
  support_email: "boekingen@skoolworkshop.nl",
  cjp_parking_enabled: true,
  cjp_bonus_enabled: true,
  cjp_bonus_points: 1000,
  cjp_bonus_cooldown_days: 0,
  cjp_bonus_minimum_amount_cents: 100000,
  cjp_minimum_amount_cents: 100000,
  /** Leeg betekent: de melding gaat naar support_email. Nooit een persoonlijk adres in de code. */
  cjp_notify_email: "",
  chat_enabled: true,
  chat_whatsapp_url: "https://wa.me/31850653923",
  chat_label: "Liever even chatten?",
  chat_help_text:
    "Stel uw vraag via WhatsApp. Op werkdagen reageren wij meestal binnen een paar uur.",
  rules_text: "",
  how_it_works_text: "",
  parser_enabled: true,
  parser_auto_approve_threshold: 95,
  booking_confirmation_from_domains: ["skoolworkshop.nl"] as string[],
  booking_confirmation_label: "Mijn Skool/Boekingsbevestiging",
  gmail_sync_query: "newer_than:60d -in:spam -in:trash -in:drafts",
  results_enabled: true,
  results_available_days: 3,
  results_notice_days: 7,
  results_max_upload_mb: 45,
  results_email_subject: "De resultaten van uw workshop staan klaar",
  workshop_images: {
      "3d printerpen": "https://skoolworkshop.nl/wp-content/uploads/2024/07/MDC05556-scaled-e1781612569521-1024x382.jpg",
      "bodypercussie": "https://skoolworkshop.nl/wp-content/uploads/2020/07/Workshop-Ghetto-Drums-10-1024x683.jpg",
      "bootcamp": "https://skoolworkshop.nl/wp-content/uploads/2026/06/Workshop-Bootcamp-e1781614313226-1024x416.jpg",
      "breakdance": "https://skoolworkshop.nl/wp-content/uploads/2020/07/Website-fotos-Hersteld_0008s_0008_6L6A5965-Verbeterd-NR-1024x576.jpg",
      "caribbean drums": "https://skoolworkshop.nl/wp-content/uploads/2020/10/6-Workshop-Carribean-Drums-1024x576.jpg",
      "cultuurdag": "https://skoolworkshop.nl/wp-content/uploads/2020/07/Cultuurdag-op-school-1024x683.jpg",
      "dans": "https://skoolworkshop.nl/wp-content/uploads/2019/12/Dans-Website-1024x683.jpg",
      "dj": "https://skoolworkshop.nl/wp-content/uploads/2023/02/2-Workshop-Dj-Skills-1024x576.jpg",
      "dj skills": "https://skoolworkshop.nl/wp-content/uploads/2023/02/2-Workshop-Dj-Skills-1024x576.jpg",
      "flashmob": "https://skoolworkshop.nl/wp-content/uploads/2026/06/Workshop-Flashmob-1024x576.jpg",
      "freerunning": "https://skoolworkshop.nl/wp-content/uploads/2020/07/Website-fotos-Hersteld_0006s_0000_Workshop-ISL-30-1024x576.jpg",
      "ghetto drums": "https://skoolworkshop.nl/wp-content/uploads/2020/07/Workshop-Ghetto-Drums-12-1024x683.jpg",
      "graffiti": "https://skoolworkshop.nl/wp-content/uploads/2020/06/0006s_0000_8-Montessori-Lyceum-Rotterdam-1024x576.jpg",
      "hiphop": "https://skoolworkshop.nl/wp-content/uploads/2019/12/Dans-Website-1024x683.jpg",
      "kickboksen": "https://skoolworkshop.nl/wp-content/uploads/2020/07/6L6A5932-Verbeterd-NR-1024x576.jpg",
      "korte film": "https://skoolworkshop.nl/wp-content/uploads/2020/07/0004s_0000_15-Workshops-British-School-1024x576.jpg",
      "liedje maken": "https://skoolworkshop.nl/wp-content/uploads/2025/10/5-Workshop-Rap-Zang-1.jpg",
      "light graffiti": "https://skoolworkshop.nl/wp-content/uploads/2020/07/1-Wrokshop-Light-Graffiti--1024x576.jpg",
      "live looping": "https://skoolworkshop.nl/wp-content/uploads/2025/10/1-Workshop-Rap-Zang.jpg",
      "pannavoetbal": "https://skoolworkshop.nl/wp-content/uploads/2026/06/Workshop-Pannavoetbal-1024x576.jpg",
      "podcast": "https://skoolworkshop.nl/wp-content/uploads/2023/02/Website-fotos_0000s_0001_14-Introductiedag-Curio-Breda-1024x576.jpg",
      "popstar": "https://skoolworkshop.nl/wp-content/uploads/2025/10/5-Workshop-Rap-Zang-1.jpg",
      "rap": "https://skoolworkshop.nl/wp-content/uploads/2020/07/Website-fotos-Hersteld_0010s_0001_17-Comenius-College-Hilversum-1024x576.jpg",
      "smartphone fotografie": "https://skoolworkshop.nl/wp-content/uploads/2020/11/Foto-6-1024x682.jpg",
      "soap acteren": "https://skoolworkshop.nl/wp-content/uploads/2026/06/Workshop-Soap-1024x576.jpg",
      "stage fighting": "https://skoolworkshop.nl/wp-content/uploads/2020/07/Website-fotos-Hersteld_0009s_0001_3-Workshopdag-Curio-Roosendaal-1024x576.jpg",
      "stop motion": "https://skoolworkshop.nl/wp-content/uploads/2020/07/0008s_0002_MDC05818-1024x576.jpg",
      "streetdance": "https://skoolworkshop.nl/wp-content/uploads/2020/09/hele-groep-1024x517.jpg",
      "t shirt ontwerpen": "https://skoolworkshop.nl/wp-content/uploads/2020/07/23-Workshops-British-School-1024x683.jpg",
      "theatersport": "https://skoolworkshop.nl/wp-content/uploads/2019/12/Theater.jpg",
      "videoclip": "https://skoolworkshop.nl/wp-content/uploads/2025/07/Videoclip-Maken_0007_Workshop-ISL-16-1024x576.jpg",
      "vloggen": "https://skoolworkshop.nl/wp-content/uploads/2021/04/Vloggen-workshop-1024x801.jpg",
      "zelfverdediging": "https://skoolworkshop.nl/wp-content/uploads/2020/07/6L6A6020-Verbeterd-NR-1024x576.jpg"
  } as Record<string, string>,
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
  if (fallback !== null && typeof fallback === "object") {
    // Bijvoorbeeld de fotolijst: een object met sleutel en waarde.
    return (raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? raw
      : fallback) as Settings[K];
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
