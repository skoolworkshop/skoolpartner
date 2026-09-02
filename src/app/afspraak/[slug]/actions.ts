"use server";

import { boekAfspraak, getBoekingsLink, gastVoornaam } from "@/lib/crm/boekingslinks";
import { stuurBevestiging } from "@/lib/crm/boeking-bevestiging";
import { AFSPRAAK_VORMEN, formatDuur, isAfspraakVorm } from "@/lib/crm/afspraken-regels";
import { createServiceSupabase } from "@/lib/supabase/server";

/**
 * De serveractie achter de openbare boekingspagina.
 *
 * ============================================================================
 * DIT IS HET ENIGE PUNT WAAR IEMAND ZONDER ACCOUNT IETS KAN VEROORZAKEN
 * ============================================================================
 *
 * Alles wat er gecontroleerd moet worden, gebeurt in boekAfspraak: bestaat de
 * link, staat hij aan, klopt de invoer, is het dagmaximum bereikt, is het
 * moment nog vrij. Die functie is de poort; deze actie is alleen het formulier
 * eromheen.
 *
 * Wat hier bewust NIET gebeurt:
 *   - geen requireAdmin, want dit is een openbare pagina;
 *   - maar ook geen enkele database-actie buiten boekAfspraak om;
 *   - en geen enkele foutmelding die iets prijsgeeft over wat er intern staat.
 *     Een bezoeker krijgt "kies een ander moment", niet welke afspraak er in
 *     de weg zat.
 */

export type BoekingState =
  | { status: "idle" }
  | { status: "fout"; melding: string }
  | { status: "geboekt"; wanneer: string; bevestigingVerstuurd: boolean };

function tekst(formData: FormData, veld: string): string {
  const waarde = formData.get(veld);
  return typeof waarde === "string" ? waarde.trim() : "";
}

/** Datum en tijd uitgeschreven, in de tijdzone van de link. */
function schrijfMoment(startsAt: string, tijdzone: string): string {
  try {
    return new Intl.DateTimeFormat("nl-NL", {
      timeZone: tijdzone,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(startsAt));
  } catch {
    return startsAt;
  }
}

export async function boekAfspraakAction(
  _prev: BoekingState,
  formData: FormData
): Promise<BoekingState> {
  const slug = tekst(formData, "slug");

  const uitkomst = await boekAfspraak(slug, {
    voornaam: tekst(formData, "voornaam"),
    achternaam: tekst(formData, "achternaam"),
    email: tekst(formData, "email"),
    telefoon: tekst(formData, "telefoon"),
    organisatie: tekst(formData, "organisatie"),
    startsAt: tekst(formData, "startsAt"),
    gasten: tekst(formData, "gasten")
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean),
    honeypot: tekst(formData, "website"),
  });

  if (!uitkomst.ok) return { status: "fout", melding: uitkomst.fout };

  const link = await getBoekingsLink(slug);
  const tijdzone = link?.timezone ?? "Europe/Amsterdam";
  const wanneer = schrijfMoment(uitkomst.startsAt, tijdzone);

  /*
    De bevestiging. Faalt die, dan blijft de boeking gewoon staan en zegt het
    scherm dat er geen mail is verstuurd. Een geslaagde afspraak als mislukking
    tonen zou betekenen dat iemand het nog een keer probeert.
  */
  let bevestigingVerstuurd = false;
  if (link) {
    const supabase = createServiceSupabase();
    const { data: eigenaar } = link.ownerId
      ? await supabase.from("profiles").select("full_name, email").eq("id", link.ownerId).maybeSingle()
      : { data: null };

    const mail = await stuurBevestiging({
      naar: tekst(formData, "email").toLowerCase(),
      voornaam: gastVoornaam(`${tekst(formData, "voornaam")} ${tekst(formData, "achternaam")}`),
      wanneer,
      duurTekst: formatDuur(link.durationMinutes),
      linkNaam: link.name,
      vormTekst: isAfspraakVorm(link.meetingForm)
        ? AFSPRAAK_VORMEN[link.meetingForm]
        : "In overleg",
      locatie: link.location,
      vanOns: eigenaar?.full_name ?? null,
    });
    bevestigingVerstuurd = mail.verstuurd;
  }

  return { status: "geboekt", wanneer, bevestigingVerstuurd };
}
