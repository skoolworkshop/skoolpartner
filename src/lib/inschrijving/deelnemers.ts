import "server-only";

import { generateToken } from "@/lib/crypto";
import { isCode, leesCode, maakCode, toonCode } from "@/lib/inschrijving/codes";
import { createServiceSupabase } from "@/lib/supabase/server";
import { leesLijst, type Probleem } from "@/lib/inschrijving/lijst";
import { maakSleutels } from "@/lib/inschrijving/naam";

/**
 * De deelnemerslijst van een inschrijfdag.
 *
 * De school levert de lijst aan, wij zetten hem erin. Twee dingen staan
 * daarbij voorop.
 *
 * NIETS DUBBEL
 *
 *   Dezelfde lijst twee keer uploaden gebeurt gewoon: iemand twijfelt of het
 *   gelukt is en doet het nog eens. Daarom wordt er per groep gekeken of de
 *   naam er al staat, met dezelfde herkenning als waarmee een leerling
 *   zichzelf straks opzoekt. Wie er al in staat, komt er niet nog een keer
 *   bij, en houdt dus ook zijn gemaakte keuzes.
 *
 * NIETS STIL WEGGOOIEN
 *
 *   Elke regel die niet is gebruikt komt terug met de reden en het
 *   regelnummer. Ook de regels die het bestand zelf al niet haalden.
 *
 * IEDEREEN KRIJGT EEN EIGEN CODE
 *
 *   Bij het toevoegen krijgt elke deelnemer meteen een persoonlijke
 *   inschrijfcode. Die hoort bij de naam en wordt nooit opnieuw uitgedeeld,
 *   ook niet als dezelfde lijst nog eens wordt geüpload: wie er al staat
 *   houdt zijn code, anders klopt het papier van de mentor niet meer.
 */

export interface LijstUitkomst {
  toegevoegd: number;
  bestondAl: number;
  /** Hoeveel er zijn weggehaald omdat de lijst werd vervangen. */
  verwijderd: number;
  /** Hoeveel bestaande deelnemers alsnog hun leerjaar kregen. */
  leerjaarAangevuld: number;
  nieuweGroepen: string[];
  onbekendeGroepen: string[];
  problemen: Probleem[];
}

const STUK = 500;

export type Vervangen = "nee" | "zonder-keuzes" | "alles";

