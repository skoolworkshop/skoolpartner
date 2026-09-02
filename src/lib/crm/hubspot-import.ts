/**
 * De omzetting van HubSpot naar SkoolPartner.
 *
 * Dit bestand bevat uitsluitend pure logica: erin gaan platte records zoals ze
 * uit HubSpot komen, eruit komt wat er in het CRM hoort te staan, of een reden
 * waarom een record niet mee gaat. Geen database, geen netwerk. Het script
 * scripts/importeer-hubspot.mjs gebruikt deze functies en doet zelf verder
 * niets aan interpretatie.
 *
 * Dat is met opzet. Een import is een handeling die je maar een keer goed kunt
 * doen, en de enige manier om vooraf te weten wat er gaat gebeuren is de
 * beslissingen los kunnen draaien van het schrijven. Elke regel hieronder is
 * dus te testen zonder dat er iets in de database verandert.
 *
 * ============================================================================
 * DE DRIE DINGEN DIE HIER NIET GEBEUREN
 * ============================================================================
 *
 * 1. Er wordt niets verzonnen. Ontbreekt een naam, een adres of een datum, dan
 *    is dat een reden om het record over te slaan en te melden, nooit om er
 *    iets plausibels van te maken.
 *
 * 2. Er wordt niets samengevoegd op gelijkenis. Twee contacten met hetzelfde
 *    adres zijn dezelfde persoon; twee contacten met dezelfde achternaam op
 *    dezelfde school zijn dat niet. Alleen het eerste is hier een regel.
 *
 * 3. Er wordt niets aan een organisatie gehangen op basis van een domeinnaam.
 *    Bedrijven gaan voorlopig niet mee. Een deal hangt dus aan zijn contact,
 *    tenzij dat contact aantoonbaar bij een school hoort die al in
 *    SkoolPartner staat, en dat oordeel valt in het importscript op grond van
 *    een gelijk e-mailadres, niet hier op grond van een gok.
 */

/* -------------------------------------------------------------------------- */
/* De fases                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * De negen fases van de HubSpot-pijplijn "Verkooppijplijn", met de fase in
 * SkoolPartner waar zij thuishoren.
 *
 * TWEE DINGEN VALLEN OP EN ZIJN GEEN VERGISSING
 *
 *   "Herinnering" staat in HubSpot als gewonnen (closedwon) gemarkeerd, maar
 *   is inhoudelijk het nabellen van een offerte die nog niet is beantwoord.
 *   Dat is geen gewonnen deal, dat is een openstaande. Hij gaat daarom naar
 *   Opvolging en blijft open staan. Zou hij als gewonnen binnenkomen, dan zou
 *   het dashboard vier deals als succes tellen die dat nooit waren.
 *
 *   "Offerte afgewezen" staat als verloren gemarkeerd en dat klopt wel. Die
 *   gaat naar Niet doorgegaan en sluit.
 *
 * De omzet op het dashboard komt uit facturen en Suri-betalingen, nooit uit
 * het bedrag op een deal. Een deal die hier als gewonnen binnenkomt telt dus
 * niet mee in de omzet; hij telt alleen mee in de pijplijn en de doorlooptijd.
 */
export const HUBSPOT_FASES: Record<
  string,
  { label: string; doel: string; sluit: "gewonnen" | "verloren" | null }
> = {
  appointmentscheduled: { label: "Nieuwe aanvraag", doel: "nieuwe_aanvraag", sluit: null },
  qualifiedtobuy: { label: "In behandeling", doel: "contact_gelegd", sluit: null },
  "587814363": { label: "Offerte verstuurd", doel: "offerte_verstuurd", sluit: null },
  closedwon: { label: "Herinnering", doel: "opvolging", sluit: null },
  "729498079": { label: "Klant bevestigd", doel: "akkoord", sluit: null },
  "729498080": { label: "Facturatie", doel: "facturatie", sluit: null },
  "729498081": { label: "Opdrcht in planningsysteem + agenda", doel: "ingepland", sluit: null },
  "729498082": { label: "Evaluatie", doel: "evaluatie", sluit: null },
  closedlost: { label: "Offerte afgewezen", doel: "verloren", sluit: "verloren" },
};

