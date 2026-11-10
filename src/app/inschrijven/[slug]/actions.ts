"use server";

import { headers } from "next/headers";

import { publiekeInschrijvingAan } from "@/lib/env";

import {
  controleerGedeeldeCode,
  getAanbod,
  getBevestiging,
  getPubliekeDag,
  leesDeelnemer,
  maakKeuze,
  zoekInGroep,
  zoekViaCode,
  zoekVoorVerificatie,
  type AanbodRonde,
  type CodeUitkomst,
  type Bevestiging,
  type MailZoekUitkomst,
  type PubliekeDag,
  type ZoekUitkomst,
} from "@/lib/inschrijving/publiek";
import { bevestigVerificatie, stuurVerificatie } from "@/lib/inschrijving/verificatie";

/**
 * De serveracties van de inschrijfpagina.
 *
 * Deze zijn openbaar: er komt geen inlog aan te pas, want een leerling heeft
 * geen account. Dat betekent dat alles wat binnenkomt verdacht is tot het
 * tegendeel blijkt.
 *
 *   De dag wordt altijd zelf opgezocht aan de hand van de sleutel in de link.
 *   Een id dat de browser meestuurt wordt nooit zomaar geloofd.
 *
 *   Voor alles behalve het opzoeken van de eigen naam is het claim_token
 *   nodig, en dat wordt bij elke actie opnieuw gecontroleerd.
 *
 *   De zware regels, vol en toegestane klassen en herhaling, staan in de
 *   database. Wat hier staat is alleen de weg ernaartoe.
 */

export interface Stand {
  aanbod: AanbodRonde[];
  bevestiging: Bevestiging | null;
}

async function dagVanSlug(slug: string) {
  // Staat de publieke inschrijving uit, dan doet geen enkele actie hier nog
  // iets. Een serveractie is gewoon een POST die ook buiten de pagina om
  // aangeroepen kan worden, dus de schakelaar moet ook hier staan.
  if (!publiekeInschrijvingAan()) return null;

  const dag = await getPubliekeDag(slug);
  return dag && dag.open ? dag : null;
}

/**
 * Waar komt dit verzoek vandaan?
 *
 * Alleen om pogingen te kunnen tellen. Wordt niet opgeslagen.
 */
async function herkomst(): Promise<string> {
  const kop = await headers();
  const doorgestuurd = kop.get("x-forwarded-for");
  return (doorgestuurd?.split(",")[0] ?? kop.get("x-real-ip") ?? "onbekend").trim();
}

/**
 * De gedeelde code hoort bij elke stap opnieuw gecontroleerd te worden.
 *
 * De browser stuurt hem elke keer mee. Dat is bewust geen sessie en geen
 * cookie: een serveractie is gewoon een POST die ook buiten de pagina om
 * aangeroepen kan worden, en dan moet die ene controle er altijd tussen
 * zitten. Een goede code kost geen poging, dus herhalen is gratis.
 */
async function dagAchterPoort(
  slug: string,
  toegang: string,
): Promise<{ dag: PubliekeDag; vanaf: string } | { fout: "dicht" | "poort" | "tevaak" }> {
  const dag = await dagVanSlug(slug);
  if (!dag) return { fout: "dicht" };

  const vanaf = await herkomst();
  const uitkomst = await controleerGedeeldeCode({ dagId: dag.id, code: toegang, vanaf });
  if (!uitkomst.ok) return { fout: uitkomst.reden === "tevaak" ? "tevaak" : "poort" };

  return { dag, vanaf };
}

export type PoortUitkomst = { ok: true } | { ok: false; reden: "fout" | "uit" | "tevaak" | "dicht" };

/**
 * De gedeelde toegangscode van de dag.
 *
 * Eén code voor de hele school, uitgedeeld door de docent samen met de link.
 * Hij zegt alleen dat je bij deze dag hoort. Wie je bent komt in de volgende
 * stap, en dat is de stap die echt bewijst.
 */
export async function poortAction(input: { slug: string; code: string }): Promise<PoortUitkomst> {
  const dag = await dagVanSlug(input.slug);
  if (!dag) return { ok: false, reden: "dicht" };

  const uitkomst = await controleerGedeeldeCode({
    dagId: dag.id,
    code: input.code,
    vanaf: await herkomst(),
  });

  return uitkomst.ok ? { ok: true } : { ok: false, reden: uitkomst.reden };
}

/**
 * Inloggen met de persoonlijke code.
 *
 * De code wordt in de database tegen precies één leerling gehouden. Lukt dat
 * niet, dan komt er alleen "deze code kennen we niet" terug: geen hint over
 * welke klas of welke naam er wel bij een code hoort.
 */
