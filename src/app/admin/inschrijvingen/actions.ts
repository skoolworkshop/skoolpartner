"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth/session";
import {
  bewaarLijst,
  nieuweCodeVoor,
  type Vervangen,
  verwijderDeelnemer,
  zetVrijstelling,
  zoekDeelnemers,
  type DeelnemerRegel,
} from "@/lib/inschrijving/deelnemers";
import {
  getIndelingVoorstel,
  KLANT_SOORTEN,
  maakMailVoorbeeld,
  maakToegang,
  trekToegangIn,
  verstuurLijsten,
  voerIndelingUit,
  type MailVoorbeeld,
  type Soort,
} from "@/lib/inschrijving/afronden";
import { verstuurBevestigingen } from "@/lib/inschrijving/bevestigingen";
import type { IndelingVoorstel } from "@/lib/inschrijving/indeling";
import {
  bewaarAppInfo,
  bewaarDag,
  bewaarRonde,
  bewaarUitvoering,
  bewaarWorkshop,
  genereerRondes,
  kopieerRonde,
  maakDag,
  nieuweLink,
  verwijderGroep,
  verwijderRonde,
  verwijderUitvoering,
  verwijderWorkshop,
  voegGroepenToe,
  voegRondeToe,
  voegUitvoeringToe,
  voegWorkshopToe,
  voegWorkshopsToe,
  zetKlassen,
  zetStatus,
  zetUitvoering,
  type Uitkomst,
} from "@/lib/inschrijving/dagen";
import { STANDAARD_MAXIMUM } from "@/lib/inschrijving/catalogus";
import { maakRooster } from "@/lib/inschrijving/rondes";
import type { EnrollmentAudience, EnrollmentStatus } from "@/lib/types/database";
import type { AdminState } from "@/app/admin/actions";

/**
 * De serveracties van het inschrijfbeheer.
 *
 * Elke actie controleert zelf opnieuw of er een beheerder aan de andere kant
 * zit. Een serveractie is namelijk gewoon een POST die iemand ook buiten het
 * scherm om kan aanroepen; de knop die je niet ziet is geen beveiliging.
 */

function tekst(formData: FormData, veld: string): string {
  return String(formData.get(veld) ?? "").trim();
}

function getal(formData: FormData, veld: string, standaard: number): number {
  const waarde = Number.parseInt(String(formData.get(veld) ?? ""), 10);
  return Number.isFinite(waarde) ? waarde : standaard;
}

function bevestigd(formData: FormData): boolean {
  return formData.get("bevestigd") === "ja";
}

function verversDag(dagId: string) {
  revalidatePath("/admin/inschrijvingen");
  revalidatePath(`/admin/inschrijvingen/${dagId}`);
}

/** Een uitkomst uit de bibliotheek omzetten naar wat het scherm toont. */
function antwoord(uitkomst: Uitkomst, dagId: string, standaardMelding = "Opgeslagen."): AdminState {
  if (!uitkomst.ok) {
    return { status: "error", message: uitkomst.fout, bevestig: uitkomst.bevestig };
  }
  verversDag(dagId);
  return { status: "ok", message: uitkomst.melding ?? standaardMelding };
}


// -----------------------------------------------------------------------------
// De dag
// -----------------------------------------------------------------------------

export async function maakDagAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const sessie = await requireAdmin();

  const audience = tekst(formData, "audience") === "organisatie" ? "organisatie" : "school";
  const uitkomst = await maakDag({
    organisatieId: tekst(formData, "organization_id"),
    naam: tekst(formData, "name"),
    datum: tekst(formData, "event_date"),
    locatie: tekst(formData, "location") || null,
    audience: audience as EnrollmentAudience,
    doorId: sessie.userId,
    doorEmail: sessie.email,
  });

  if (!uitkomst.ok) return { status: "error", message: uitkomst.fout };

  revalidatePath("/admin/inschrijvingen");
  redirect(`/admin/inschrijvingen/${uitkomst.id}`);
}