/**
 * De levensfase van een contact.
 *
 * ZZP-er ontbreekt hier met opzet. Dat zijn de docenten waarmee gewerkt wordt,
 * geen scholen die iets kopen. Ze horen niet in een verkooppijplijn thuis en
 * worden apart gemeld zodat ze desgewenst met de hand als leverancier kunnen
 * worden overgezet.
 */
export const LIFECYCLE_MAP: Record<string, "prospect" | "lead" | "klant" | "oud_klant"> = {
  subscriber: "prospect",
  lead: "prospect",
  marketingqualifiedlead: "prospect",
  salesqualifiedlead: "lead",
  opportunity: "lead",
  customer: "klant",
  evangelist: "klant",
  other: "prospect",
};

/** De HubSpot-waarde voor ZZP-er in dit portaal. */
export const ZZP_LIFECYCLE = "720711628";

/* -------------------------------------------------------------------------- */
/* Kleine opschoners                                                           */
/* -------------------------------------------------------------------------- */

export function schoon(waarde: unknown): string {
  return typeof waarde === "string" ? waarde.replace(/\s+/g, " ").trim() : "";
}

/**
 * Een adres is geldig als het een apenstaartje met iets ervoor en iets erna
 * heeft. Strenger controleren dan dit is bij een import zinloos: een adres dat
 * er goed uitziet kan alsnog niet bestaan, en een adres dat vreemd oogt kan
 * prima werken. De echte toets is de eerste mail die eruit gaat.
 */
export function leesEmail(waarde: unknown): string | null {
  const tekst = schoon(waarde).toLowerCase();
  if (!tekst) return null;
  if (tekst.includes(" ")) return null;
  const bij = tekst.indexOf("@");
  if (bij < 1 || bij === tekst.length - 1) return null;
  if (!tekst.slice(bij + 1).includes(".")) return null;
  return tekst;
}

/**
 * Telefoonnummers komen uit HubSpot in alle vormen. Alleen ruis eruit, verder
 * niets aannemen: een nummer omzetten naar +31 zou betekenen dat je gokt op
 * het land, en dat gaat bij een enkel Belgisch nummer mis.
 */
export function leesTelefoon(waarde: unknown): string | null {
  const tekst = schoon(waarde).replace(/[^\d+ ()-]/g, "").trim();
  const cijfers = tekst.replace(/\D/g, "");
  if (cijfers.length < 8 || cijfers.length > 15) return null;
  return tekst;
}

/**
 * De naam. Voornaam en achternaam samen, en als die allebei leeg zijn is dit
 * geen bruikbaar contact. Het deel voor het apenstaartje als naam gebruiken
 * levert "info" en "administratie" op, en dat is geen persoon.
 */
export function leesNaam(voornaam: unknown, achternaam: unknown): string | null {
  const naam = `${schoon(voornaam)} ${schoon(achternaam)}`.replace(/\s+/g, " ").trim();
  return naam.length > 1 ? naam : null;
}

/** Een datum uit HubSpot: ISO-tekst of een getal in milliseconden. */
export function leesMoment(waarde: unknown): string | null {
  if (waarde === null || waarde === undefined || waarde === "") return null;
  const ruw = typeof waarde === "number" ? waarde : schoon(waarde);
  if (ruw === "") return null;
  const datum = typeof ruw === "number" ? new Date(ruw) : new Date(/^\d+$/.test(ruw) ? Number(ruw) : ruw);
  if (Number.isNaN(datum.getTime())) return null;
  const jaar = datum.getUTCFullYear();
  // Buiten dit venster is het geen datum maar een verkeerd gelezen veld.
  if (jaar < 2015 || jaar > 2100) return null;
  return datum.toISOString();
}

/** Een bedrag in hele euro's naar centen. Nooit negatief, nooit onzinnig groot. */
export function leesBedrag(waarde: unknown): number {
  const tekst = typeof waarde === "number" ? String(waarde) : schoon(waarde).replace(",", ".");
  const getal = Number(tekst);
  if (!Number.isFinite(getal) || getal <= 0) return 0;
  const centen = Math.round(getal * 100);
  return centen > 100_000_000 ? 0 : centen;
}

/* -------------------------------------------------------------------------- */
/* Contacten                                                                   */
/* -------------------------------------------------------------------------- */

