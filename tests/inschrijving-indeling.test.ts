import { describe, expect, it } from "vitest";

import {
  maakIndeling,
  type IndelingDeelnemer,
  type IndelingInvoer,
  type IndelingUitvoering,
} from "@/lib/inschrijving/indeling";

/**
 * De cultuurdag waar het echt om gaat: 8 klassen, 12 workshops, 4 rondes.
 *
 * 8 klassen van 25 leerlingen is 200 kinderen. Met 12 workshops van 25 plekken
 * in 4 rondes zijn er 300 plekken per ronde, dus het past, maar niet ruim.
 */
const KLASSEN = ["1 HAVO", "1 VWO", "2 HAVO", "2 VWO", "3 HAVO", "3 VWO", "4 HAVO", "4 VWO"];
const WORKSHOPS = [
  "Ghetto Drums",
  "DJ Skills",
  "Hiphop",
  "Graffiti",
  "Vloggen",
  "Podcast",
  "Breakdance",
  "Stage Fighting",
  "Freerunning",
  "Fotografie",
  "Rap",
  "Stop Motion",
];

function school(opties: {
  perKlas?: number;
  rondes?: number;
  maximum?: number;
  herhaling?: boolean;
} = {}): IndelingInvoer {
  const perKlas = opties.perKlas ?? 25;
  const aantalRondes = opties.rondes ?? 4;
  const maximum = opties.maximum ?? 25;

  const rondes = Array.from({ length: aantalRondes }, (_, i) => ({
    id: `r${i + 1}`,
    label: `Workshopronde ${i + 1}`,
    pauze: false,
  }));

  const uitvoeringen: IndelingUitvoering[] = [];
  for (const ronde of rondes) {
    for (const [index, naam] of WORKSHOPS.entries()) {
      uitvoeringen.push({
        id: `${ronde.id}-w${index + 1}`,
        rondeId: ronde.id,
        workshopId: `w${index + 1}`,
        workshopNaam: naam,
        label: null,
        maximum,
        bezet: 0,
        klassen: [],
      });
    }
  }

  const deelnemers: IndelingDeelnemer[] = [];
  for (const [klasIndex, klas] of KLASSEN.entries()) {
    for (let i = 1; i <= perKlas; i += 1) {
      deelnemers.push({
        id: `d-${klasIndex + 1}-${i}`,
        naam: `Leerling ${String(klasIndex + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`,
        groepId: `g${klasIndex + 1}`,
        groepNaam: klas,
        vrijgesteld: false,
        keuzes: {},
      });
    }
  }

  return { rondes, deelnemers, uitvoeringen, herhalingToegestaan: opties.herhaling ?? false };
}

/** Controleert dat een voorstel geen enkele regel overtreedt. */
function controleer(invoer: IndelingInvoer, voorstel: ReturnType<typeof maakIndeling>) {
  const uitvoeringen = new Map(invoer.uitvoeringen.map((u) => [u.id, u]));
  const deelnemers = new Map(invoer.deelnemers.map((d) => [d.id, d]));

  const perSessie = new Map<string, number>();
  for (const uitvoering of invoer.uitvoeringen) perSessie.set(uitvoering.id, uitvoering.bezet);

  const perDeelnemerRonde = new Set<string>();
  const workshopsPerDeelnemer = new Map<string, Set<string>>();
  for (const deelnemer of invoer.deelnemers) {
    const set = new Set<string>();
    for (const [rondeId, sessieId] of Object.entries(deelnemer.keuzes)) {
      perDeelnemerRonde.add(`${deelnemer.id}::${rondeId}`);
      const workshop = uitvoeringen.get(sessieId)?.workshopId;
      if (workshop) set.add(workshop);
    }
    workshopsPerDeelnemer.set(deelnemer.id, set);
  }

  for (const toewijzing of voorstel.toewijzingen) {
    const uitvoering = uitvoeringen.get(toewijzing.sessieId);
    const deelnemer = deelnemers.get(toewijzing.deelnemerId);
    expect(uitvoering, "uitvoering bestaat").toBeTruthy();
    expect(deelnemer, "deelnemer bestaat").toBeTruthy();
    if (!uitvoering || !deelnemer) continue;

    expect(deelnemer.vrijgesteld, `${deelnemer.naam} is vrijgesteld`).toBe(false);
    expect(uitvoering.rondeId).toBe(toewijzing.rondeId);

    if (uitvoering.klassen.length > 0) {
      expect(uitvoering.klassen, `${deelnemer.naam} mag hier niet in`).toContain(deelnemer.groepId);
    }

    const sleutel = `${toewijzing.deelnemerId}::${toewijzing.rondeId}`;
    expect(perDeelnemerRonde.has(sleutel), "twee workshops in dezelfde ronde").toBe(false);
    perDeelnemerRonde.add(sleutel);

    const gehad = workshopsPerDeelnemer.get(deelnemer.id) ?? new Set<string>();
    if (!invoer.herhalingToegestaan) {
      expect(gehad.has(uitvoering.workshopId), `${deelnemer.naam} krijgt dezelfde workshop twee keer`).toBe(false);
    }
    gehad.add(uitvoering.workshopId);
    workshopsPerDeelnemer.set(deelnemer.id, gehad);

    const nieuw = (perSessie.get(uitvoering.id) ?? 0) + 1;
    expect(nieuw, `${uitvoering.workshopNaam} gaat over het maximum`).toBeLessThanOrEqual(uitvoering.maximum);
    perSessie.set(uitvoering.id, nieuw);
  }
}