export async function bewaarDagAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const id = tekst(formData, "event_id");

  return antwoord(
    await bewaarDag({
      id,
      naam: tekst(formData, "name"),
      datum: tekst(formData, "event_date"),
      locatie: tekst(formData, "location") || null,
      opmerking: tekst(formData, "note") || null,
      sluitOp: tekst(formData, "closes_at") || null,
      herhalingToegestaan: formData.get("allow_repeat") === "ja",
      toegangswijze: tekst(formData, "access_mode") === "naam" ? "naam" : "code",
      contactNaam: tekst(formData, "contact_name") || null,
      contactEmail: tekst(formData, "contact_email") || null,
    }),
    id,
    "De gegevens zijn bijgewerkt.",
  );
}

/** Een nieuwe inschrijflink. De oude vervalt daarmee. */
export async function nieuweLinkAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const dagId = tekst(formData, "event_id");
  return antwoord(await nieuweLink({ dagId, bevestigd: bevestigd(formData) }), dagId);
}

export async function zetStatusAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const id = tekst(formData, "event_id");
  const status = tekst(formData, "status") as EnrollmentStatus;

  if (!["concept", "open", "gesloten", "afgerond"].includes(status)) {
    return { status: "error", message: "Onbekende status." };
  }

  const uitkomst = await zetStatus(id, status);
  if (!uitkomst.ok) return { status: "error", message: uitkomst.fout };

  verversDag(id);
  const melding: Record<EnrollmentStatus, string> = {
    concept: "De dag staat weer op concept. De inschrijflink werkt niet meer.",
    open: "De inschrijving staat open. De link kan naar de organisatie.",
    gesloten: "De inschrijving is gesloten. Er kan niets meer gekozen of gewijzigd worden.",
    afgerond: "De dag staat op afgerond.",
  };
  return { status: "ok", message: melding[status] };
}


// -----------------------------------------------------------------------------
// Rondes
// -----------------------------------------------------------------------------

export async function voegRondeToeAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const dagId = tekst(formData, "event_id");

  return antwoord(
    await voegRondeToe({
      dagId,
      label: tekst(formData, "label"),
      begin: tekst(formData, "starts_at"),
      eind: tekst(formData, "ends_at"),
    }),
    dagId,
    "De ronde staat erin.",
  );
}

/**
 * Het hele rooster in één keer aanmaken.
 *
 * De tijden worden hier opnieuw uitgerekend uit wat het formulier stuurt. Wat
 * de browser laat zien is dus een voorbeeld; wat er wordt opgeslagen bepaalt
 * de server.
 */
export async function genereerRondesAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const dagId = tekst(formData, "event_id");

  const rooster = maakRooster({
    aantal: getal(formData, "aantal", 0),
    start: tekst(formData, "start"),
    duurMinuten: getal(formData, "duur", 0),
    pauzeMinuten: getal(formData, "pauze", 0),
    langePauzeNa: tekst(formData, "lange_pauze_na") ? getal(formData, "lange_pauze_na", 0) : null,
    langePauzeMinuten: tekst(formData, "lange_pauze") ? getal(formData, "lange_pauze", 0) : null,
    naam: tekst(formData, "naam") || undefined,
  });

  if (rooster.fouten.length > 0) {
    return { status: "error", message: rooster.fouten.join(" ") };
  }

  return antwoord(
    await genereerRondes({
      dagId,
      regels: rooster.regels,
      vervangen: formData.get("vervangen") === "ja",
      bevestigd: bevestigd(formData),
    }),
    dagId,
  );
}

export async function bewaarRondeAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const dagId = tekst(formData, "event_id");

  return antwoord(
    await bewaarRonde({
      rondeId: tekst(formData, "round_id"),
      label: tekst(formData, "label"),
      begin: tekst(formData, "starts_at"),
      eind: tekst(formData, "ends_at"),
    }),
    dagId,
  );
}

export async function verwijderRondeAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const dagId = tekst(formData, "event_id");
  return antwoord(await verwijderRonde(tekst(formData, "round_id")), dagId);
}

export async function kopieerRondeAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const dagId = tekst(formData, "event_id");

  return antwoord(
    await kopieerRonde({
      vanRondeId: tekst(formData, "van_ronde"),
      naarRondeId: tekst(formData, "naar_ronde"),
    }),
    dagId,
  );
}


// -----------------------------------------------------------------------------
// Workshops
// -----------------------------------------------------------------------------