export interface HubSpotContact {
  id: string;
  firstname?: unknown;
  lastname?: unknown;
  email?: unknown;
  phone?: unknown;
  mobilephone?: unknown;
  jobtitle?: unknown;
  city?: unknown;
  lifecyclestage?: unknown;
  hs_email_optout?: unknown;
  createdate?: unknown;
  notes_last_contacted?: unknown;
}

export interface ContactRij {
  hubspot_id: string;
  full_name: string;
  contact_type: string | null;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  city: string | null;
  lifecycle: "prospect" | "lead" | "klant" | "oud_klant" | null;
  is_unsubscribed: boolean;
  last_contact_at: string | null;
}

export type Uitkomst<T> = { ok: true; rij: T } | { ok: false; reden: string };

/** Bij een contact wil je er ook bij weten waar de naam vandaan komt. */
export type ContactUitkomst =
  | { ok: true; rij: ContactRij; naamUitEmail: boolean }
  | { ok: false; reden: string };

export interface ContactOpties {
  /**
   * Wat er met de ZZP-ers gebeurt.
   *
   *   "leverancier" - ze komen mee als leverancier, met een lege levensfase.
   *                   Ze staan dan in het CRM, maar buiten de verkooppijplijn,
   *                   en hun afspraken kunnen aan hen blijven hangen.
   *   "overslaan"   - ze blijven in HubSpot achter, met hun afspraken.
   *
   * De eerste is de standaard. In de eerste proefdraai bleek namelijk dat 38
   * van de 73 afspraken aan deze mensen hangen: stagegesprekken en
   * kennismakingen met docenten. Ze overslaan betekent dus meer dan de helft
   * van de afsprakenhistorie weggooien, en dat is een te grote prijs voor het
   * netjes houden van een pijplijn waar ze toch al buiten vallen.
   */
  zzp?: "leverancier" | "overslaan";
}

export function leesContact(bron: HubSpotContact, opties: ContactOpties = {}): ContactUitkomst {
  const hubspotId = schoon(bron.id);
  if (!hubspotId) return { ok: false, reden: "geen recordnummer" };

  const naam = leesNaam(bron.firstname, bron.lastname);
  const email = leesEmail(bron.email);

  /*
    EEN CONTACT ZONDER NAAM IS NOG GEEN ONBRUIKBAAR CONTACT

    In HubSpot staan honderden mensen met alleen een e-mailadres: aanvragen via
    het formulier waar de naam niet is ingevuld, adressen uit een doorgestuurde
    mail, oude imports. Aan een deel van die adressen hangt wel een offerte, een
    afspraak of een notitie.

    Ze overslaan omdat de naam ontbreekt betekent dat je die historie kwijt
    bent. Er een naam bij verzinnen mag niet en is ook nergens voor nodig: het
    adres is de naam die je hebt. HubSpot doet zelf precies hetzelfde; een
    contact zonder naam staat daar in de lijst met zijn e-mailadres.

    Alleen als er ook geen adres is, blijft er niets over om mee te werken. Dan
    gaat de rij niet mee, en het rapport laat zien of er iets aan hing.
  */
  if (!naam && !email) return { ok: false, reden: "geen naam en geen e-mailadres" };

  const fase = schoon(bron.lifecyclestage);
  const isZzp = fase === ZZP_LIFECYCLE;
  if (isZzp && opties.zzp === "overslaan") {
    return { ok: false, reden: "ZZP-er, op verzoek overgeslagen" };
  }

  return {
    ok: true,
    naamUitEmail: naam === null,
    rij: {
      hubspot_id: hubspotId,
      full_name: naam ?? (email as string),
      // Een ZZP-er is een leverancier en geen prospect. Zo staat hij in het
      // CRM zonder ooit in een verkoopcijfer mee te tellen.
      contact_type: isZzp ? "leverancier" : null,
      email,
      phone: leesTelefoon(bron.phone) ?? leesTelefoon(bron.mobilephone),
      job_title: schoon(bron.jobtitle) || null,
      city: schoon(bron.city) || null,
      lifecycle: isZzp ? null : (LIFECYCLE_MAP[fase] ?? null),
      // Afgemeld blijft afgemeld. Dit is het enige veld waarbij twijfel altijd
      // de kant van niet mailen op valt.
      is_unsubscribed: schoon(bron.hs_email_optout).toLowerCase() === "true",
      last_contact_at: leesMoment(bron.notes_last_contacted),
    },
  };
}

