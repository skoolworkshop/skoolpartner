"use server";

import { headers } from "next/headers";

import { publiekeInschrijvingAan } from "@/lib/env";

import {
  getAanbod,
  getBevestiging,
  getPubliekeDag,
  leesDeelnemer,
  maakKeuze,
  zoekInGroep,
  zoekViaCode,
  type AanbodRonde,
  type CodeUitkomst,
  type Bevestiging,
  type ZoekUitkomst,
} from "@/lib/inschrijving/publiek";

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
 * Inloggen met de persoonlijke code.
 *
 * De code wordt in de database tegen precies één leerling gehouden. Lukt dat
 * niet, dan komt er alleen "deze code kennen we niet" terug: geen hint over
 * welke klas of welke naam er wel bij een code hoort.
 */
export async function codeAction(input: {
  slug: string;
  code: string;
}): Promise<CodeUitkomst | { soort: "dicht" }> {
  const dag = await dagVanSlug(input.slug);
  if (!dag) return { soort: "dicht" };

  return zoekViaCode({ dagId: dag.id, code: input.code, vanaf: await herkomst() });
}

export async function zoekAction(input: {
  slug: string;
  groepId: string;
  naam: string;
}): Promise<ZoekUitkomst | { soort: "dicht" }> {
  const dag = await dagVanSlug(input.slug);
  if (!dag) return { soort: "dicht" };

  // Staat deze dag op codes, dan is zoeken op naam hier ook dicht. Anders zou
  // je de strengere manier kunnen omzeilen door het oude formulier na te
  // bouwen.
  if (dag.codeModus) return { soort: "niets" };

  if (!dag.groepen.some((groep) => groep.id === input.groepId)) return { soort: "niets" };
  if (input.naam.trim().length < 2) return { soort: "niets" };

  return zoekInGroep({ dagId: dag.id, groepId: input.groepId, naam: input.naam });
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
  groepId: string;
  deelnemerId: string;
}): Promise<{ ok: true; claim: string; naam: string } | { ok: false }> {
  const dag = await dagVanSlug(input.slug);
  if (!dag) return { ok: false };
  if (dag.codeModus) return { ok: false };

  const { createServiceSupabase } = await import("@/lib/supabase/server");
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("enrollment_participants")
    .select("id, display_name, claim_token, exempt")
    .eq("id", input.deelnemerId)
    .eq("event_id", dag.id)
    .eq("group_id", input.groepId)
    .maybeSingle();

  if (!data || data.exempt) return { ok: false };
  return { ok: true, claim: data.claim_token, naam: data.display_name };
}

export async function standAction(input: {
  slug: string;
  deelnemerId: string;
  claim: string;
}): Promise<Stand | null> {
  const dag = await dagVanSlug(input.slug);
  if (!dag) return null;

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
  deelnemerId: string;
  claim: string;
  sessieId: string;
}): Promise<{ ok: boolean; fout?: string; stand: Stand | null }> {
  const dag = await dagVanSlug(input.slug);
  if (!dag) return { ok: false, fout: "De inschrijving is gesloten.", stand: null };

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