export async function voegWorkshopToeAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const dagId = tekst(formData, "event_id");

  return antwoord(
    await voegWorkshopToe({
      dagId,
      naam: tekst(formData, "name"),
      maximum: getal(formData, "capacity", 25),
    }),
    dagId,
  );
}

/** Meerdere workshops tegelijk uit de catalogus op de dag zetten. */
export async function voegWorkshopsToeAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const dagId = tekst(formData, "event_id");

  const namen = formData
    .getAll("naam")
    .map((waarde) => String(waarde).trim())
    .filter(Boolean);

  return antwoord(
    await voegWorkshopsToe({ dagId, namen, maximum: getal(formData, "maximum", STANDAARD_MAXIMUM) }),
    dagId,
  );
}

export async function bewaarWorkshopAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const dagId = tekst(formData, "event_id");

  return antwoord(
    await bewaarWorkshop({
      workshopId: tekst(formData, "workshop_id"),
      naam: tekst(formData, "name"),
      standaardMaximum: getal(formData, "capacity", 25),
    }),
    dagId,
  );
}

export async function verwijderWorkshopAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const dagId = tekst(formData, "event_id");
  return antwoord(await verwijderWorkshop(tekst(formData, "workshop_id")), dagId);
}


// -----------------------------------------------------------------------------
// Uitvoeringen
// -----------------------------------------------------------------------------

export async function bewaarUitvoeringAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const dagId = tekst(formData, "event_id");

  return antwoord(
    await bewaarUitvoering({
      sessieId: tekst(formData, "session_id"),
      maximum: getal(formData, "capacity", 25),
      ruimte: tekst(formData, "room") || null,
      docent: tekst(formData, "teacher") || null,
      label: tekst(formData, "label") || null,
    }),
    dagId,
  );
}

export async function zetUitvoeringAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const dagId = tekst(formData, "event_id");

  return antwoord(
    await zetUitvoering({
      sessieId: tekst(formData, "session_id"),
      actief: tekst(formData, "actief") === "ja",
      bevestigd: bevestigd(formData),
    }),
    dagId,
  );
}

export async function voegUitvoeringToeAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const dagId = tekst(formData, "event_id");

  return antwoord(
    await voegUitvoeringToe({
      workshopId: tekst(formData, "workshop_id"),
      rondeId: tekst(formData, "round_id"),
      label: tekst(formData, "label"),
      maximum: getal(formData, "capacity", 25),
      ruimte: tekst(formData, "room") || null,
      docent: tekst(formData, "teacher") || null,
    }),
    dagId,
  );
}

export async function verwijderUitvoeringAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const dagId = tekst(formData, "event_id");
  return antwoord(await verwijderUitvoering(tekst(formData, "session_id")), dagId);
}

export async function zetKlassenAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const dagId = tekst(formData, "event_id");

  const groepIds = formData
    .getAll("groep")
    .map((waarde) => String(waarde))
    .filter((waarde) => waarde.length > 0);

  return antwoord(
    await zetKlassen({
      sessieId: tekst(formData, "session_id"),
      groepIds,
      bevestigd: bevestigd(formData),
    }),
    dagId,
  );
}


// -----------------------------------------------------------------------------
// Klassen en deelnemers
// -----------------------------------------------------------------------------

export async function voegGroepenToeAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const dagId = tekst(formData, "event_id");

  const uitkomst = await voegGroepenToe({ dagId, namen: String(formData.get("names") ?? "") });
  if (!uitkomst.ok) return { status: "error", message: uitkomst.fout };

  verversDag(dagId);
  const staart = uitkomst.overgeslagen > 0 ? `, ${uitkomst.overgeslagen} stond er al` : "";
  return { status: "ok", message: `${uitkomst.toegevoegd} toegevoegd${staart}.` };
}

export async function verwijderGroepAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const dagId = tekst(formData, "event_id");
  return antwoord(await verwijderGroep(tekst(formData, "group_id")), dagId);
}

/**
 * De deelnemerslijst opslaan.
 *
 * De browser stuurt de regels zoals hij ze heeft gelezen, maar de server leest
 * ze opnieuw in en bepaalt zelf wat er wordt opgeslagen. Een serveractie is
 * een POST; wie hem rechtstreeks aanroept komt niet langs het voorbeeld op het
 * scherm, en mag daar ook niets mee opschieten.
 */