/**
 * Twee contacten met hetzelfde adres zijn dezelfde persoon. De eerste wint,
 * want de lijst komt gesorteerd op aanmaakdatum binnen en de oudste rij heeft
 * de meeste historie aan zich hangen.
 *
 * Contacten zonder adres worden nooit samengevoegd. Twee keer "J. de Vries"
 * zonder adres zijn twee mensen tot het tegendeel blijkt.
 */
export function ontdubbelContacten(rijen: ContactRij[]): {
  uniek: ContactRij[];
  dubbel: { hubspot_id: string; zelfdeAls: string; email: string }[];
} {
  const gezien = new Map<string, string>();
  const uniek: ContactRij[] = [];
  const dubbel: { hubspot_id: string; zelfdeAls: string; email: string }[] = [];

  for (const rij of rijen) {
    if (!rij.email) {
      uniek.push(rij);
      continue;
    }
    const eerder = gezien.get(rij.email);
    if (eerder) {
      dubbel.push({ hubspot_id: rij.hubspot_id, zelfdeAls: eerder, email: rij.email });
      continue;
    }
    gezien.set(rij.email, rij.hubspot_id);
    uniek.push(rij);
  }

  return { uniek, dubbel };
}

/* -------------------------------------------------------------------------- */
/* Deals                                                                       */
/* -------------------------------------------------------------------------- */

export interface HubSpotDeal {
  id: string;
  dealname?: unknown;
  dealstage?: unknown;
  amount?: unknown;
  closedate?: unknown;
  createdate?: unknown;
  hs_lastmodifieddate?: unknown;
  description?: unknown;
  contactIds?: string[];
}

export interface DealRij {
  hubspot_id: string;
  title: string;
  stage_key: string;
  value_cents: number;
  expected_date: string | null;
  closed_at: string | null;
  note: string | null;
  created_at: string | null;
  stage_since: string | null;
  /**
   * Alle contacten die HubSpot aan deze deal koppelt, in de volgorde waarin
   * HubSpot ze teruggeeft. Bewust een lijst en geen enkel nummer: bij een
   * school hangt een offerte vaak aan de conciërge en aan de directeur, en de
   * eerste in de lijst is niet per definitie degene die ook meekomt.
   */
  contact_hubspot_ids: string[];
}

export interface DealOpties {
  /**
   * Het moment waarop de import draait. Alles met een sluitingsdatum daarvoor
   * is verleden tijd.
   */
  nu: Date;
  /**
   * Wat er moet gebeuren met de 311 deals die in HubSpot in Evaluatie zijn
   * blijven staan.
   *
   *   "sluiten"  - alles met een sluitingsdatum in het verleden gaat naar
   *                Afgerond en telt als gewonnen. De pijplijn laat dan alleen
   *                zien wat er echt nog loopt.
   *   "laten"    - alles komt binnen als Evaluatie en blijft open staan.
   *
   * Dit is een keuze en geen vanzelfsprekendheid, daarom staat hij hier en
   * niet verstopt in een if.
   */
  oudeEvaluaties: "sluiten" | "laten";
}

/**
 * Welke fase, en is de deal daarmee dicht.
 *
 * De sluitingsdatum uit HubSpot is leidend voor closed_at. Ontbreekt die bij
 * een deal die wel dicht moet, dan valt hij terug op de laatste wijziging: dat
 * is aantoonbaar het laatste moment waarop er iets aan die deal is gebeurd, en
 * dus de meest verdedigbare datum die er is. Bestaat ook die niet, dan blijft
 * de deal open en wordt hij gemeld.
 */
