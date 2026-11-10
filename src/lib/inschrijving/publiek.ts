import "server-only";

import { isCode, leesCode } from "@/lib/inschrijving/codes";
import { createServiceSupabase } from "@/lib/supabase/server";
import { zoekDeelnemer, type Kandidaat } from "@/lib/inschrijving/naam";
import {
  POGINGEN_MAX,
  POGINGEN_VENSTER_SECONDEN,
  leesToegangswijze,
  maskeer,
  pogingSleutel,
  vergelijkGedeeldeCode,
  type Toegangswijze,
} from "@/lib/inschrijving/toegang";
import type {
  EnrollmentEventRow,
  EnrollmentRoundRow,
  EnrollmentSessionRow,
  EnrollmentWorkshopRow,
} from "@/lib/types/database";

/**
 * De kant van de leerling.
 *
 * WAT HIER NOOIT GEBEURT
 *
 *   Namen van anderen tonen. De leerling kiest zijn klas en typt zijn eigen
 *   naam; er komt geen lijst in beeld waar klasgenoten op staan. Wie niet
 *   gevonden wordt, krijgt hooguit een suggestie van de naam die er het meest
 *   op lijkt, en alleen binnen zijn eigen klas.
 *
 * HET BEWIJS
 *
 *   Zodra de naam gevonden is, krijgt de browser het claim_token van die
 *   deelnemer. Elke keuze daarna moet dat token meesturen. Zonder zoiets zou
 *   je met een aangepast formulier de keuzes van een klasgenoot kunnen
 *   omgooien, want een id is geen geheim.
 *
 * DE DATABASE BESLIST
 *
 *   Alle regels over vol, toegestane klassen, herhaling en gesloten dagen
 *   staan in enrollment_choose(). Dit bestand bepaalt alleen wat er op het
 *   scherm komt. Zou er hier iets doorheen glippen, dan weigert de database
 *   het alsnog.
 */

export interface PubliekeRonde {
  id: string;
  label: string;
  begin: string;
  eind: string;
  pauze: boolean;
}

export interface PubliekeDag {
  id: string;
  naam: string;
  datum: string;
  locatie: string | null;
  organisatieNaam: string;
  audience: "school" | "organisatie";
  open: boolean;
  /** Waarom de inschrijving dicht is, als dat zo is. */
  reden: string | null;
  rondes: PubliekeRonde[];
  groepen: { id: string; naam: string }[];
  /**
   * Hoe een leerling zich bekendmaakt, nadat hij de gedeelde code heeft
   * ingevuld.
   *
   *   'code'        met zijn persoonlijke inschrijfcode van de mentor.
   *   'schoolmail'  met een cijfercode naar het adres dat de school van hem
   *                 heeft aangeleverd.
   *   'naam'        met alleen zijn naam. Staat standaard uit.
   */
  toegangswijze: Toegangswijze;
  /**
   * Staat er een gedeelde code klaar voor deze dag? Zonder actieve code kan
   * er niemand in, ook niet met de link.
   */
  gedeeldeCodeNodig: boolean;
  /** Oude naam voor toegangswijze !== 'naam'. Blijft voor de bestaande schermen. */
  codeModus: boolean;
}

function isOpen(dag: EnrollmentEventRow): { open: boolean; reden: string | null } {
  if (dag.status === "concept") return { open: false, reden: "De inschrijving is nog niet geopend." };
  if (dag.status !== "open") return { open: false, reden: "De inschrijving is gesloten." };

  const nu = Date.now();
  if (dag.opens_at && nu < Date.parse(dag.opens_at)) {
    return { open: false, reden: "De inschrijving is nog niet geopend." };
  }
  if (dag.closes_at && nu > Date.parse(dag.closes_at)) {
    return { open: false, reden: "De inschrijving is gesloten." };
  }
  return { open: true, reden: null };
}