export async function bewaarLijstAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const dagId = tekst(formData, "event_id");
  const regels = String(formData.get("rows") ?? "");

  if (regels.trim().length === 0) {
    return { status: "error", message: "Kies eerst een bestand of plak de namen." };
  }

  const gevraagd = tekst(formData, "vervangen");
  const vervangen: Vervangen =
    gevraagd === "alles" || gevraagd === "zonder-keuzes" ? gevraagd : "nee";

  const antwoordLijst = await bewaarLijst({
    dagId,
    tekst: regels,
    maakGroepen: formData.get("maak_groepen") === "ja",
    vervangen,
  });

  if (!antwoordLijst.ok) return { status: "error", message: antwoordLijst.fout };

  const { toegevoegd, bestondAl, verwijderd, leerjaarAangevuld, nieuweGroepen, onbekendeGroepen, problemen } =
    antwoordLijst.uitkomst;
  const delen = [`${toegevoegd} toegevoegd`];
  if (verwijderd > 0) delen.push(`${verwijderd} vervangen`);
  if (bestondAl > 0) delen.push(`${bestondAl} stond${bestondAl === 1 ? "" : "en"} er al`);
  if (leerjaarAangevuld > 0) delen.push(`${leerjaarAangevuld} keer het leerjaar aangevuld`);
  if (nieuweGroepen.length > 0) delen.push(`nieuw aangemaakt: ${nieuweGroepen.join(", ")}`);
  if (onbekendeGroepen.length > 0) delen.push(`niet aangemaakt: ${onbekendeGroepen.join(", ")}`);
  if (problemen.length > 0) delen.push(`${problemen.length} regel${problemen.length === 1 ? "" : "s"} overgeslagen`);

  verversDag(dagId);
  return { status: "ok", message: `${delen.join(", ")}.` };
}


// -----------------------------------------------------------------------------
// App en benodigdheden
// -----------------------------------------------------------------------------

export async function bewaarAppInfoAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const dagId = tekst(formData, "event_id");

  return antwoord(
    await bewaarAppInfo({
      workshopId: tekst(formData, "workshop_id"),
      appNodig: formData.get("app_required") === "ja",
      appNaam: tekst(formData, "app_name") || null,
      android: tekst(formData, "app_android_url") || null,
      ios: tekst(formData, "app_ios_url") || null,
      web: tekst(formData, "app_web_url") || null,
      uitleg: tekst(formData, "app_instructions") || null,
      spullen: tekst(formData, "materials") || null,
    }),
    dagId,
    "De voorbereiding is bijgewerkt.",
  );
}


// -----------------------------------------------------------------------------
// Afronden: indelen, lijsten en versturen
// -----------------------------------------------------------------------------

/** Het voorstel ophalen. Verandert niets. */
export async function bekijkIndelingAction(dagId: string): Promise<IndelingVoorstel | null> {
  await requireAdmin();
  return getIndelingVoorstel(dagId);
}

export async function bevestigIndelingAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const sessie = await requireAdmin();
  const dagId = tekst(formData, "event_id");

  const uitkomst = await voerIndelingUit({ dagId, doorId: sessie.userId, doorEmail: sessie.email });
  if (!uitkomst.ok) return { status: "error", message: uitkomst.fout };

  verversDag(dagId);
  const staart = uitkomst.mislukt > 0 ? `, ${uitkomst.mislukt} niet gelukt` : "";
  return { status: "ok", message: `${uitkomst.gelukt} deelnemers ingedeeld${staart}.` };
}

export async function bekijkMailAction(input: {
  dagId: string;
  naar: string;
  naam: string;
  opmerking: string;
  soorten: Soort[];
}): Promise<MailVoorbeeld | null> {
  await requireAdmin();
  return maakMailVoorbeeld({
    dagId: input.dagId,
    naar: input.naar,
    naam: input.naam,
    opmerking: input.opmerking || null,
    soorten: input.soorten.filter((soort) => KLANT_SOORTEN.includes(soort)),
  });
}

