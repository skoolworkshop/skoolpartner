import "server-only";

import { recordAudit } from "@/lib/audit";
import { resolveSiteUrl } from "@/lib/site-url";
import { generateToken, hashToken } from "@/lib/crypto";
import { integrationMode, serverEnv } from "@/lib/env";
import { formatShortDate, formatTime } from "@/lib/format";
import { GmailClient } from "@/lib/integrations/gmail/client";
import { maakIndeling, type IndelingVoorstel } from "@/lib/inschrijving/indeling";
import {
  bestandsnaam,
  codesPdf,
  codesXlsx,
  klassenPdf,
  klassenXlsx,
  ontbrekendOverzicht,
  workshopsPdf,
  workshopsXlsx,
  type LijstGegevens,
  type Ontbrekend,
} from "@/lib/inschrijving/lijsten";
import {
  handtekeningTekst,
  maakMailHtml,
  metDomein,
  STANDAARD_HANDTEKENING,
} from "@/lib/inschrijving/handtekening";
import { maakBericht, type Bijlage } from "@/lib/inschrijving/mail";
import { createServiceSupabase } from "@/lib/supabase/server";
import type {
  EnrollmentEventRow,
  EnrollmentRoundRow,
  EnrollmentSessionRow,
  EnrollmentWorkshopRow,
} from "@/lib/types/database";

/**
 * De dag afronden: indelen, lijsten maken en versturen.
 *
 * ALLES GAAT LANGS JOU
 *
 *   De indeling wordt eerst berekend en getoond, en pas na bevestigen
 *   weggeschreven. De mail wordt eerst getoond, en pas na bevestigen
 *   verstuurd. Er gaat nooit iets automatisch de deur uit.
 *
 * WEGSCHRIJVEN GAAT LANGS DEZELFDE DEUR
 *
 *   Elke automatische toewijzing loopt via enrollment_choose(), dezelfde
 *   functie waarmee een leerling zelf kiest. Daardoor gelden dezelfde regels
 *   over vol, toegestane klassen en herhaling, ook als er tijdens het
 *   bevestigen nog iemand een plek pakt.
 */

export type Soort =
  | "klassen-xlsx"
  | "workshops-xlsx"
  | "klassen-pdf"
  | "workshops-pdf"
  | "codes-xlsx"
  | "codes-pdf";

export const SOORT_LABELS: Record<Soort, string> = {
  "klassen-xlsx": "Klassenlijsten (Excel)",
  "workshops-xlsx": "Workshoplijsten (Excel)",
  "klassen-pdf": "Klassenlijsten (PDF)",
  "workshops-pdf": "Workshoplijsten (PDF)",
  "codes-xlsx": "Inschrijfcodes (Excel)",
  "codes-pdf": "Inschrijfcodes (PDF)",
};

/**
 * Welke lijsten waar mogen komen.
 *
 * De codelijst hoort bij de mentor en niet in de omgeving waar de indeling
 * rondgaat. Hij gaat dus niet mee in de mail met de indeling en staat niet in
 * de klantomgeving. Jij downloadt hem en geeft hem door.
 */
export const KLANT_SOORTEN: Soort[] = ["klassen-xlsx", "workshops-xlsx", "klassen-pdf", "workshops-pdf"];

export const ALLE_SOORTEN: Soort[] = [...KLANT_SOORTEN, "codes-xlsx", "codes-pdf"];

interface RuweDag {
  dag: EnrollmentEventRow & { organizations: { name: string } | null };
  rondes: EnrollmentRoundRow[];
  sessies: EnrollmentSessionRow[];
  workshops: EnrollmentWorkshopRow[];
  klassen: { session_id: string; group_id: string }[];
  deelnemers: {
    id: string;
    display_name: string;
    group_id: string;
    exempt: boolean;
    email: string | null;
    access_code: string;
    confirmation_sent_at: string | null;
    enrollment_groups: { name: string } | null;
    enrollment_choices: { round_id: string; session_id: string; source: string }[] | null;
  }[];
}

