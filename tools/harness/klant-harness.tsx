import { CodePoort } from "@/components/indeling/code-poort";
import { IndelingOverzicht } from "@/components/indeling/indeling-overzicht";
import type { KlasLijst, WorkshopLijst } from "@/lib/inschrijving/lijsten";

/**
 * Visuele controle van de omgeving voor de school.
 *
 * Twee schermen onder elkaar: eerst het codeveld dat de school ziet, daarna
 * het overzicht dat erachter zit. Verzonnen gegevens, maar wel een tabel met
 * vier rondes naast elkaar, want dat is waar het op een telefoon spannend
 * wordt.
 */

const rondes = [
  { id: "r1", label: "Workshopronde 1", tijd: "09:15 tot 10:15", pauze: false },
  { id: "r2", label: "Workshopronde 2", tijd: "10:45 tot 11:45", pauze: false },
  { id: "r3", label: "Pauze", tijd: "11:45 tot 12:30", pauze: true },
  { id: "r4", label: "Workshopronde 3", tijd: "13:00 tot 14:00", pauze: false },
];

const klassen: KlasLijst[] = [
  {
    klas: "1 HAVO",
    rondes,
    regels: [
      {
        naam: "Lissa van der Velde",
        vrijgesteld: false,
        perRonde: [
          "Workshop Ghetto Drums (Aula)",
          "Workshop DJ Skills (Lokaal 1.04)",
          "Pauze",
          "Workshop Graffiti (Buiten)",
        ],
      },
      {
        naam: "Jan-Peter Bakker",
        vrijgesteld: false,
        perRonde: ["Workshop Hiphop (Gymzaal)", "Nog niet ingedeeld", "Pauze", "Workshop Ghetto Drums (Aula)"],
      },
      {
        naam: "Ilse Mooren-Verstegen",
        vrijgesteld: true,
        perRonde: ["Vrijgesteld", "Vrijgesteld", "Pauze", "Vrijgesteld"],
      },
    ],
  },
  {
    klas: "2 VWO",
    rondes,
    regels: [
      {
        naam: "Youssef El Amrani",
        vrijgesteld: false,
        perRonde: [
          "Workshop Hiphop · Groep B (Danszaal)",
          "Workshop Graffiti (Buiten)",
          "Pauze",
          "Workshop DJ Skills (Lokaal 1.04)",
        ],
      },
    ],
  },
];

const workshops: WorkshopLijst[] = [
  {
    rondeLabel: "Workshopronde 1",
    tijd: "09:15 tot 10:15",
    workshop: "Workshop Ghetto Drums",
    ruimte: "Aula",
    docent: "Dathen",
    maximum: 25,
    deelnemers: [
      { naam: "Lissa van der Velde", klas: "1 HAVO" },
      { naam: "Fenna de Jong", klas: "1 HAVO" },
      { naam: "Daan Visser", klas: "2 VWO" },
    ],
  },
  {
    rondeLabel: "Workshopronde 1",
    tijd: "09:15 tot 10:15",
    workshop: "Workshop Hiphop · Groep B",
    ruimte: "Danszaal",
    docent: null,
    maximum: 16,
    deelnemers: [{ naam: "Youssef El Amrani", klas: "2 VWO" }],
  },
  {
    rondeLabel: "Workshopronde 3",
    tijd: "13:00 tot 14:00",
    workshop: "Workshop Streetart",
    ruimte: "Buiten",
    docent: null,
    maximum: 20,
    deelnemers: [],
  },
];

async function nietsDoen(): Promise<{ fout?: string }> {
  return {};
}

export function Harness() {
  return (
    <main className="mx-auto max-w-[1100px] space-y-8 px-4 py-8 sm:px-6">
      <div className="max-w-md">
        <CodePoort token="voorbeeldtoken" meldAan={nietsDoen} />
      </div>

      <IndelingOverzicht
        dag={{
          naam: "Cultuurdag",
          datumTekst: "woensdag 31 mei",
          organisatie: "Scholengemeenschap De Rotonde",
          locatie: "Breda",
        }}
        klassen={klassen}
        workshops={workshops}
        aantalOpen={1}
        downloads={[
          { label: "Klassenlijsten (Excel)", href: "#" },
          { label: "Workshoplijsten (Excel)", href: "#" },
          { label: "Klassenlijsten (PDF)", href: "#" },
          { label: "Workshoplijsten (PDF)", href: "#" },
        ]}
      />
    </main>
  );
}
