import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/audit";
import type { Actor } from "@/lib/crm/mutations";
import { vertaalFout } from "@/lib/crm/mutations";
import {
  STANDAARD_REGELS,
  STANDAARD_VENSTERS,
  berekenVrijeMomenten,
  controleerVensters,
  type BezetBlok,
  type BoekingsRegels,
  type VrijeDag,
  type Werkvenster,
} from "@/lib/crm/beschikbaarheid";
import { AGENDA_UITLEG, agendaStand, bezetteBlokken, zetInAgenda } from "@/lib/integrations/google/calendar";
import { splitsNaam } from "@/lib/crm/fragment-tekst";
import { isMerk, type Merk } from "@/lib/crm/merk";
import { isAfspraakSoort, isAfspraakVorm } from "@/lib/crm/afspraken-regels";
import { generateToken } from "@/lib/crypto";

/**
 * Boekingslinks: beheren, vrije momenten tonen en een boeking aannemen.
 *
 * ============================================================================
 * DE VOLGORDE BIJ HET BOEKEN, EN WAAROM DIE ZO IS
 * ============================================================================
 *
 *   1. Is de link actief en bestaat hij?
 *   2. Klopt wat er is ingevuld?
 *   3. Zit deze link niet al aan zijn dagmaximum?
 *   4. Is het gekozen moment op DIT MOMENT nog vrij, opnieuw berekend?
 *   5. De afspraak wegschrijven. Botst hij toch, dan vangt een unieke index in
 *      de database dat op, en dat is de enige bescherming die werkt als twee
 *      bezoekers tegelijk op de knop drukken.
 *   6. Pas daarna: het contact bijwerken, de agenda vullen, de bevestiging
 *      versturen. Gaat daar iets mis, dan staat de afspraak er wel en is dat
 *      een zichtbaar probleem in plaats van een verloren boeking.
 *
 * Stap 4 en 5 zijn allebei nodig. Stap 4 geeft de bezoeker een begrijpelijke
 * melding; stap 5 is wat het echt onmogelijk maakt.
 *
 * ============================================================================
 * WAT ER MET DE PERSOONSGEGEVENS GEBEURT
 * ============================================================================
 *
 * De ingevulde naam, e-mail, telefoon en organisatie komen op twee plekken:
 * als contact in crm_contacts, want daar horen personen, en als momentopname
 * op de afspraak zelf. Dat tweede is geen verdubbeling om de verdubbeling:
 * een contact wordt later bijgewerkt of samengevoegd, en dan wil je nog steeds
 * kunnen zien wat er destijds is opgegeven.
 *
 * Er wordt geen account aangemaakt, geen uitnodiging voor het klantportaal
 * verstuurd en geen bestaande gebruiker gekoppeld. Een school die een gesprek
 * inplant, is daarmee geen SkoolPartner-gebruiker geworden.
 */

export interface BoekingsLink {
  id: string;
  slug: string;
  name: string;
  intro: string | null;
  brand: Merk;
  meetingKind: string;
  meetingForm: string;
  location: string | null;
  ownerId: string | null;
  ownerNaam: string | null;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  noticeHours: number;
  horizonDays: number;
  slotStepMinutes: number;
  timezone: string;
  isActive: boolean;
  maxPerDay: number;
  vensters: Werkvenster[];
  /** Hoeveel afspraken er via deze link zijn geboekt. Geteld, niet opgeslagen. */
  aantalBoekingen: number;
}

interface LinkRij {
  id: string;
  slug: string;
  name: string;
  intro: string | null;
  brand: string;
  meeting_kind: string;
  meeting_form: string;
  location: string | null;
  owner_id: string | null;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  notice_hours: number;
  horizon_days: number;
  slot_step_minutes: number;
  timezone: string;
  is_active: boolean;
  max_per_day: number;
}

const LINK_KOLOMMEN =
  "id, slug, name, intro, brand, meeting_kind, meeting_form, location, owner_id, duration_minutes, buffer_before_minutes, buffer_after_minutes, notice_hours, horizon_days, slot_step_minutes, timezone, is_active, max_per_day";

