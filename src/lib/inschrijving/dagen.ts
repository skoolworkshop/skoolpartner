import "server-only";

import { randomBytes } from "node:crypto";

import { recordAudit } from "@/lib/audit";
import { woorden } from "@/lib/inschrijving/regels";
import {
  blokkades,
  controleerRooster,
  geraaktDoorKlasbeperking,
  type Rooster,
  type Waarschuwing,
} from "@/lib/inschrijving/rooster";
import { staatErAl } from "@/lib/inschrijving/catalogus";
import { standaardBewaardatum } from "@/lib/inschrijving/bewaartermijn";
import { toonCode } from "@/lib/inschrijving/codes";
import { controleerTijden, type RoosterRegel } from "@/lib/inschrijving/rondes";
import { maakGedeeldeCode } from "@/lib/inschrijving/toegang";
import { createServiceSupabase } from "@/lib/supabase/server";
import type {
  EnrollmentAudience,
  EnrollmentEventRow,
  EnrollmentGroupRow,
  EnrollmentRoundRow,
  EnrollmentSessionRow,
  EnrollmentStatus,
  EnrollmentWorkshopRow,
} from "@/lib/types/database";

/**
 * Inschrijfdagen beheren.
 *
 * DRIE LAGEN
 *
 *   De dag heeft rondes en workshops. Wat er in een ronde van een workshop
 *   draait heet een uitvoering, en dat is wat een leerling kiest. Dezelfde
 *   workshop kan in meerdere rondes draaien, en binnen één ronde zelfs twee
 *   keer naast elkaar met twee docenten.
 *
 * NOOIT IEMAND AUTOMATISCH VERPLAATSEN
 *
 *   Elke wijziging die bestaande inschrijvingen raakt, wordt eerst
 *   tegengehouden met een uitleg over wie het betreft. Pas als je bevestigt
 *   gaat hij door, en zelfs dan blijven de leerlingen staan waar ze staan.
 *
 * Alles hier draait met de serviceclient. De tabellen zijn voor niemand
 * rechtstreeks leesbaar, ook niet voor een ingelogde beheerder; de controle op
 * wie wat mag staat in de serveracties die deze functies aanroepen.
 */

/**
 * De openbare sleutel van een dag.
 *
 * Naam en datum erin, zodat je in een mailbox nog ziet waar een link over
 * ging, plus acht willekeurige tekens. Die staart is het punt: zonder die
 * tekens zou je met een gok bij de dag van een andere school komen.
 */