export function bepaalFase(
  bron: HubSpotDeal,
  opties: DealOpties
): { stage_key: string; closed_at: string | null; melding: string | null } {
  const stadium = schoon(bron.dealstage);
  const fase = HUBSPOT_FASES[stadium];
  if (!fase) {
    return { stage_key: "nieuwe_aanvraag", closed_at: null, melding: `onbekende fase ${stadium}` };
  }

  const sluitingsdatum = leesMoment(bron.closedate);
  const laatsteWijziging = leesMoment(bron.hs_lastmodifieddate);
  const isVerleden = sluitingsdatum !== null && new Date(sluitingsdatum) < opties.nu;

  if (fase.sluit === "verloren") {
    const moment = sluitingsdatum ?? laatsteWijziging;
    return {
      stage_key: fase.doel,
      closed_at: moment,
      melding: moment ? null : "verloren deal zonder sluitingsdatum",
    };
  }

  if (fase.doel === "evaluatie" && opties.oudeEvaluaties === "sluiten" && isVerleden) {
    return { stage_key: "afgerond", closed_at: sluitingsdatum, melding: null };
  }

  return { stage_key: fase.doel, closed_at: null, melding: null };
}

export function leesDeal(bron: HubSpotDeal, opties: DealOpties): Uitkomst<DealRij> {
  const hubspotId = schoon(bron.id);
  if (!hubspotId) return { ok: false, reden: "geen recordnummer" };

  /*
    Namen uit HubSpot bevatten HTML-entiteiten. In de export staat bijvoorbeeld
    "Kbs Petrus &amp; Paulus -&nbsp;Workshop Ghetto Drums". Die letterlijk
    overnemen levert een dealnaam op waar &amp; in staat, en dat is precies het
    soort ruis dat je nooit meer opruimt zodra het er eenmaal in zit.
  */
  const titel = schoon(naarPlatteTekst(bron.dealname));
  if (titel.length < 2) return { ok: false, reden: "geen bruikbare naam" };

  // Een deal zonder contact heeft in SkoolPartner niets om aan te hangen: de
  // database eist een organisatie of een contact, en organisaties gaan nu niet
  // mee. Zo'n deal overslaan is beter dan hem los in de lucht zetten.
  const contactIds = (bron.contactIds ?? []).map(schoon).filter((waarde) => waarde.length > 0);
  if (contactIds.length === 0) return { ok: false, reden: "geen gekoppeld contact" };

  const { stage_key, closed_at } = bepaalFase(bron, opties);
  const aangemaakt = leesMoment(bron.createdate);

  return {
    ok: true,
    rij: {
      hubspot_id: hubspotId,
      title: titel,
      stage_key,
      value_cents: leesBedrag(bron.amount),
      // De sluitingsdatum is in HubSpot bij een open deal de verwachte datum.
      expected_date: closed_at === null ? (leesMoment(bron.closedate)?.slice(0, 10) ?? null) : null,
      closed_at,
      note: schoon(bron.description) || null,
      created_at: aangemaakt,
      // Hoe lang staat hij al stil. De laatste wijziging is het dichtste bij
      // de waarheid dat HubSpot geeft; de echte faseovergang staat alleen in
      // de tijdlijn en die gaat niet mee.
      stage_since: leesMoment(bron.hs_lastmodifieddate) ?? aangemaakt,
      contact_hubspot_ids: contactIds,
    },
  };
}

/**
 * Welk contact wordt het.
 *
 * Niet zomaar de eerste uit de lijst, maar de eerste die ook echt meekomt.
 * Anders zou een deal die aan twee mensen hangt afketsen op het contact dat
 * toevallig vooraan staat en niet wordt overgenomen, terwijl de tweede prima
 * bruikbaar is. Dit is precies het verschil tussen 634 en 654 deals in de
 * eerste proefdraai.
 */