function naarLink(
  rij: LinkRij,
  vensters: Werkvenster[],
  extra: { ownerNaam?: string | null; aantalBoekingen?: number } = {}
): BoekingsLink {
  return {
    id: rij.id,
    slug: rij.slug,
    name: rij.name,
    intro: rij.intro,
    brand: isMerk(rij.brand) ? rij.brand : "skool_workshop",
    meetingKind: rij.meeting_kind,
    meetingForm: rij.meeting_form,
    location: rij.location,
    ownerId: rij.owner_id,
    ownerNaam: extra.ownerNaam ?? null,
    durationMinutes: rij.duration_minutes,
    bufferBeforeMinutes: rij.buffer_before_minutes,
    bufferAfterMinutes: rij.buffer_after_minutes,
    noticeHours: rij.notice_hours,
    horizonDays: rij.horizon_days,
    slotStepMinutes: rij.slot_step_minutes,
    timezone: rij.timezone,
    isActive: rij.is_active,
    maxPerDay: rij.max_per_day,
    vensters,
    aantalBoekingen: extra.aantalBoekingen ?? 0,
  };
}

/** De regels waarmee de beschikbaarheid wordt uitgerekend. */
export function regelsVan(link: BoekingsLink): BoekingsRegels {
  return {
    duurMinuten: link.durationMinutes,
    bufferVoorMinuten: link.bufferBeforeMinutes,
    bufferNaMinuten: link.bufferAfterMinutes,
    opzegtermijnUren: link.noticeHours,
    horizonDagen: link.horizonDays,
    rasterMinuten: link.slotStepMinutes,
    tijdzone: link.timezone,
    vensters: link.vensters,
  };
}

async function vensterPerLink(linkIds: string[]): Promise<Map<string, Werkvenster[]>> {
  if (linkIds.length === 0) return new Map();
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("crm_booking_availability")
    .select("link_id, weekday, start_minute, end_minute")
    .in("link_id", linkIds)
    .order("weekday", { ascending: true })
    .order("start_minute", { ascending: true });

  const kaart = new Map<string, Werkvenster[]>();
  for (const rij of data ?? []) {
    const venster: Werkvenster = {
      weekdag: rij.weekday,
      vanafMinuut: rij.start_minute,
      totMinuut: rij.end_minute,
    };
    const lijst = kaart.get(rij.link_id);
    if (lijst) lijst.push(venster);
    else kaart.set(rij.link_id, [venster]);
  }
  return kaart;
}

/** Alle boekingslinks, voor het beheerscherm. */
export async function getBoekingsLinks(): Promise<BoekingsLink[]> {
  const supabase = createServiceSupabase();

  const { data: rijen } = await supabase
    .from("crm_booking_links")
    .select(LINK_KOLOMMEN)
    .order("created_at", { ascending: true });

  const links = (rijen ?? []) as LinkRij[];
  if (links.length === 0) return [];

  const ownerIds = [...new Set(links.map((l) => l.owner_id).filter(Boolean))] as string[];

  const [vensters, { data: eigenaren }, { data: boekingen }] = await Promise.all([
    vensterPerLink(links.map((l) => l.id)),
    ownerIds.length
      ? supabase.from("profiles").select("id, full_name, email").in("id", ownerIds)
      : Promise.resolve({ data: [] }),
    supabase.from("crm_meetings").select("booking_link_id").not("booking_link_id", "is", null),
  ]);

  const naam = new Map((eigenaren ?? []).map((p) => [p.id, p.full_name ?? p.email]));
  const telling = new Map<string, number>();
  for (const b of boekingen ?? []) {
    if (b.booking_link_id) telling.set(b.booking_link_id, (telling.get(b.booking_link_id) ?? 0) + 1);
  }

  return links.map((rij) =>
    naarLink(rij, vensters.get(rij.id) ?? [], {
      ownerNaam: rij.owner_id ? (naam.get(rij.owner_id) ?? null) : null,
      aantalBoekingen: telling.get(rij.id) ?? 0,
    })
  );
}

/** Een link op zijn sleutel, voor de openbare pagina. */
export async function getBoekingsLink(slug: string): Promise<BoekingsLink | null> {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("crm_booking_links")
    .select(LINK_KOLOMMEN)
    .eq("slug", slug)
    .maybeSingle();

  if (!data) return null;

  const rij = data as LinkRij;
  const vensters = await vensterPerLink([rij.id]);
  return naarLink(rij, vensters.get(rij.id) ?? []);
}

// -----------------------------------------------------------------------------
// Vrije momenten
// -----------------------------------------------------------------------------

export interface VrijeMomentenUitkomst {
  dagen: VrijeDag[];
  /** Waarschuwing als de agenda niet is meegenomen. Null als alles klopt. */
  agendaWaarschuwing: string | null;
}