export async function verstuurLijstenAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const sessie = await requireAdmin();
  const dagId = tekst(formData, "event_id");

  const soorten = formData
    .getAll("soort")
    .map((waarde) => String(waarde))
    // Alleen de lijsten die naar een klant mogen. De codelijst hoort bij de
    // mentor en gaat nooit als bijlage mee, ook niet als iemand het formulier
    // naspeelt.
    .filter((waarde): waarde is Soort => (KLANT_SOORTEN as string[]).includes(waarde));

  const uitkomst = await verstuurLijsten({
    dagId,
    naar: tekst(formData, "to_email"),
    naam: tekst(formData, "to_name"),
    opmerking: tekst(formData, "note") || null,
    soorten,
    toegangsLink: tekst(formData, "access_link") || null,
    nogmaals: formData.get("nogmaals") === "ja",
    doorId: sessie.userId,
    doorEmail: sessie.email,
  });

  if (!uitkomst.ok) return { status: "error", message: uitkomst.fout };
  verversDag(dagId);
  return { status: "ok", message: uitkomst.melding };
}

export async function maakToegangAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const sessie = await requireAdmin();
  const dagId = tekst(formData, "event_id");

  const uitkomst = await maakToegang({
    dagId,
    label: tekst(formData, "label"),
    dagenGeldig: getal(formData, "dagen", 30),
    doorId: sessie.userId,
  });

  if (!uitkomst.ok) return { status: "error", message: uitkomst.fout };

  verversDag(dagId);
  return {
    status: "ok",
    message: `Link: /indeling/${uitkomst.token} · Code: ${uitkomst.code} — noteer deze nu, hij is hierna niet meer op te vragen.`,
  };
}

export async function trekToegangInAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const dagId = tekst(formData, "event_id");
  const uitkomst = await trekToegangIn(tekst(formData, "access_id"));
  if (!uitkomst.ok) return { status: "error", message: "Dat lukte niet." };
  verversDag(dagId);
  return { status: "ok", message: "De toegang is ingetrokken." };
}

export async function verstuurBevestigingenAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const sessie = await requireAdmin();
  const dagId = tekst(formData, "event_id");

  const uitkomst = await verstuurBevestigingen({
    dagId,
    opnieuw: formData.get("opnieuw") === "ja",
    doorId: sessie.userId,
    doorEmail: sessie.email,
  });

  if (!uitkomst.ok) return { status: "error", message: uitkomst.fout };
  verversDag(dagId);
  return { status: "ok", message: uitkomst.melding };
}


// -----------------------------------------------------------------------------
// Eén deelnemer
//
// Dit is het telefoontje op de ochtend zelf: iemand is zijn code kwijt, of
// iemand doet niet mee. Daarom opzoeken op naam of op code, en per deelnemer
// precies drie dingen die je kunt doen.
// -----------------------------------------------------------------------------

export async function zoekDeelnemersAction(input: { dagId: string; term: string }): Promise<DeelnemerRegel[]> {
  await requireAdmin();
  return zoekDeelnemers(input.dagId, input.term);
}

export async function zetVrijstellingAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const dagId = tekst(formData, "event_id");

  return antwoord(
    await zetVrijstelling({
      id: tekst(formData, "participant_id"),
      vrijgesteld: tekst(formData, "exempt") === "ja",
      bevestigd: bevestigd(formData),
    }),
    dagId,
  );
}

export async function nieuweCodeAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const dagId = tekst(formData, "event_id");

  const uitkomst = await nieuweCodeVoor(tekst(formData, "participant_id"));
  if (!uitkomst.ok) return { status: "error", message: uitkomst.fout };

  verversDag(dagId);
  return {
    status: "ok",
    message: `Nieuwe code voor ${uitkomst.naam}: ${uitkomst.code}. De oude werkt niet meer.`,
  };
}

export async function verwijderDeelnemerAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const dagId = tekst(formData, "event_id");

  const uitkomst = await verwijderDeelnemer(tekst(formData, "participant_id"), bevestigd(formData));
  if (!uitkomst.ok) {
    return { status: "error", message: `${uitkomst.fout} Doorgaan haalt die keuzes ook weg.`, bevestig: true };
  }

  verversDag(dagId);
  return { status: "ok", message: "Verwijderd." };
}