async function haalDag(dagId: string): Promise<RuweDag | null> {
  const supabase = createServiceSupabase();

  const [{ data: dag }, { data: rondes }, { data: sessies }, { data: workshops }, { data: klassen }, { data: deelnemers }] =
    await Promise.all([
      supabase.from("enrollment_events").select("*, organizations ( name )").eq("id", dagId).maybeSingle(),
      supabase.from("enrollment_rounds").select("*").eq("event_id", dagId).order("position"),
      supabase.from("enrollment_sessions").select("*").eq("event_id", dagId).order("position"),
      supabase.from("enrollment_workshops").select("*").eq("event_id", dagId).order("position"),
      supabase.from("enrollment_session_groups").select("session_id, group_id").eq("event_id", dagId),
      supabase
        .from("enrollment_participants")
        .select(
          "id, display_name, group_id, exempt, email, access_code, confirmation_sent_at, enrollment_groups ( name ), enrollment_choices ( round_id, session_id, source )",
        )
        .eq("event_id", dagId)
        .limit(5000),
    ]);

  if (!dag) return null;

  return {
    dag: dag as unknown as RuweDag["dag"],
    rondes: (rondes ?? []) as unknown as EnrollmentRoundRow[],
    sessies: (sessies ?? []) as unknown as EnrollmentSessionRow[],
    workshops: (workshops ?? []) as unknown as EnrollmentWorkshopRow[],
    klassen: klassen ?? [],
    deelnemers: (deelnemers ?? []) as unknown as RuweDag["deelnemers"],
  };
}

function tijdVan(ronde: EnrollmentRoundRow): string {
  return `${formatTime(ronde.starts_at)} tot ${formatTime(ronde.ends_at)}`;
}

/** Alles wat de lijsten nodig hebben, in de vorm die ze verwachten. */
export async function getLijstGegevens(dagId: string): Promise<LijstGegevens | null> {
  const ruw = await haalDag(dagId);
  if (!ruw) return null;

  const workshopNaam = new Map(ruw.workshops.map((workshop) => [workshop.id, workshop.name]));

  return {
    dag: {
      naam: ruw.dag.name,
      datumTekst: formatShortDate(ruw.dag.event_date),
      organisatie: ruw.dag.organizations?.name ?? "Onbekende organisatie",
      locatie: ruw.dag.location,
    },
    rondes: ruw.rondes.map((ronde) => ({
      id: ronde.id,
      label: ronde.label,
      tijd: tijdVan(ronde),
      pauze: ronde.kind === "pauze",
    })),
    uitvoeringen: ruw.sessies
      .filter((sessie) => sessie.is_active)
      .map((sessie) => ({
        id: sessie.id,
        rondeId: sessie.round_id,
        workshopNaam: workshopNaam.get(sessie.workshop_id) ?? "Workshop",
        label: sessie.label,
        ruimte: sessie.room,
        docent: sessie.teacher,
        maximum: sessie.capacity,
      })),
    deelnemers: ruw.deelnemers.map((deelnemer) => ({
      id: deelnemer.id,
      naam: deelnemer.display_name,
      groepNaam: deelnemer.enrollment_groups?.name ?? "",
      vrijgesteld: deelnemer.exempt,
      code: deelnemer.access_code,
      keuzes: Object.fromEntries(
        (deelnemer.enrollment_choices ?? []).map((keuze) => [keuze.round_id, keuze.session_id]),
      ),
    })),
  };
}

export async function getOntbrekend(dagId: string): Promise<Ontbrekend | null> {
  const gegevens = await getLijstGegevens(dagId);
  return gegevens ? ontbrekendOverzicht(gegevens) : null;
}