export async function bewaarLijst(params: {
  dagId: string;
  tekst: string;
  maakGroepen: boolean;
  standaardGroep?: string | null;
  /**
   * Wat te doen met wie er al staat.
   *
   *   nee             alleen aanvullen, dat is de normale gang van zaken
   *   zonder-keuzes   eerst weghalen wie nog niets gekozen heeft
   *   alles           alles weghalen, ook gemaakte keuzes
   *
   * De tweede is bedoeld voor een verkeerde import rechtzetten: wat de
   * leerlingen zelf al hebben gekozen blijft dan staan. De derde haalt echt
   * alles weg en hoort alleen te gebeuren als iemand dat op het scherm
   * bevestigt.
   */
  vervangen?: Vervangen;
}): Promise<{ ok: true; uitkomst: LijstUitkomst } | { ok: false; fout: string }> {
  const supabase = createServiceSupabase();

  const { data: dag } = await supabase
    .from("enrollment_events")
    .select("id, status")
    .eq("id", params.dagId)
    .maybeSingle();
  if (!dag) return { ok: false, fout: "Deze inschrijfdag bestaat niet meer." };

  // De lijst wordt hier opnieuw ingelezen. Wat de browser stuurde is een
  // voorstel; wat er wordt opgeslagen bepaalt de server.
  const lezing = leesLijst(params.tekst, params.standaardGroep ?? null);
  if (lezing.regels.length === 0) {
    return {
      ok: false,
      fout:
        lezing.problemen.length > 0
          ? "Geen enkele regel was bruikbaar. Kijk of de kolommen kloppen."
          : "De lijst is leeg.",
    };
  }

  const { data: groepRijen } = await supabase
    .from("enrollment_groups")
    .select("id, name, position")
    .eq("event_id", params.dagId);

  const groepen = new Map<string, string>();
  for (const groep of groepRijen ?? []) groepen.set(groep.name.trim().toLowerCase(), groep.id);

  const problemen = [...lezing.problemen];
  const nieuweGroepen: string[] = [];
  const onbekendeGroepen: string[] = [];

  const gevraagd = new Map<string, string>();
  for (const regel of lezing.regels) {
    const naam = (regel.groep ?? "").trim();
    if (naam && !groepen.has(naam.toLowerCase())) gevraagd.set(naam.toLowerCase(), naam);
  }

  if (gevraagd.size > 0) {
    if (params.maakGroepen) {
      let positie = Math.max(0, ...(groepRijen ?? []).map((groep) => groep.position));
      const nieuw = [...gevraagd.values()].map((naam) => ({
        event_id: params.dagId,
        name: naam,
        position: (positie += 1),
      }));
      const { data: gemaakt, error } = await supabase.from("enrollment_groups").insert(nieuw).select("id, name");
      if (error) return { ok: false, fout: error.message };
      for (const groep of gemaakt ?? []) {
        groepen.set(groep.name.trim().toLowerCase(), groep.id);
        nieuweGroepen.push(groep.name);
      }
    } else {
      onbekendeGroepen.push(...gevraagd.values());
    }
  }

  /*
    Eerst opruimen, als dat gevraagd is.

    Dit staat bewust vóór het inlezen van wie er al staat, zodat een
    vervangen lijst daarna gewoon als nieuw wordt toegevoegd en er geen
    dubbelen kunnen ontstaan.
  */
  let verwijderd = 0;
  if (params.vervangen === "zonder-keuzes" || params.vervangen === "alles") {
    const { data: huidige } = await supabase
      .from("enrollment_participants")
      .select("id, enrollment_choices ( id )")
      .eq("event_id", params.dagId);

    const rijen = (huidige ?? []) as unknown as { id: string; enrollment_choices: { id: string }[] | null }[];
    const weg =
      params.vervangen === "alles"
        ? rijen.map((rij) => rij.id)
        : rijen.filter((rij) => (rij.enrollment_choices?.length ?? 0) === 0).map((rij) => rij.id);

    for (let i = 0; i < weg.length; i += STUK) {
      const { error } = await supabase
        .from("enrollment_participants")
        .delete()
        .in("id", weg.slice(i, i + STUK));
      if (error) return { ok: false, fout: error.message };
    }
    verwijderd = weg.length;
  }

  // Wie er al staat, blijft staan. Vergelijken gebeurt op dezelfde sleutel als
  // waarmee een deelnemer zichzelf straks opzoekt.
  const { data: bestaande } = await supabase
    .from("enrollment_participants")
    .select("id, group_id, search_key, access_code, year_level")
    .eq("event_id", params.dagId);

  const bekend = new Map(
    (bestaande ?? []).map((rij) => [
      `${rij.group_id}::${rij.search_key}`,
      { id: rij.id as string, leerjaar: (rij.year_level ?? null) as string | null },
    ]),
  );

  // Een code mag binnen een dag maar één keer voorkomen, want daarop wordt
  // straks opgezocht. De database bewaakt dat ook, maar een botsing hier
  // afvangen is prettiger dan een mislukte upload.
  const gebruikteCodes = new Set((bestaande ?? []).map((rij) => rij.access_code as string));

  function nieuweCode(): string {
    for (let poging = 0; poging < 50; poging += 1) {
      const code = maakCode();
      if (!gebruikteCodes.has(code)) {
        gebruikteCodes.add(code);
        return code;
      }
    }
    // Zo goed als onmogelijk met duizend miljard mogelijkheden, maar dan
    // liever een langere code dan een mislukking.
    const lang = maakCode(12);
    gebruikteCodes.add(lang);
    return lang;
  }

  const nieuweDeelnemers: {
    event_id: string;
    group_id: string;
    display_name: string;
    search_key: string;
    flat_key: string;
    email: string | null;
    claim_token: string;
    access_code: string;
    year_level: string | null;
  }[] = [];
  let bestondAl = 0;
  // Wie er al stond zonder leerjaar, krijgt het alsnog als het nu meekomt.
  const leerjaarBij: { id: string; year_level: string }[] = [];

  for (const regel of lezing.regels) {
    const groepNaam = (regel.groep ?? "").trim().toLowerCase();
    const groepId = groepen.get(groepNaam);
    if (!groepId) {
      problemen.push({
        regel: regel.regel,
        tekst: `${regel.naam} (${regel.groep ?? ""})`,
        reden: "deze klas of groep staat nog niet bij deze dag",
      });
      continue;
    }

    const sleutels = maakSleutels(regel.naam);
    const sleutel = `${groepId}::${sleutels.sleutel}`;
    const alBekend = bekend.get(sleutel);
    if (alBekend) {
      bestondAl += 1;
      if (regel.leerjaar && !alBekend.leerjaar) {
        leerjaarBij.push({ id: alBekend.id, year_level: regel.leerjaar });
        alBekend.leerjaar = regel.leerjaar;
      }
      continue;
    }
    bekend.set(sleutel, { id: "nieuw", leerjaar: regel.leerjaar });

    nieuweDeelnemers.push({
      event_id: params.dagId,
      group_id: groepId,
      display_name: regel.naam,
      search_key: sleutels.sleutel,
      flat_key: sleutels.platteSleutel,
      email: regel.email,
      // Het bewijs dat straks aantoont dat de deelnemer zelf kiest. Wordt
      // nooit getoond in een lijst, een mail of een export.
      claim_token: generateToken(24),
      // De code die de leerling zelf intypt. Die staat wél op het papier van
      // de mentor, en alleen daar.
      access_code: nieuweCode(),
      // Het leerjaar is een eigen kenmerk en nooit de klas.
      year_level: regel.leerjaar,
    });
  }

  for (let i = 0; i < nieuweDeelnemers.length; i += STUK) {
    const { error } = await supabase.from("enrollment_participants").insert(nieuweDeelnemers.slice(i, i + STUK));
    if (error) return { ok: false, fout: error.message };
  }

  for (const regel of leerjaarBij) {
    const { error } = await supabase
      .from("enrollment_participants")
      .update({ year_level: regel.year_level })
      .eq("id", regel.id);
    if (error) return { ok: false, fout: error.message };
  }

  return {
    ok: true,
    uitkomst: {
      toegevoegd: nieuweDeelnemers.length,
      bestondAl,
      verwijderd,
      leerjaarAangevuld: leerjaarBij.length,
      nieuweGroepen,
      onbekendeGroepen,
      problemen,
    },
  };
}