export function kiesContact(ids: string[], bekend: ReadonlySet<string>): string | null {
  return ids.find((id) => bekend.has(id)) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Afspraken                                                                   */
/* -------------------------------------------------------------------------- */

export interface HubSpotMeeting {
  id: string;
  hs_meeting_title?: unknown;
  hs_meeting_body?: unknown;
  hs_meeting_location?: unknown;
  hs_meeting_start_time?: unknown;
  hs_meeting_end_time?: unknown;
  hs_meeting_outcome?: unknown;
  contactIds?: string[];
}

export interface AfspraakRij {
  hubspot_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: "gepland" | "gehouden" | "geannuleerd" | "niet_verschenen";
  location: string | null;
  note: string | null;
  outcome: string | null;
  contact_hubspot_ids: string[];
}

/**
 * De uitkomst uit HubSpot naar de stand hier.
 *
 * VERZET IS EEN LASTIG GEVAL. In HubSpot betekent RESCHEDULED dat er een
 * nieuwe afspraak voor in de plaats is gekomen. De oude ging dus niet door.
 * Hij komt hier binnen als geannuleerd, met de oorspronkelijke uitkomst in het
 * veld ernaast zodat er niets verdwijnt.
 */
export const AFSPRAAK_STANDEN: Record<string, AfspraakRij["status"]> = {
  SCHEDULED: "gepland",
  COMPLETED: "gehouden",
  CANCELED: "geannuleerd",
  RESCHEDULED: "geannuleerd",
  NO_SHOW: "niet_verschenen",
  NO_ANSWER: "niet_verschenen",
};

export function leesAfspraak(bron: HubSpotMeeting, nu: Date): Uitkomst<AfspraakRij> {
  const hubspotId = schoon(bron.id);
  if (!hubspotId) return { ok: false, reden: "geen recordnummer" };

  const start = leesMoment(bron.hs_meeting_start_time);
  const eind = leesMoment(bron.hs_meeting_end_time);
  if (!start || !eind) return { ok: false, reden: "geen begin- of eindtijd" };

  const beginMs = new Date(start).getTime();
  const eindMs = new Date(eind).getTime();
  if (eindMs <= beginMs) return { ok: false, reden: "eindtijd ligt niet na de begintijd" };
  // De database staat geen afspraak van meer dan een etmaal toe. Zo'n record
  // is in HubSpot bijna altijd een blokkade in de agenda en geen gesprek.
  if (eindMs - beginMs > 24 * 60 * 60 * 1000) return { ok: false, reden: "duurt langer dan een dag" };

  const contactIds = (bron.contactIds ?? []).map(schoon).filter((waarde) => waarde.length > 0);
  if (contactIds.length === 0) return { ok: false, reden: "geen gekoppeld contact" };

  const uitkomst = schoon(bron.hs_meeting_outcome).toUpperCase();
  const gemeld = AFSPRAAK_STANDEN[uitkomst] ?? null;

  /*
    Staat er niets, dan bepaalt de klok het. Een afspraak van vorig jaar die
    nog op gepland staat, is geen agendapunt maar geschiedenis; die als gepland
    overnemen zou de agenda vullen met gesprekken die al lang geweest zijn.
    Hij komt binnen als gehouden, want dat is wat er hoogstwaarschijnlijk is
    gebeurd, en de oorspronkelijke uitkomst blijft zichtbaar in het veld.
  */
  const status: AfspraakRij["status"] = gemeld ?? (beginMs < nu.getTime() ? "gehouden" : "gepland");

  const titel = schoon(naarPlatteTekst(bron.hs_meeting_title)) || "Afspraak uit HubSpot";

  return {
    ok: true,
    rij: {
      hubspot_id: hubspotId,
      title: titel.length > 1 ? titel : "Afspraak uit HubSpot",
      starts_at: start,
      ends_at: eind,
      status,
      location: schoon(bron.hs_meeting_location) || null,
      // Platte tekst, geen HTML. Bij de eerste import ging dit mis en belandde
      // de opmaak van HubSpot letterlijk in de database; scripts/herstel-
      // afspraakteksten.mjs ruimt op wat er toen is binnengekomen.
      note: naarPlatteTekst(bron.hs_meeting_body) || null,
      outcome: uitkomst ? `Uit HubSpot: ${uitkomst}` : null,
      contact_hubspot_ids: contactIds,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Notities                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Notities staan in HubSpot als HTML in het veld. Voor de tijdlijn wil je
 * gewone tekst: die is doorzoekbaar, leest op elk scherm goed en kan niets
 * kapotmaken in de opmaak van een pagina waar hij later in terechtkomt.
 *
 * Opmaak gaat dus verloren. Dat is een bewuste keuze en geen tekortkoming:
 * vetgedrukte woorden in een notitie uit 2024 wegen niet op tegen het risico
 * van vreemde HTML in het eigen scherm.
 */
export function naarPlatteTekst(waarde: unknown): string {
  const ruw = typeof waarde === "string" ? waarde : "";
  return ruw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface HubSpotNotitie {
  id: string;
  hs_note_body?: unknown;
  hs_timestamp?: unknown;
  contactIds?: string[];
}

export interface NotitieRij {
  hubspot_id: string;
  kind: "notitie";
  summary: string;
  body: string | null;
  occurred_at: string;
  contact_hubspot_ids: string[];
}

/** De eerste zin, kort genoeg om in een lijst te passen. */
export function samenvatting(tekst: string, maximum = 120): string {
  const eerste = tekst.split("\n").find((regel) => regel.trim().length > 0)?.trim() ?? "";
  if (eerste.length <= maximum) return eerste;
  const afgekapt = eerste.slice(0, maximum);
  const spatie = afgekapt.lastIndexOf(" ");
  return `${(spatie > 40 ? afgekapt.slice(0, spatie) : afgekapt).trimEnd()}...`;
}

export function leesNotitie(bron: HubSpotNotitie): Uitkomst<NotitieRij> {
  const hubspotId = schoon(bron.id);
  if (!hubspotId) return { ok: false, reden: "geen recordnummer" };

  const tekst = naarPlatteTekst(bron.hs_note_body);
  // Een lege notitie is in HubSpot vaak een restant van een sjabloon of een
  // koppeling. Die overnemen maakt de tijdlijn alleen maar langer.
  if (tekst.length < 2) return { ok: false, reden: "lege notitie" };

  const moment = leesMoment(bron.hs_timestamp);
  if (!moment) return { ok: false, reden: "geen datum" };

  const contactIds = (bron.contactIds ?? []).map(schoon).filter((waarde) => waarde.length > 0);
  if (contactIds.length === 0) return { ok: false, reden: "geen gekoppeld contact" };

  return {
    ok: true,
    rij: {
      hubspot_id: hubspotId,
      kind: "notitie",
      summary: samenvatting(tekst),
      body: tekst,
      occurred_at: moment,
      contact_hubspot_ids: contactIds,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Verslag                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Wat er is overgeslagen en waarom, geteld per reden. Dit is het enige stuk
 * van de import dat je echt moet lezen: een reden die vaker voorkomt dan je
 * verwacht, betekent dat er iets niet klopt aan de export en niet aan de data.
 */
export interface Telling {
  soort: string;
  inHubSpot: number;
  geimporteerd: number;
  uitgesloten: number;
  redenen: { reden: string; aantal: number }[];
  klopt: boolean;
}

/**
 * De sluitende telling per soort.
 *
 * WAAROM DIT EEN EIGEN FUNCTIE IS
 *
 *   In de eerste proefdraai stond bij deals 634 overgenomen, terwijl de fases
 *   optelden tot 654. Beide getallen waren op zichzelf juist, maar ze telden
 *   iets anders: het ene was voor en het andere na de controle op het contact.
 *   Zulke verschillen kosten vertrouwen, en terecht.
 *
 *   Daarom rekent alleen deze functie nog. Zij eist dat geimporteerd plus alle
 *   uitsluitredenen samen precies het aantal in HubSpot oplevert, en zet
 *   `klopt` op onwaar als dat niet zo is. Een rapport dat niet sluit, mag geen
 *   groen licht geven.
 */
export function maakTelling(
  soort: string,
  inHubSpot: number,
  geimporteerd: number,
  redenen: { reden: string; aantal: number }[]
): Telling {
  const uitgesloten = redenen.reduce((som, r) => som + r.aantal, 0);
  return {
    soort,
    inHubSpot,
    geimporteerd,
    uitgesloten,
    redenen: [...redenen].sort((a, b) => b.aantal - a.aantal),
    klopt: geimporteerd + uitgesloten === inHubSpot,
  };
}

export function tellRedenen(uitkomsten: { ok: boolean; reden?: string }[]): { reden: string; aantal: number }[] {
  const teller = new Map<string, number>();
  for (const uitkomst of uitkomsten) {
    if (uitkomst.ok || !uitkomst.reden) continue;
    teller.set(uitkomst.reden, (teller.get(uitkomst.reden) ?? 0) + 1);
  }
  return [...teller.entries()]
    .map(([reden, aantal]) => ({ reden, aantal }))
    .sort((a, b) => b.aantal - a.aantal);
}
