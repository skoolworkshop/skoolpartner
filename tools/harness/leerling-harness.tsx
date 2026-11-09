import { Bevestigingsblok, InschrijfFlow, RondeKaart } from "@/components/inschrijven/inschrijf-flow";
import type { AanbodRonde, Bevestiging, PubliekeDag } from "@/lib/inschrijving/publiek";

/**
 * Visuele controle van de inschrijfpagina voor een leerling.
 *
 * Dit is het scherm dat op een telefoon in de pauze gebruikt wordt, dus
 * daarop wordt het ook gecontroleerd. De gegevens zijn verzonnen, maar wel de
 * lastige gevallen: een workshop die vol zit, een die je al in een andere
 * ronde doet, een ronde waarin niets voor jouw klas draait, een pauze, en een
 * workshop met een app die je vooraf moet installeren.
 */

function ronde(nummer: number, extra: Partial<AanbodRonde> = {}): AanbodRonde {
  return {
    id: `r${nummer}`,
    label: `Workshopronde ${nummer}`,
    begin: "09:15:00",
    eind: "10:15:00",
    pauze: false,
    keuze: null,
    mogelijkheden: [],
    ...extra,
  };
}

const rondes: AanbodRonde[] = [
  ronde(1, {
    mogelijkheden: [
      {
        id: "s1",
        workshopId: "w1",
        naam: "Workshop Ghetto Drums",
        label: null,
        ruimte: "Aula",
        vrij: 7,
        maximum: 25,
        alGekozen: false,
        gekozen: true,
      },
      {
        id: "s2",
        workshopId: "w2",
        naam: "Workshop DJ Skills",
        label: null,
        ruimte: "Lokaal 1.04",
        vrij: 0,
        maximum: 15,
        alGekozen: false,
        gekozen: false,
      },
      {
        id: "s3",
        workshopId: "w3",
        naam: "Workshop Hiphop",
        label: "Groep B",
        ruimte: "Danszaal",
        vrij: 12,
        maximum: 30,
        alGekozen: false,
        gekozen: false,
      },
    ],
  }),
  ronde(2, {
    label: "Pauze",
    begin: "10:15:00",
    eind: "10:45:00",
    pauze: true,
  }),
  ronde(3, {
    label: "Workshopronde 2",
    begin: "10:45:00",
    eind: "11:45:00",
    mogelijkheden: [
      {
        id: "s4",
        workshopId: "w1",
        naam: "Workshop Ghetto Drums",
        label: null,
        ruimte: "Aula",
        vrij: 9,
        maximum: 25,
        alGekozen: true,
        gekozen: false,
      },
      {
        id: "s5",
        workshopId: "w4",
        naam: "Workshop Vloggen",
        label: null,
        ruimte: "Lokaal 2.11",
        vrij: 3,
        maximum: 20,
        alGekozen: false,
        gekozen: false,
      },
    ],
  }),
  ronde(4, { label: "Workshopronde 3", begin: "13:00:00", eind: "14:00:00", mogelijkheden: [] }),
];

const bevestiging: Bevestiging = {
  deelnemer: "Lissa van der Velde",
  groep: "1 HAVO",
  organisatie: "Scholengemeenschap De Rotonde",
  dagNaam: "Cultuurdag",
  datum: "2027-05-31",
  locatie: "Breda",
  openRondes: 1,
  rondes: [
    {
      label: "Workshopronde 1",
      begin: "09:15:00",
      eind: "10:15:00",
      pauze: false,
      workshop: "Workshop Ghetto Drums",
      uitvoering: null,
      ruimte: "Aula",
      docent: "Dathen",
      app: null,
      spullen: null,
    },
    {
      label: "Pauze",
      begin: "10:15:00",
      eind: "10:45:00",
      pauze: true,
      workshop: null,
      uitvoering: null,
      ruimte: null,
      docent: null,
      app: null,
      spullen: null,
    },
    {
      label: "Workshopronde 2",
      begin: "10:45:00",
      eind: "11:45:00",
      pauze: false,
      workshop: "Workshop Vloggen",
      uitvoering: null,
      ruimte: "Lokaal 2.11",
      docent: "Iris",
      app: {
        naam: "CapCut",
        android: "https://play.google.com/store/apps/details?id=com.lemon.lvoverseas",
        ios: "https://apps.apple.com/nl/app/capcut-video-editor/id1500855883",
        web: null,
        uitleg: "Installeer de app voor de workshop begint en maak een account aan.",
      },
      spullen: "Een koptelefoon of oordopjes",
    },
    {
      label: "Workshopronde 3",
      begin: "13:00:00",
      eind: "14:00:00",
      pauze: false,
      workshop: null,
      uitvoering: null,
      ruimte: null,
      docent: null,
      app: null,
      spullen: null,
    },
  ],
};

/** De dag zoals een leerling hem binnenkomt: met een eigen code. */
const dag: PubliekeDag = {
  id: "dag-1",
  naam: "Cultuurdag",
  datum: "2027-05-31",
  locatie: "Breda",
  organisatieNaam: "Scholengemeenschap De Rotonde",
  audience: "school",
  open: true,
  reden: null,
  rondes: rondes.map((regel) => ({
    id: regel.id,
    label: regel.label,
    begin: regel.begin,
    eind: regel.eind,
    pauze: regel.pauze,
  })),
  groepen: [
    { id: "g1", naam: "1 HAVO" },
    { id: "g2", naam: "2 VWO" },
  ],
  codeModus: true,
};

export function Harness() {
  return (
    <main className="mx-auto w-full max-w-2xl space-y-5 px-4 py-8 sm:px-6">
      <header>
        <p className="text-sm font-semibold text-muted">Scholengemeenschap De Rotonde</p>
        <h1 className="text-[30px]">Cultuurdag</h1>
        <p className="text-[15px] text-muted">31 mei 2027 · Breda</p>
      </header>

      <InschrijfFlow slug="cultuurdag-2027-05-31-a71f3c9d" dag={dag} />

      {rondes.map((regel) => (
        <RondeKaart key={regel.id} ronde={regel} onKies={() => {}} />
      ))}

      <Bevestigingsblok bevestiging={bevestiging} />
    </main>
  );
}