/** Het voorstel voor de overige deelnemers. Verandert niets. */
export async function getIndelingVoorstel(dagId: string): Promise<IndelingVoorstel | null> {
  const ruw = await haalDag(dagId);
  if (!ruw) return null;

  const workshopNaam = new Map(ruw.workshops.map((workshop) => [workshop.id, workshop.name]));
  const klassenPerSessie = new Map<string, string[]>();
  for (const rij of ruw.klassen) {
    const lijst = klassenPerSessie.get(rij.session_id);
    if (lijst) lijst.push(rij.group_id);
    else klassenPerSessie.set(rij.session_id, [rij.group_id]);
  }

  const bezet = new Map<string, number>();
  for (const deelnemer of ruw.deelnemers) {
    for (const keuze of deelnemer.enrollment_choices ?? []) {
      bezet.set(keuze.session_id, (bezet.get(keuze.session_id) ?? 0) + 1);
    }
  }

  return maakIndeling({
    rondes: ruw.rondes.map((ronde) => ({ id: ronde.id, label: ronde.label, pauze: ronde.kind === "pauze" })),
    herhalingToegestaan: ruw.dag.allow_repeat,
    uitvoeringen: ruw.sessies
      .filter((sessie) => sessie.is_active)
      .map((sessie) => ({
        id: sessie.id,
        rondeId: sessie.round_id,
        workshopId: sessie.workshop_id,
        workshopNaam: workshopNaam.get(sessie.workshop_id) ?? "Workshop",
        label: sessie.label,
        maximum: sessie.capacity,
        bezet: bezet.get(sessie.id) ?? 0,
        klassen: klassenPerSessie.get(sessie.id) ?? [],
      })),
    deelnemers: ruw.deelnemers.map((deelnemer) => ({
      id: deelnemer.id,
      naam: deelnemer.display_name,
      groepId: deelnemer.group_id,
      groepNaam: deelnemer.enrollment_groups?.name ?? "",
      vrijgesteld: deelnemer.exempt,
      keuzes: Object.fromEntries(
        (deelnemer.enrollment_choices ?? []).map((keuze) => [keuze.round_id, keuze.session_id]),
      ),
    })),
  });
}

/**
 * Het voorstel uitvoeren.
 *
 * De berekening wordt opnieuw gedaan op de stand van dit moment, want tussen
 * kijken en bevestigen kan er iemand bij zijn gekomen. Daarna gaat elke
 * toewijzing langs enrollment_choose(), dus de database houdt de regels
 * alsnog aan als er iets is veranderd.
 */
export async function voerIndelingUit(params: {
  dagId: string;
  doorId: string;
  doorEmail: string;
}): Promise<{ ok: true; gelukt: number; mislukt: number } | { ok: false; fout: string }> {
  const voorstel = await getIndelingVoorstel(params.dagId);
  if (!voorstel) return { ok: false, fout: "Deze inschrijfdag bestaat niet meer." };
  if (voorstel.toewijzingen.length === 0) return { ok: false, fout: "Er is niemand om in te delen." };

  const supabase = createServiceSupabase();
  let gelukt = 0;
  let mislukt = 0;

  for (const toewijzing of voorstel.toewijzingen) {
    const { error } = await supabase.rpc("enrollment_choose", {
      p_participant: toewijzing.deelnemerId,
      p_session: toewijzing.sessieId,
      p_source: "automatisch",
    });
    if (error) mislukt += 1;
    else gelukt += 1;
  }

  await recordAudit({
    actorId: params.doorId,
    actorEmail: params.doorEmail,
    action: "enrollment_auto_assigned",
    entityType: "enrollment_event",
    entityId: params.dagId,
    after: { gelukt, mislukt },
  });

  return { ok: true, gelukt, mislukt };
}

export async function maakBestand(
  dagId: string,
  soort: Soort,
): Promise<{ naam: string; type: string; data: Uint8Array } | null> {
  const gegevens = await getLijstGegevens(dagId);
  if (!gegevens) return null;

  const excel = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  switch (soort) {
    case "klassen-xlsx":
      return { naam: bestandsnaam(gegevens.dag, "Klassenlijsten", "xlsx"), type: excel, data: klassenXlsx(gegevens) };
    case "workshops-xlsx":
      return {
        naam: bestandsnaam(gegevens.dag, "Workshoplijsten", "xlsx"),
        type: excel,
        data: workshopsXlsx(gegevens),
      };
    case "klassen-pdf":
      return {
        naam: bestandsnaam(gegevens.dag, "Klassenlijsten", "pdf"),
        type: "application/pdf",
        data: klassenPdf(gegevens),
      };
    case "workshops-pdf":
      return {
        naam: bestandsnaam(gegevens.dag, "Workshoplijsten", "pdf"),
        type: "application/pdf",
        data: workshopsPdf(gegevens),
      };
    case "codes-xlsx":
      return { naam: bestandsnaam(gegevens.dag, "Inschrijfcodes", "xlsx"), type: excel, data: codesXlsx(gegevens) };
    case "codes-pdf":
      return {
        naam: bestandsnaam(gegevens.dag, "Inschrijfcodes", "pdf"),
        type: "application/pdf",
        data: codesPdf(gegevens),
      };
  }
}