/**
 * De vrije momenten van een link.
 *
 * Twee bronnen van bezette tijd: de afspraken die het CRM al kent, en de
 * agenda van Google. Ontbreekt die tweede, dan gaat het rekenen gewoon door
 * en komt er een waarschuwing bij. Zie de kop van calendar.ts voor waarom.
 */
export async function getVrijeMomenten(
  link: BoekingsLink,
  nu = new Date()
): Promise<VrijeMomentenUitkomst> {
  const regels = regelsVan(link);
  const tot = new Date(nu.getTime() + link.horizonDays * 24 * 60 * 60_000);

  const supabase = createServiceSupabase();

  // Alleen geplande afspraken blokkeren. Een afgezegde afspraak hoort een
  // moment weer vrij te geven.
  const crmVraag = supabase
    .from("crm_meetings")
    .select("starts_at, ends_at")
    .eq("status", "gepland")
    .gte("starts_at", new Date(nu.getTime() - 24 * 60 * 60_000).toISOString())
    .lte("starts_at", tot.toISOString());

  const [{ data: crmRijen }, agenda] = await Promise.all([
    link.ownerId ? crmVraag.eq("owner_id", link.ownerId) : crmVraag,
    bezetteBlokken(nu, tot),
  ]);

  const bezet: BezetBlok[] = [
    ...(crmRijen ?? []).map((r) => ({
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      bron: "crm" as const,
    })),
    ...agenda.blokken.map((b) => ({ ...b, bron: "agenda" as const })),
  ];

  return {
    dagen: berekenVrijeMomenten(regels, bezet, nu),
    agendaWaarschuwing: agenda.stand.beschikbaar ? null : AGENDA_UITLEG[agenda.stand.reden],
  };
}

// -----------------------------------------------------------------------------
// Beheren
// -----------------------------------------------------------------------------

export interface LinkInvoer {
  id?: string | null;
  name: string;
  intro?: string | null;
  brand?: string | null;
  meetingKind?: string | null;
  meetingForm?: string | null;
  location?: string | null;
  ownerId?: string | null;
  durationMinutes: number;
  bufferAfterMinutes: number;
  noticeHours: number;
  horizonDays: number;
  isActive: boolean;
  vensters: Werkvenster[];
}

export async function bewaarBoekingsLink(invoer: LinkInvoer, wie: Actor): Promise<string> {
  const naam = invoer.name.trim();
  if (naam.length < 2) throw new Error("Geef de boekingslink een naam.");

  const vensterFouten = controleerVensters(invoer.vensters);
  if (vensterFouten.length > 0) throw new Error(vensterFouten.join(" "));
  if (invoer.vensters.length === 0) {
    throw new Error("Zonder werktijden valt er niets te boeken. Vul minstens een dag in.");
  }

  const supabase = createServiceSupabase();

  const velden = {
    name: naam,
    intro: invoer.intro?.trim() || null,
    brand: isMerk(invoer.brand) ? invoer.brand : "skool_workshop",
    meeting_kind: isAfspraakSoort(invoer.meetingKind) ? invoer.meetingKind : "kennismaking",
    meeting_form: isAfspraakVorm(invoer.meetingForm) ? invoer.meetingForm : "videobellen",
    location: invoer.location?.trim() || null,
    owner_id: invoer.ownerId || null,
    duration_minutes: invoer.durationMinutes,
    buffer_after_minutes: invoer.bufferAfterMinutes,
    notice_hours: invoer.noticeHours,
    horizon_days: invoer.horizonDays,
    is_active: invoer.isActive,
  };

  let id: string;

  if (invoer.id) {
    const { error } = await supabase.from("crm_booking_links").update(velden).eq("id", invoer.id);
    if (error) throw new Error(vertaalFout(error));
    id = invoer.id;
  } else {
    /*
      De sleutel in het adres.

      Willekeurig en lang, geen naam van de link en geen oplopend nummer. Wie
      de link niet heeft gekregen, komt er niet bij door te raden, en de naam
      van een school lekt niet uit het adres.
    */
    const slug = `${generateToken(12).toLowerCase().replace(/[^a-z0-9]/g, "")}`.slice(0, 20);
    const { data, error } = await supabase
      .from("crm_booking_links")
      .insert({ ...velden, slug, created_by: wie.userId })
      .select("id")
      .single();
    if (error) throw new Error(vertaalFout(error));
    id = data.id;
  }

  // De werktijden opnieuw zetten. Eerst weg, dan erin: bijwerken per venster
  // zou betekenen dat je moet bijhouden welke er weg mogen, en dat levert bij
  // een fout halve werktijden op.
  await supabase.from("crm_booking_availability").delete().eq("link_id", id);
  if (invoer.vensters.length > 0) {
    const { error } = await supabase.from("crm_booking_availability").insert(
      invoer.vensters.map((v) => ({
        link_id: id,
        weekday: v.weekdag,
        start_minute: v.vanafMinuut,
        end_minute: v.totMinuut,
      }))
    );
    if (error) throw new Error(vertaalFout(error));
  }

  await recordAudit({
    actorId: wie.userId,
    actorEmail: wie.email,
    action: invoer.id ? "crm.boekingslink.bijgewerkt" : "crm.boekingslink.aangemaakt",
    entityType: "crm_booking_link",
    entityId: id,
    after: { naam, actief: invoer.isActive },
  });

  return id;
}

