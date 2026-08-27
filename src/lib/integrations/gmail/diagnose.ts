import "server-only";

import { publicEnv, serverEnv } from "@/lib/env";
import { createServiceSupabase } from "@/lib/supabase/server";

/**
 * Waarom kan het koppelen van Gmail niet slagen?
 *
 * Deze controles draaien op de server en tonen alleen of iets aanwezig is en
 * of het klopt. NOOIT de waarde zelf. Van een sleutel tonen wij hooguit de
 * lengte, en van een Supabase-sleutel welke rol erin staat. Dat zijn geen
 * geheimen, maar het is wel precies wat je nodig hebt om te zien wat er mis is.
 *
 * Bedoeld voor de beheerder in Admin > Integraties, zodat hij niet hoeft te
 * gokken en niet in serverlogs hoeft te duiken.
 */

export type Uitkomst = "goed" | "fout" | "onbekend";

export interface DiagnoseRegel {
  label: string;
  uitkomst: Uitkomst;
  /** Wat er is gevonden, in gewone taal. Nooit een geheime waarde. */
  waarde: string;
  /** Wat de beheerder moet doen als het fout is. */
  oplossing?: string;
}

/**
 * Leest de rol uit een Supabase-sleutel.
 *
 * De oude sleutels zijn JWT's met een leesbaar middenstuk waarin de rol staat.
 * Wij lezen alleen dat ene veld. De handtekening blijft geheim en wordt hier
 * niet aangeraakt.
 */
export function rolUitSupabaseSleutel(sleutel: string | null | undefined): string | null {
  if (!sleutel) return null;

  // Nieuwe sleutels beginnen met sb_secret_ of sb_publishable_ en zijn geen JWT.
  if (sleutel.startsWith("sb_secret_")) return "secret (nieuw formaat)";
  if (sleutel.startsWith("sb_publishable_")) return "publishable (nieuw formaat)";

  const delen = sleutel.split(".");
  if (delen.length !== 3) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(delen[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    ) as { role?: string };
    return payload.role ?? null;
  } catch {
    return null;
  }
}

/**
 * Zegt in gewone taal wat de database terugstuurde.
 *
 * De melding van PostgREST bevat nooit een sleutel of wachtwoord, alleen de
 * naam van een tabel en een reden. Die tonen wij daarom gewoon: zonder die
 * tekst blijft het gissen tussen "geen rechten" en "tabel bestaat niet", en
 * dat zijn twee heel verschillende problemen met twee verschillende
 * oplossingen.
 */
export function verklaarDatabasefout(error: { message: string; code?: string }): DiagnoseRegel {
  const tekst = error.message ?? "";
  const kort = tekst.slice(0, 200);

  if (/permission denied|row-level security/i.test(tekst)) {
    return {
      label: "Schrijfrechten op de database",
      uitkomst: "fout",
      waarde: `de database weigert deze sleutel: ${kort}`,
      oplossing:
        "De sleutel is van de juiste rol, maar mist rechten op de tabel. Draai setup-alles.sql opnieuw op dit project; onderaan staan de grants.",
    };
  }

  if (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    /does not exist|could not find the table|schema cache/i.test(tekst)
  ) {
    return {
      label: "Schrijfrechten op de database",
      uitkomst: "fout",
      waarde: `de tabel bestaat niet op dit project: ${kort}`,
      oplossing:
        "Draai supabase/setup-alles.sql in de SQL Editor van dit Supabase-project. Wijst NEXT_PUBLIC_SUPABASE_URL wel naar hetzelfde project waar je de migraties hebt gedraaid?",
    };
  }

  return {
    label: "Schrijfrechten op de database",
    uitkomst: "fout",
    waarde: kort || "onbekende fout",
    oplossing: "Controleer of de migraties op dit Supabase-project zijn uitgevoerd.",
  };
}

function sleutelRegel(): DiagnoseRegel {
  const sleutel = serverEnv.appEncryptionKey;

  if (!sleutel) {
    return {
      label: "APP_ENCRYPTION_KEY",
      uitkomst: "fout",
      waarde: "ontbreekt",
      oplossing: "Maak er een met: openssl rand -base64 32, en zet die in Vercel.",
    };
  }

  const bytes = Buffer.from(sleutel, "base64").length;
  if (bytes !== 32) {
    return {
      label: "APP_ENCRYPTION_KEY",
      uitkomst: "fout",
      waarde: `${bytes} bytes, moeten er 32 zijn`,
      oplossing:
        "Dit is geen geldige sleutel. Maak een nieuwe met: openssl rand -base64 32. Dat geeft 44 tekens die eindigen op een isgelijkteken.",
    };
  }

  return { label: "APP_ENCRYPTION_KEY", uitkomst: "goed", waarde: "32 bytes, geldig" };
}

