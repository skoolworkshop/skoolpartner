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

  /** Forceer mockmodus, ook als er credentials aanwezig zijn. */
  forceMock: optional("INTEGRATIONS_FORCE_MOCK") === "true",

  /**
   * Staat de inschrijfpagina voor leerlingen aan?
   *
   * Zet PUBLIEKE_INSCHRIJVING op 'uit' en niemand komt op /inschrijven, ook
   * niet met een geldige link van een dag die open staat. Bedoeld voor de
   * periode dat het beheer al live is maar de leerlingen nog niet mogen.
   *
   * Ontbreekt de variabele, dan staat het gewoon aan. Zo verandert er niets
   * voor wie lokaal werkt of hem nooit heeft ingevuld.
   */
  publiekeInschrijving: (optional("PUBLIEKE_INSCHRIJVING") ?? "aan").toLowerCase(),
};

/** Mogen leerlingen zich nu inschrijven? */
export function publiekeInschrijvingAan(): boolean {
  return !["uit", "off", "false", "0", "nee"].includes(serverEnv.publiekeInschrijving);
}

export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);
}

/**
 * Klopt de Supabase-configuratie, of staat er nog een voorbeeldwaarde?
 *
 * WAAROM DIT ERBIJ IS
 *
 *   Een .env.local die is overgeschreven met de voorbeeldregels uit
 *   .env.example is niet leeg, dus isSupabaseConfigured() zegt dan gewoon ja.
 *   De applicatie praat vervolgens tegen een adres dat niet bestaat, en wat je
 *   op het scherm ziet is "versturen is niet gelukt". Dat kost een avond
 *   zoeken. Deze controle vangt dat af en zegt precies wat er mis is.
 *
 *   Geeft null terug als alles in orde is, anders een zin die je zo aan de
 *   beheerder kunt tonen.
 */
export function supabaseConfigFout(): string | null {
  const url = publicEnv.supabaseUrl;
  const sleutel = publicEnv.supabaseAnonKey;

  if (!url) return "NEXT_PUBLIC_SUPABASE_URL ontbreekt in .env.local.";
  if (!sleutel) return "NEXT_PUBLIC_SUPABASE_ANON_KEY ontbreekt in .env.local.";

  // Het echte adres van een project, of een lokale Supabase.
  const echtAdres =
    /^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(url) || /^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(url);
  if (!echtAdres) {
    return "NEXT_PUBLIC_SUPABASE_URL is geen geldig Supabase-adres. Staat er nog een voorbeeldwaarde in .env.local?";
  }

  // Eerst het gevaarlijke geval: de geheime sleutel op de publieke plek. Die
  // zou met elke pagina mee de browser in gaan.
  if (sleutel.startsWith("sb_secret_") || sleutel.includes("service_role")) {
    return "In NEXT_PUBLIC_SUPABASE_ANON_KEY staat een geheime sleutel. Daar hoort de publieke sleutel te staan.";
  }

  // De publieke sleutel is sb_publishable_... (nieuw) of een JWT dat met eyJ
  // begint (oud). Alles daarbuiten is een voorbeeldwaarde of een typefout.
  const echteSleutel = sleutel.startsWith("sb_publishable_") || sleutel.startsWith("eyJ");
  if (!echteSleutel) {
    return "NEXT_PUBLIC_SUPABASE_ANON_KEY is geen geldige sleutel. Hij hoort met sb_publishable_ of met eyJ te beginnen.";
  }

  return null;
}

export function hasServiceRole(): boolean {
  return Boolean(serverEnv.supabaseServiceRoleKey);
}

/**
 * De koppelingen die SkoolPartner actief gebruikt.
 *
 * Bewust iets anders dan IntegrationSystem in types/database.ts: dat type
 * spiegelt de enum in de database, waar de waarde hubspot nog in staat omdat
 * daar historische rijen aan hangen. Deze lijst gaat over wat de applicatie
 * daadwerkelijk aanroept.
 */
export type IntegrationName = "moneybird" | "gmail";

export function integrationMode(name: IntegrationName): "live" | "mock" {
  if (serverEnv.forceMock) return "mock";
  switch (name) {
    case "moneybird":
      return serverEnv.moneybird.apiToken && serverEnv.moneybird.administrationId ? "live" : "mock";
    case "gmail":
      return serverEnv.google.clientId && serverEnv.google.clientSecret ? "live" : "mock";
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
  return missing;
}