export async function getPubliekeDag(slug: string): Promise<PubliekeDag | null> {
  const supabase = createServiceSupabase();

  const { data } = await supabase
    .from("enrollment_events")
    .select("*, organizations ( name )")
    .eq("slug", slug)
    .maybeSingle();

  if (!data) return null;
  const dag = data as unknown as EnrollmentEventRow & { organizations: { name: string } | null };

  const [{ data: rondes }, { data: groepen }] = await Promise.all([
    supabase.from("enrollment_rounds").select("*").eq("event_id", dag.id).order("position"),
    supabase.from("enrollment_groups").select("id, name").eq("event_id", dag.id).order("position").order("name"),
  ]);

  const { open, reden } = isOpen(dag);

  return {
    id: dag.id,
    naam: dag.name,
    datum: dag.event_date,
    locatie: dag.location,
    organisatieNaam: dag.organizations?.name ?? "",
    audience: dag.audience,
    open,
    reden,
    rondes: ((rondes ?? []) as unknown as EnrollmentRoundRow[]).map((ronde) => ({
      id: ronde.id,
      label: ronde.label,
      begin: ronde.starts_at,
      eind: ronde.ends_at,
      pauze: ronde.kind === "pauze",
    })),
    groepen: (groepen ?? []).map((groep) => ({ id: groep.id, naam: groep.name })),
    toegangswijze: leesToegangswijze(dag.access_mode),
    gedeeldeCodeNodig: Boolean(dag.shared_code) && dag.shared_code_active !== false,
    codeModus: leesToegangswijze(dag.access_mode) !== "naam",
  };
}

// -----------------------------------------------------------------------------
// Met de eigen code
// -----------------------------------------------------------------------------

export type CodeUitkomst =
  | { soort: "gevonden"; deelnemerId: string; claim: string; naam: string; groepId: string; groepNaam: string }
  | { soort: "vrijgesteld"; naam: string }
  | { soort: "niets" }
  | { soort: "tevaak" };

/**
 * Eén mislukte poging tellen, en zeggen of er nog een mag.
 *
 * WAAROM DIT IN DE DATABASE STAAT
 *
 *   Een teller in het geheugen van de server telt alleen wat die ene server
 *   ziet. Op Vercel draaien er meerdere naast elkaar, dus dan heeft iemand die
 *   codes zit te raden in de praktijk een veelvoud aan pogingen. Deze teller
 *   staat op één plek en geldt voor alle servers tegelijk.
 *
 *   Er wordt geteld op een versleuteld kenmerk van de bezoeker, nooit op het
 *   IP-adres zelf. Zo weten we wel dat het dezelfde bezoeker is, maar staat er
 *   nergens iets dat naar een kind te herleiden is.
 *
 *   Gaat de telling onderuit, dan weigeren we. Liever iemand die even moet
 *   wachten dan een rem die stilletjes niets meer tegenhoudt.
 */
async function magNog(params: {
  dagId: string;
  soort: "gedeeld" | "code" | "naam" | "verificatie";
  vanaf: string;
}): Promise<boolean> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase.rpc("enrollment_poging", {
    p_event: params.dagId,
    p_bucket: pogingSleutel(params.soort, params.vanaf),
    p_max: POGINGEN_MAX,
    p_seconden: POGINGEN_VENSTER_SECONDEN,
  });

  if (error) {
    console.error("[inschrijving] pogingenteller werkt niet", error.message);
    return false;
  }
  return data === true;
}

export type GedeeldeCodeUitkomst = { ok: true } | { ok: false; reden: "fout" | "uit" | "tevaak" };

/**
 * De gedeelde toegangscode van de dag controleren.
 *
 * Dit is de deur, niet het paspoort. Wie hem goed heeft weet alleen dat hij
 * bij deze dag hoort; wie hij is wordt daarna apart vastgesteld. Een goede
 * code kost geen poging, een foute wel.
 */
