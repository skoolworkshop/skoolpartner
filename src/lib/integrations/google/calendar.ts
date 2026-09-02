import "server-only";

import { createOAuthClient } from "@/lib/integrations/gmail/client";
import { decryptSecret } from "@/lib/crypto";
import { createServiceSupabase } from "@/lib/supabase/server";

/**
 * De koppeling met Google Agenda.
 *
 * ============================================================================
 * DIT MAG NOOIT EEN BLOKKADE WORDEN
 * ============================================================================
 *
 * De agenda is een aanvulling, geen voorwaarde. Een boekingslink rekent zijn
 * vrije momenten uit met de werktijden minus de afspraken die het CRM al kent;
 * de agenda levert daar extra bezette blokken bij.
 *
 * Dat is met opzet zo. Zonder die keuze zou een verlopen token, een
 * ingetrokken toestemming of een storing bij Google betekenen dat er geen
 * enkel moment meer te boeken is. Nu betekent het alleen dat er een moment
 * dubbel geboekt kan worden, en dat is zichtbaar en te herstellen.
 *
 * Elke functie hier geeft daarom bij een probleem een lege lijst of null terug,
 * met een reden erbij, in plaats van een fout te gooien.
 *
 * ============================================================================
 * OVER DE SCOPES
 * ============================================================================
 *
 * calendar.readonly  om te zien wanneer je bezet bent (freeBusy)
 * calendar.events    om de afspraak in de agenda te zetten
 *
 * Bewust niet de volledige calendar-scope: die geeft ook het recht om agenda's
 * aan te maken en te verwijderen, en dat hoort SkoolPartner niet te kunnen.
 *
 * Deze scopes staan los van de Gmail-scopes en worden pas gegeven als de
 * beheerder de koppeling opnieuw goedkeurt. Tot die tijd werkt alles hier
 * niet, en dat is geen storing maar de normale tussenstand.
 */

export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export type AgendaStand =
  | { beschikbaar: true }
  | { beschikbaar: false; reden: "geen-koppeling" | "geen-toestemming" | "storing" };

export interface AgendaBlok {
  startsAt: string;
  endsAt: string;
}

/**
 * Haalt een geldig toegangstoken op, of null.
 *
 * Leest dezelfde versleutelde refresh token als Gmail. Dat is geen slordigheid:
 * het is een koppeling met een Google-account, en die draagt alle toestemmingen
 * die daarbij horen. De rij heet nog 'gmail' omdat hij van voor de agenda
 * dateert; hem hernoemen zou de bestaande koppeling verbreken en dat is het
 * niet waard.
 */
async function toegangstoken(): Promise<string | null> {
  const oauth = createOAuthClient();
  if (!oauth) return null;

  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("integration_credentials")
    .select("encrypted_payload")
    .eq("integration", "gmail")
    .eq("label", "default")
    .maybeSingle();

  if (!data?.encrypted_payload) return null;

  try {
    const payload = JSON.parse(decryptSecret(data.encrypted_payload)) as {
      refresh_token?: string;
    };
    if (!payload.refresh_token) return null;
    oauth.setCredentials({ refresh_token: payload.refresh_token });
    const { token } = await oauth.getAccessToken();
    return token ?? null;
  } catch {
    return null;
  }
}

/** Heeft de koppeling toestemming voor de agenda? */
export async function agendaStand(): Promise<AgendaStand> {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("integration_credentials")
    .select("encrypted_payload, scopes")
    .eq("integration", "gmail")
    .eq("label", "default")
    .maybeSingle();

  if (!data?.encrypted_payload) return { beschikbaar: false, reden: "geen-koppeling" };

  const scopes = Array.isArray(data.scopes) ? data.scopes : [];
  const heeftAgenda = CALENDAR_SCOPES.every((scope) => scopes.includes(scope));
  if (!heeftAgenda) return { beschikbaar: false, reden: "geen-toestemming" };

  return { beschikbaar: true };
}

/**
 * De bezette blokken uit de agenda, tussen twee momenten.
 *
 * Gebruikt freeBusy en niet de lijst met gebeurtenissen. Dat is bewust: bij
 * freeBusy krijg je alleen begin- en eindtijden terug, geen titels,
 * omschrijvingen of deelnemers. Voor het uitrekenen van vrije tijd is dat
 * genoeg, en het betekent dat de inhoud van je agenda nooit door dit systeem
 * heen gaat.
 */
