import "server-only";

import { integrationMode, serverEnv } from "@/lib/env";
import { formatShortDate } from "@/lib/format";
import { GmailClient } from "@/lib/integrations/gmail/client";
import { maakBericht } from "@/lib/inschrijving/mail";
import { maakMailHtml, metDomein, STANDAARD_HANDTEKENING } from "@/lib/inschrijving/handtekening";
import { resolveSiteUrl } from "@/lib/site-url";
import {
  beoordeelVerificatie,
  maakVerificatiecode,
  maskeer,
  pogingSleutel,
  POGINGEN_MAX,
  POGINGEN_VENSTER_SECONDEN,
  VERIFICATIE_MINUTEN,
  verificatieSleutel,
} from "@/lib/inschrijving/toegang";
import { createServiceSupabase } from "@/lib/supabase/server";

/**
 * De cijfercode naar het schooladres.
 *
 * WAAROM DIT BESTAAT
 *
 *   Met alleen de gedeelde code van de dag en een naam uit de klas kan
 *   iedereen zich als iedereen voordoen. De tweede stap moet dus iets zijn wat
 *   alleen die leerling heeft. Als de school adressen aanlevert, is dat de
 *   mailbox van die leerling.
 *
 * HET ADRES KOMT ALTIJD VAN DE SCHOOL
 *
 *   Er wordt nooit gestuurd naar een adres dat iemand zelf intypt. Dan zou je
 *   de naam van een klasgenoot kunnen kiezen en je eigen adres invullen, en
 *   dan is de hele controle voor niets.
 *
 * WAT ER IN DE DATABASE STAAT
 *
 *   Niet de code, alleen de versleutelde vorm, met het deelnemer-id in de
 *   berekening. Een code vervalt na tien minuten, na vijf foute pogingen, of
 *   zodra hij één keer gebruikt is.
 */

export type StuurUitkomst =
  | { ok: true; adres: string }
  | { ok: false; reden: "onbekend" | "geen-adres" | "vrijgesteld" | "tevaak" | "mail-uit" | "mislukt" };

interface DeelnemerRij {
  id: string;
  display_name: string;
  email: string | null;
  exempt: boolean;
}

/** Eén poging tellen op de pogingenteller in de database. */
async function magNog(dagId: string, vanaf: string): Promise<boolean> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase.rpc("enrollment_poging", {
    p_event: dagId,
    p_bucket: pogingSleutel("verificatie", vanaf),
    p_max: POGINGEN_MAX,
    p_seconden: POGINGEN_VENSTER_SECONDEN,
  });
  if (error) {
    console.error("[inschrijving] pogingenteller werkt niet", error.message);
    return false;
  }
  return data === true;
}

/**
 * Een verificatiecode klaarzetten en versturen.
 *
 * Elke aanvraag kost een poging, ook een geslaagde. Anders kan iemand met de
 * gedeelde code de hele klas één voor één een mail bezorgen.
 */
export async function stuurVerificatie(params: {
  dagId: string;
  deelnemerId: string;
  vanaf: string;
}): Promise<StuurUitkomst> {
  if (!(await magNog(params.dagId, params.vanaf))) return { ok: false, reden: "tevaak" };

  const supabase = createServiceSupabase();

  const { data } = await supabase
    .from("enrollment_participants")
    .select("id, display_name, email, exempt")
    .eq("id", params.deelnemerId)
    .eq("event_id", params.dagId)
    .maybeSingle();

  const deelnemer = data as unknown as DeelnemerRij | null;
  if (!deelnemer) return { ok: false, reden: "onbekend" };
  if (deelnemer.exempt) return { ok: false, reden: "vrijgesteld" };
  if (!deelnemer.email) return { ok: false, reden: "geen-adres" };

  const { data: dag } = await supabase
    .from("enrollment_events")
    .select("name, event_date, organizations ( name )")
    .eq("id", params.dagId)
    .maybeSingle();

  const code = maakVerificatiecode();

  // Een eerdere code die nog open stond vervalt meteen: er is er altijd maar
  // één geldig, zodat een oude mail niets meer waard is.
  await supabase
    .from("enrollment_verifications")
    .update({ used_at: new Date().toISOString() })
    .eq("participant_id", deelnemer.id)
    .is("used_at", null);

  const { error: bewaarFout } = await supabase.from("enrollment_verifications").insert({
    participant_id: deelnemer.id,
    code_hash: verificatieSleutel(deelnemer.id, code),
    sent_to: deelnemer.email,
    expires_at: new Date(Date.now() + VERIFICATIE_MINUTEN * 60 * 1000).toISOString(),
  });

  if (bewaarFout) {
    console.error("[inschrijving] verificatiecode bewaren mislukt", bewaarFout.message);
    return { ok: false, reden: "mislukt" };
  }

  const dagNaam = (dag as unknown as { name?: string } | null)?.name ?? "de cultuurdag";
  const datum = (dag as unknown as { event_date?: string } | null)?.event_date;

  const tekst = [
    `Hoi ${deelnemer.display_name.split(" ")[0]},`,
    "",
    `Je code om je in te schrijven voor ${dagNaam.toLowerCase()}${datum ? ` op ${formatShortDate(datum)}` : ""} is:`,
    "",
    code,
    "",
    `Vul deze code in op de inschrijfpagina. Hij is ${VERIFICATIE_MINUTEN} minuten geldig.`,
    "",
    "Heb je dit niet zelf aangevraagd? Dan hoef je niets te doen. Zonder deze code kan niemand jouw inschrijving doen.",
  ].join("\n");

  if (integrationMode("gmail") !== "live") {
    // Lokaal testen zonder mailkoppeling: de code gaat naar de serverlog, nooit
    // naar het scherm van de bezoeker. In productie gebeurt dit niet.
    if (process.env.NODE_ENV !== "production") {
      console.info(`[inschrijving] verificatiecode voor ${deelnemer.display_name}: ${code}`);
      return { ok: true, adres: maskeer(deelnemer.email) };
    }
    return { ok: false, reden: "mail-uit" };
  }

  const client = await GmailClient.create();
  if (!client) return { ok: false, reden: "mail-uit" };

  try {
    await client.sendRaw(
      maakBericht({
        van: `Skool Workshop <${serverEnv.google.mailbox}>`,
        naar: [deelnemer.email],
        onderwerp: `Je code: ${code}`,
        tekst,
        html: maakMailHtml({
          tekst,
          handtekening: metDomein(STANDAARD_HANDTEKENING, await resolveSiteUrl()),
        }),
      }),
    );
  } catch (fout) {
    console.error("[inschrijving] verificatiemail mislukt", fout);
    return { ok: false, reden: "mislukt" };
  }

  return { ok: true, adres: maskeer(deelnemer.email) };
}