export async function controleerGedeeldeCode(params: {
  dagId: string;
  code: string;
  vanaf: string;
}): Promise<GedeeldeCodeUitkomst> {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("enrollment_events")
    .select("shared_code, shared_code_active")
    .eq("id", params.dagId)
    .maybeSingle();

  if (!data) return { ok: false, reden: "uit" };

  const oordeel = vergelijkGedeeldeCode(params.code, {
    shared_code: data.shared_code,
    shared_code_active: data.shared_code_active !== false,
  });

  if (oordeel === "ok") return { ok: true };
  if (oordeel === "uit") return { ok: false, reden: "uit" };

  const mag = await magNog({ dagId: params.dagId, soort: "gedeeld", vanaf: params.vanaf });
  return { ok: false, reden: mag ? "fout" : "tevaak" };
}

/**
 * Een leerling opzoeken met zijn persoonlijke code.
 *
 * Er komt geen klas aan te pas en er komt nooit een lijst met namen terug. Of
 * de code hoort bij precies één leerling, of er komt niets.
 */
export async function zoekViaCode(params: {
  dagId: string;
  code: string;
  vanaf: string;
}): Promise<CodeUitkomst> {
  const code = leesCode(params.code);
  if (!isCode(code)) {
    // Ook iets wat niet eens op een code lijkt telt mee. Anders kan een script
    // onbeperkt blijven kloppen met rommel om de teller te omzeilen.
    const mag = await magNog({ dagId: params.dagId, soort: "code", vanaf: params.vanaf });
    return mag ? { soort: "niets" } : { soort: "tevaak" };
  }

  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("enrollment_participants")
    .select("id, display_name, group_id, exempt, claim_token, enrollment_groups ( name )")
    .eq("event_id", params.dagId)
    .eq("access_code", code)
    .maybeSingle();

  if (!data) {
    const mag = await magNog({ dagId: params.dagId, soort: "code", vanaf: params.vanaf });
    return mag ? { soort: "niets" } : { soort: "tevaak" };
  }
  const rij = data as unknown as {
    id: string;
    display_name: string;
    group_id: string;
    exempt: boolean;
    claim_token: string;
    enrollment_groups: { name: string } | null;
  };

  if (rij.exempt) return { soort: "vrijgesteld", naam: rij.display_name };

  return {
    soort: "gevonden",
    deelnemerId: rij.id,
    claim: rij.claim_token,
    naam: rij.display_name,
    groepId: rij.group_id,
    groepNaam: rij.enrollment_groups?.name ?? "",
  };
}

export type ZoekUitkomst =
  | { soort: "gevonden"; deelnemerId: string; claim: string; naam: string }
  | { soort: "bijna"; kandidaten: { id: string; naam: string }[] }
  | { soort: "meerdere"; kandidaten: { id: string; naam: string }[] }
  | { soort: "vrijgesteld"; naam: string }
  | { soort: "niets" };

interface GroepRij {
  id: string;
  display_name: string;
  search_key: string;
  flat_key: string;
  exempt: boolean;
  claim_token: string;
  email: string | null;
}

/**
 * De naam opzoeken binnen één groep.
 *
 * Geeft de rij terug bij een zekere treffer, of de suggesties bij twijfel. Wat
 * er daarna met die rij mag gebeuren hangt af van de toegangswijze, en dat
 * staat in de twee functies hieronder. Zo kan er nooit per ongeluk een
 * claim_token uitgedeeld worden in een modus die dat niet hoort te doen.
 */
async function vindInGroep(params: {
  dagId: string;
  groepId: string;
  naam: string;
}): Promise<
  | { soort: "gevonden"; rij: GroepRij }
  | { soort: "bijna" | "meerdere"; kandidaten: { id: string; naam: string }[] }
  | { soort: "niets" }
