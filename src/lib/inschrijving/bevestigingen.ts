import "server-only";

import { recordAudit } from "@/lib/audit";
import { integrationMode, serverEnv } from "@/lib/env";
import { formatShortDate, formatTime } from "@/lib/format";
import { GmailClient } from "@/lib/integrations/gmail/client";
import { getBevestiging } from "@/lib/inschrijving/publiek";
import { maakBericht } from "@/lib/inschrijving/mail";
import { createServiceSupabase } from "@/lib/supabase/server";

/**
 * De definitieve persoonlijke planning mailen.
 *
 * WIE KRIJGT HEM
 *
 *   Alleen deelnemers van wie we een e-mailadres hebben gekregen van de
 *   school, en die nog niets hebben ontvangen. Dat laatste voorkomt dat een
 *   tweede klik op de knop iedereen een dubbele mail bezorgt. Wie opnieuw wil
 *   sturen, bijvoorbeeld omdat de indeling is gewijzigd, zet dat bewust aan.
 *
 * WAAROM DIT VOORAL VOOR AUTOMATISCH INGEDEELDE LEERLINGEN IS
 *
 *   Wie zelf koos, zag zijn planning al op het scherm. Wie is ingedeeld, weet
 *   nog van niets.
 */

/** De planning als platte tekst. Dezelfde gegevens als op het scherm. */
function alsTekst(bevestiging: NonNullable<Awaited<ReturnType<typeof getBevestiging>>>): string {
  const regels = [
    `Beste ${bevestiging.deelnemer.split(" ")[0]},`,
    "",
    `Je bent ingedeeld voor ${bevestiging.dagNaam.toLowerCase()} op ${formatShortDate(bevestiging.datum)}.`,
    "",
  ];

  for (const ronde of bevestiging.rondes) {
    const tijd = `${formatTime(ronde.begin)} tot ${formatTime(ronde.eind)}`;
    if (ronde.pauze) {
      regels.push(`${ronde.label} (${tijd}): pauze`);
      continue;
    }
    const plek = [ronde.workshop ?? "nog niet ingedeeld", ronde.uitvoering, ronde.ruimte]
      .filter(Boolean)
      .join(" · ");
    regels.push(`${ronde.label} (${tijd}): ${plek}`);
  }

  const apps = bevestiging.rondes.filter((ronde) => ronde.app);
  if (apps.length > 0) {
    regels.push("", "Installeer dit vooraf:");
    for (const ronde of apps) {
      regels.push(`- ${ronde.workshop}: ${ronde.app?.naam}`);
      if (ronde.app?.uitleg) regels.push(`  ${ronde.app.uitleg}`);
      if (ronde.app?.android) regels.push(`  Android: ${ronde.app.android}`);
      if (ronde.app?.ios) regels.push(`  iPhone: ${ronde.app.ios}`);
      if (ronde.app?.web) regels.push(`  In de browser: ${ronde.app.web}`);
    }
  }

  const spullen = bevestiging.rondes.filter((ronde) => ronde.spullen);
  if (spullen.length > 0) {
    regels.push("", "Neem mee:");
    for (const ronde of spullen) regels.push(`- ${ronde.workshop}: ${ronde.spullen}`);
  }

  regels.push("", "Veel plezier!", "", "Met vriendelijke groet,", "Team Skool Workshop");
  return regels.join("\n");
}

export async function verstuurBevestigingen(params: {
  dagId: string;
  opnieuw: boolean;
  doorId: string;
  doorEmail: string;
}): Promise<{ ok: true; melding: string } | { ok: false; fout: string }> {
  const supabase = createServiceSupabase();

  const { data: dag } = await supabase
    .from("enrollment_events")
    .select("id, name, status")
    .eq("id", params.dagId)
    .maybeSingle();
  if (!dag) return { ok: false, fout: "Deze inschrijfdag bestaat niet meer." };

  let vraag = supabase
    .from("enrollment_participants")
    .select("id, display_name, email, confirmation_sent_at, exempt")
    .eq("event_id", params.dagId)
    .not("email", "is", null)
    .eq("exempt", false)
    .limit(2000);

  if (!params.opnieuw) vraag = vraag.is("confirmation_sent_at", null);

  const { data: deelnemers } = await vraag;
  const lijst = (deelnemers ?? []) as unknown as { id: string; display_name: string; email: string }[];

  if (lijst.length === 0) {
    return { ok: false, fout: "Er is niemand om een bevestiging naar te sturen." };
  }

  if (integrationMode("gmail") !== "live") {
    return { ok: false, fout: "De Gmail-koppeling staat niet aan, dus er kan niets verstuurd worden." };
  }

  const client = await GmailClient.create();
  if (!client) return { ok: false, fout: "Gmail is nog niet gekoppeld." };

  let verstuurd = 0;
  let mislukt = 0;

  for (const deelnemer of lijst) {
    const bevestiging = await getBevestiging({ dagId: params.dagId, deelnemerId: deelnemer.id });
    if (!bevestiging) {
      mislukt += 1;
      continue;
    }

    try {
      await client.sendRaw(
        maakBericht({
          van: `Skool Workshop <${serverEnv.google.mailbox}>`,
          naar: [deelnemer.email],
          onderwerp: `Jouw workshops op ${formatShortDate(bevestiging.datum)}`,
          tekst: alsTekst(bevestiging),
        }),
      );
      await supabase
        .from("enrollment_participants")
        .update({ confirmation_sent_at: new Date().toISOString() })
        .eq("id", deelnemer.id);
      verstuurd += 1;
    } catch (fout) {
      console.error("[inschrijving] bevestiging mislukt", fout);
      mislukt += 1;
    }
  }

  await recordAudit({
    actorId: params.doorId,
    actorEmail: params.doorEmail,
    action: "enrollment_confirmations_sent",
    entityType: "enrollment_event",
    entityId: params.dagId,
    after: { verstuurd, mislukt },
  });

  const staart = mislukt > 0 ? `, ${mislukt} mislukt` : "";
  return { ok: true, melding: `${verstuurd} bevestigingen verstuurd${staart}.` };
}