/**
 * Naar wie de lijsten waarschijnlijk moeten.
 *
 * Eerst de contactpersoon die bij deze dag is ingevuld. Staat die er niet,
 * dan de bekende contactpersoon van de school uit het portaal. Wordt er
 * niemand gevonden, dan blijft het veld leeg en vult de medewerker het zelf
 * in. Er wordt nooit zomaar een adres gekozen dat toevallig in de buurt komt.
 */
export async function getVoorgesteldeOntvanger(
  dagId: string,
): Promise<{ naam: string; email: string; bron: "dag" | "organisatie" | "geen" }> {
  const supabase = createServiceSupabase();

  const { data: dag } = await supabase
    .from("enrollment_events")
    .select("organization_id, contact_name, contact_email")
    .eq("id", dagId)
    .maybeSingle();

  if (!dag) return { naam: "", email: "", bron: "geen" };
  if (dag.contact_email) {
    return { naam: dag.contact_name ?? "", email: dag.contact_email, bron: "dag" };
  }

  const { data: contacten } = await supabase
    .from("organization_contacts")
    .select("email, full_name, is_verified")
    .eq("organization_id", dag.organization_id)
    .order("is_verified", { ascending: false })
    .order("created_at")
    .limit(1);

  const contact = contacten?.[0];
  if (!contact) return { naam: dag.contact_name ?? "", email: "", bron: "geen" };

  return { naam: contact.full_name ?? "", email: contact.email, bron: "organisatie" };
}

export interface MailVoorbeeld {
  naar: string;
  naam: string;
  onderwerp: string;
  tekst: string;
  /** Dezelfde mail als opgemaakte HTML, met de handtekening eronder. */
  html: string;
  bijlagen: string[];
  /** Wat er nog niet klopt aan de indeling. Staat boven het voorbeeld. */
  waarschuwingen: string[];
}

/** De mail zoals hij eruit komt te zien, zonder hem te versturen. */
export async function maakMailVoorbeeld(params: {
  dagId: string;
  naar: string;
  naam: string;
  opmerking: string | null;
  soorten: Soort[];
  toegangsLink?: string | null;
}): Promise<MailVoorbeeld | null> {
  const gegevens = await getLijstGegevens(params.dagId);
  if (!gegevens) return null;

  const aanhef = params.naam.trim() ? `Beste ${params.naam.trim().split(" ")[0]},` : "Beste,";

  const heeftExcel = params.soorten.some((soort) => soort.endsWith("xlsx"));

  /*
    De tekst van de mail.

    Dit is de brief die jullie al jaren sturen, alleen dan automatisch gevuld.
    Hij staat bewust als gewone tekst in het voorbeeld: dan kan de medewerker
    hem aanpassen, en wat hij typt komt er ook zo uit. De opmaak en de
    handtekening komen er bij het versturen omheen.
  */
  const kern = [
    aanhef,
    "",
    `In de bijlage vind je de workshopindeling voor ${gegevens.dag.naam.toLowerCase()} op ${gegevens.dag.datumTekst}.`,
    "",
    heeftExcel
      ? "Je ontvangt twee bestanden: de klassenlijsten met per klas de workshopkeuzes van de leerlingen, en de workshoplijsten met per workshop en per ronde de ingedeelde leerlingen."
      : "Je ontvangt de lijsten met per klas en per workshop de ingedeelde leerlingen.",
    "",
    "Het is handig om de lijsten uit te printen en op een goed zichtbare plek op te hangen. Zo kunnen de leerlingen eenvoudig zien waar ze moeten zijn.",
    ...(heeftExcel
      ? ["", "In beide Excel-bestanden vind je aparte tabbladen voor de betreffende klassen of workshops."]
      : []),
    ...(params.opmerking?.trim() ? ["", params.opmerking.trim()] : []),
  ].join("\n");

  const tekst = [
    kern,
    ...(params.toegangsLink
      ? ["", "De actuele indeling staat ook online en blijft bijgewerkt:", params.toegangsLink]
      : []),
    "",
    handtekeningTekst(),
  ].join("\n");

  const html = maakMailHtml({
    tekst: kern,
    handtekening: metDomein(STANDAARD_HANDTEKENING, await resolveSiteUrl()),
    naschrift: params.toegangsLink
      ? { tekst: "Bekijk de actuele indeling online", url: params.toegangsLink }
      : null,
  });

  // Waar de school straks over belt, staat liever hier dan daar.
  const ontbrekend = ontbrekendOverzicht(gegevens);
  const waarschuwingen: string[] = [];
  if (ontbrekend.nietIngedeeld.length > 0) {
    waarschuwingen.push(
      `${ontbrekend.nietIngedeeld.length} ${
        ontbrekend.nietIngedeeld.length === 1 ? "leerling mist" : "leerlingen missen"
      } nog een workshop in een of meer rondes.`,
    );
  }
  if (ontbrekend.teVol.length > 0) {
    waarschuwingen.push(`${ontbrekend.teVol.length} uitvoering(en) zitten boven het maximum.`);
  }
  if (ontbrekend.leeg.length > 0) {
    waarschuwingen.push(`${ontbrekend.leeg.length} uitvoering(en) hebben nog niemand.`);
  }

  return {
    naar: params.naar,
    naam: params.naam,
    onderwerp: `Workshopindeling en klassen · ${gegevens.dag.organisatie} · ${gegevens.dag.datumTekst}`,
    tekst,
    html,
    bijlagen: params.soorten.map((soort) => SOORT_LABELS[soort]),
    waarschuwingen,
  };
}

