/**
 * Het rooster nakijken voordat de inschrijving opengaat.
 *
 * WAAROM DIT APART STAAT
 *
 *   Dit rekent alleen. Het praat niet met de database en het verandert niets.
 *   Daardoor is het te testen met verzonnen roosters, en dat is precies wat je
 *   wilt bij regels als "heeft 2 VWO in ronde 3 nog wel ergens plek".
 *
 * WAT HET CONTROLEERT
 *
 *   Een blokkade is iets waardoor een leerling straks vastloopt. Daar gaat de
 *   inschrijving niet mee open.
 *
 *   Een waarschuwing is iets wat waarschijnlijk niet de bedoeling is, maar wat
 *   best mag. Die houdt niets tegen.
 */

export interface RoosterRonde {
  id: string;
  label: string;
  /**
   * Een pauze staat wel op het rooster, maar er valt niets te kiezen.
   *
   * Zonder dit werd de lunchpauze als workshopronde nagekeken, en kreeg je
   * negentien keer "A1BK1 kan in Pauze (lunch) niets kiezen". Dat klopte ook:
   * er draait niets in de pauze, want dat is het idee van een pauze.
   */
  pauze?: boolean;
}

export interface RoosterGroep {
  id: string;
  naam: string;
  aantal: number;
}

export interface RoosterUitvoering {
  id: string;
  rondeId: string;
  workshopId: string;
  actief: boolean;
  maximum: number;
  bezet: number;
  /** Lege lijst betekent: alle klassen mogen erin. */
  klassen: string[];
}

export interface RoosterWorkshop {
  id: string;
  naam: string;
  uitvoeringen: RoosterUitvoering[];
}

export interface Rooster {
  rondes: RoosterRonde[];
  groepen: RoosterGroep[];
  workshops: RoosterWorkshop[];
  /** Mag dezelfde workshop in meerdere rondes gekozen worden? */
  herhalingToegestaan: boolean;
}

export type WaarschuwingSoort = "blokkade" | "let op";

export interface Waarschuwing {
  soort: WaarschuwingSoort;
  tekst: string;
}

/** Mag deze klas in deze uitvoering? Geen klassen aangevinkt is iedereen. */
export function magErin(uitvoering: RoosterUitvoering, groepId: string): boolean {
  return uitvoering.klassen.length === 0 || uitvoering.klassen.includes(groepId);
}

/** Alle uitvoeringen die deze klas in deze ronde kan kiezen. */
export function keuzesVoor(rooster: Rooster, groepId: string, rondeId: string): RoosterUitvoering[] {
  return rooster.workshops.flatMap((workshop) =>
    workshop.uitvoeringen.filter(
      (uitvoering) => uitvoering.actief && uitvoering.rondeId === rondeId && magErin(uitvoering, groepId),
    ),
  );
}