export async function codeAction(input: {
  slug: string;
  toegang: string;
  code: string;
}): Promise<CodeUitkomst | { soort: "dicht" } | { soort: "poort" }> {
  const poort = await dagAchterPoort(input.slug, input.toegang);
  if ("fout" in poort) return { soort: poort.fout === "tevaak" ? "tevaak" : poort.fout };

  /*
    De persoonlijke code werkt in elke modus.

    Hij is nooit zwakker dan de andere manieren: hij hoort bij precies één
    leerling en komt van de mentor. Dit is de achtervang voor wie niet bij zijn
    schoolmail kan, zodat Anne iemand kan helpen zonder de hele dag om te
    zetten. Omzeilen kan er niets mee: wie de code niet heeft, heeft er niets
    aan.
  */
  return zoekViaCode({ dagId: poort.dag.id, code: input.code, vanaf: poort.vanaf });
}

export async function zoekAction(input: {
  slug: string;
  toegang: string;
  groepId: string;
  naam: string;
}): Promise<ZoekUitkomst | { soort: "dicht" } | { soort: "poort" } | { soort: "tevaak" }> {
  const poort = await dagAchterPoort(input.slug, input.toegang);
  if ("fout" in poort) return { soort: poort.fout === "tevaak" ? "tevaak" : poort.fout };

  // Zoeken op naam alleen is de lichtste manier en staat standaard uit. Staat
  // deze dag op codes of op schoolmail, dan doet dit formulier hier niets.
  if (poort.dag.toegangswijze !== "naam") return { soort: "niets" };

  if (!poort.dag.groepen.some((groep) => groep.id === input.groepId)) return { soort: "niets" };
  if (input.naam.trim().length < 2) return { soort: "niets" };

  return zoekInGroep({ dagId: poort.dag.id, groepId: input.groepId, naam: input.naam });
}

/**
 * Stap één van de schoolmailmanier: de naam opzoeken.
 *
 * Hier komt nog geen bewijs uit, alleen het half verborgen adres waar de code
 * naartoe zou gaan. Zo ziet de leerling dat het zijn eigen schooladres is.
 */
export async function mailZoekAction(input: {
  slug: string;
  toegang: string;
  groepId: string;
  naam: string;
}): Promise<MailZoekUitkomst | { soort: "dicht" } | { soort: "poort" } | { soort: "tevaak" }> {
  const poort = await dagAchterPoort(input.slug, input.toegang);
  if ("fout" in poort) return { soort: poort.fout === "tevaak" ? "tevaak" : poort.fout };

  if (poort.dag.toegangswijze !== "schoolmail") return { soort: "niets" };
  if (!poort.dag.groepen.some((groep) => groep.id === input.groepId)) return { soort: "niets" };
  if (input.naam.trim().length < 2) return { soort: "niets" };

  return zoekVoorVerificatie({ dagId: poort.dag.id, groepId: input.groepId, naam: input.naam });
}

/**
 * Stap twee: de code versturen naar het adres van de school.
 *
 * Het adres staat niet in dit verzoek. Het wordt opgezocht bij de deelnemer,
 * want een adres dat de browser meestuurt is precies het gat dat we dicht
 * willen hebben.
 */
export async function vraagCodeAction(input: {
  slug: string;
  toegang: string;
  deelnemerId: string;
}): Promise<{ ok: true; adres: string } | { ok: false; reden: string }> {
  const poort = await dagAchterPoort(input.slug, input.toegang);
  if ("fout" in poort) {
    return {
      ok: false,
      reden:
        poort.fout === "tevaak"
          ? "Even wachten. Er zijn te veel pogingen gedaan."
          : "De inschrijving is inmiddels gesloten.",
    };
  }
  if (poort.dag.toegangswijze !== "schoolmail") return { ok: false, reden: "Dat kan hier niet." };

  const uitkomst = await stuurVerificatie({
    dagId: poort.dag.id,
    deelnemerId: input.deelnemerId,
    vanaf: poort.vanaf,
  });

  if (uitkomst.ok) return { ok: true, adres: uitkomst.adres };

  const meldingen: Record<string, string> = {
    onbekend: "Dat lukte niet. Begin opnieuw.",
    "geen-adres": "Van jou staat geen e-mailadres in de lijst. Vraag je docent om je in te schrijven.",
    vrijgesteld: "Jij hoeft je niet in te schrijven voor deze dag.",
    tevaak: "Even wachten. Er zijn te veel pogingen gedaan. Probeer het over tien minuten opnieuw.",
    "mail-uit": "We kunnen nu geen mail versturen. Vraag je docent om je in te schrijven.",
    mislukt: "Het versturen lukte niet. Probeer het over een paar minuten opnieuw.",
  };

  return { ok: false, reden: meldingen[uitkomst.reden] ?? "Dat lukte niet." };
}

