import { BoekingsFormulier } from "@/app/afspraak/[slug]/boekings-formulier";
import { BoekingsLinksScherm } from "@/app/admin/crm/boekingslinks/boekingslinks-scherm";
import {
  STANDAARD_REGELS,
  STANDAARD_VENSTERS,
  berekenVrijeMomenten,
} from "@/lib/crm/beschikbaarheid";
import type { BoekingsLink } from "@/lib/crm/boekingslinks";

/**
 * De visuele controle van de boekingslink.
 *
 * De vrije momenten worden hier met de echte functie uitgerekend, niet
 * opgeschreven. Wat je op de schermafbeelding ziet, is dus wat de motor
 * oplevert bij deze werktijden.
 *
 * Waar deze harness op let:
 *   - is de openbare pagina op een telefoon te bedienen, met knoppen die groot
 *     genoeg zijn voor een duim?
 *   - past het formulier met vijf velden zonder horizontaal geschuif?
 *   - valt de waarschuwing over de agenda voldoende op?
 */

const NU = new Date("2026-09-09T06:00:00Z");

const DAGEN = berekenVrijeMomenten(
  { ...STANDAARD_REGELS, vensters: STANDAARD_VENSTERS, opzegtermijnUren: 24, horizonDagen: 14 },
  [
    { startsAt: "2026-09-10T08:00:00Z", endsAt: "2026-09-10T10:00:00Z", bron: "agenda" },
    { startsAt: "2026-09-11T12:00:00Z", endsAt: "2026-09-11T14:00:00Z", bron: "crm" },
  ],
  NU
);

const LINK: BoekingsLink = {
  id: "l1",
  slug: "a1b2c3d4e5f6g7h8",
  name: "Kennismakingsgesprek",
  intro: "Een half uur om te horen wat jullie zoeken en wat wij kunnen doen.",
  brand: "skool_workshop",
  meetingKind: "kennismaking",
  meetingForm: "videobellen",
  location: "Google Meet",
  ownerId: "u1",
  ownerNaam: "Clinten",
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 15,
  noticeHours: 24,
  horizonDays: 60,
  slotStepMinutes: 15,
  timezone: "Europe/Amsterdam",
  isActive: true,
  maxPerDay: 10,
  vensters: STANDAARD_VENSTERS,
  aantalBoekingen: 7,
};

function Scherm({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <p className="mb-3 font-mono text-xs uppercase tracking-widest text-muted">{titel}</p>
      <div className="rounded-card border border-line bg-surface-2 p-4 sm:p-6">{children}</div>
    </section>
  );
}

export function Harness() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Bewust geen smaller kader eromheen: de mobiele schermafbeelding wordt
          al op 390 pixels gemaakt, en dan is dit precies wat een school ziet. */}
      {/* Zonder extra kader eromheen, want elke laag met marge maakt de pagina
          in de harness smaller dan hij in het echt is, en dan ga je problemen
          oplossen die er niet zijn. */}
      <Scherm titel="De openbare pagina, zoals een school hem ziet">
        <div className="-mx-4 bg-white px-4 sm:-mx-6 sm:px-6">
          <p className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted-soft">
            Skool Workshop
          </p>
          <h1 className="text-balance break-words text-[26px] leading-tight">{LINK.name}</h1>
          <p className="mt-2 text-muted">30 min · Videobellen · Google Meet</p>
          <p className="mb-6 mt-4 text-muted">{LINK.intro}</p>
          <BoekingsFormulier
            slug={LINK.slug}
            dagen={DAGEN}
            tijdzone={LINK.timezone}
            duurTekst="30 min"
          />
        </div>
      </Scherm>

      <Scherm titel="Het beheerscherm, met agendawaarschuwing">
        <BoekingsLinksScherm
          links={[LINK, { ...LINK, id: "l2", name: "Adviesgesprek burgerschap", isActive: false, aantalBoekingen: 0, vensters: [] }]}
          beheerders={[{ id: "u1", naam: "Clinten" }]}
          siteUrl="https://skoolpartner.vercel.app"
          agendaWaarschuwing="De koppeling heeft nog geen toegang tot je agenda. Koppel Google opnieuw en geef toestemming voor Agenda."
        />
      </Scherm>
    </div>
  );
}