export function controleerRooster(rooster: Rooster): Waarschuwing[] {
  const waarschuwingen: Waarschuwing[] = [];

  /*
    Alleen de rondes waarin echt gekozen wordt.

    Een pauze doet nergens aan mee: niet aan capaciteit, niet aan "kan deze
    klas hier iets kiezen", en niet aan het aantal verschillende workshops dat
    een klas nodig heeft. Dat filter staat hier bovenaan zodat het voor elke
    regel hieronder geldt, ook voor regels die later worden toegevoegd.
  */
  const rondes = rooster.rondes.filter((ronde) => !ronde.pauze);

  if (rondes.length === 0) {
    waarschuwingen.push({
      soort: "blokkade",
      tekst:
        rooster.rondes.length === 0
          ? "Er is nog geen enkele ronde."
          : "Er staan alleen pauzes op het rooster. Zet er minstens één workshopronde bij.",
    });
    return waarschuwingen;
  }

  if (rooster.groepen.length === 0) {
    waarschuwingen.push({ soort: "blokkade", tekst: "Er is nog geen enkele klas of groep." });
    return waarschuwingen;
  }

  // Een ronde waarin helemaal niets draait.
  for (const ronde of rondes) {
    const draaien = rooster.workshops.flatMap((workshop) =>
      workshop.uitvoeringen.filter((uitvoering) => uitvoering.actief && uitvoering.rondeId === ronde.id),
    );
    if (draaien.length === 0) {
      waarschuwingen.push({ soort: "blokkade", tekst: `In ${ronde.label} draait geen enkele workshop.` });
    }
  }

  // Een workshop die nergens aan staat.
  for (const workshop of rooster.workshops) {
    if (!workshop.uitvoeringen.some((uitvoering) => uitvoering.actief)) {
      waarschuwingen.push({
        soort: "let op",
        tekst: `${workshop.naam} staat in geen enkele ronde aan.`,
      });
    }
  }

  // Per klas, per ronde: kan iedereen uit die klas ergens terecht?
  for (const groep of rooster.groepen) {
    for (const ronde of rondes) {
      const keuzes = keuzesVoor(rooster, groep.id, ronde.id);

      if (keuzes.length === 0) {
        waarschuwingen.push({
          soort: "blokkade",
          tekst: `${groep.naam} kan in ${ronde.label} niets kiezen.`,
        });
        continue;
      }

      if (groep.aantal === 0) continue;

      // Plekken die deze klas nog kan pakken. Wie er al in zit telt niet mee,
      // ongeacht uit welke klas die komt: die plek is bezet.
      const vrij = keuzes.reduce((som, uitvoering) => som + Math.max(uitvoering.maximum - uitvoering.bezet, 0), 0);
      const nogTeKiezen = groep.aantal - keuzes.reduce((som, uitvoering) => som + uitvoering.bezet, 0);

      if (vrij < Math.max(nogTeKiezen, 0)) {
        waarschuwingen.push({
          soort: "blokkade",
          tekst: `${groep.naam} heeft in ${ronde.label} ${vrij} ${
            vrij === 1 ? "vrije plek" : "vrije plekken"
          } voor ${Math.max(nogTeKiezen, 0)} ${nogTeKiezen === 1 ? "leerling" : "leerlingen"}.`,
        });
      }
    }
  }

  // Met herhaling uit heeft een klas minstens zoveel verschillende workshops
  // nodig als er rondes zijn, anders loopt iemand in de laatste ronde vast.
  if (!rooster.herhalingToegestaan) {
    for (const groep of rooster.groepen) {
      const bereikbaar = new Set<string>();
      for (const ronde of rondes) {
        for (const uitvoering of keuzesVoor(rooster, groep.id, ronde.id)) {
          bereikbaar.add(uitvoering.workshopId);
        }
      }
      if (bereikbaar.size > 0 && bereikbaar.size < rondes.length) {
        waarschuwingen.push({
          soort: "blokkade",
          tekst: `${groep.naam} kan maar ${bereikbaar.size} verschillende ${
            bereikbaar.size === 1 ? "workshop" : "workshops"
          } kiezen voor ${rondes.length} rondes, en dezelfde workshop mag niet twee keer.`,
        });
      }
    }
  }

  return waarschuwingen;
}

/** Alleen de blokkades, voor het moment dat de inschrijving opengaat. */
export function blokkades(rooster: Rooster): Waarschuwing[] {
  return controleerRooster(rooster).filter((waarschuwing) => waarschuwing.soort === "blokkade");
}

/**
 * Wie raakt een wijziging?
 *
 * Voordat klassen bij een uitvoering worden ingeperkt, wordt gekeken wie er al
 * in zit en straks niet meer zou mogen. Die leerlingen worden nooit
 * weggehaald; ze worden alleen genoemd, zodat jij beslist.
 */
export function geraaktDoorKlasbeperking(
  deelnemers: { naam: string; groepId: string }[],
  nieuweKlassen: string[],
): string[] {
  if (nieuweKlassen.length === 0) return [];
  return deelnemers.filter((deelnemer) => !nieuweKlassen.includes(deelnemer.groepId)).map((deelnemer) => deelnemer.naam);
}