export function maakSlug(naam: string, datum: string): string {
  const basis = `${naam} ${datum}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  const staart = randomBytes(4).toString("hex");
  return basis ? `${basis}-${staart}` : `inschrijving-${staart}`;
}

export type Uitkomst =
  | { ok: true; melding?: string }
  /** `bevestig` betekent: dit mag wel, maar niet zonder dat jij het zegt. */
  | { ok: false; fout: string; bevestig?: boolean };

export interface DagRegel {
  id: string;
  naam: string;
  datum: string;
  status: EnrollmentStatus;
  audience: EnrollmentAudience;
  slug: string;
  locatie: string | null;
  organisatieId: string;
  organisatieNaam: string;
  aantalGroepen: number;
  aantalRondes: number;
  aantalWorkshops: number;
  aantalDeelnemers: number;
}

type TelRij = { count: number }[] | null;

function tel(waarde: TelRij): number {
  return waarde?.[0]?.count ?? 0;
}

export async function getInschrijfdagen(): Promise<DagRegel[]> {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("enrollment_events")
    .select(
      `id, name, event_date, status, audience, slug, location, organization_id,
       organizations ( name ),
       enrollment_groups ( count ),
       enrollment_rounds ( count ),
       enrollment_workshops ( count ),
       enrollment_participants ( count )`,
    )
    .order("event_date", { ascending: false })
    .limit(200);

  const rijen = (data ?? []) as unknown as (EnrollmentEventRow & {
    organizations: { name: string } | null;
    enrollment_groups: TelRij;
    enrollment_rounds: TelRij;
    enrollment_workshops: TelRij;
    enrollment_participants: TelRij;
  })[];

  return rijen.map((rij) => ({
    id: rij.id,
    naam: rij.name,
    datum: rij.event_date,
    status: rij.status,
    audience: rij.audience,
    slug: rij.slug,
    locatie: rij.location,
    organisatieId: rij.organization_id,
    organisatieNaam: rij.organizations?.name ?? "Onbekende organisatie",
    aantalGroepen: tel(rij.enrollment_groups),
    aantalRondes: tel(rij.enrollment_rounds),
    aantalWorkshops: tel(rij.enrollment_workshops),
    aantalDeelnemers: tel(rij.enrollment_participants),
  }));
}

export interface RondeRegel {
  id: string;
  positie: number;
  label: string;
  begin: string;
  eind: string;
  /** Een pauze staat op het rooster, maar er valt niets te kiezen. */
  pauze: boolean;
}

export interface UitvoeringRegel {
  id: string;
  rondeId: string;
  workshopId: string;
  label: string | null;
  maximum: number;
  ruimte: string | null;
  docent: string | null;
  actief: boolean;
  bezet: number;
  vrij: number;
  /** Lege lijst betekent: alle klassen. */
  klassen: string[];
}

export interface WorkshopRegel {
  id: string;
  naam: string;
  standaardMaximum: number;
  positie: number;
  uitvoeringen: UitvoeringRegel[];
  /** Wat een deelnemer vooraf moet regelen. */
  appNodig: boolean;
  appNaam: string | null;
  android: string | null;
  ios: string | null;
  web: string | null;
  appUitleg: string | null;
  spullen: string | null;
}

export interface GroepRegel {
  id: string;
  naam: string;
  positie: number;
  aantal: number;
}

export interface DagDetail {
  dag: EnrollmentEventRow;
  organisatieNaam: string;
  /** Alle regels van het rooster, pauzes inbegrepen. */
  rondes: RondeRegel[];
  /** Hoeveel daarvan echte workshoprondes zijn. Dit is het getal dat telt. */
  aantalWorkshopRondes: number;
  groepen: GroepRegel[];
  workshops: WorkshopRegel[];
  aantalDeelnemers: number;
  /** Deelnemers die in elke ronde een keuze hebben gemaakt. */
  aantalKlaar: number;
  /** Deelnemers die nog niets hebben gekozen. */
  aantalNietBegonnen: number;
  waarschuwingen: Waarschuwing[];
}

function maakRooster(detail: Omit<DagDetail, "waarschuwingen">): Rooster {
  return {
    rondes: detail.rondes.map((ronde) => ({ id: ronde.id, label: ronde.label, pauze: ronde.pauze })),
    groepen: detail.groepen.map((groep) => ({ id: groep.id, naam: groep.naam, aantal: groep.aantal })),
    workshops: detail.workshops.map((workshop) => ({
      id: workshop.id,
      naam: workshop.naam,
      uitvoeringen: workshop.uitvoeringen,
    })),
    herhalingToegestaan: detail.dag.allow_repeat,
  };
}

export async function getInschrijfdag(id: string): Promise<DagDetail | null> {
  const supabase = createServiceSupabase();

  const { data: dagRij } = await supabase
    .from("enrollment_events")
    .select("*, organizations ( name )")
    .eq("id", id)
    .maybeSingle();

  if (!dagRij) return null;
  const dag = dagRij as unknown as EnrollmentEventRow & { organizations: { name: string } | null };

  const [
    { data: rondeRijen },
    { data: groepRijen },
    { data: workshopRijen },
    { data: sessieRijen },
    { data: klasRijen },
    { data: bezetting },
    { data: deelnemers },
  ] = await Promise.all([
    supabase.from("enrollment_rounds").select("*").eq("event_id", id).order("position"),
    supabase
      .from("enrollment_groups")
      .select("*, enrollment_participants ( count )")
      .eq("event_id", id)
      .order("position")
      .order("name"),
    supabase.from("enrollment_workshops").select("*").eq("event_id", id).order("position").order("name"),
    supabase.from("enrollment_sessions").select("*").eq("event_id", id).order("position"),
    supabase.from("enrollment_session_groups").select("session_id, group_id").eq("event_id", id),
    supabase.from("enrollment_session_occupancy").select("session_id, bezet, vrij").eq("event_id", id),
    supabase.from("enrollment_participants").select("id, enrollment_choices ( id )").eq("event_id", id),
  ]);

  const bezetPerSessie = new Map<string, { bezet: number; vrij: number }>();
  for (const rij of bezetting ?? []) bezetPerSessie.set(rij.session_id, { bezet: rij.bezet, vrij: rij.vrij });

  const klassenPerSessie = new Map<string, string[]>();
  for (const rij of klasRijen ?? []) {
    const lijst = klassenPerSessie.get(rij.session_id);
    if (lijst) lijst.push(rij.group_id);
    else klassenPerSessie.set(rij.session_id, [rij.group_id]);
  }

  const sessiesPerWorkshop = new Map<string, UitvoeringRegel[]>();
  for (const sessie of (sessieRijen ?? []) as unknown as EnrollmentSessionRow[]) {
    const gevonden = bezetPerSessie.get(sessie.id);
    const regel: UitvoeringRegel = {
      id: sessie.id,
      rondeId: sessie.round_id,
      workshopId: sessie.workshop_id,
      label: sessie.label,
      maximum: sessie.capacity,
      ruimte: sessie.room,
      docent: sessie.teacher,
      actief: sessie.is_active,
      bezet: gevonden?.bezet ?? 0,
      vrij: gevonden?.vrij ?? sessie.capacity,
      klassen: klassenPerSessie.get(sessie.id) ?? [],
    };
    const lijst = sessiesPerWorkshop.get(sessie.workshop_id);
    if (lijst) lijst.push(regel);
    else sessiesPerWorkshop.set(sessie.workshop_id, [regel]);
  }

  const rondes: RondeRegel[] = ((rondeRijen ?? []) as unknown as EnrollmentRoundRow[]).map((ronde) => ({
    id: ronde.id,
    positie: ronde.position,
    label: ronde.label,
    begin: ronde.starts_at,
    eind: ronde.ends_at,
    pauze: ronde.kind === "pauze",
  }));

  // Alleen hier wordt geteld wat een leerling moet kiezen. Een pauze telt niet
  // mee, anders is niemand ooit klaar.
  const aantalWorkshopRondes = rondes.filter((ronde) => !ronde.pauze).length;

  const workshops: WorkshopRegel[] = ((workshopRijen ?? []) as unknown as EnrollmentWorkshopRow[]).map((workshop) => ({
    id: workshop.id,
    naam: workshop.name,
    standaardMaximum: workshop.default_capacity,
    positie: workshop.position,
    uitvoeringen: sessiesPerWorkshop.get(workshop.id) ?? [],
    appNodig: workshop.app_required,
    appNaam: workshop.app_name,
    android: workshop.app_android_url,
    ios: workshop.app_ios_url,
    web: workshop.app_web_url,
    appUitleg: workshop.app_instructions,
    spullen: workshop.materials,
  }));

  const groepen: GroepRegel[] = ((groepRijen ?? []) as unknown as (EnrollmentGroupRow & {
    enrollment_participants: TelRij;
  })[]).map((groep) => ({
    id: groep.id,
    naam: groep.name,
    positie: groep.position,
    aantal: tel(groep.enrollment_participants),
  }));

  const deelnemerRijen = (deelnemers ?? []) as unknown as { id: string; enrollment_choices: { id: string }[] | null }[];
  let aantalKlaar = 0;
  let aantalNietBegonnen = 0;
  for (const deelnemer of deelnemerRijen) {
    const gekozen = deelnemer.enrollment_choices?.length ?? 0;
    if (aantalWorkshopRondes > 0 && gekozen >= aantalWorkshopRondes) aantalKlaar += 1;
    if (gekozen === 0) aantalNietBegonnen += 1;
  }

  const zonderControle = {
    dag,
    organisatieNaam: dag.organizations?.name ?? "Onbekende organisatie",
    rondes,
    aantalWorkshopRondes,
    groepen,
    workshops,
    aantalDeelnemers: deelnemerRijen.length,
    aantalKlaar,
    aantalNietBegonnen,
  };

  return { ...zonderControle, waarschuwingen: controleerRooster(maakRooster(zonderControle)) };
}

/** Een nieuwe inschrijfdag. Begint altijd als concept, nooit direct open. */
export async function maakDag(params: {
  organisatieId: string;
  naam: string;
  datum: string;
  locatie: string | null;
  audience: EnrollmentAudience;
  doorId: string;
  doorEmail: string;
}): Promise<{ ok: true; id: string } | { ok: false; fout: string }> {
  const supabase = createServiceSupabase();

  const naam = params.naam.trim();
  if (naam.length < 2) return { ok: false, fout: "Geef de dag een naam, bijvoorbeeld Cultuurdag." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.datum)) return { ok: false, fout: "Kies een datum." };

  const { data: organisatie } = await supabase
    .from("organizations")
    .select("id")
    .eq("id", params.organisatieId)
    .maybeSingle();
  if (!organisatie) return { ok: false, fout: "Kies een organisatie." };

  const { data, error } = await supabase
    .from("enrollment_events")
    .insert({
      organization_id: params.organisatieId,
      name: naam,
      event_date: params.datum,
      location: params.locatie?.trim() || null,
      audience: params.audience,
      status: "concept",
      slug: maakSlug(naam, params.datum),
      // De gedeelde toegangscode staat er meteen bij. Zo kan hij niet vergeten
      // worden, en kan de school hem alvast doorgeven met de link.
      shared_code: maakGedeeldeCode(),
      shared_code_active: true,
      shared_code_changed_at: new Date().toISOString(),
      // Vanaf het begin staat vast tot wanneer de leerlinggegevens bewaard
      // worden. Zo is er nooit een dag zonder termijn.
      purge_after: standaardBewaardatum(params.datum),
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, fout: error?.message ?? "De dag kon niet worden aangemaakt." };

  await recordAudit({
    actorId: params.doorId,
    actorEmail: params.doorEmail,
    action: "enrollment_event_created",
    entityType: "enrollment_event",
    entityId: data.id,
    organizationId: params.organisatieId,
    after: { name: naam, event_date: params.datum },
  });

  return { ok: true, id: data.id };
}

export async function bewaarDag(params: {
  id: string;
  naam: string;
  datum: string;
  locatie: string | null;
  opmerking: string | null;
  sluitOp: string | null;
  herhalingToegestaan: boolean;
  /**
   * 'code' is de veilige standaard: de persoonlijke code van de mentor.
   * 'schoolmail' als de school adressen heeft aangeleverd.
   * 'naam' alleen als een school niet anders kan, want dan kan een klasgenoot
   * de inschrijving van iemand anders doen.
   */
  toegangswijze: "code" | "schoolmail" | "naam";
  contactNaam: string | null;
  contactEmail: string | null;
  /**
   * Tot wanneer de leerlinggegevens van deze dag bewaard worden. Leeg laten
   * betekent terug naar de standaard: dertig dagen na de cultuurdag.
   */
  bewaarTot: string | null;
}): Promise<Uitkomst> {
  const supabase = createServiceSupabase();
  const naam = params.naam.trim();
  if (naam.length < 2) return { ok: false, fout: "Geef de dag een naam." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.datum)) return { ok: false, fout: "Kies een datum." };

  const email = (params.contactEmail ?? "").trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, fout: "Dat e-mailadres klopt niet." };
  }

  // Verificatie per schoolmail kan alleen als er adressen in de lijst staan.
  // Zonder adressen zou niemand meer binnenkomen, en dat merk je pas als de
  // eerste klas het probeert.
  if (params.toegangswijze === "schoolmail") {
    const { count } = await supabase
      .from("enrollment_participants")
      .select("id", { count: "exact", head: true })
      .eq("event_id", params.id)
      .not("email", "is", null);

    if ((count ?? 0) === 0) {
      return {
        ok: false,
        fout:
          "Bij deze dag staat van niemand een e-mailadres. Kies de persoonlijke codes, of lees eerst een lijst met adressen in.",
      };
    }
  }

  const bewaarTot = (params.bewaarTot ?? "").trim() || standaardBewaardatum(params.datum);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bewaarTot)) {
    return { ok: false, fout: "De bewaardatum klopt niet." };
  }
  if (bewaarTot < params.datum) {
    return { ok: false, fout: "De leerlinggegevens kunnen niet weg voordat de dag geweest is." };
  }

  const { error } = await supabase
    .from("enrollment_events")
    .update({
      name: naam,
      event_date: params.datum,
      location: params.locatie?.trim() || null,
      note: params.opmerking?.trim() || null,
      closes_at: params.sluitOp || null,
      allow_repeat: params.herhalingToegestaan,
      access_mode:
        params.toegangswijze === "naam" ? "naam" : params.toegangswijze === "schoolmail" ? "schoolmail" : "code",
      contact_name: params.contactNaam?.trim() || null,
      contact_email: email || null,
      purge_after: bewaarTot,
    })
    .eq("id", params.id);

  return error ? { ok: false, fout: error.message } : { ok: true };
}

/**
 * De status wijzigen.
 *
 * Openzetten mag alleen als het rooster klopt. Een leerling die straks op een
 * ronde stuit waar hij niets kan kiezen, is een telefoontje; dat hoort er van
 * tevoren uit te komen.
 */
/**
 * Een nieuwe inschrijflink maken.
 *
 * WANNEER
 *
 *   Als de link ergens terecht is gekomen waar hij niet hoort. De oude werkt
 *   daarna niet meer; wie hem opent krijgt gewoon "niet gevonden".
 *
 * WAT ER NIET GEBEURT
 *
 *   Aan de inschrijvingen verandert niets. De gemaakte keuzes, de klassen, de
 *   persoonlijke codes en de deelnemers blijven precies zoals ze waren. Alleen
 *   het adres van de pagina verandert, en dat moet de school opnieuw delen.
 *   Daarom vraagt dit eerst om bevestiging.
 */
export async function nieuweLink(params: { dagId: string; bevestigd?: boolean }): Promise<Uitkomst> {
  const supabase = createServiceSupabase();

  const { data: dag } = await supabase
    .from("enrollment_events")
    .select("id, name, event_date, status")
    .eq("id", params.dagId)
    .maybeSingle();

  if (!dag) return { ok: false, fout: "Deze inschrijfdag bestaat niet meer." };

  if (!params.bevestigd) {
    return {
      ok: false,
      bevestig: true,
      fout:
        dag.status === "open"
          ? "De inschrijving staat open. Wie de huidige link al heeft, kan er daarna niet meer bij tot de school de nieuwe heeft gedeeld."
          : "De huidige link werkt daarna niet meer. De school moet de nieuwe link opnieuw delen.",
    };
  }

  const { error } = await supabase
    .from("enrollment_events")
    .update({ slug: maakSlug(dag.name, dag.event_date) })
    .eq("id", params.dagId);

  return error
    ? { ok: false, fout: error.message }
    : { ok: true, melding: "Er staat een nieuwe link klaar. De oude werkt niet meer." };
}

// -----------------------------------------------------------------------------
// De gedeelde toegangscode
// -----------------------------------------------------------------------------
/**
 * WAT DIT IS
 *
 *   Eén code per cultuurdag, die de school samen met de link aan alle
 *   leerlingen geeft. Hij zegt alleen: jij hoort bij deze dag. Wie iemand is
 *   wordt daarna apart vastgesteld, met de persoonlijke code of met een
 *   cijfercode naar het schooladres.
 *
 * WAAROM HIJ GEWOON LEESBAAR OP HET SCHERM STAAT
 *
 *   Hij is bedoeld om gedeeld te worden met honderden leerlingen. Een code die
 *   een hele school kent is geen geheim, en doen alsof dat wel zo is maakt het
 *   alleen onhandig. De bescherming zit in het kunnen intrekken, in de
 *   pogingenteller, en vooral in de tweede stap.
 */

/** Een nieuwe gedeelde code. De oude werkt daarna niet meer. */
export async function nieuweGedeeldeCode(params: {
  dagId: string;
  bevestigd?: boolean;
}): Promise<Uitkomst> {
  const supabase = createServiceSupabase();

  const { data: dag } = await supabase
    .from("enrollment_events")
    .select("id, status, shared_code")
    .eq("id", params.dagId)
    .maybeSingle();

  if (!dag) return { ok: false, fout: "Deze inschrijfdag bestaat niet meer." };

  // Staat de inschrijving open en is er al een code uitgedeeld, dan kan dit
  // midden in een les een klas buitensluiten. Daar hoort een vraag voor.
  if (dag.shared_code && dag.status === "open" && !params.bevestigd) {
    return {
      ok: false,
      bevestig: true,
      fout:
        "De inschrijving staat open. Wie de huidige code heeft gekregen, komt er na het wisselen niet meer in tot de school de nieuwe code heeft gedeeld. Gemaakte keuzes blijven staan.",
    };
  }

  const code = maakGedeeldeCode();
  const { error } = await supabase
    .from("enrollment_events")
    .update({ shared_code: code, shared_code_active: true, shared_code_changed_at: new Date().toISOString() })
    .eq("id", params.dagId);

  return error
    ? { ok: false, fout: error.message }
    : { ok: true, melding: `De nieuwe toegangscode is ${toonCode(code)}. Deel hem met de school.` };
}

/**
 * De gedeelde code aan- of uitzetten.
 *
 * Uitzetten is de noodrem: er komt dan niemand meer binnen, ook niet wie het
 * scherm nog open heeft staan. Aan de gemaakte keuzes verandert niets.
 */
export async function zetGedeeldeCode(params: { dagId: string; actief: boolean }): Promise<Uitkomst> {
  const supabase = createServiceSupabase();

  const { data: dag } = await supabase
    .from("enrollment_events")
    .select("id, shared_code")
    .eq("id", params.dagId)
    .maybeSingle();

  if (!dag) return { ok: false, fout: "Deze inschrijfdag bestaat niet meer." };
  if (params.actief && !dag.shared_code) {
    return { ok: false, fout: "Er staat nog geen code klaar. Maak er eerst een." };
  }

  const { error } = await supabase
    .from("enrollment_events")
    .update({ shared_code_active: params.actief })
    .eq("id", params.dagId);

  if (error) return { ok: false, fout: error.message };

  return {
    ok: true,
    melding: params.actief
      ? "De toegangscode werkt weer."
      : "De toegangscode staat uit. Er kan nu niemand meer inschrijven of wijzigen.",
  };
}

export async function zetStatus(id: string, status: EnrollmentStatus): Promise<Uitkomst> {
  const supabase = createServiceSupabase();

  if (status === "open") {
    const detail = await getInschrijfdag(id);
    if (!detail) return { ok: false, fout: "Deze inschrijfdag bestaat niet meer." };

    // Zonder werkende toegangscode komt er geen leerling binnen. Staat hij uit,
    // dan is dat een keuze van de beheerder en zeggen we het gewoon. Is er nog
    // geen code, dan zetten we er een klaar: dat kan niet misgaan en het scheelt
    // een stap.
    if (!detail.dag.shared_code) {
      const nieuw = await nieuweGedeeldeCode({ dagId: id, bevestigd: true });
      if (!nieuw.ok) return nieuw;
    } else if (!detail.dag.shared_code_active) {
      return {
        ok: false,
        fout: "De toegangscode van deze dag staat uit. Zet hem aan, anders komt er geen leerling binnen.",
      };
    }

    if (detail.dag.access_mode === "schoolmail") {
      const { count } = await supabase
        .from("enrollment_participants")
        .select("id", { count: "exact", head: true })
        .eq("event_id", id)
        .not("email", "is", null);

      if ((count ?? 0) === 0) {
        return {
          ok: false,
          fout:
            "Deze dag staat op verificatie per schoolmail, maar er staat van niemand een e-mailadres in de lijst. Zet hem op de persoonlijke codes of lees eerst de adressen in.",
        };
      }
    }

    const taal = woorden(detail.dag.audience);
    if (detail.aantalWorkshopRondes === 0) {
      return {
        ok: false,
        fout:
          detail.rondes.length === 0
            ? "Zet eerst minstens één ronde klaar."
            : "Er staan alleen pauzes op het rooster. Zet er minstens één workshopronde bij.",
      };
    }
    if (detail.workshops.length === 0) return { ok: false, fout: "Zet eerst minstens één workshop klaar." };
    if (detail.groepen.length === 0) return { ok: false, fout: `Zet eerst minstens één ${taal.groep} klaar.` };

    const problemen = blokkades(maakRooster(detail));
    if (problemen.length > 0) {
      return { ok: false, fout: `Het rooster klopt nog niet: ${problemen.map((p) => p.tekst).join(" ")}` };
    }
  }

  const { error } = await supabase
    .from("enrollment_events")
    .update({ status, opens_at: status === "open" ? new Date().toISOString() : undefined })
    .eq("id", id);

  return error ? { ok: false, fout: error.message } : { ok: true };
}


// -----------------------------------------------------------------------------
// Rondes
// -----------------------------------------------------------------------------

export async function voegRondeToe(params: {
  dagId: string;
  label: string;
  begin: string;
  eind: string;
}): Promise<Uitkomst> {
  const supabase = createServiceSupabase();
  if (!/^\d{2}:\d{2}$/.test(params.begin) || !/^\d{2}:\d{2}$/.test(params.eind)) {
    return { ok: false, fout: "Vul een begin- en eindtijd in, bijvoorbeeld 09:15." };
  }
  if (params.eind <= params.begin) return { ok: false, fout: "De eindtijd moet na de begintijd liggen." };

  const { data: bestaand } = await supabase
    .from("enrollment_rounds")
    .select("position")
    .eq("event_id", params.dagId)
    .order("position", { ascending: false })
    .limit(1);

  const positie = (bestaand?.[0]?.position ?? 0) + 1;
  if (positie > 12) return { ok: false, fout: "Twaalf rondes op één dag is het maximum." };

  const { data: ronde, error } = await supabase
    .from("enrollment_rounds")
    .insert({
      event_id: params.dagId,
      position: positie,
      label: params.label.trim() || `Workshopronde ${positie}`,
      starts_at: params.begin,
      ends_at: params.eind,
    })
    .select("id")
    .single();

  if (error || !ronde) return { ok: false, fout: error?.message ?? "De ronde kon niet worden toegevoegd." };

  // Elke workshop die al bestaat, draait standaard ook in deze nieuwe ronde.
  const { data: workshops } = await supabase
    .from("enrollment_workshops")
    .select("id, default_capacity")
    .eq("event_id", params.dagId);

  if (workshops && workshops.length > 0) {
    await supabase.from("enrollment_sessions").insert(
      workshops.map((workshop, index) => ({
        event_id: params.dagId,
        workshop_id: workshop.id,
        round_id: ronde.id,
        capacity: workshop.default_capacity,
        position: index + 1,
      })),
    );
  }

  return { ok: true, melding: "De ronde staat erin, met alle workshops erin aangezet." };
}

export async function bewaarRonde(params: {
  rondeId: string;
  label: string;
  begin: string;
  eind: string;
}): Promise<Uitkomst> {
  const supabase = createServiceSupabase();
  if (!/^\d{2}:\d{2}/.test(params.begin) || !/^\d{2}:\d{2}/.test(params.eind)) {
    return { ok: false, fout: "Vul een begin- en eindtijd in, bijvoorbeeld 09:15." };
  }
  if (params.eind <= params.begin) return { ok: false, fout: "De eindtijd moet na de begintijd liggen." };
  if (params.label.trim().length < 2) return { ok: false, fout: "Geef de ronde een naam." };

  const { error } = await supabase
    .from("enrollment_rounds")
    .update({ label: params.label.trim(), starts_at: params.begin, ends_at: params.eind })
    .eq("id", params.rondeId);

  return error ? { ok: false, fout: error.message } : { ok: true, melding: "De ronde is bijgewerkt." };
}

/**
 * Een ronde weghalen.
 *
 * De keuzes van de deelnemers in die ronde verdwijnen mee. Daarom mag het
 * alleen zolang er nog niemand in die ronde heeft gekozen; anders gooi je met
 * één klik het werk van een halve klas weg.
 */
/**
 * Het hele dagrooster in één keer aanmaken.
 *
 * WAT DIT OPLOST
 *
 *   Vijf rondes met pauzes ertussen zijn tien formuliertjes en een
 *   rekensommetje. Hier geef je het aantal, de starttijd, de duur en de
 *   pauze, en staat het rooster er.
 *
 * BESTAANDE RONDES WORDEN NOOIT ZOMAAR OVERSCHREVEN
 *
 *   Staan er al rondes, dan gebeurt er niets tot jij zegt wat ermee moet.
 *   Vervangen kan alleen als er nog nergens iets gekozen is: zodra er één
 *   leerling in een ronde zit, is die ronde van hem en niet meer van het
 *   formulier. Dan kun je nog wel rondes toevoegen.
 */
export async function genereerRondes(params: {
  dagId: string;
  regels: RoosterRegel[];
  /** nee = erbij zetten, ja = eerst alle bestaande rondes weghalen. */
  vervangen: boolean;
  bevestigd?: boolean;
}): Promise<Uitkomst> {
  const supabase = createServiceSupabase();

  if (params.regels.length === 0) return { ok: false, fout: "Er is nog geen rooster om op te slaan." };

  const problemen = controleerTijden(params.regels);
  if (problemen.length > 0) return { ok: false, fout: problemen[0].tekst };

  const { data: bestaande } = await supabase
    .from("enrollment_rounds")
    .select("id, position")
    .eq("event_id", params.dagId)
    .order("position");

  const aantalBestaand = bestaande?.length ?? 0;

  if (aantalBestaand + params.regels.length > 12 && !params.vervangen) {
    return { ok: false, fout: "Twaalf rondes op één dag is het maximum." };
  }

  if (params.vervangen && aantalBestaand > 0) {
    const { count } = await supabase
      .from("enrollment_choices")
      .select("id", { count: "exact", head: true })
      .in("round_id", (bestaande ?? []).map((ronde) => ronde.id));

    if ((count ?? 0) > 0) {
      return {
        ok: false,
        fout: `Er zijn al ${count} keuzes gemaakt in de huidige rondes. Die kunnen niet zomaar weg. Pas de tijden van de bestaande rondes aan, of verwijder eerst de keuzes.`,
      };
    }

    if (!params.bevestigd) {
      return {
        ok: false,
        bevestig: true,
        fout: `Er ${aantalBestaand === 1 ? "staat al 1 ronde" : `staan al ${aantalBestaand} rondes`} klaar. Doorgaan vervangt die door dit rooster.`,
      };
    }

    const { error: wegFout } = await supabase
      .from("enrollment_rounds")
      .delete()
      .eq("event_id", params.dagId);
    if (wegFout) return { ok: false, fout: wegFout.message };
  }

  const beginPositie = params.vervangen ? 0 : aantalBestaand;

  const { data: nieuweRondes, error } = await supabase
    .from("enrollment_rounds")
    .insert(
      params.regels.map((regel, index) => ({
        event_id: params.dagId,
        position: beginPositie + index + 1,
        label: regel.label,
        starts_at: regel.begin,
        ends_at: regel.eind,
        kind: regel.pauze ? "pauze" : "workshop",
      })),
    )
    .select("id, kind");

  if (error || !nieuweRondes) {
    return { ok: false, fout: error?.message ?? "Het rooster kon niet worden opgeslagen." };
  }

  // Elke workshop die al bestaat, draait standaard ook in de nieuwe rondes.
  // In een pauze valt niets te kiezen, dus daar komt geen uitvoering.
  const { data: workshops } = await supabase
    .from("enrollment_workshops")
    .select("id, default_capacity")
    .eq("event_id", params.dagId);

  const workshopRondes = nieuweRondes.filter((ronde) => ronde.kind !== "pauze");
  if (workshops && workshops.length > 0 && workshopRondes.length > 0) {
    const uitvoeringen = workshopRondes.flatMap((ronde) =>
      workshops.map((workshop, index) => ({
        event_id: params.dagId,
        workshop_id: workshop.id,
        round_id: ronde.id,
        capacity: workshop.default_capacity,
        position: index + 1,
      })),
    );
    const { error: sessieFout } = await supabase.from("enrollment_sessions").insert(uitvoeringen);
    if (sessieFout) return { ok: false, fout: sessieFout.message };
  }

  const aantalRondes = workshopRondes.length;
  const aantalPauzes = nieuweRondes.length - aantalRondes;

  return {
    ok: true,
    melding: `${aantalRondes} ${aantalRondes === 1 ? "ronde" : "rondes"}${
      aantalPauzes > 0 ? ` en ${aantalPauzes} ${aantalPauzes === 1 ? "pauze" : "pauzes"}` : ""
    } aangemaakt${workshops && workshops.length > 0 ? ", met alle workshops erin aangezet" : ""}.`,
  };
}

export async function verwijderRonde(rondeId: string): Promise<Uitkomst> {
  const supabase = createServiceSupabase();
  const { count } = await supabase
    .from("enrollment_choices")
    .select("id", { count: "exact", head: true })
    .eq("round_id", rondeId);

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      fout: `Er zijn al ${count} keuzes in deze ronde. Zet de uitvoeringen uit in plaats van de ronde te verwijderen.`,
    };
  }

  const { error } = await supabase.from("enrollment_rounds").delete().eq("id", rondeId);
  return error ? { ok: false, fout: error.message } : { ok: true, melding: "De ronde is weg." };
}


// -----------------------------------------------------------------------------
// Workshops
// -----------------------------------------------------------------------------

/**
 * Een workshop toevoegen.
 *
 * Hij komt meteen in alle rondes te draaien, want dat is bijna altijd wat je
 * wilt. Uitzetten waar hij niet doorgaat is één klik; hem overal apart
 * aanzetten zijn er vier.
 */
export async function voegWorkshopToe(params: {
  dagId: string;
  naam: string;
  maximum: number;
}): Promise<Uitkomst> {
  const supabase = createServiceSupabase();
  const naam = params.naam.trim();
  if (naam.length < 2) return { ok: false, fout: "Geef de workshop een naam." };
  if (!Number.isInteger(params.maximum) || params.maximum < 1 || params.maximum > 500) {
    return { ok: false, fout: "Het maximum moet tussen 1 en 500 liggen." };
  }

  const [{ data: bestaand }, { data: rondes }] = await Promise.all([
    supabase
      .from("enrollment_workshops")
      .select("position")
      .eq("event_id", params.dagId)
      .order("position", { ascending: false })
      .limit(1),
    supabase
      .from("enrollment_rounds")
      .select("id, position, kind")
      .eq("event_id", params.dagId)
      .neq("kind", "pauze")
      .order("position"),
  ]);

  const positie = (bestaand?.[0]?.position ?? 0) + 1;

  const { data: workshop, error } = await supabase
    .from("enrollment_workshops")
    .insert({ event_id: params.dagId, name: naam, default_capacity: params.maximum, position: positie })
    .select("id")
    .single();

  if (error || !workshop) {
    return error && (error.code === "23505" || /duplicate|unique/i.test(error.message))
      ? { ok: false, fout: "Deze workshop staat al op deze dag." }
      : { ok: false, fout: error?.message ?? "De workshop kon niet worden toegevoegd." };
  }

  if (rondes && rondes.length > 0) {
    const { error: sessieFout } = await supabase.from("enrollment_sessions").insert(
      rondes.map((ronde) => ({
        event_id: params.dagId,
        workshop_id: workshop.id,
        round_id: ronde.id,
        capacity: params.maximum,
        position: positie,
      })),
    );
    if (sessieFout) return { ok: false, fout: sessieFout.message };
  }

  return {
    ok: true,
    melding:
      rondes && rondes.length > 0
        ? `${naam} draait nu in alle ${rondes.length} rondes. Zet uit waar hij niet doorgaat.`
        : `${naam} staat erin. Voeg rondes toe om hem in te plannen.`,
  };
}

/**
 * Meerdere workshops tegelijk op de dag zetten.
 *
 * WAAROM NIET GEWOON DE ENKELE FUNCTIE IN EEN LUSJE
 *
 *   Omdat je dan bij twaalf workshops twaalf keer hetzelfde opzoekwerk doet,
 *   en omdat een half gelukte poging vervelender is dan een hele. Hier wordt
 *   één keer gekeken wat er al staat, en wat er al staat wordt stil
 *   overgeslagen in plaats van als fout gemeld: twee keer dezelfde workshop
 *   op één dag kan niet, maar het is ook geen ramp dat je hem aanvinkte.
 *
 *   In een pauze komt geen uitvoering.
 */
export async function voegWorkshopsToe(params: {
  dagId: string;
  namen: string[];
  maximum: number;
}): Promise<Uitkomst> {
  const supabase = createServiceSupabase();

  const gevraagd = params.namen.map((naam) => naam.trim()).filter((naam) => naam.length >= 2);
  if (gevraagd.length === 0) return { ok: false, fout: "Kies eerst een of meer workshops." };
  if (!Number.isInteger(params.maximum) || params.maximum < 1 || params.maximum > 500) {
    return { ok: false, fout: "Het maximum moet tussen 1 en 500 liggen." };
  }

  const [{ data: bestaande }, { data: rondes }] = await Promise.all([
    supabase.from("enrollment_workshops").select("name, position").eq("event_id", params.dagId),
    supabase
      .from("enrollment_rounds")
      .select("id")
      .eq("event_id", params.dagId)
      .neq("kind", "pauze")
      .order("position"),
  ]);

  const namenErAl = (bestaande ?? []).map((workshop) => workshop.name);
  let positie = Math.max(0, ...(bestaande ?? []).map((workshop) => workshop.position));

  const nieuw: { event_id: string; name: string; default_capacity: number; position: number }[] = [];
  const overgeslagen: string[] = [];

  for (const naam of gevraagd) {
    if (staatErAl(naam, [...namenErAl, ...nieuw.map((workshop) => workshop.name)])) {
      overgeslagen.push(naam);
      continue;
    }
    positie += 1;
    nieuw.push({ event_id: params.dagId, name: naam, default_capacity: params.maximum, position: positie });
  }

  if (nieuw.length === 0) {
    return { ok: false, fout: "Deze workshops staan al op deze dag." };
  }

  const { data: gemaakt, error } = await supabase
    .from("enrollment_workshops")
    .insert(nieuw)
    .select("id, position, default_capacity");

  if (error || !gemaakt) {
    return { ok: false, fout: error?.message ?? "De workshops konden niet worden toegevoegd." };
  }

  if (rondes && rondes.length > 0) {
    const uitvoeringen = gemaakt.flatMap((workshop) =>
      rondes.map((ronde) => ({
        event_id: params.dagId,
        workshop_id: workshop.id,
        round_id: ronde.id,
        capacity: workshop.default_capacity,
        position: workshop.position,
      })),
    );
    const { error: sessieFout } = await supabase.from("enrollment_sessions").insert(uitvoeringen);
    if (sessieFout) return { ok: false, fout: sessieFout.message };
  }

  const delen = [`${gemaakt.length} ${gemaakt.length === 1 ? "workshop" : "workshops"} toegevoegd`];
  if (rondes && rondes.length > 0) {
    delen.push(`in alle ${rondes.length} ${rondes.length === 1 ? "ronde" : "rondes"} aangezet`);
  } else {
    delen.push("voeg nog rondes toe om ze in te plannen");
  }
  if (overgeslagen.length > 0) delen.push(`${overgeslagen.join(", ")} stond${overgeslagen.length === 1 ? "" : "en"} er al`);

  return { ok: true, melding: `${delen.join(", ")}.` };
}

export async function bewaarWorkshop(params: {
  workshopId: string;
  naam: string;
  standaardMaximum: number;
}): Promise<Uitkomst> {
  const supabase = createServiceSupabase();
  if (params.naam.trim().length < 2) return { ok: false, fout: "Geef de workshop een naam." };
  if (!Number.isInteger(params.standaardMaximum) || params.standaardMaximum < 1 || params.standaardMaximum > 500) {
    return { ok: false, fout: "Het maximum moet tussen 1 en 500 liggen." };
  }

  const { error } = await supabase
    .from("enrollment_workshops")
    .update({ name: params.naam.trim(), default_capacity: params.standaardMaximum })
    .eq("id", params.workshopId);

  return error ? { ok: false, fout: error.message } : { ok: true, melding: "De workshop is bijgewerkt." };
}

export async function verwijderWorkshop(workshopId: string): Promise<Uitkomst> {
  const supabase = createServiceSupabase();

  const { data: sessies } = await supabase.from("enrollment_sessions").select("id").eq("workshop_id", workshopId);
  const ids = (sessies ?? []).map((sessie) => sessie.id);

  if (ids.length > 0) {
    const { count } = await supabase
      .from("enrollment_choices")
      .select("id", { count: "exact", head: true })
      .in("session_id", ids);
    if ((count ?? 0) > 0) {
      return { ok: false, fout: `Er zitten al ${count} deelnemers in deze workshop.` };
    }
  }

  const { error } = await supabase.from("enrollment_workshops").delete().eq("id", workshopId);
  return error ? { ok: false, fout: error.message } : { ok: true, melding: "De workshop is weg." };
}


// -----------------------------------------------------------------------------
// Uitvoeringen: een workshop in een ronde
// -----------------------------------------------------------------------------

async function bezetVanSessie(sessieId: string): Promise<number> {
  const supabase = createServiceSupabase();
  const { count } = await supabase
    .from("enrollment_choices")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessieId);
  return count ?? 0;
}

export async function bewaarUitvoering(params: {
  sessieId: string;
  maximum: number;
  ruimte: string | null;
  docent: string | null;
  label: string | null;
}): Promise<Uitkomst> {
  const supabase = createServiceSupabase();
  if (!Number.isInteger(params.maximum) || params.maximum < 1 || params.maximum > 500) {
    return { ok: false, fout: "Het maximum moet tussen 1 en 500 liggen." };
  }

  const bezet = await bezetVanSessie(params.sessieId);
  if (params.maximum < bezet) {
    return { ok: false, fout: `Er zitten al ${bezet} deelnemers in deze uitvoering.` };
  }

  const { error } = await supabase
    .from("enrollment_sessions")
    .update({
      capacity: params.maximum,
      room: params.ruimte?.trim() || null,
      teacher: params.docent?.trim() || null,
      label: params.label?.trim() || null,
    })
    .eq("id", params.sessieId);

  return error ? { ok: false, fout: error.message } : { ok: true };
}

/**
 * Een uitvoering aan- of uitzetten.
 *
 * Uitzetten terwijl er al leerlingen in zitten wordt tegengehouden, tenzij je
 * bevestigt. Ook dan blijven die leerlingen staan: niemand wordt verplaatst of
 * verwijderd. Je ziet ze gewoon terug op de deelnemerslijst van die
 * uitvoering, en bepaalt zelf wat je ermee doet.
 */
export async function zetUitvoering(params: {
  sessieId: string;
  actief: boolean;
  bevestigd?: boolean;
}): Promise<Uitkomst> {
  const supabase = createServiceSupabase();

  if (!params.actief && !params.bevestigd) {
    const bezet = await bezetVanSessie(params.sessieId);
    if (bezet > 0) {
      return {
        ok: false,
        bevestig: true,
        fout: `Er ${bezet === 1 ? "zit al 1 deelnemer" : `zitten al ${bezet} deelnemers`} in deze uitvoering. Uitzetten laat ${
          bezet === 1 ? "hem of haar" : "ze"
        } staan, maar niemand kan er nog bij komen.`,
      };
    }
  }

  const { error } = await supabase
    .from("enrollment_sessions")
    .update({ is_active: params.actief })
    .eq("id", params.sessieId);

  return error
    ? { ok: false, fout: error.message }
    : { ok: true, melding: params.actief ? "Staat aan." : "Staat uit." };
}

/** Een tweede uitvoering van dezelfde workshop in dezelfde ronde. */
export async function voegUitvoeringToe(params: {
  workshopId: string;
  rondeId: string;
  label: string;
  maximum: number;
  ruimte: string | null;
  docent: string | null;
}): Promise<Uitkomst> {
  const supabase = createServiceSupabase();

  if (params.label.trim().length === 0) {
    return { ok: false, fout: "Geef deze tweede uitvoering een naam, bijvoorbeeld Groep B." };
  }
  if (!Number.isInteger(params.maximum) || params.maximum < 1 || params.maximum > 500) {
    return { ok: false, fout: "Het maximum moet tussen 1 en 500 liggen." };
  }

  const { data: workshop } = await supabase
    .from("enrollment_workshops")
    .select("event_id")
    .eq("id", params.workshopId)
    .maybeSingle();
  if (!workshop) return { ok: false, fout: "Deze workshop bestaat niet meer." };

  const { error } = await supabase.from("enrollment_sessions").insert({
    event_id: workshop.event_id,
    workshop_id: params.workshopId,
    round_id: params.rondeId,
    label: params.label.trim(),
    capacity: params.maximum,
    room: params.ruimte?.trim() || null,
    teacher: params.docent?.trim() || null,
    position: 2,
  });

  if (error) {
    return error.code === "23505" || /duplicate|unique/i.test(error.message)
      ? { ok: false, fout: "Er is al een uitvoering met deze naam in deze ronde." }
      : { ok: false, fout: error.message };
  }

  return { ok: true, melding: "De tweede uitvoering staat erin." };
}

export async function verwijderUitvoering(sessieId: string): Promise<Uitkomst> {
  const supabase = createServiceSupabase();
  const bezet = await bezetVanSessie(sessieId);
  if (bezet > 0) {
    return { ok: false, fout: `Er ${bezet === 1 ? "zit" : "zitten"} al ${bezet} in. Zet hem uit in plaats van weg.` };
  }

  const { error } = await supabase.from("enrollment_sessions").delete().eq("id", sessieId);
  return error ? { ok: false, fout: error.message } : { ok: true, melding: "De uitvoering is weg." };
}

/**
 * Instellen welke klassen in een uitvoering mogen.
 *
 * Een lege lijst betekent: alle klassen. Zou de beperking leerlingen buiten
 * sluiten die er al in zitten, dan gaat het niet door zonder bevestiging, en
 * krijg je eerst hun namen te zien.
 */
export async function zetKlassen(params: {
  sessieId: string;
  groepIds: string[];
  bevestigd?: boolean;
}): Promise<Uitkomst> {
  const supabase = createServiceSupabase();

  const { data: sessie } = await supabase
    .from("enrollment_sessions")
    .select("id, event_id")
    .eq("id", params.sessieId)
    .maybeSingle();
  if (!sessie) return { ok: false, fout: "Deze uitvoering bestaat niet meer." };

  if (params.groepIds.length > 0 && !params.bevestigd) {
    const { data: keuzes } = await supabase
      .from("enrollment_choices")
      .select("enrollment_participants ( display_name, group_id )")
      .eq("session_id", params.sessieId);

    const deelnemers = ((keuzes ?? []) as unknown as {
      enrollment_participants: { display_name: string; group_id: string } | null;
    }[])
      .map((rij) => rij.enrollment_participants)
      .filter((rij): rij is { display_name: string; group_id: string } => rij !== null)
      .map((rij) => ({ naam: rij.display_name, groepId: rij.group_id }));

    const geraakt = geraaktDoorKlasbeperking(deelnemers, params.groepIds);
    if (geraakt.length > 0) {
      const namen = geraakt.slice(0, 5).join(", ");
      const rest = geraakt.length > 5 ? ` en nog ${geraakt.length - 5}` : "";
      return {
        ok: false,
        bevestig: true,
        fout: `${namen}${rest} ${geraakt.length === 1 ? "zit" : "zitten"} hier al in en ${
          geraakt.length === 1 ? "hoort" : "horen"
        } niet bij de klassen die je aanvinkt. Ze blijven staan waar ze staan; er kan alleen niemand meer bij uit die klassen.`,
      };
    }
  }

  const { error: wegFout } = await supabase
    .from("enrollment_session_groups")
    .delete()
    .eq("session_id", params.sessieId);
  if (wegFout) return { ok: false, fout: wegFout.message };

  if (params.groepIds.length > 0) {
    const { error } = await supabase.from("enrollment_session_groups").insert(
      params.groepIds.map((groepId) => ({
        session_id: params.sessieId,
        group_id: groepId,
        event_id: sessie.event_id,
      })),
    );
    if (error) return { ok: false, fout: error.message };
  }

  return {
    ok: true,
    melding: params.groepIds.length === 0 ? "Open voor alle klassen." : `Beperkt tot ${params.groepIds.length} klassen.`,
  };
}

/**
 * Een hele ronde kopiëren naar een andere ronde.
 *
 * Scheelt werk bij een dag met vier rondes die grotendeels hetzelfde zijn. Wat
 * er al in de doelronde zit wordt bijgewerkt, wat ontbreekt wordt aangemaakt.
 * Een maximum dat lager zou uitkomen dan het aantal leerlingen dat er al in
 * zit, wordt overgeslagen en gemeld.
 */
export async function kopieerRonde(params: { vanRondeId: string; naarRondeId: string }): Promise<Uitkomst> {
  const supabase = createServiceSupabase();

  if (params.vanRondeId === params.naarRondeId) {
    return { ok: false, fout: "Kies twee verschillende rondes." };
  }

  // In een pauze draait niets, dus daar valt niets heen te kopiëren.
  const { data: betrokken } = await supabase
    .from("enrollment_rounds")
    .select("id, label, kind")
    .in("id", [params.vanRondeId, params.naarRondeId]);

  const pauze = (betrokken ?? []).find((ronde) => ronde.kind === "pauze");
  if (pauze) {
    return { ok: false, fout: `${pauze.label} is een pauze. Daar draait geen workshop in.` };
  }

  const [{ data: bron }, { data: doel }] = await Promise.all([
    supabase.from("enrollment_sessions").select("*").eq("round_id", params.vanRondeId),
    supabase.from("enrollment_sessions").select("*").eq("round_id", params.naarRondeId),
  ]);

  const bronRijen = (bron ?? []) as unknown as EnrollmentSessionRow[];
  const doelRijen = (doel ?? []) as unknown as EnrollmentSessionRow[];
  if (bronRijen.length === 0) return { ok: false, fout: "In die ronde staat nog niets om te kopiëren." };

  const sleutel = (rij: EnrollmentSessionRow) => `${rij.workshop_id}::${(rij.label ?? "").trim().toLowerCase()}`;
  const bestaand = new Map(doelRijen.map((rij) => [sleutel(rij), rij]));

  const klassenPerBron = new Map<string, string[]>();
  const { data: klasRijen } = await supabase
    .from("enrollment_session_groups")
    .select("session_id, group_id")
    .in(
      "session_id",
      bronRijen.map((rij) => rij.id),
    );
  for (const rij of klasRijen ?? []) {
    const lijst = klassenPerBron.get(rij.session_id);
    if (lijst) lijst.push(rij.group_id);
    else klassenPerBron.set(rij.session_id, [rij.group_id]);
  }

  let bijgewerkt = 0;
  let aangemaakt = 0;
  const overgeslagen: string[] = [];

  for (const bronRij of bronRijen) {
    const doelRij = bestaand.get(sleutel(bronRij));

    if (doelRij) {
      const bezet = await bezetVanSessie(doelRij.id);
      if (bronRij.capacity < bezet) {
        overgeslagen.push(`${bronRij.label ?? "uitvoering"} (${bezet} al bezet)`);
        continue;
      }
      await supabase
        .from("enrollment_sessions")
        .update({
          capacity: bronRij.capacity,
          room: bronRij.room,
          teacher: bronRij.teacher,
          is_active: bronRij.is_active,
        })
        .eq("id", doelRij.id);
      await supabase.from("enrollment_session_groups").delete().eq("session_id", doelRij.id);
      const klassen = klassenPerBron.get(bronRij.id) ?? [];
      if (klassen.length > 0) {
        await supabase.from("enrollment_session_groups").insert(
          klassen.map((groepId) => ({ session_id: doelRij.id, group_id: groepId, event_id: bronRij.event_id })),
        );
      }
      bijgewerkt += 1;
      continue;
    }

    const { data: nieuw } = await supabase
      .from("enrollment_sessions")
      .insert({
        event_id: bronRij.event_id,
        workshop_id: bronRij.workshop_id,
        round_id: params.naarRondeId,
        label: bronRij.label,
        capacity: bronRij.capacity,
        room: bronRij.room,
        teacher: bronRij.teacher,
        is_active: bronRij.is_active,
        position: bronRij.position,
      })
      .select("id")
      .single();

    if (nieuw) {
      const klassen = klassenPerBron.get(bronRij.id) ?? [];
      if (klassen.length > 0) {
        await supabase.from("enrollment_session_groups").insert(
          klassen.map((groepId) => ({ session_id: nieuw.id, group_id: groepId, event_id: bronRij.event_id })),
        );
      }
      aangemaakt += 1;
    }
  }

  const delen = [`${bijgewerkt} bijgewerkt`, `${aangemaakt} aangemaakt`];
  if (overgeslagen.length > 0) delen.push(`overgeslagen: ${overgeslagen.join(", ")}`);
  return { ok: true, melding: `${delen.join(", ")}.` };
}


// -----------------------------------------------------------------------------
// Klassen en teams
// -----------------------------------------------------------------------------

/**
 * Klassen of teams toevoegen.
 *
 * In één veld, elke regel een naam, want een school levert dat zo aan: Groep
 * 1/2a, Groep 3/4, Groep 5. Namen die er al staan worden overgeslagen in
 * plaats van geweigerd, zodat je de lijst gewoon nog een keer kunt plakken.
 */
export async function voegGroepenToe(params: {
  dagId: string;
  namen: string;
}): Promise<{ ok: true; toegevoegd: number; overgeslagen: number } | { ok: false; fout: string }> {
  const supabase = createServiceSupabase();

  const gevraagd = params.namen
    .split(/[\r\n,;]+/)
    .map((naam) => naam.trim())
    .filter((naam) => naam.length > 0 && naam.length <= 60);

  if (gevraagd.length === 0) return { ok: false, fout: "Vul minstens één naam in." };

  const { data: bestaand } = await supabase
    .from("enrollment_groups")
    .select("name, position")
    .eq("event_id", params.dagId);

  const bekend = new Set((bestaand ?? []).map((groep) => groep.name.trim().toLowerCase()));
  let positie = Math.max(0, ...(bestaand ?? []).map((groep) => groep.position));

  const nieuw: { event_id: string; name: string; position: number }[] = [];
  let overgeslagen = 0;
  for (const naam of gevraagd) {
    const sleutel = naam.toLowerCase();
    if (bekend.has(sleutel)) {
      overgeslagen += 1;
      continue;
    }
    bekend.add(sleutel);
    positie += 1;
    nieuw.push({ event_id: params.dagId, name: naam, position: positie });
  }

  if (nieuw.length > 0) {
    const { error } = await supabase.from("enrollment_groups").insert(nieuw);
    if (error) return { ok: false, fout: error.message };
  }

  return { ok: true, toegevoegd: nieuw.length, overgeslagen };
}

export async function verwijderGroep(groepId: string): Promise<Uitkomst> {
  const supabase = createServiceSupabase();
  const { count } = await supabase
    .from("enrollment_participants")
    .select("id", { count: "exact", head: true })
    .eq("group_id", groepId);

  if ((count ?? 0) > 0) {
    return { ok: false, fout: `Er staan nog ${count} deelnemers in deze groep.` };
  }

  const { error } = await supabase.from("enrollment_groups").delete().eq("id", groepId);
  return error ? { ok: false, fout: error.message } : { ok: true, melding: "Weg." };
}


// -----------------------------------------------------------------------------
// Voorbereiding: apps en benodigdheden
// -----------------------------------------------------------------------------

/**
 * Wat een deelnemer vooraf moet regelen voor deze workshop.
 *
 * De links moeten naar de officiele winkels wijzen. Dat wordt hier
 * gecontroleerd en nog eens in de database, want deze tekst gaat straks in
 * een mail naar honderden leerlingen. Een verkeerde link is daar niet terug
 * te halen.
 */
export async function bewaarAppInfo(params: {
  workshopId: string;
  appNodig: boolean;
  appNaam: string | null;
  android: string | null;
  ios: string | null;
  web: string | null;
  uitleg: string | null;
  spullen: string | null;
}): Promise<Uitkomst> {
  const supabase = createServiceSupabase();

  const naam = params.appNaam?.trim() || null;
  if (params.appNodig && !naam) {
    return { ok: false, fout: "Vul de naam van de app in, anders weet een leerling niet wat hij moet installeren." };
  }

  const android = params.android?.trim() || null;
  const ios = params.ios?.trim() || null;
  const web = params.web?.trim() || null;

  if (android && !/^https:\/\/play\.google\.com\//.test(android)) {
    return { ok: false, fout: "De Android-link moet beginnen met https://play.google.com/" };
  }
  if (ios && !/^https:\/\/apps\.apple\.com\//.test(ios)) {
    return { ok: false, fout: "De iPhone-link moet beginnen met https://apps.apple.com/" };
  }
  if (web && !/^https:\/\//.test(web)) {
    return { ok: false, fout: "De webversie moet een https-adres zijn." };
  }

  const { error } = await supabase
    .from("enrollment_workshops")
    .update({
      app_required: params.appNodig,
      app_name: naam,
      app_android_url: android,
      app_ios_url: ios,
      app_web_url: web,
      app_instructions: params.uitleg?.trim() || null,
      materials: params.spullen?.trim() || null,
    })
    .eq("id", params.workshopId);

  return error ? { ok: false, fout: error.message } : { ok: true };
}