> {
  const supabase = createServiceSupabase();

  const { data } = await supabase
    .from("enrollment_participants")
    .select("id, display_name, search_key, flat_key, exempt, claim_token, email")
    .eq("event_id", params.dagId)
    .eq("group_id", params.groepId)
    .limit(500);

  const rijen = (data ?? []) as unknown as GroepRij[];

  const kandidaten: Kandidaat[] = rijen.map((rij) => ({
    id: rij.id,
    naam: rij.display_name,
    sleutel: rij.search_key,
    platteSleutel: rij.flat_key,
  }));

  const uitkomst = zoekDeelnemer(params.naam, kandidaten);

  if (uitkomst.soort === "gevonden") {
    const rij = rijen.find((kandidaat) => kandidaat.id === uitkomst.kandidaat.id);
    return rij ? { soort: "gevonden", rij } : { soort: "niets" };
  }

  if (uitkomst.soort === "bijna" || uitkomst.soort === "meerdere") {
    return {
      soort: uitkomst.soort,
      // Hooguit vijf suggesties: genoeg om de juiste te herkennen, te weinig
      // om een klassenlijst mee te verzamelen.
      kandidaten: uitkomst.kandidaten.slice(0, 5).map((kandidaat) => ({ id: kandidaat.id, naam: kandidaat.naam })),
    };
  }

  return { soort: "niets" };
}

/**
 * De deelnemer opzoeken binnen zijn eigen groep, alleen op naam.
 *
 * Dit is de lichtste manier en staat standaard uit. Alleen een zekere treffer
 * levert het claim_token op. Bij twijfel komt er een vraag terug, en pas na
 * bevestigen van de juiste naam gaat het verder.
 */
export async function zoekInGroep(params: {
  dagId: string;
  groepId: string;
  naam: string;
}): Promise<ZoekUitkomst> {
  const uitkomst = await vindInGroep(params);

  if (uitkomst.soort === "gevonden") {
    const rij = uitkomst.rij;
    if (rij.exempt) return { soort: "vrijgesteld", naam: rij.display_name };
    return { soort: "gevonden", deelnemerId: rij.id, claim: rij.claim_token, naam: rij.display_name };
  }

  return uitkomst;
}

export type MailZoekUitkomst =
  | { soort: "verificatie"; deelnemerId: string; naam: string; adres: string }
  | { soort: "geen-adres"; naam: string }
  | { soort: "bijna" | "meerdere"; kandidaten: { id: string; naam: string }[] }
  | { soort: "vrijgesteld"; naam: string }
  | { soort: "niets" };

/**
 * De deelnemer opzoeken om er een verificatiemail naartoe te sturen.
 *
 * WAT HIER NIET UITKOMT
 *
 *   Het claim_token. Een naam aanklikken is geen bewijs: iedereen in de klas
 *   kent elkaars naam. Wat er wel uitkomt is het half verborgen adres, zodat
 *   de leerling ziet dat de mail naar zijn eigen schooladres gaat en niet naar
 *   dat van een klasgenoot.
 *
 *   Het adres komt altijd uit de lijst van de school. Een adres dat iemand
 *   zelf intypt wordt nergens gebruikt, want dan kon je je als een klasgenoot
 *   voordoen door je eigen adres in te vullen.
 */
export async function zoekVoorVerificatie(params: {
  dagId: string;
  groepId: string;
  naam: string;
}): Promise<MailZoekUitkomst> {
  const uitkomst = await vindInGroep(params);
  if (uitkomst.soort !== "gevonden") return uitkomst;

  const rij = uitkomst.rij;
  if (rij.exempt) return { soort: "vrijgesteld", naam: rij.display_name };
  if (!rij.email) return { soort: "geen-adres", naam: rij.display_name };

  return {
    soort: "verificatie",
    deelnemerId: rij.id,
    naam: rij.display_name,
    adres: maskeer(rij.email),
  };
}