/**
 * Deelnemers zoeken in de beheeromgeving.
 *
 * Op naam of op code. Hooguit vijfentwintig regels terug, want dit is bedoeld
 * om één iemand op te zoeken en niet om de hele lijst uit te lezen.
 */
export async function zoekDeelnemers(dagId: string, term: string): Promise<DeelnemerRegel[]> {
  const schoon = term.trim();
  if (schoon.length < 2) return [];

  const supabase = createServiceSupabase();
  const code = leesCode(schoon);

  const velden =
    "id, display_name, email, group_id, exempt, access_code, enrollment_groups ( name ), enrollment_choices ( id )";

  // Ziet het eruit als een code, dan eerst daarop. Dat is de vraag die Anne
  // aan de telefoon heeft: "van wie is deze code?"
  if (isCode(code)) {
    const { data } = await supabase
      .from("enrollment_participants")
      .select(velden)
      .eq("event_id", dagId)
      .eq("access_code", code)
      .limit(1);
    const gevonden = naarRegels(data);
    if (gevonden.length > 0) return gevonden;
  }

  const { data } = await supabase
    .from("enrollment_participants")
    .select(velden)
    .eq("event_id", dagId)
    // Het procentteken en de underscore zijn jokers in ilike. Wie die intypt
    // krijgt ze als gewoon teken terug.
    .ilike("display_name", `%${schoon.replace(/[%_]/g, "\\$&")}%`)
    .order("display_name")
    .limit(25);

  return naarRegels(data);
}

export interface DeelnemerRegel {
  id: string;
  naam: string;
  groepId: string;
  groepNaam: string;
  email: string | null;
  gekozen: number;
  /** De eigen code, leesbaar met streepje. Zodat je hem kunt voorlezen. */
  code: string;
  vrijgesteld: boolean;
}

function naarRegels(data: unknown): DeelnemerRegel[] {
  const rijen = (data ?? []) as {
    id: string;
    display_name: string;
    email: string | null;
    group_id: string;
    exempt?: boolean;
    access_code: string;
    enrollment_groups: { name: string } | null;
    enrollment_choices: { id: string }[] | null;
  }[];

  return rijen.map((rij) => ({
    id: rij.id,
    naam: rij.display_name,
    groepId: rij.group_id,
    groepNaam: rij.enrollment_groups?.name ?? "",
    email: rij.email,
    gekozen: rij.enrollment_choices?.length ?? 0,
    code: toonCode(rij.access_code),
    vrijgesteld: rij.exempt ?? false,
  }));
}

