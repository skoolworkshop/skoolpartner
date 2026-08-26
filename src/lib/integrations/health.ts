import "server-only";

import { integrationMode, serverEnv, type IntegrationName } from "@/lib/env";
import { GmailClient, createOAuthClient } from "@/lib/integrations/gmail/client";
import { MoneybirdClient } from "@/lib/integrations/moneybird/client";
import { createServiceSupabase } from "@/lib/supabase/server";

/**
 * Verbindingstests voor de koppelingen.
 *
 * Uitsluitend lezen. Er wordt tijdens een test nooit iets aangemaakt,
 * gewijzigd, verstuurd of verwijderd, niet in Moneybird en niet in Gmail.
 *
 * Foutmeldingen worden bewust ingekort en bevatten nooit een token. Een
 * Moneybird-fout kan de volledige aanroep terugsturen, en daar hoort geen
 * geheim in te belanden.
 */

export interface HealthCheck {
  ok: boolean;
  /** Korte samenvatting voor de beheerder, in gewone taal. */
  summary: string;
  /** Losse regels met wat er precies is gecontroleerd. */
  details: string[];
}

/** Nooit een token in een foutmelding. */
function veiligeFout(error: unknown): string {
  const bericht = error instanceof Error ? error.message : String(error);
  return bericht
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***")
    .replace(/[A-Za-z0-9_-]{30,}/g, "***")
    .slice(0, 200);
}

export async function testMoneybird(): Promise<HealthCheck> {
  const details: string[] = [];

  if (integrationMode("moneybird") === "mock") {
    return {
      ok: false,
      summary: "Moneybird draait in testmodus. Er zijn nog geen credentials ingesteld.",
      details: ["MONEYBIRD_API_TOKEN of MONEYBIRD_ADMINISTRATION_ID ontbreekt."],
    };
  }

  const client = MoneybirdClient.fromEnv();
  const token = serverEnv.moneybird.apiToken;
  const administratieId = serverEnv.moneybird.administrationId;

  if (!client || !token || !administratieId) {
    return { ok: false, summary: "Moneybird-credentials ontbreken.", details };
  }

  try {
    // 1. Is het token geldig, en zit de ingestelde administratie erbij?
    const administraties = await MoneybirdClient.listAdministrations(token);
    details.push(`Token geldig. ${administraties.length} administratie(s) bereikbaar.`);

    const gekozen = administraties.find((a) => String(a.id) === String(administratieId));
    if (!gekozen) {
      return {
        ok: false,
        summary: "Het token werkt, maar het ingestelde administratie-ID hoort er niet bij.",
        details: [
          ...details,
          `MONEYBIRD_ADMINISTRATION_ID staat op ${administratieId}.`,
          `Beschikbaar: ${administraties.map((a) => `${a.name ?? "naamloos"} (${a.id})`).join(", ")}`,
        ],
      };
    }
    details.push(`Administratie gevonden: ${gekozen.name ?? "naamloos"}.`);

    // 2. Contacten lezen.
    const contacten = await client.listContacts();
    details.push(`Contacten ophalen werkt. Eerste pagina: ${contacten.length}.`);

    // 3. Verkoopfacturen lezen.
    const facturen = await client.listSalesInvoices();
    details.push(`Verkoopfacturen ophalen werkt. Eerste pagina: ${facturen.length}.`);

    return {
      ok: true,
      summary: `Verbonden met ${gekozen.name ?? "de administratie"}.`,
      details,
    };
  } catch (error) {
    return {
      ok: false,
      summary: "Moneybird gaf een fout terug.",
      details: [...details, veiligeFout(error)],
    };
  }
}

/** Is Gmail daadwerkelijk gekoppeld, dus staat er een refresh token klaar? */
export async function isGmailConnected(): Promise<{
  connected: boolean;
  accountEmail: string | null;
  connectedAt: string | null;
}> {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("integration_credentials")
    .select("account_email, updated_at, encrypted_payload")
    .eq("integration", "gmail")
    .eq("label", "default")
    .maybeSingle();

  return {
    connected: Boolean(data?.encrypted_payload),
    accountEmail: data?.account_email ?? null,
    connectedAt: data?.updated_at ?? null,
  };
}

export async function testGmail(): Promise<HealthCheck> {
  const details: string[] = [];

  if (!createOAuthClient()) {
    return {
      ok: false,
      summary: "Gmail draait in testmodus. De Google-credentials ontbreken nog.",
      details: ["GOOGLE_CLIENT_ID of GOOGLE_CLIENT_SECRET ontbreekt."],
    };
  }

  if (!serverEnv.appEncryptionKey) {
    return {
      ok: false,
      summary: "APP_ENCRYPTION_KEY ontbreekt, dus tokens kunnen niet veilig worden bewaard.",
      details: [],
    };
  }

  const koppeling = await isGmailConnected();
  if (!koppeling.connected) {
    return {
      ok: false,
      summary: "Gmail is nog niet gekoppeld. Klik op Gmail koppelen om te starten.",
      details: [],
    };
  }
  details.push("Er staat een versleutelde refresh token klaar.");

  try {
    // GmailClient.create() wisselt de refresh token om voor een access token.
    // Lukt dat, dan werkt de vernieuwing van tokens dus ook.
    const client = await GmailClient.create();
    if (!client) {
      return {
        ok: false,
        summary: "De opgeslagen token kon niet worden omgewisseld voor een toegangstoken.",
        details: [...details, "Koppel Gmail opnieuw."],
      };
    }
    details.push("Token vernieuwen werkt.");

    const profiel = await client.getProfile();
    details.push(`Mailbox bereikbaar: ${profiel.emailAddress}.`);
    details.push(`Berichten in de mailbox: ${profiel.messagesTotal}.`);

    const verwacht = serverEnv.google.mailbox?.toLowerCase();
    if (verwacht && profiel.emailAddress.toLowerCase() !== verwacht) {
      return {
        ok: false,
        summary: `Er is gekoppeld met ${profiel.emailAddress}, maar GMAIL_MAILBOX staat op ${verwacht}.`,
        details: [...details, "Koppel opnieuw en log in met de juiste mailbox."],
      };
    }

    return { ok: true, summary: `Verbonden met ${profiel.emailAddress}.`, details };
  } catch (error) {
    return {
      ok: false,
      summary: "Gmail gaf een fout terug.",
      details: [...details, veiligeFout(error)],
    };
  }
}

export async function testIntegration(name: IntegrationName): Promise<HealthCheck> {
  if (name === "moneybird") return testMoneybird();
  if (name === "gmail") return testGmail();
  return {
    ok: integrationMode("hubspot") === "live",
    summary:
      integrationMode("hubspot") === "live"
        ? "HubSpot-token is ingesteld."
        : "HubSpot draait in testmodus.",
    details: [],
  };
}