async function databaseRegels(): Promise<DiagnoseRegel[]> {
  const sleutel = serverEnv.supabaseServiceRoleKey;

  if (!sleutel) {
    return [
      {
        label: "SUPABASE_SERVICE_ROLE_KEY",
        uitkomst: "fout",
        waarde: "ontbreekt",
        oplossing: "Haal de service role key op in Supabase, Project Settings, API keys.",
      },
    ];
  }

  const rol = rolUitSupabaseSleutel(sleutel);
  const rolGoed = rol === "service_role" || rol === "secret (nieuw formaat)";

  const regels: DiagnoseRegel[] = [
    {
      label: "SUPABASE_SERVICE_ROLE_KEY",
      uitkomst: rol === null ? "onbekend" : rolGoed ? "goed" : "fout",
      waarde: rol === null ? "aanwezig, rol niet te lezen" : `rol in de sleutel: ${rol}`,
      oplossing: rolGoed
        ? undefined
        : "Hier hoort de service role key te staan, niet de anon of publishable key. Die vind je in Supabase, Project Settings, API keys.",
    },
  ];

  // En het echte bewijs: mag de server ook daadwerkelijk bij de tabel?
  try {
    const supabase = createServiceSupabase();
    const { error } = await supabase
      .from("integration_credentials")
      .select("integration", { count: "exact", head: true });

    if (error) {
      regels.push(verklaarDatabasefout(error));
    } else {
      regels.push({
        label: "Schrijfrechten op de database",
        uitkomst: "goed",
        waarde: "de server kan bij de koppelingstabel",
      });
    }
  } catch (error) {
    regels.push({
      label: "Schrijfrechten op de database",
      uitkomst: "fout",
      waarde: error instanceof Error ? error.message.slice(0, 120) : "onbekende fout",
    });
  }

  return regels;
}

function googleRegels(gekoppeldAccount: string | null): DiagnoseRegel[] {
  const verwachteUri = `${publicEnv.siteUrl}/api/integrations/google/callback`;
  const ingesteld = serverEnv.google.redirectUri;

  const regels: DiagnoseRegel[] = [
    {
      label: "GOOGLE_CLIENT_ID",
      uitkomst: serverEnv.google.clientId ? "goed" : "fout",
      waarde: serverEnv.google.clientId ? "aanwezig" : "ontbreekt",
      oplossing: serverEnv.google.clientId ? undefined : "Zet deze in Vercel en deploy opnieuw.",
    },
    {
      label: "GOOGLE_CLIENT_SECRET",
      uitkomst: serverEnv.google.clientSecret ? "goed" : "fout",
      waarde: serverEnv.google.clientSecret ? "aanwezig" : "ontbreekt",
      oplossing: serverEnv.google.clientSecret ? undefined : "Zet deze in Vercel en deploy opnieuw.",
    },
  ];

  if (!ingesteld) {
    regels.push({
      label: "GOOGLE_REDIRECT_URI",
      uitkomst: "fout",
      waarde: "ontbreekt",
      oplossing: `Zet deze op ${verwachteUri}, en zet hetzelfde adres in de Google Cloud Console.`,
    });
  } else if (ingesteld.trim() !== verwachteUri) {
    regels.push({
      label: "GOOGLE_REDIRECT_URI",
      uitkomst: "fout",
      waarde: `staat op ${ingesteld}`,
      oplossing: `Verwacht wordt ${verwachteUri}. Eén tekentje verschil is al genoeg om het te laten mislukken. Let op https, hoofdletters en een slash aan het eind.`,
    });
  } else {
    regels.push({
      label: "GOOGLE_REDIRECT_URI",
      uitkomst: "goed",
      waarde: ingesteld,
    });
  }

  const mailbox = serverEnv.google.mailbox;

  if (!mailbox) {
    regels.push({
      label: "GMAIL_MAILBOX",
      uitkomst: "fout",
      waarde: "ontbreekt",
      oplossing: "Vul hier het adres in waarmee jullie met klanten mailen.",
    });
  } else if (gekoppeldAccount && normaliseer(gekoppeldAccount) === normaliseer(mailbox)) {
    /*
      Dit is geen technische fout, maar wel een privacyrisico dat je moet zien.

      Staat hier het persoonlijke inlogadres, dan valt de filter weg die
      voorkomt dat privémail in SkoolPartner belandt: alles wat aan dat adres
      is gericht telt dan opeens als klantcommunicatie. En uitgaande post naar
      klanten komt dan van dat persoonlijke adres.
    */
    regels.push({
      label: "GMAIL_MAILBOX",
      uitkomst: "fout",
      waarde: `${mailbox}, hetzelfde als het inlogaccount`,
      oplossing:
        "Hier hoort het gedeelde boekingenadres te staan, niet het persoonlijke inlogadres. Staan ze gelijk, dan telt alle post aan dat adres als klantcommunicatie en verliest de privacyfilter zijn werking.",
    });
  } else {
    regels.push({
      label: "GMAIL_MAILBOX",
      uitkomst: "goed",
      waarde: `${mailbox} (het adres waarmee wij met klanten mailen)`,
    });
  }

  regels.push({
    label: "Supabase-project",
    uitkomst: publicEnv.supabaseUrl ? "goed" : "fout",
    waarde: publicEnv.supabaseUrl || "ontbreekt",
    oplossing: publicEnv.supabaseUrl
      ? undefined
      : "Zet NEXT_PUBLIC_SUPABASE_URL in Vercel en deploy opnieuw.",
  });

  return regels;
}

function normaliseer(waarde: string | null | undefined): string {
  return (waarde ?? "").trim().toLowerCase();
}

export interface Diagnose {
  regels: DiagnoseRegel[];
  /** Kan het koppelen op dit moment überhaupt slagen? */
  kanKoppelen: boolean;
}

export async function diagnoseGmail(gekoppeldAccount: string | null = null): Promise<Diagnose> {
  const regels = [
    sleutelRegel(),
    ...(await databaseRegels()),
    ...googleRegels(gekoppeldAccount),
  ];
  return { regels, kanKoppelen: regels.every((r) => r.uitkomst !== "fout") };
}