export async function getDeelnemers(dagId: string, groepId?: string): Promise<DeelnemerRegel[]> {
  const supabase = createServiceSupabase();

  let vraag = supabase
    .from("enrollment_participants")
    .select(
      "id, display_name, email, group_id, exempt, access_code, enrollment_groups ( name ), enrollment_choices ( id )",
    )
    .eq("event_id", dagId)
    .order("display_name")
    .limit(2000);

  if (groepId) vraag = vraag.eq("group_id", groepId);

  const { data } = await vraag;
  return naarRegels(data);
}

/**
 * Een deelnemer weghalen.
 *
 * De keuzes gaan mee, want die horen bij deze persoon. Daarom alleen als er
 * nog niets gekozen is, of als er bewust wordt doorgezet.
 */
export async function verwijderDeelnemer(id: string, ookMetKeuzes = false): Promise<{ ok: true } | { ok: false; fout: string }> {
  const supabase = createServiceSupabase();

  if (!ookMetKeuzes) {
    const { count } = await supabase
      .from("enrollment_choices")
      .select("id", { count: "exact", head: true })
      .eq("participant_id", id);
    if ((count ?? 0) > 0) {
      return { ok: false, fout: "Deze deelnemer heeft al workshops gekozen." };
    }
  }

  const { error } = await supabase.from("enrollment_participants").delete().eq("id", id);
  return error ? { ok: false, fout: error.message } : { ok: true };
}

/**
 * Iemand vrijstellen, of die vrijstelling weer intrekken.
 *
 * Vrijgesteld betekent: doet niet mee. Die deelnemer wordt niet ingedeeld,
 * telt niet mee in de controles, en kan zelf niets meer kiezen. Staat er al
 * iets gekozen, dan vraagt dit eerst om bevestiging: die plekken komen vrij
 * en dat is niet zomaar terug te draaien.
 */
export async function zetVrijstelling(params: {
  id: string;
  vrijgesteld: boolean;
  bevestigd?: boolean;
}): Promise<{ ok: true; melding: string } | { ok: false; fout: string; bevestig?: boolean }> {
  const supabase = createServiceSupabase();

  if (params.vrijgesteld && !params.bevestigd) {
    const { count } = await supabase
      .from("enrollment_choices")
      .select("id", { count: "exact", head: true })
      .eq("participant_id", params.id);

    if ((count ?? 0) > 0) {
      return {
        ok: false,
        bevestig: true,
        fout: `Deze deelnemer heeft al ${count === 1 ? "één workshop" : `${count} workshops`} gekozen. Vrijstellen haalt die keuzes weg en maakt de plekken weer vrij.`,
      };
    }
  }

  if (params.vrijgesteld) {
    const { error: keuzeFout } = await supabase.from("enrollment_choices").delete().eq("participant_id", params.id);
    if (keuzeFout) return { ok: false, fout: keuzeFout.message };
  }

  const { error } = await supabase
    .from("enrollment_participants")
    .update({ exempt: params.vrijgesteld })
    .eq("id", params.id);

  if (error) return { ok: false, fout: error.message };
  return { ok: true, melding: params.vrijgesteld ? "Staat op vrijgesteld." : "Doet weer mee." };
}

/**
 * Een nieuwe code voor iemand die de zijne kwijt is.
 *
 * De oude code werkt daarna niet meer. Dat is precies de bedoeling: een code
 * die ergens rondzwerft, trek je zo in. De gemaakte keuzes blijven staan.
 */
export async function nieuweCodeVoor(
  id: string,
): Promise<{ ok: true; code: string; naam: string } | { ok: false; fout: string }> {
  const supabase = createServiceSupabase();

  const { data: deelnemer } = await supabase
    .from("enrollment_participants")
    .select("id, event_id, display_name")
    .eq("id", id)
    .maybeSingle();
  if (!deelnemer) return { ok: false, fout: "Deze deelnemer bestaat niet meer." };

  const { data: bestaande } = await supabase
    .from("enrollment_participants")
    .select("access_code")
    .eq("event_id", deelnemer.event_id);
  const gebruikt = new Set((bestaande ?? []).map((rij) => rij.access_code as string));

  let code = maakCode();
  for (let poging = 0; poging < 50 && gebruikt.has(code); poging += 1) code = maakCode();

  const { error } = await supabase
    .from("enrollment_participants")
    .update({ access_code: code })
    .eq("id", id);

  if (error) return { ok: false, fout: error.message };
  return { ok: true, code: toonCode(code), naam: deelnemer.display_name };
}