export async function bezetteBlokken(
  vanaf: Date,
  tot: Date,
  agendaId = "primary"
): Promise<{ blokken: AgendaBlok[]; stand: AgendaStand }> {
  const stand = await agendaStand();
  if (!stand.beschikbaar) return { blokken: [], stand };

  const token = await toegangstoken();
  if (!token) return { blokken: [], stand: { beschikbaar: false, reden: "geen-koppeling" } };

  try {
    const antwoord = await fetch(`${CALENDAR_API}/freeBusy`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin: vanaf.toISOString(),
        timeMax: tot.toISOString(),
        items: [{ id: agendaId }],
      }),
      cache: "no-store",
    });

    if (!antwoord.ok) {
      return { blokken: [], stand: { beschikbaar: false, reden: "storing" } };
    }

    const gegevens = (await antwoord.json()) as {
      calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
    };

    const busy = gegevens.calendars?.[agendaId]?.busy ?? [];
    return {
      blokken: busy.map((b) => ({ startsAt: b.start, endsAt: b.end })),
      stand,
    };
  } catch {
    return { blokken: [], stand: { beschikbaar: false, reden: "storing" } };
  }
}

export interface AgendaAfspraak {
  titel: string;
  omschrijving?: string | null;
  locatie?: string | null;
  startsAt: string;
  endsAt: string;
  tijdzone: string;
  /** De school. Krijgt van Google een uitnodiging als sendUpdates aan staat. */
  gastEmail?: string | null;
  gastNaam?: string | null;
}

/**
 * Zet een afspraak in de agenda.
 *
 * Geeft het id terug, of null als het niet lukte. Bewust null en geen fout: de
 * afspraak staat op dat moment al in het CRM en de school heeft al een
 * bevestiging gekregen. Alsnog omvallen zou betekenen dat een geslaagde
 * boeking als mislukt op het scherm komt.
 *
 * sendUpdates staat op 'none'. De bevestiging gaat vanuit SkoolPartner zelf,
 * en twee mails over dezelfde afspraak is verwarrend.
 */
export async function zetInAgenda(
  afspraak: AgendaAfspraak,
  agendaId = "primary"
): Promise<{ eventId: string | null; stand: AgendaStand }> {
  const stand = await agendaStand();
  if (!stand.beschikbaar) return { eventId: null, stand };

  const token = await toegangstoken();
  if (!token) return { eventId: null, stand: { beschikbaar: false, reden: "geen-koppeling" } };

  try {
    const antwoord = await fetch(
      `${CALENDAR_API}/calendars/${encodeURIComponent(agendaId)}/events?sendUpdates=none`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: afspraak.titel,
          description: afspraak.omschrijving ?? undefined,
          location: afspraak.locatie ?? undefined,
          start: { dateTime: afspraak.startsAt, timeZone: afspraak.tijdzone },
          end: { dateTime: afspraak.endsAt, timeZone: afspraak.tijdzone },
          attendees: afspraak.gastEmail
            ? [{ email: afspraak.gastEmail, displayName: afspraak.gastNaam ?? undefined }]
            : undefined,
        }),
        cache: "no-store",
      }
    );

    if (!antwoord.ok) return { eventId: null, stand: { beschikbaar: false, reden: "storing" } };

    const gegevens = (await antwoord.json()) as { id?: string };
    return { eventId: gegevens.id ?? null, stand };
  } catch {
    return { eventId: null, stand: { beschikbaar: false, reden: "storing" } };
  }
}

/** Haalt een afspraak weer uit de agenda. Faalt zacht, om dezelfde reden. */
export async function haalUitAgenda(eventId: string, agendaId = "primary"): Promise<boolean> {
  const token = await toegangstoken();
  if (!token) return false;

  try {
    const antwoord = await fetch(
      `${CALENDAR_API}/calendars/${encodeURIComponent(agendaId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
    // 410 betekent: stond er al niet meer. Dat is voor ons hetzelfde als weg.
    return antwoord.ok || antwoord.status === 410;
  } catch {
    return false;
  }
}

export const AGENDA_UITLEG: Record<Exclude<AgendaStand, { beschikbaar: true }>["reden"], string> = {
  "geen-koppeling":
    "Google is nog niet gekoppeld. Vrije momenten volgen nu alleen uit je werktijden en de afspraken in het CRM.",
  "geen-toestemming":
    "De koppeling heeft nog geen toegang tot je agenda. Koppel Google opnieuw en geef toestemming voor Agenda, anders kan er over een afspraak heen geboekt worden die alleen in Google staat.",
  storing:
    "Google Agenda was even niet bereikbaar. De vrije momenten zijn nu berekend zonder je agenda erbij.",
};
