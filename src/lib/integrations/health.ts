import "server-only";

import { integrationMode, serverEnv, type IntegrationName } from "@/lib/env";
import { GmailClient, createOAuthClient } from "@/lib/integrations/gmail/client";
import {
  checkSendAs,
  normalizeEmail,
  sendAsInstructie,
  type SendAsCheck,
} from "@/lib/integrations/gmail/identity";
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
    // 1 en 7. GmailClient.create() wisselt de refresh token om voor een access
    // token. Lukt dat, dan is de OAuth-koppeling geldig én werkt het vernieuwen
    // van tokens. Dat zijn meteen twee controles in één.
    const client = await GmailClient.create();
    if (!client) {
      return {
        ok: false,
        summary: "De opgeslagen token kon niet worden omgewisseld voor een toegangstoken.",
        details: [...details, "Koppel Gmail opnieuw."],
      };
    }
    details.push("Refresh token werkt: er is een geldig toegangstoken opgehaald.");

    // 2, 3 en 4. Gmail is bereikbaar, wie is er gekoppeld, en kan de mailbox
    // worden gelezen?
    const profiel = await client.getProfile();
    const account = profiel.emailAddress;
    details.push(`Gmail API bereikbaar.`);
    details.push(`Google-account: ${account}.`);
    details.push(`Mailbox leesbaar: ${profiel.messagesTotal} berichten, ${profiel.threadsTotal} gesprekken.`);

    const mailbox = serverEnv.google.mailbox;
    if (!mailbox) {
      return {
        ok: false,
        summary: "GMAIL_MAILBOX is niet ingesteld, dus wij weten niet welk adres het boekingenadres is.",
        details,
      };
    }

    /*
      5 en 6. Is het boekingenadres herkenbaar, en mag er namens verzonden
      worden?

      Dit is het punt waarop de oude versie stukliep. Die eiste dat het
      ingelogde account gelijk was aan GMAIL_MAILBOX, en bij Skool Workshop is
      dat bewust niet zo: er wordt ingelogd met een persoonlijk account en
      gemaild vanaf een boekingenadres. Een verschil tussen die twee is dus
      geen fout, zolang het boekingenadres maar een geldige send-as identiteit
      is.
    */
    const sendAsLijst = await client.listSendAs();
    details.push(
      `Verzendadressen in dit account: ${
        sendAsLijst.map((s) => s.sendAsEmail).join(", ") || "geen gevonden"
      }.`
    );

    const zelfdeAccount = normalizeEmail(account) === normalizeEmail(mailbox);
    const sendAs = checkSendAs(sendAsLijst, mailbox);

    if (zelfdeAccount) {
      details.push(`Het boekingenadres is hier hetzelfde als het Google-account.`);
    } else {
      details.push(
        `Boekingenadres ${mailbox} is bewust een ander adres dan het Google-account. Dat is goed.`
      );
    }

    if (!sendAs.ready) {
      return {
        ok: false,
        summary: `Verbonden met ${account}, maar verzenden als ${mailbox} kan nog niet.`,
        details: [
          ...details,
          sendAs.message,
          "Wat er in Gmail moet gebeuren:",
          ...sendAsInstructie(sendAs, mailbox, account).map((regel) => `  ${regel}`),
          "Zolang dit niet klopt, verstuurt SkoolPartner geen enkel bericht. Er gaat dus nooit per ongeluk post uit vanaf het verkeerde adres.",
        ],
      };
    }

    details.push(sendAs.message);
    if (sendAs.entry?.displayName) {
      details.push(`Weergavenaam bij dat adres: ${sendAs.entry.displayName}.`);
    }

    return {
      ok: true,
      summary: zelfdeAccount
        ? `Verbonden met ${account}. Verzenden als ${mailbox} is gereed.`
        : `Verbonden met ${account}, verzenden als ${mailbox} is gereed.`,
      details,
    };
  } catch (error) {
    return {
      ok: false,
      summary: "Gmail gaf een fout terug.",
      details: [...details, veiligeFout(error)],
    };
  }
}

export interface GmailStatus {
  connected: boolean;
  /** Het Google-account waarmee is ingelogd. */
  accountEmail: string | null;
  /** Het adres waarmee wij met klanten mailen. */
  mailbox: string;
  /** Zijn dit bewust twee verschillende adressen? */
  apartAdres: boolean;
  /** null als wij het (nog) niet hebben kunnen ophalen. */
  sendAs: SendAsCheck | null;
  connectedAt: string | null;
}

/**
 * Alles wat Admin > Integraties over Gmail moet tonen, in één keer.
 *
 * Faalt nooit hard: kan de send-as lijst niet worden opgehaald, dan blijft die
 * gewoon leeg en toont het scherm dat het nog niet bekend is. Een pagina die
 * omvalt omdat Google even hikt, helpt niemand.
 */
export async function getGmailStatus(): Promise<GmailStatus> {
  const mailbox = serverEnv.google.mailbox ?? "";
  const koppeling = await isGmailConnected();

  const basis: GmailStatus = {
    connected: koppeling.connected,
    accountEmail: koppeling.accountEmail,
    mailbox,
    apartAdres:
      Boolean(koppeling.accountEmail) &&
      normalizeEmail(koppeling.accountEmail) !== normalizeEmail(mailbox),
    sendAs: null,
    connectedAt: koppeling.connectedAt,
  };

  if (!koppeling.connected || !mailbox) return basis;

  try {
    const client = await GmailClient.create();
    if (!client) return basis;

    const lijst = await client.listSendAs();
    return { ...basis, sendAs: checkSendAs(lijst, mailbox) };
  } catch {
    return basis;
  }
}

export async function testIntegration(name: IntegrationName): Promise<HealthCheck> {
  if (name === "moneybird") return testMoneybird();
  return testGmail();
}