export type BevestigUitkomst =
  | { ok: true; deelnemerId: string; claim: string; naam: string; groepId: string; groepNaam: string }
  | { ok: false; reden: "geen" | "verlopen" | "gebruikt" | "fout" | "tevaak" };

/**
 * De ingetypte cijfercode controleren.
 *
 * Pas hier komt het claim_token tevoorschijn. Dat is het bewijs dat elke
 * volgende stap moet meesturen, en het is het enige moment waarop het de
 * browser in gaat.
 */
export async function bevestigVerificatie(params: {
  dagId: string;
  deelnemerId: string;
  code: string;
}): Promise<BevestigUitkomst> {
  const supabase = createServiceSupabase();

  // Eerst de deelnemer, zodat een id van een andere dag hier al afketst.
  const { data: deelnemerRij } = await supabase
    .from("enrollment_participants")
    .select("id, display_name, group_id, exempt, claim_token, enrollment_groups ( name )")
    .eq("id", params.deelnemerId)
    .eq("event_id", params.dagId)
    .maybeSingle();

  const deelnemer = deelnemerRij as unknown as {
    id: string;
    display_name: string;
    group_id: string;
    exempt: boolean;
    claim_token: string;
    enrollment_groups: { name: string } | null;
  } | null;

  if (!deelnemer || deelnemer.exempt) return { ok: false, reden: "geen" };

  const { data } = await supabase
    .from("enrollment_verifications")
    .select("id, code_hash, expires_at, attempts, used_at, sent_to")
    .eq("participant_id", deelnemer.id)
    .is("used_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  const regel = (data ?? [])[0] as
    | { id: string; code_hash: string; expires_at: string; attempts: number; used_at: string | null; sent_to: string }
    | undefined;

  const oordeel = beoordeelVerificatie({
    regel: regel ?? null,
    deelnemerId: deelnemer.id,
    code: params.code,
  });

  if (!oordeel.ok) {
    if (regel) {
      await supabase
        .from("enrollment_verifications")
        .update({ attempts: regel.attempts + 1 })
        .eq("id", regel.id);
    }
    return { ok: false, reden: oordeel.reden };
  }

  await supabase
    .from("enrollment_verifications")
    .update({ used_at: new Date().toISOString() })
    .eq("id", regel!.id);

  // Vastleggen met welk adres deze inschrijving is bevestigd. Bestaande keuzes
  // blijven staan: een bevestiging zegt wie je bent, het verandert niets aan
  // wat er al gekozen is.
  await supabase
    .from("enrollment_participants")
    .update({ claim_email: regel!.sent_to, claimed_at: new Date().toISOString() })
    .eq("id", deelnemer.id);

  return {
    ok: true,
    deelnemerId: deelnemer.id,
    claim: deelnemer.claim_token,
    naam: deelnemer.display_name,
    groepId: deelnemer.group_id,
    groepNaam: deelnemer.enrollment_groups?.name ?? "",
  };
}