/** Controleert of dit bewijs echt bij deze deelnemer en deze dag hoort. */
export async function leesDeelnemer(params: {
  dagId: string;
  deelnemerId: string;
  claim: string;
}): Promise<{ id: string; naam: string; groepId: string; groepNaam: string; email: string | null } | null> {
  if (!params.claim || params.claim.length < 16) return null;

  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("enrollment_participants")
    .select("id, display_name, group_id, email, exempt, claim_token, enrollment_groups ( name )")
    .eq("id", params.deelnemerId)
    .eq("event_id", params.dagId)
    .maybeSingle();

  if (!data) return null;
  const rij = data as unknown as {
    id: string;
    display_name: string;
    group_id: string;
    email: string | null;
    exempt: boolean;
    claim_token: string;
    enrollment_groups: { name: string } | null;
  };

  if (rij.exempt) return null;
  if (rij.claim_token !== params.claim) return null;

  return {
    id: rij.id,
    naam: rij.display_name,
    groepId: rij.group_id,
    groepNaam: rij.enrollment_groups?.name ?? "",
    email: rij.email,
  };
}

export interface AanbodUitvoering {
  id: string;
  workshopId: string;
  naam: string;
  label: string | null;
  ruimte: string | null;
  vrij: number;
  maximum: number;
  /** Al eerder gekozen in een andere ronde, en herhaling staat uit. */
  alGekozen: boolean;
  gekozen: boolean;
}

export interface AanbodRonde {
  id: string;
  label: string;
  begin: string;
  eind: string;
  pauze: boolean;
  keuze: AanbodUitvoering | null;
  mogelijkheden: AanbodUitvoering[];
}

/**
 * Wat deze deelnemer per ronde kan kiezen, en wat hij al gekozen heeft.
 *
 * Een volle uitvoering blijft zichtbaar, maar zonder knop. Dat is duidelijker
 * dan hem weglaten: anders denkt een leerling dat hij iets verkeerd ziet,
 * terwijl een klasgenoot gewoon eerder was.
 */
export async function getAanbod(params: {
  dagId: string;
  deelnemerId: string;
  groepId: string;
}): Promise<AanbodRonde[]> {
  const supabase = createServiceSupabase();

  const [{ data: dag }, { data: rondes }, { data: sessies }, { data: workshops }, { data: klassen }, { data: keuzes }, { data: bezetting }] =
    await Promise.all([
      supabase.from("enrollment_events").select("allow_repeat").eq("id", params.dagId).maybeSingle(),
      supabase.from("enrollment_rounds").select("*").eq("event_id", params.dagId).order("position"),
      supabase.from("enrollment_sessions").select("*").eq("event_id", params.dagId).eq("is_active", true),
      supabase.from("enrollment_workshops").select("id, name, position").eq("event_id", params.dagId),
      supabase.from("enrollment_session_groups").select("session_id, group_id").eq("event_id", params.dagId),
      supabase.from("enrollment_choices").select("round_id, session_id").eq("participant_id", params.deelnemerId),
      supabase.from("enrollment_session_occupancy").select("session_id, bezet, vrij").eq("event_id", params.dagId),
    ]);

  const herhalingMag = dag?.allow_repeat ?? false;

  const naamVanWorkshop = new Map<string, { naam: string; positie: number }>();
  for (const workshop of (workshops ?? []) as unknown as EnrollmentWorkshopRow[]) {
    naamVanWorkshop.set(workshop.id, { naam: workshop.name, positie: workshop.position });
  }

  const beperkt = new Map<string, Set<string>>();
  for (const rij of klassen ?? []) {
    const bestaand = beperkt.get(rij.session_id);
    if (bestaand) bestaand.add(rij.group_id);
    else beperkt.set(rij.session_id, new Set([rij.group_id]));
  }

  const bezetPer = new Map<string, { bezet: number; vrij: number }>();
  for (const rij of bezetting ?? []) bezetPer.set(rij.session_id, { bezet: rij.bezet, vrij: rij.vrij });

  const gekozenPerRonde = new Map<string, string>();
  for (const keuze of keuzes ?? []) gekozenPerRonde.set(keuze.round_id, keuze.session_id);

  const gekozenSessies = new Set(gekozenPerRonde.values());
  const gekozenWorkshops = new Set(
    ((sessies ?? []) as unknown as EnrollmentSessionRow[])
      .filter((sessie) => gekozenSessies.has(sessie.id))
      .map((sessie) => sessie.workshop_id),
  );

  return ((rondes ?? []) as unknown as EnrollmentRoundRow[]).map((ronde) => {
    const gekozenId = gekozenPerRonde.get(ronde.id) ?? null;

    const mogelijkheden = ((sessies ?? []) as unknown as EnrollmentSessionRow[])
      .filter((sessie) => sessie.round_id === ronde.id)
      .filter((sessie) => {
        const toegestaan = beperkt.get(sessie.id);
        return !toegestaan || toegestaan.has(params.groepId);
      })
      .sort((a, b) => {
        const een = naamVanWorkshop.get(a.workshop_id);
        const twee = naamVanWorkshop.get(b.workshop_id);
        return (
          (een?.positie ?? 0) - (twee?.positie ?? 0) ||
          (een?.naam ?? "").localeCompare(twee?.naam ?? "", "nl")
        );
      })
      .map((sessie): AanbodUitvoering => {
        const workshop = naamVanWorkshop.get(sessie.workshop_id);
        const telling = bezetPer.get(sessie.id);
        const isGekozen = sessie.id === gekozenId;
        return {
          id: sessie.id,
          workshopId: sessie.workshop_id,
          naam: workshop?.naam ?? "Workshop",
          label: sessie.label,
          ruimte: sessie.room,
          vrij: telling?.vrij ?? sessie.capacity,
          maximum: sessie.capacity,
          alGekozen: !herhalingMag && !isGekozen && gekozenWorkshops.has(sessie.workshop_id),
          gekozen: isGekozen,
        };
      });

    return {
      id: ronde.id,
      label: ronde.label,
      begin: ronde.starts_at,
      eind: ronde.ends_at,
      pauze: ronde.kind === "pauze",
      keuze: mogelijkheden.find((mogelijkheid) => mogelijkheid.gekozen) ?? null,
      mogelijkheden,
    };
  });
}

