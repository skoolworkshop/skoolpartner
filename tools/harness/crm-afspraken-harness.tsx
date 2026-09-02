import { AfsprakenBlok } from "@/components/admin/afspraak-blok";
import { AfsprakenScherm } from "@/app/admin/crm/afspraken/afspraken-scherm";
import { deelAfsprakenIn } from "@/lib/crm/afspraken-regels";
import type { Afspraak } from "@/lib/crm/afspraken";

/**
 * De visuele controle van de afspraken.
 *
 * De indeling wordt hier met de echte functie gemaakt, dus wat er onder
 * "blijft liggen" staat, staat daar ook echt omdat de regel dat zegt. Alleen
 * de afspraken zelf zijn verzonnen testwaarden.
 *
 * Waar deze harness op let:
 *   - valt "blijft liggen" genoeg op om er iets mee te doen?
 *   - past de tabel op een telefoon zonder horizontaal geschuif?
 *   - blijft het formulier met acht velden leesbaar op 340 pixels?
 */

const NU = "2026-09-10T12:00:00.000Z";

function afspraak(waarden: Partial<Afspraak> & { id: string; title: string }): Afspraak {
  return {
    kind: "kennismaking",
    form: "op_locatie",
    startsAt: "2026-09-15T09:00:00.000Z",
    endsAt: "2026-09-15T10:00:00.000Z",
    location: null,
    status: "gepland",
    outcome: null,
    note:
      'Join link for Google Meet : https://meet.google.com/hov-grgh-qup<br><b>Wil je wijzigingen ' +
      'aanbrengen?</b><br><ul><li>Opnieuw plannen:&nbsp;<a href="https://app-eu1.hubspot.com/meetings/' +
      'skool-workshop/suri-impact?rescheduleId=918810da4aae2af8b9bbd8f1cd2f56f3&amp;ms=1">https://app-eu1' +
      '.hubspot.com/meetings/skool-workshop/suri-impact?rescheduleId=918810da4aae2af8b9bbd8f1cd2f56f3' +
      '&amp;ms=1</a></li><li>Annuleren:&nbsp;<a href="https://app-eu1.hubspot.com/meetings/skool-workshop/' +
      'suri-impact?cancelId=918810da4aae2af8b9bbd8f1cd2f56f3&amp;ms=1">https://app-eu1.hubspot.com/' +
      'meetings/skool-workshop/suri-impact?cancelId=918810da4aae2af8b9bbd8f1cd2f56f3&amp;ms=1</a></li></ul>',
    organizationId: "org-1",
    contactId: null,
    dealId: null,
    ownerId: "u1",
    ownerNaam: "Clinten",
    organisatieNaam: "Markenhage College",
    contactNaam: null,
    dealTitel: null,
    duurMinuten: 60,
    createdAt: "2026-08-01T09:00:00.000Z",
    ...waarden,
  };
}

const AFSPRAKEN: Afspraak[] = [
  afspraak({
    id: "1",
    title: "Kennismaking over de cultuurdag",
    startsAt: "2026-09-11T08:30:00.000Z",
    endsAt: "2026-09-11T09:30:00.000Z",
    location: "Markenhagelaan 1, Breda",
    contactNaam: "Nora Bakker",
    contactId: "c-1",
    dealTitel: "Cultuurdag 2026",
    dealId: "d-1",
  }),
  afspraak({
    id: "2",
    title: "Rondleiding en zaalcheck",
    kind: "rondleiding",
    startsAt: "2026-09-18T12:00:00.000Z",
    endsAt: "2026-09-18T13:30:00.000Z",
    duurMinuten: 90,
    organisatieNaam: "Metis Montessori Lyceum",
    organizationId: "org-2",
  }),
  afspraak({
    id: "3",
    title: "Belafspraak over de offerte",
    kind: "advies",
    form: "telefoon",
    startsAt: "2026-09-02T13:00:00.000Z",
    endsAt: "2026-09-02T13:30:00.000Z",
    duurMinuten: 30,
    organisatieNaam: "Da Vinci College",
    organizationId: "org-3",
    dealTitel: "Projectweek Da Vinci",
    dealId: "d-3",
  }),
  afspraak({
    id: "4",
    title: "Evaluatie na de workshopweek",
    kind: "evaluatie",
    form: "videobellen",
    status: "gehouden",
    startsAt: "2026-09-04T09:00:00.000Z",
    endsAt: "2026-09-04T09:45:00.000Z",
    duurMinuten: 45,
    outcome: null,
    organisatieNaam: "OSG Noord-West",
    organizationId: "org-4",
  }),
  afspraak({
    id: "5",
    title: "Intake nieuwe locatie",
    kind: "intake",
    status: "gehouden",
    startsAt: "2026-08-28T09:00:00.000Z",
    endsAt: "2026-08-28T10:00:00.000Z",
    outcome:
      "Ze willen twee dagdelen in maart, met vier groepen tegelijk. Offerte voor 15 september versturen.",
    organisatieNaam: "Fons Vitae Lyceum",
    organizationId: "org-5",
  }),
  afspraak({
    id: "6",
    title: "Kennismaking, afgezegd door de school",
    status: "geannuleerd",
    startsAt: "2026-08-20T09:00:00.000Z",
    endsAt: "2026-08-20T10:00:00.000Z",
    outcome: "Cultuurcoördinator is ziek, wordt opnieuw ingepland.",
    organisatieNaam: "Corlaer College",
    organizationId: "org-6",
  }),
  afspraak({
    id: "7",
    title: "Adviesgesprek burgerschap",
    kind: "advies",
    status: "niet_verschenen",
    startsAt: "2026-08-14T09:00:00.000Z",
    endsAt: "2026-08-14T10:00:00.000Z",
    organisatieNaam: "Calvijn College",
    organizationId: "org-7",
  }),
];

const INDELING = deelAfsprakenIn(AFSPRAKEN, NU);

const BEHEERDERS = [
  { id: "u1", naam: "Clinten" },
  { id: "u2", naam: "Collega" },
];

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
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Scherm titel="Het overzicht op een breed scherm">
        <AfsprakenScherm
          achterstallig={INDELING.achterstallig}
          komend={INDELING.komend}
          geweest={INDELING.geweest}
          zonderUitkomst={INDELING.zonderUitkomst}
        />
      </Scherm>

      <Scherm titel="Het blok zoals het bij een deal staat">
        <AfsprakenBlok
          onderwerp={{ dealId: "d-1", organizationId: "org-1" }}
          indeling={INDELING}
          beheerders={BEHEERDERS}
        />
      </Scherm>

      <Scherm titel="Hetzelfde blok op een telefoon">
        <div className="mx-auto max-w-[340px]">
          <AfsprakenBlok
            onderwerp={{ dealId: "d-1", organizationId: "org-1" }}
            indeling={INDELING}
            beheerders={BEHEERDERS}
          />
        </div>
      </Scherm>

      <Scherm titel="Het overzicht op een telefoon">
        <div className="mx-auto max-w-[340px]">
          <AfsprakenScherm
            achterstallig={INDELING.achterstallig}
            komend={INDELING.komend}
            geweest={INDELING.geweest}
            zonderUitkomst={INDELING.zonderUitkomst}
          />
        </div>
      </Scherm>
    </div>
  );
}