export async function verstuurLijsten(params: {
  dagId: string;
  naar: string;
  naam: string;
  opmerking: string | null;
  soorten: Soort[];
  toegangsLink?: string | null;
  /** Bewust nog een keer versturen, ondanks de controle hieronder. */
  nogmaals?: boolean;
  doorId: string;
  doorEmail: string;
}): Promise<{ ok: true; melding: string } | { ok: false; fout: string }> {
  if (params.soorten.length === 0) return { ok: false, fout: "Kies minstens één lijst om mee te sturen." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(params.naar)) return { ok: false, fout: "Vul een geldig e-mailadres in." };

  const voorbeeld = await maakMailVoorbeeld(params);
  if (!voorbeeld) return { ok: false, fout: "Deze inschrijfdag bestaat niet meer." };

  /*
    Twee keer op de knop drukken.

    Dat gebeurt: de knop lijkt niets te doen terwijl de bijlagen nog gemaakt
    worden. De knop zelf gaat op slot zodra je drukt, maar dat helpt niet als
    iemand het scherm ververst. Daarom kijkt de server ook: ging er in de
    afgelopen twee minuten al dezelfde mail naar hetzelfde adres, dan niet
    nog een keer, tenzij er bewust op "toch nog een keer" wordt gedrukt.
  */
  if (!params.nogmaals) {
    const sinds = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: recent } = await createServiceSupabase()
      .from("enrollment_deliveries")
      .select("id, sent_at")
      .eq("event_id", params.dagId)
      .eq("to_email", params.naar)
      .gte("sent_at", sinds)
      .limit(1);

    if (recent && recent.length > 0) {
      return {
        ok: false,
        fout: `Er is net al een mail naar ${params.naar} gestuurd. Kijk eerst bij Verstuurd of hij er staat.`,
      };
    }
  }

  const bijlagen: Bijlage[] = [];
  for (const soort of params.soorten) {
    const bestand = await maakBestand(params.dagId, soort);
    if (bestand) bijlagen.push({ naam: bestand.naam, type: bestand.type, data: bestand.data });
  }

  const supabase = createServiceSupabase();

  if (integrationMode("gmail") !== "live") {
    return { ok: false, fout: "De Gmail-koppeling staat niet aan, dus er kan niets verstuurd worden." };
  }

  let messageId: string | null = null;
  try {
    const client = await GmailClient.create();
    if (!client) throw new Error("Gmail is nog niet gekoppeld");
    const antwoord = await client.sendRaw(
      maakBericht({
        // Versturen gebeurt uit de mailbox waar de koppeling op staat, en
        // antwoorden komen daar ook terug. Dat is boekingen@skoolworkshop.nl,
        // tenzij GMAIL_MAILBOX iets anders zegt.
        van: `Skool Workshop <${serverEnv.google.mailbox}>`,
        antwoordNaar: `Skool Workshop <${serverEnv.google.mailbox}>`,
        naar: [params.naar],
        onderwerp: voorbeeld.onderwerp,
        tekst: voorbeeld.tekst,
        html: voorbeeld.html,
        bijlagen,
      }),
    );
    messageId = (antwoord as { id?: string } | null)?.id ?? null;
  } catch (fout) {
    console.error("[inschrijving] lijsten versturen mislukt", fout);
    return { ok: false, fout: "De mail kon niet verstuurd worden. Kijk of de Gmail-koppeling nog werkt." };
  }

  await supabase.from("enrollment_deliveries").insert({
    event_id: params.dagId,
    to_email: params.naar,
    to_name: params.naam || null,
    formats: params.soorten,
    note: params.opmerking?.trim() || null,
    message_id: messageId,
    sent_by: params.doorId,
  });

  await recordAudit({
    actorId: params.doorId,
    actorEmail: params.doorEmail,
    action: "enrollment_lists_sent",
    entityType: "enrollment_event",
    entityId: params.dagId,
    after: { naar: params.naar, soorten: params.soorten },
  });

  return { ok: true, melding: `De lijsten zijn verstuurd naar ${params.naar}.` };
}