/** De foutcodes uit de database omzetten naar iets wat een leerling snapt. */
const FOUTEN: Record<string, string> = {
  enrollment_closed: "De inschrijving is gesloten.",
  enrollment_unknown: "Dat lukte niet. Probeer het opnieuw.",
  enrollment_unavailable: "Deze workshop gaat in deze ronde niet door.",
  enrollment_not_allowed: "Deze workshop is niet voor jouw klas.",
  enrollment_repeat: "Je hebt deze workshop al in een andere ronde gekozen.",
  enrollment_exempt: "Je bent vrijgesteld voor deze dag.",
  enrollment_full: "Deze workshop zit vol. Iemand was je net voor.",
};

export async function maakKeuze(params: {
  dagId: string;
  deelnemerId: string;
  claim: string;
  sessieId: string;
}): Promise<{ ok: true } | { ok: false; fout: string }> {
  const deelnemer = await leesDeelnemer(params);
  if (!deelnemer) return { ok: false, fout: "Dat lukte niet. Begin opnieuw." };

  const supabase = createServiceSupabase();
  const { error } = await supabase.rpc("enrollment_choose", {
    p_participant: params.deelnemerId,
    p_session: params.sessieId,
    p_source: "deelnemer",
  });

  if (error) {
    const code = Object.keys(FOUTEN).find((sleutel) => error.message.includes(sleutel));
    return { ok: false, fout: code ? FOUTEN[code] : "Dat lukte niet. Probeer het opnieuw." };
  }

  return { ok: true };
}

export interface BevestigingRonde {
  label: string;
  begin: string;
  eind: string;
  pauze: boolean;
  workshop: string | null;
  uitvoering: string | null;
  ruimte: string | null;
  docent: string | null;
  app: {
    naam: string;
    android: string | null;
    ios: string | null;
    web: string | null;
    uitleg: string | null;
  } | null;
  spullen: string | null;
}