export async function zetLinkAan(id: string, actief: boolean, wie: Actor): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("crm_booking_links")
    .update({ is_active: actief })
    .eq("id", id);
  if (error) throw new Error(vertaalFout(error));

  await recordAudit({
    actorId: wie.userId,
    actorEmail: wie.email,
    action: actief ? "crm.boekingslink.aan" : "crm.boekingslink.uit",
    entityType: "crm_booking_link",
    entityId: id,
  });
}

/** De standaardwerktijden voor een nieuwe link. */
export function standaardVensters(): Werkvenster[] {
  return STANDAARD_VENSTERS.map((v) => ({ ...v }));
}

export const STANDAARD_LINK_REGELS = STANDAARD_REGELS;

// -----------------------------------------------------------------------------
// Boeken
// -----------------------------------------------------------------------------

export interface BoekingInvoer {
  voornaam: string;
  achternaam: string;
  email: string;
  telefoon: string;
  organisatie: string;
  /** Het gekozen moment, als ISO-tijdstip. */
  startsAt: string;
  /** Verborgen veld dat een mens leeg laat. */
  honeypot?: string | null;
}

export type BoekingUitkomst =
  | { ok: true; meetingId: string; startsAt: string; endsAt: string }
  | { ok: false; fout: string };

const EMAIL_PATROON = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Een boeking aannemen vanaf de openbare pagina.
 *
 * Deze functie is het enige punt waar iemand van buiten iets in dit systeem
 * kan veroorzaken. Elke controle hier staat er om een reden.
 */
