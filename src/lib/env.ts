/**
 * Centrale plek voor alle environment variables.
 *
 * Regels:
 *  - Secrets staan NOOIT in de code en worden nooit naar de client gestuurd.
 *  - Alles wat niet met NEXT_PUBLIC_ begint, is uitsluitend server-side leesbaar.
 *  - Ontbrekende integratiecredentials blokkeren de applicatie niet. De
 *    betreffende integratie draait dan in mockmodus en dat is zichtbaar in
 *    Admin > Integraties.
 */

function optional(name: string): string | null {
  const value = process.env[name];
  if (!value || value.trim() === "") return null;
  return value.trim();
}

function requiredPublic(name: string, fallback = ""): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    if (process.env.NODE_ENV === "production" && typeof window === "undefined") {
      // Tijdens build in CI mag dit niet hard falen; de runtime-check hieronder
      // geeft een duidelijke melding in de UI.
      return fallback;
    }
    return fallback;
  }
  return value.trim();
}

export const publicEnv = {
  supabaseUrl: requiredPublic("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: requiredPublic("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  siteUrl: requiredPublic("NEXT_PUBLIC_SITE_URL", "http://localhost:3000"),
  appName: requiredPublic("NEXT_PUBLIC_APP_NAME", "SkoolPartner"),
};

export const serverEnv = {
  supabaseServiceRoleKey: optional("SUPABASE_SERVICE_ROLE_KEY"),
  appEncryptionKey: optional("APP_ENCRYPTION_KEY"),
  cronSecret: optional("CRON_SECRET"),

  moneybird: {
    apiToken: optional("MONEYBIRD_API_TOKEN"),
    administrationId: optional("MONEYBIRD_ADMINISTRATION_ID"),
    /** Komt uit de aanmaakrespons van de webhook, veld "token". */
    webhookToken: optional("MONEYBIRD_WEBHOOK_TOKEN"),
    /**
     * Optioneel. Veld "secret" uit diezelfde respons. Is dit gevuld, dan
     * controleren wij bovenop de token ook de Moneybird-Signature van elke
     * webhook. Ontbreekt het, dan blijft de tokencontrole gewoon werken.
     */
    webhookSecret: optional("MONEYBIRD_WEBHOOK_SECRET"),
  },

  google: {
    clientId: optional("GOOGLE_CLIENT_ID"),
    clientSecret: optional("GOOGLE_CLIENT_SECRET"),
    redirectUri: optional("GOOGLE_REDIRECT_URI"),
    mailbox: optional("GMAIL_MAILBOX") ?? "boekingen@skoolworkshop.nl",
  },

  hubspot: {
    token: optional("HUBSPOT_PRIVATE_APP_TOKEN"),
  },

  /** Forceer mockmodus, ook als er credentials aanwezig zijn. */
  forceMock: optional("INTEGRATIONS_FORCE_MOCK") === "true",
};

export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);
}

export function hasServiceRole(): boolean {
  return Boolean(serverEnv.supabaseServiceRoleKey);
}

export type IntegrationName = "moneybird" | "gmail" | "hubspot";

export function integrationMode(name: IntegrationName): "live" | "mock" {
  if (serverEnv.forceMock) return "mock";
  switch (name) {
    case "moneybird":
      return serverEnv.moneybird.apiToken && serverEnv.moneybird.administrationId ? "live" : "mock";
    case "gmail":
      return serverEnv.google.clientId && serverEnv.google.clientSecret ? "live" : "mock";
    case "hubspot":
      return serverEnv.hubspot.token ? "live" : "mock";
  }
}

/** Welke variabelen ontbreken er nog per integratie. Gebruikt in Admin > Integraties. */
export function missingCredentials(name: IntegrationName): string[] {
  const missing: string[] = [];
  if (name === "moneybird") {
    if (!serverEnv.moneybird.apiToken) missing.push("MONEYBIRD_API_TOKEN");
    if (!serverEnv.moneybird.administrationId) missing.push("MONEYBIRD_ADMINISTRATION_ID");
    if (!serverEnv.moneybird.webhookToken) missing.push("MONEYBIRD_WEBHOOK_TOKEN");
  }
  if (name === "gmail") {
    if (!serverEnv.google.clientId) missing.push("GOOGLE_CLIENT_ID");
    if (!serverEnv.google.clientSecret) missing.push("GOOGLE_CLIENT_SECRET");
    if (!serverEnv.google.redirectUri) missing.push("GOOGLE_REDIRECT_URI");
    if (!serverEnv.appEncryptionKey) missing.push("APP_ENCRYPTION_KEY");
  }
  if (name === "hubspot") {
    if (!serverEnv.hubspot.token) missing.push("HUBSPOT_PRIVATE_APP_TOKEN");
  }
  return missing;
}