describe("een hele cultuurdag indelen", () => {
  it("deelt 200 leerlingen in over 4 rondes zonder een regel te breken", () => {
    const invoer = school();
    const voorstel = maakIndeling(invoer);

    expect(voorstel.aantalMetGat).toBe(200);
    expect(voorstel.toewijzingen).toHaveLength(800);
    expect(voorstel.nietGelukt).toEqual([]);
    expect(voorstel.aantalCompleet).toBe(200);
    controleer(invoer, voorstel);
  });

  it("laat bestaande keuzes staan en vult alleen de gaten", () => {
    const invoer = school();
    // De helft heeft ronde 1 al zelf gekozen.
    for (const [index, deelnemer] of invoer.deelnemers.entries()) {
      if (index % 2 === 0) deelnemer.keuzes.r1 = `r1-w${(index % 12) + 1}`;
    }
    const alGekozen = invoer.deelnemers.filter((d) => d.keuzes.r1).map((d) => [d.id, d.keuzes.r1] as const);

    const voorstel = maakIndeling(invoer);

    // Geen enkele bestaande keuze is aangeraakt.
    for (const [id, sessie] of alGekozen) {
      const toewijzing = voorstel.toewijzingen.find((t) => t.deelnemerId === id && t.rondeId === "r1");
      expect(toewijzing, "bestaande keuze opnieuw ingedeeld").toBeUndefined();
      expect(invoer.deelnemers.find((d) => d.id === id)?.keuzes.r1).toBe(sessie);
    }
    expect(voorstel.toewijzingen).toHaveLength(800 - alGekozen.length);
    controleer(invoer, voorstel);
  });

  it("verdeelt gelijkmatig in plaats van alles in dezelfde workshop te proppen", () => {
    const voorstel = maakIndeling(school());
    const perRonde1 = voorstel.ruimte.filter((regel) => regel.rondeLabel === "Workshopronde 1");
    const aantallen = perRonde1.map((regel) => regel.bezetNa);
    // 200 leerlingen over 12 workshops is gemiddeld 17. Niets mag daar ver
    // vanaf liggen; een verschil van meer dan twee is al scheef.
    expect(Math.max(...aantallen) - Math.min(...aantallen)).toBeLessThanOrEqual(2);
  });

  it("slaat vrijgestelde leerlingen over", () => {
    const invoer = school();
    for (const deelnemer of invoer.deelnemers.slice(0, 10)) deelnemer.vrijgesteld = true;

    const voorstel = maakIndeling(invoer);
    const vrijgesteld = new Set(invoer.deelnemers.filter((d) => d.vrijgesteld).map((d) => d.id));

    expect(voorstel.aantalVrijgesteld).toBe(10);
    expect(voorstel.toewijzingen.some((t) => vrijgesteld.has(t.deelnemerId))).toBe(false);
    // 190 leerlingen die wel meedoen, keer vier rondes.
    expect(voorstel.toewijzingen).toHaveLength(760);
    expect(voorstel.aantalCompleet).toBe(190);
    controleer(invoer, voorstel);
  });

  it("slaat pauzerondes over", () => {
    const invoer = school({ rondes: 3 });
    invoer.rondes.splice(1, 0, { id: "pauze", label: "Pauze", pauze: true });

    const voorstel = maakIndeling(invoer);
    expect(voorstel.toewijzingen.some((t) => t.rondeId === "pauze")).toBe(false);
    expect(voorstel.toewijzingen).toHaveLength(600);
  });
});

