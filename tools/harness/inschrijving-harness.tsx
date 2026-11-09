import { DagScherm, type DagExtra } from "@/app/admin/inschrijvingen/[id]/dag-scherm";
import { LijstVoorbeeld } from "@/components/admin/lijst-upload";
import { leesLijst, maakOverzicht } from "@/lib/inschrijving/lijst";
import type { DagDetail, UitvoeringRegel } from "@/lib/inschrijving/dagen";
import { controleerRooster } from "@/lib/inschrijving/rooster";

/**
 * Visuele controle van het scherm van een inschrijfdag.
 *
 * Verzonnen gegevens, maar wel een drukke dag: vier klassen, vier workshops,
 * drie rondes, een workshop die vol zit, een uitvoering die uit staat, een
 * tweede uitvoering naast elkaar en een paar klasbeperkingen. Gaat het hier op
 * 390 pixels goed, dan gaat het in het echt ook goed.
 */

const rondes = [
  { id: "r1", positie: 1, label: "Workshopronde 1", begin: "09:15:00", eind: "10:15:00", pauze: false },
  { id: "r2", positie: 2, label: "Workshopronde 2", begin: "10:45:00", eind: "11:45:00", pauze: false },
  // De lunchpauze hoort gewoon op het rooster te staan, en nergens mee te
  // tellen. Daarom staat hij ook in de visuele controle.
  { id: "p1", positie: 3, label: "Pauze (lunch)", begin: "11:45:00", eind: "12:30:00", pauze: true },
  { id: "r3", positie: 4, label: "Workshopronde 3", begin: "13:00:00", eind: "14:00:00", pauze: false },
];

const groepen = [
  { id: "g1", naam: "1 HAVO", positie: 1, aantal: 28 },
  { id: "g2", naam: "1 VWO", positie: 2, aantal: 26 },
  { id: "g3", naam: "2 HAVO", positie: 3, aantal: 27 },
  { id: "g4", naam: "2 VWO", positie: 4, aantal: 25 },
];

function uitvoering(
  workshopId: string,
  rondeId: string,
  opties: Partial<UitvoeringRegel> = {},
): UitvoeringRegel {
  const maximum = opties.maximum ?? 25;
  const bezet = opties.bezet ?? 0;
  return {
    id: `${workshopId}-${rondeId}${opties.label ? "-b" : ""}`,
    rondeId,
    workshopId,
    label: null,
    maximum,
    ruimte: null,
    docent: null,
    actief: true,
    bezet,
    vrij: Math.max(maximum - bezet, 0),
    klassen: [],
    ...opties,
  };
}

const geenApp = {
  appNodig: false,
  appNaam: null,
  android: null,
  ios: null,
  web: null,
  appUitleg: null,
  spullen: null,
};

const workshops = [
  {
    ...geenApp,
    id: "drums",
    naam: "Workshop Ghetto Drums",
    standaardMaximum: 25,
    positie: 1,
    uitvoeringen: [
      uitvoering("drums", "r1", { bezet: 25, klassen: ["g1"], ruimte: "Aula" }),
      uitvoering("drums", "r2", { bezet: 18, ruimte: "Aula" }),
      uitvoering("drums", "r3", { bezet: 4, klassen: ["g4"], ruimte: "Aula" }),
    ],
  },
  {
    ...geenApp,
    id: "dj",
    naam: "Workshop DJ Skills",
    standaardMaximum: 15,
    positie: 2,
    uitvoeringen: [
      uitvoering("dj", "r1", { maximum: 15, bezet: 13, klassen: ["g1", "g2", "g3"], ruimte: "Lokaal 1.04" }),
      uitvoering("dj", "r2", { maximum: 15, bezet: 9, klassen: ["g2"], ruimte: "Lokaal 1.04" }),
      uitvoering("dj", "r3", { maximum: 15, bezet: 2, ruimte: "Lokaal 1.04" }),
    ],
  },
  {
    ...geenApp,
    id: "hiphop",
    naam: "Workshop Hiphop",
    standaardMaximum: 30,
    positie: 3,
    uitvoeringen: [
      uitvoering("hiphop", "r1", { maximum: 30, bezet: 22, ruimte: "Gymzaal", docent: "Dathen" }),
      uitvoering("hiphop", "r2", { maximum: 30, bezet: 24, klassen: ["g1", "g3"], ruimte: "Gymzaal" }),
      uitvoering("hiphop", "r2", {
        label: "Groep B",
        maximum: 20,
        bezet: 7,
        ruimte: "Danszaal",
        docent: "Iris",
      }),
      uitvoering("hiphop", "r3", { maximum: 30, bezet: 11, ruimte: "Gymzaal" }),
    ],
  },
  {
    // Een workshop met een app, zodat die velden ook in beeld komen.
    appNodig: true,
    appNaam: "CapCut",
    android: "https://play.google.com/store/apps/details?id=com.lemon.lvoverseas",
    ios: "https://apps.apple.com/nl/app/capcut-video-editor/id1500855883",
    web: null,
    appUitleg: "Installeer de app voor de workshop begint en maak een account aan.",
    spullen: "Oude kleren",
    id: "graffiti",
    naam: "Workshop Graffiti",
    standaardMaximum: 25,
    positie: 4,
    uitvoeringen: [
      uitvoering("graffiti", "r1", { bezet: 20, klassen: ["g3", "g4"], ruimte: "Buiten" }),
      uitvoering("graffiti", "r2", { bezet: 25, ruimte: "Buiten" }),
      uitvoering("graffiti", "r3", { actief: false, klassen: ["g1"], ruimte: "Buiten" }),
    ],
  },
];