/**
 * Stap drie: de cijfercode uit de mail.
 *
 * Klopt hij, dan komt het claim_token terug en gaat de inschrijving verder.
 * Dit is het enige moment waarop dat token de browser in gaat.
 */
export async function bevestigCodeAction(input: {
  slug: string;
  toegang: string;
  deelnemerId: string;
  code: string;
}): Promise<
  | { ok: true; deelnemerId: string; claim: string; naam: string; groepNaam: string }
  | { ok: false; reden: string }
> {
  const poort = await dagAchterPoort(input.slug, input.toegang);
  if ("fout" in poort) {
    return {
      ok: false,
      reden:
        poort.fout === "tevaak"
          ? "Even wachten. Er zijn te veel pogingen gedaan."
          : "De inschrijving is inmiddels gesloten.",
    };
  }
  if (poort.dag.toegangswijze !== "schoolmail") return { ok: false, reden: "Dat kan hier niet." };

  const uitkomst = await bevestigVerificatie({
    dagId: poort.dag.id,
    deelnemerId: input.deelnemerId,
    code: input.code,
  });

  if (uitkomst.ok) {
    return {
      ok: true,
      deelnemerId: uitkomst.deelnemerId,
      claim: uitkomst.claim,
      naam: uitkomst.naam,
      groepNaam: uitkomst.groepNaam,
    };
  }

  const meldingen: Record<string, string> = {
    geen: "Er staat geen code klaar. Vraag een nieuwe aan.",
    verlopen: "Deze code is verlopen. Vraag een nieuwe aan.",
    gebruikt: "Deze code is al gebruikt. Vraag een nieuwe aan.",
    fout: "Die code klopt niet. Kijk de mail nog een keer na.",
    tevaak: "Te vaak fout ingevuld. Vraag een nieuwe code aan.",
  };

  return { ok: false, reden: meldingen[uitkomst.reden] ?? "Dat lukte niet." };
}

/**
 * Een voorgestelde naam bevestigen.
 *
 * Bij twijfel toont het scherm een paar namen. Pas als de leerling er een
 * aanwijst, wordt het bewijs afgegeven. Het id komt uit die suggestie, en
 * hoort dus altijd bij de groep waarin gezocht is.
 */
export async function bevestigNaamAction(input: {
  slug: string;
  toegang: string;
  groepId: string;
  deelnemerId: string;
}): Promise<{ ok: true; claim: string; naam: string } | { ok: false }> {
  const poort = await dagAchterPoort(input.slug, input.toegang);
  if ("fout" in poort) return { ok: false };
  if (poort.dag.toegangswijze !== "naam") return { ok: false };

  const { createServiceSupabase } = await import("@/lib/supabase/server");
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("enrollment_participants")
    .select("id, display_name, claim_token, exempt")
    .eq("id", input.deelnemerId)
    .eq("event_id", poort.dag.id)
    .eq("group_id", input.groepId)
    .maybeSingle();

  if (!data || data.exempt) return { ok: false };
  return { ok: true, claim: data.claim_token, naam: data.display_name };
}

export async function standAction(input: {
  slug: string;
  toegang: string;
  deelnemerId: string;
  claim: string;
}): Promise<Stand | null> {
  // Ook hier de gedeelde code erbij. Trekt de beheerder hem in, dan kan er
  // niemand meer iets wijzigen, ook niet wie het scherm nog open heeft staan.
  const poort = await dagAchterPoort(input.slug, input.toegang);
  if ("fout" in poort) return null;
  const dag = poort.dag;

  const deelnemer = await leesDeelnemer({ dagId: dag.id, deelnemerId: input.deelnemerId, claim: input.claim });
  if (!deelnemer) return null;

  const [aanbod, bevestiging] = await Promise.all([
    getAanbod({ dagId: dag.id, deelnemerId: deelnemer.id, groepId: deelnemer.groepId }),
    getBevestiging({ dagId: dag.id, deelnemerId: deelnemer.id }),
  ]);

  return { aanbod, bevestiging };
}

export async function kiesAction(input: {
  slug: string;
  toegang: string;
  deelnemerId: string;
  claim: string;
  sessieId: string;
}): Promise<{ ok: boolean; fout?: string; stand: Stand | null }> {
  const poort = await dagAchterPoort(input.slug, input.toegang);
  if ("fout" in poort) return { ok: false, fout: "De inschrijving is gesloten.", stand: null };
  const dag = poort.dag;

  const uitkomst = await maakKeuze({
    dagId: dag.id,
    deelnemerId: input.deelnemerId,
    claim: input.claim,
    sessieId: input.sessieId,
  });

  // Ook na een mislukte poging de stand teruggeven: als iemand je net voor
  // was, moet je meteen zien dat die plek weg is.
  const stand = await standAction(input);
  return uitkomst.ok ? { ok: true, stand } : { ok: false, fout: uitkomst.fout, stand };
}