describe("als het niet past", () => {
  it("meldt per leerling waarom het niet lukte", () => {
    const invoer = school({ perKlas: 25, rondes: 1, maximum: 10 });
    const voorstel = maakIndeling(invoer);

    // 200 leerlingen, 12 workshops van 10 = 120 plekken.
    expect(voorstel.toewijzingen).toHaveLength(120);
    expect(voorstel.nietGelukt).toHaveLength(80);
    expect(voorstel.nietGelukt[0].reden).toBe("alle workshops in deze ronde zitten vol");
    controleer(invoer, voorstel);
  });

  it("meldt het als er voor een klas niets draait", () => {
    const invoer = school({ perKlas: 2, rondes: 1 });
    for (const uitvoering of invoer.uitvoeringen) uitvoering.klassen = ["g1"];

    const voorstel = maakIndeling(invoer);
    const buiten = voorstel.nietGelukt.filter((regel) => regel.groepNaam !== "1 HAVO");
    expect(buiten).toHaveLength(14);
    expect(buiten[0].reden).toContain("geen workshop voor");
  });

  it("meldt het als alle overgebleven workshops al gehad zijn", () => {
    const invoer: IndelingInvoer = {
      rondes: [
        { id: "r1", label: "Ronde 1", pauze: false },
        { id: "r2", label: "Ronde 2", pauze: false },
      ],
      herhalingToegestaan: false,
      uitvoeringen: [
        {
          id: "s1",
          rondeId: "r1",
          workshopId: "w1",
          workshopNaam: "Hiphop",
          label: null,
          maximum: 5,
          bezet: 0,
          klassen: [],
        },
        {
          id: "s2",
          rondeId: "r2",
          workshopId: "w1",
          workshopNaam: "Hiphop",
          label: null,
          maximum: 5,
          bezet: 0,
          klassen: [],
        },
      ],
      deelnemers: [
        {
          id: "d1",
          naam: "Lissa van der Velde",
          groepId: "g1",
          groepNaam: "1 HAVO",
          vrijgesteld: false,
          keuzes: {},
        },
      ],
    };

    const voorstel = maakIndeling(invoer);
    expect(voorstel.toewijzingen).toHaveLength(1);
    expect(voorstel.nietGelukt).toHaveLength(1);
    expect(voorstel.nietGelukt[0].reden).toBe("alle overgebleven workshops heeft deze leerling al gehad");
  });

  it("lukt datzelfde wel als herhaling aan staat", () => {
    const invoer: IndelingInvoer = {
      rondes: [
        { id: "r1", label: "Ronde 1", pauze: false },
        { id: "r2", label: "Ronde 2", pauze: false },
      ],
      herhalingToegestaan: true,
      uitvoeringen: [
        { id: "s1", rondeId: "r1", workshopId: "w1", workshopNaam: "Hiphop", label: null, maximum: 5, bezet: 0, klassen: [] },
        { id: "s2", rondeId: "r2", workshopId: "w1", workshopNaam: "Hiphop", label: null, maximum: 5, bezet: 0, klassen: [] },
      ],
      deelnemers: [
        { id: "d1", naam: "Lissa", groepId: "g1", groepNaam: "1 HAVO", vrijgesteld: false, keuzes: {} },
      ],
    };

    const voorstel = maakIndeling(invoer);
    expect(voorstel.toewijzingen).toHaveLength(2);
    expect(voorstel.nietGelukt).toEqual([]);
  });
});

describe("krapte eerst", () => {
  it("geeft de enige plek aan de leerling die niets anders kan", () => {
    const invoer: IndelingInvoer = {
      rondes: [{ id: "r1", label: "Ronde 1", pauze: false }],
      herhalingToegestaan: false,
      uitvoeringen: [
        // Alleen 2 VWO mag hier in, en er is één plek.
        { id: "krap", rondeId: "r1", workshopId: "w1", workshopNaam: "Graffiti", label: null, maximum: 1, bezet: 0, klassen: ["g2"] },
        // Hier mag iedereen in.
        { id: "ruim", rondeId: "r1", workshopId: "w2", workshopNaam: "Hiphop", label: null, maximum: 10, bezet: 0, klassen: [] },
      ],
      deelnemers: [
        { id: "d1", naam: "Aaa Eerste", groepId: "g1", groepNaam: "1 HAVO", vrijgesteld: false, keuzes: {} },
        { id: "d2", naam: "Zzz Laatste", groepId: "g2", groepNaam: "2 VWO", vrijgesteld: false, keuzes: {} },
      ],
    };

    const voorstel = maakIndeling(invoer);
    expect(voorstel.nietGelukt).toEqual([]);
    // De leerling uit 1 HAVO kan alleen bij Hiphop; die van 2 VWO kan beide,
    // maar krijgt niet zomaar de enige plek van Graffiti ingepikt.
    const eerste = voorstel.toewijzingen.find((t) => t.deelnemerId === "d1");
    expect(eerste?.workshopNaam).toBe("Hiphop");
  });

  it("geeft bij dezelfde invoer altijd dezelfde uitkomst", () => {
    const een = maakIndeling(school({ perKlas: 5 }));
    const twee = maakIndeling(school({ perKlas: 5 }));
    expect(JSON.stringify(een.toewijzingen)).toBe(JSON.stringify(twee.toewijzingen));
  });

  it("laat de invoer ongemoeid", () => {
    const invoer = school({ perKlas: 3 });
    const voor = JSON.stringify(invoer.deelnemers);
    maakIndeling(invoer);
    expect(JSON.stringify(invoer.deelnemers)).toBe(voor);
  });
});