const zonderControle = {
  dag: {
    id: "dag-1",
    organization_id: "org-1",
    booking_id: null,
    name: "Cultuurdag",
    event_date: "2027-05-31",
    location: "Breda",
    audience: "school" as const,
    status: "open" as const,
    slug: "cultuurdag-2027-05-31-a71f3c9d",
    opens_at: "2027-05-01T08:00:00.000Z",
    closes_at: "2027-05-28T23:59:00.000Z",
    allow_repeat: false,
    access_mode: "code" as const,
    contact_name: "Heleen Nijveld",
    contact_email: "h.nijveld@voorbeeld.nl",
    purge_after: null,
    note: "Twee ruimtes buiten, bij regen alles in de aula.",
    created_by: null,
    created_at: "2027-04-20T10:00:00.000Z",
    updated_at: "2027-04-20T10:00:00.000Z",
  },
  organisatieNaam: "Scholengemeenschap De Rotonde",
  rondes,
  groepen,
  workshops,
  aantalWorkshopRondes: rondes.filter((ronde) => !ronde.pauze).length,
  aantalDeelnemers: 106,
  aantalKlaar: 71,
  aantalNietBegonnen: 19,
};

const detail: DagDetail = {
  ...zonderControle,
  waarschuwingen: controleerRooster({
    rondes: rondes.map((ronde) => ({ id: ronde.id, label: ronde.label, pauze: ronde.pauze })),
    groepen,
    workshops: workshops.map((workshop) => ({
      id: workshop.id,
      naam: workshop.naam,
      uitvoeringen: workshop.uitvoeringen,
    })),
    herhalingToegestaan: false,
  }),
};

const extra: DagExtra = {
  inschrijflink: "https://mijn.skoolworkshop.nl/inschrijven/cultuurdag-2027-05-31-a71f3c9d",
  ontvanger: { naam: "Heleen Nijveld", email: "h.nijveld@voorbeeld.nl", bron: "dag" },
  ontbrekend: {
    nietIngedeeld: [
      { naam: "Anne-Marie de Jong", klas: "1 HAVO", rondes: ["Workshopronde 3"] },
      { naam: "Tim van 't Hof", klas: "2 HAVO", rondes: ["Workshopronde 2", "Workshopronde 3"] },
    ],
    vrijgesteld: [{ naam: "Ilse Mooren-Verstegen", klas: "2 VWO" }],
    teVol: [],
    leeg: [{ workshop: "Workshop Graffiti", ronde: "Workshopronde 3" }],
  },
  toegangen: [
    {
      id: "t1",
      label: "Heleen Nijveld",
      expires_at: "2027-06-30T00:00:00.000Z",
      revoked_at: null,
      last_seen_at: "2027-05-20T10:00:00.000Z",
      verlopen: false,
    },
  ],
  verzendingen: [
    {
      id: "v1",
      to_email: "h.nijveld@voorbeeld.nl",
      to_name: "Heleen Nijveld",
      formats: ["klassen-xlsx", "workshops-xlsx"],
      sent_at: "2027-05-21T09:12:00.000Z",
    },
  ],
};

/*
  Een verzonnen lijst in de vorm die scholen echt aanleveren: een titelregel,
  de kopregel op regel twee, lege kolommen ertussen, en zowel een kolom
  Leerjaar als een kolom Klas. Zo is het voorbeeldscherm ook op 390 pixels te
  bekijken zonder dat er een bestand gekozen hoeft te worden.
*/
const VOORBEELD_LIJST = [
  ["Overzicht leerlingen 2026-2027"],
  ["", "Voornaam", "", "Achternaam", "Leerjaar", "", "Klas", "", "Mentoren"],
  ["", "Sanne", "", "Bakker", "1", "", "A1BK1", "", "a1bk1"],
  ["", "Daan", "", "Vloot, van der", "1", "", "A1BK1", "", "a1km1"],
  ["", "Noor", "", "Visser", "1", "", "A1KM1", "", "a1km2"],
  ["", "Bram", "", "Beek, van", "1", "", "A1KM1", ""],
  ["", "Esmée", "", "Kuipers", "2", "", "B2K1", ""],
  ["", "Tim", "", "Hendriks", "2", "", "B2K1", ""],
  ["", "Lotte", "", "Jong, de", "2", "", "B2K2", ""],
  ["", "", "", "", "", "", "", ""],
]
  .map((rij) => rij.join("\t"))
  .join("\n");

const voorbeeldLezing = leesLijst(VOORBEELD_LIJST);

export function Harness() {
  return (
    <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6">
      <DagScherm detail={detail} extra={extra} />

      <section className="mt-8">
        <h2 className="mb-3 text-[22px]">Voorbeeld van een ingelezen lijst</h2>
        <LijstVoorbeeld
          lezing={voorbeeldLezing}
          overzicht={maakOverzicht(voorbeeldLezing)}
          woorden={{ groep: "klas", groepen: "klassen", deelnemer: "leerling", deelnemers: "leerlingen" }}
          nieuweGroepen={["A1BK1", "A1KM1", "B2K1", "B2K2"]}
          meerBladen={false}
          kolommen={voorbeeldLezing.kolommen}
          onKolom={() => {}}
        />
      </section>
    </main>
  );
}