export async function getVerzendingen(dagId: string) {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("enrollment_deliveries")
    .select("id, to_email, to_name, formats, sent_at")
    .eq("event_id", dagId)
    .order("sent_at", { ascending: false })
    .limit(20);
  return data ?? [];
}


// -----------------------------------------------------------------------------
// Tijdelijke toegang voor de school
// -----------------------------------------------------------------------------

/**
 * Een link plus een code aanmaken.
 *
 * De link en de code worden één keer getoond en daarna alleen nog versleuteld
 * bewaard. Wie de tabel leest, kan er dus niets mee. Kwijt is kwijt: dan maak
 * je een nieuwe aan en trek je de oude in.
 */
export async function maakToegang(params: {
  dagId: string;
  label: string;
  dagenGeldig: number;
  doorId: string;
}): Promise<{ ok: true; token: string; code: string } | { ok: false; fout: string }> {
  if (params.label.trim().length < 2) return { ok: false, fout: "Geef aan voor wie deze toegang is." };

  const supabase = createServiceSupabase();
  const token = generateToken(24);
  // Zes tekens is genoeg naast een token dat niemand raadt.
  const code = generateToken(8).replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase();

  const verloopt = new Date();
  verloopt.setDate(verloopt.getDate() + Math.min(Math.max(params.dagenGeldig, 1), 180));

  const { error } = await supabase.from("enrollment_access").insert({
    event_id: params.dagId,
    label: params.label.trim(),
    token_hash: hashToken(token),
    code_hash: hashToken(code),
    expires_at: verloopt.toISOString(),
    created_by: params.doorId,
  });

  if (error) return { ok: false, fout: error.message };
  return { ok: true, token, code };
}

export async function trekToegangIn(id: string): Promise<{ ok: boolean }> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("enrollment_access")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  return { ok: !error };
}

export interface ToegangRegel {
  id: string;
  label: string;
  expires_at: string;
  revoked_at: string | null;
  last_seen_at: string | null;
  /** Of de geldigheid voorbij is. Wordt hier bepaald, niet tijdens het tekenen. */
  verlopen: boolean;
}

export async function getToegangen(dagId: string): Promise<ToegangRegel[]> {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("enrollment_access")
    .select("id, label, expires_at, revoked_at, last_seen_at, created_at")
    .eq("event_id", dagId)
    .order("created_at", { ascending: false });

  const nu = Date.now();
  return (data ?? []).map((rij) => ({
    id: rij.id,
    label: rij.label,
    expires_at: rij.expires_at,
    revoked_at: rij.revoked_at,
    last_seen_at: rij.last_seen_at,
    verlopen: Date.parse(rij.expires_at) < nu,
  }));
}

/** Hoort deze link met deze code bij een geldige toegang? */
export async function leesToegang(params: {
  token: string;
  code: string;
}): Promise<{ dagId: string; label: string } | null> {
  if (!params.token || !params.code) return null;

  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("enrollment_access")
    .select("id, event_id, label, code_hash, expires_at, revoked_at")
    .eq("token_hash", hashToken(params.token))
    .maybeSingle();

  if (!data) return null;
  if (data.revoked_at) return null;
  if (Date.parse(data.expires_at) < Date.now()) return null;
  if (data.code_hash !== hashToken(params.code.trim().toUpperCase())) return null;

  await supabase
    .from("enrollment_access")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", data.id);

  return { dagId: data.event_id, label: data.label };
}