export async function boekAfspraak(
  slug: string,
  invoer: BoekingInvoer,
  nu = new Date()
): Promise<BoekingUitkomst> {
  // Een verborgen veld dat een mens nooit ziet. Is het gevuld, dan was het een
  // robot. Bewust een gewone bevestiging terug: wie merkt dat hij is
  // tegengehouden, past zijn robot aan.
  if (invoer.honeypot?.trim()) {
    return { ok: false, fout: "Er ging iets mis. Probeer het later opnieuw." };
  }

  const link = await getBoekingsLink(slug);
  if (!link) return { ok: false, fout: "Deze link bestaat niet." };
  if (!link.isActive) {
    return { ok: false, fout: "Er kan via deze link op dit moment niet worden geboekt." };
  }

  const voornaam = invoer.voornaam.trim();
  const achternaam = invoer.achternaam.trim();
  const email = invoer.email.trim().toLowerCase();
  const telefoon = invoer.telefoon.trim();
  const organisatie = invoer.organisatie.trim();

  if (voornaam.length < 2) return { ok: false, fout: "Vul je voornaam in." };
  if (achternaam.length < 2) return { ok: false, fout: "Vul je achternaam in." };
  if (!EMAIL_PATROON.test(email)) return { ok: false, fout: "Vul een geldig e-mailadres in." };
  if (telefoon.replace(/\D/g, "").length < 8) {
    return { ok: false, fout: "Vul een geldig telefoonnummer in." };
  }
  if (organisatie.length < 2) return { ok: false, fout: "Vul de naam van je school of organisatie in." };

  const supabase = createServiceSupabase();

  // Het dagmaximum. Een openbare pagina zonder bovengrens is een uitnodiging
  // om de agenda vol te zetten.
  const dagBegin = new Date(nu.getTime() - 24 * 60 * 60_000).toISOString();
  const { count } = await supabase
    .from("crm_meetings")
    .select("id", { count: "exact", head: true })
    .eq("booking_link_id", link.id)
    .gte("created_at", dagBegin);

  if ((count ?? 0) >= link.maxPerDay) {
    return {
      ok: false,
      fout: "Er zijn vandaag al veel afspraken via deze link gemaakt. Neem contact op via e-mail.",
    };
  }

  // Opnieuw rekenen. Wat er op het scherm van de bezoeker stond, kan
  // achterhaald zijn.
  const momenten = await getVrijeMomenten(link, nu);
  const nogVrij = momenten.dagen.some((dag) =>
    dag.momenten.some((m) => m.startsAt === invoer.startsAt)
  );

  if (!nogVrij) {
    return {
      ok: false,
      fout: "Dit moment is net bezet geraakt of bestaat niet meer. Kies een ander moment.",
    };
  }

  const eindeTijd = new Date(Date.parse(invoer.startsAt) + link.durationMinutes * 60_000);
  const volledigeNaam = `${voornaam} ${achternaam}`;

  // Het contact. Bestaat er al iemand met dit e-mailadres, dan wordt die
  // gebruikt; anders komt er een nieuw contact bij. Er wordt nooit een account
  // aangemaakt of gekoppeld.
  const { data: bestaand } = await supabase
    .from("crm_contacts")
    .select("id, organization_id")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();

  let contactId = bestaand?.id ?? null;
  if (!contactId) {
    const { data: nieuw } = await supabase
      .from("crm_contacts")
      .insert({
        full_name: volledigeNaam,
        email,
        phone: telefoon,
        contact_type: "opdrachtgever",
        lifecycle: "lead",
        note: `Aangemeld via de boekingslink "${link.name}". Opgegeven organisatie: ${organisatie}.`,
      })
      .select("id")
      .single();
    contactId = nieuw?.id ?? null;
  }

  const { data: afspraak, error } = await supabase
    .from("crm_meetings")
    .insert({
      title: `${link.name} met ${organisatie}`,
      kind: link.meetingKind,
      form: link.meetingForm,
      starts_at: invoer.startsAt,
      ends_at: eindeTijd.toISOString(),
      location: link.location,
      status: "gepland",
      organization_id: bestaand?.organization_id ?? null,
      contact_id: contactId,
      owner_id: link.ownerId,
      source: "boekingslink",
      booking_link_id: link.id,
      guest_name: volledigeNaam,
      guest_email: email,
      guest_phone: telefoon,
      guest_company: organisatie,
    })
    .select("id, starts_at, ends_at")
    .single();

  if (error) {
    // De unieke index heeft toegeslagen: twee bezoekers drukten tegelijk.
    const dubbel = /duplicate key|unique constraint/i.test(error.message);
    return {
      ok: false,
      fout: dubbel
        ? "Iemand was je net voor op dit moment. Kies een ander moment."
        : "Het is niet gelukt de afspraak vast te leggen. Probeer het opnieuw.",
    };
  }

  // Vanaf hier staat de afspraak er. Wat hierna misgaat, mag de boeking niet
  // ongedaan maken.
  const agenda = await zetInAgenda({
    titel: `${link.name} met ${organisatie}`,
    omschrijving: [
      `Geboekt via SkoolPartner (${link.name}).`,
      `${volledigeNaam}, ${organisatie}`,
      email,
      telefoon,
    ].join("\n"),
    locatie: link.location,
    startsAt: afspraak.starts_at,
    endsAt: afspraak.ends_at,
    tijdzone: link.timezone,
    gastEmail: email,
    gastNaam: volledigeNaam,
  });

  if (agenda.eventId) {
    await supabase
      .from("crm_meetings")
      .update({ calendar_event_id: agenda.eventId })
      .eq("id", afspraak.id);
  }

  await recordAudit({
    action: "crm.boeking.aangenomen",
    entityType: "crm_meeting",
    entityId: afspraak.id,
    after: { link: link.name, organisatie, in_agenda: Boolean(agenda.eventId) },
  });

  return {
    ok: true,
    meetingId: afspraak.id,
    startsAt: afspraak.starts_at,
    endsAt: afspraak.ends_at,
  };
}

/** De voornaam van de gast, voor de aanhef in de bevestiging. */
export function gastVoornaam(volledig: string | null): string | null {
  return splitsNaam(volledig).voornaam;
}

export { agendaStand };