export interface Bevestiging {
  deelnemer: string;
  groep: string;
  organisatie: string;
  dagNaam: string;
  datum: string;
  locatie: string | null;
  rondes: BevestigingRonde[];
  /** Rondes waarin nog niets gekozen is. */
  openRondes: number;
}

/**
 * De persoonlijke planning.
 *
 * Dit is wat op het scherm komt, wat in de mail gaat en wat in de pdf staat.
 * Eén functie, zodat die drie nooit uit elkaar kunnen lopen.
 */
export async function getBevestiging(params: {
  dagId: string;
  deelnemerId: string;
}): Promise<Bevestiging | null> {
  const supabase = createServiceSupabase();

  const [{ data: deelnemer }, { data: dag }, { data: rondes }, { data: keuzes }] = await Promise.all([
    supabase
      .from("enrollment_participants")
      .select("display_name, enrollment_groups ( name )")
      .eq("id", params.deelnemerId)
      .eq("event_id", params.dagId)
      .maybeSingle(),
    supabase
      .from("enrollment_events")
      .select("name, event_date, location, organizations ( name )")
      .eq("id", params.dagId)
      .maybeSingle(),
    supabase.from("enrollment_rounds").select("*").eq("event_id", params.dagId).order("position"),
    supabase
      .from("enrollment_choices")
      .select(
        `round_id,
         enrollment_sessions ( label, room, teacher,
           enrollment_workshops ( name, app_required, app_name, app_android_url, app_ios_url, app_web_url, app_instructions, materials ) )`,
      )
      .eq("participant_id", params.deelnemerId),
  ]);

  if (!deelnemer || !dag) return null;

  const deelnemerRij = deelnemer as unknown as {
    display_name: string;
    enrollment_groups: { name: string } | null;
  };
  const dagRij = dag as unknown as {
    name: string;
    event_date: string;
    location: string | null;
    organizations: { name: string } | null;
  };

  type KeuzeRij = {
    round_id: string;
    enrollment_sessions: {
      label: string | null;
      room: string | null;
      teacher: string | null;
      enrollment_workshops: {
        name: string;
        app_required: boolean;
        app_name: string | null;
        app_android_url: string | null;
        app_ios_url: string | null;
        app_web_url: string | null;
        app_instructions: string | null;
        materials: string | null;
      } | null;
    } | null;
  };

  const perRonde = new Map<string, KeuzeRij>();
  for (const keuze of (keuzes ?? []) as unknown as KeuzeRij[]) perRonde.set(keuze.round_id, keuze);

  let openRondes = 0;
  const regels: BevestigingRonde[] = ((rondes ?? []) as unknown as EnrollmentRoundRow[]).map((ronde) => {
    const keuze = perRonde.get(ronde.id);
    const sessie = keuze?.enrollment_sessions ?? null;
    const workshop = sessie?.enrollment_workshops ?? null;
    const pauze = ronde.kind === "pauze";

    if (!pauze && !workshop) openRondes += 1;

    return {
      label: ronde.label,
      begin: ronde.starts_at,
      eind: ronde.ends_at,
      pauze,
      workshop: workshop?.name ?? null,
      uitvoering: sessie?.label ?? null,
      ruimte: sessie?.room ?? null,
      docent: sessie?.teacher ?? null,
      app:
        workshop?.app_required && workshop.app_name
          ? {
              naam: workshop.app_name,
              android: workshop.app_android_url,
              ios: workshop.app_ios_url,
              web: workshop.app_web_url,
              uitleg: workshop.app_instructions,
            }
          : null,
      spullen: workshop?.materials ?? null,
    };
  });

  return {
    deelnemer: deelnemerRij.display_name,
    groep: deelnemerRij.enrollment_groups?.name ?? "",
    organisatie: dagRij.organizations?.name ?? "",
    dagNaam: dagRij.name,
    datum: dagRij.event_date,
    locatie: dagRij.location,
    rondes: regels,
    openRondes,
  };
}
