/**
 * De overige deelnemers indelen.
 *
 * WAT DIT IS
 *
 *   Een berekening, meer niet. Er gaat niets naar de database en er verandert
 *   niets. Wat eruit komt is een voorstel dat eerst op het scherm komt.
 *
 * WIE ER WORDEN INGEDEELD
 *
 *   Iedereen die ergens een gat heeft: wie zich nooit heeft ingeschreven, wie
 *   maar een deel van de rondes heeft gekozen, en wie een keuze had die niet
 *   meer geldig is omdat een uitvoering is uitgezet. Bestaande keuzes blijven
 *   altijd staan.
 *
 * DE VOLGORDE IS DE KERN
 *
 *   Wie de minste mogelijkheden heeft, is als eerste aan de beurt. Een
 *   leerling van 2 VWO die in ronde 3 nog maar bij één workshop terechtkan,
 *   moet die plek krijgen voordat iemand met tien mogelijkheden hem inpikt.
 *   Dat scheelt het verschil tussen iedereen een plek, en achteraf vier
 *   kinderen overhouden.
 *
 *   Binnen een ronde gaat de leerling naar de uitvoering met de meeste ruimte.
 *   Daardoor lopen groepen gelijkmatig vol in plaats van dat de laatste
 *   leerlingen allemaal bij dezelfde workshop belanden.
 *
 * GEEN TOEVAL
 *
 *   Er zit nergens een willekeurige keuze in. Dezelfde invoer geeft altijd
 *   dezelfde uitkomst, en dus is wat je op het scherm ziet precies wat er
 *   wordt opgeslagen.
 */

export interface IndelingRonde {
  id: string;
  label: string;
  pauze: boolean;
}

export interface IndelingUitvoering {
  id: string;
  rondeId: string;
  workshopId: string;
  workshopNaam: string;
  label: string | null;
  maximum: number;
  /** Hoeveel er nu in zitten, inclusief de keuzes die blijven staan. */
  bezet: number;
  /** Lege lijst is alle klassen. */
  klassen: string[];
}

export interface IndelingDeelnemer {
  id: string;
  naam: string;
  groepId: string;
  groepNaam: string;
  vrijgesteld: boolean;
  /** Per ronde de uitvoering die al vaststaat. */
  keuzes: Record<string, string>;
}

export interface IndelingInvoer {
  rondes: IndelingRonde[];
  deelnemers: IndelingDeelnemer[];
  uitvoeringen: IndelingUitvoering[];
  herhalingToegestaan: boolean;
}

export interface Toewijzing {
  deelnemerId: string;
  naam: string;
  groepNaam: string;
  rondeId: string;
  rondeLabel: string;
  sessieId: string;
  workshopNaam: string;
}

export interface NietGelukt {
  deelnemerId: string;
  naam: string;
  groepNaam: string;
  rondeLabel: string;
  reden: string;
}

export interface RuimteRegel {
  sessieId: string;
  rondeLabel: string;
  workshopNaam: string;
  maximum: number;
  bezetVoor: number;
  bezetNa: number;
}

export interface IndelingVoorstel {
  toewijzingen: Toewijzing[];
  nietGelukt: NietGelukt[];
  /** Deelnemers die voor de indeling nog een gat hadden. */
  aantalMetGat: number;
  /** Deelnemers die na de indeling helemaal rond zijn. */
  aantalCompleet: number;
  /** Deelnemers die bewust niet meedoen. */
  aantalVrijgesteld: number;
  ruimte: RuimteRegel[];
}

function magErin(uitvoering: IndelingUitvoering, groepId: string): boolean {
  return uitvoering.klassen.length === 0 || uitvoering.klassen.includes(groepId);
}

interface Gat {
  deelnemer: IndelingDeelnemer;
  ronde: IndelingRonde;
}

export function maakIndeling(invoer: IndelingInvoer): IndelingVoorstel {
  const rondes = invoer.rondes.filter((ronde) => !ronde.pauze);
  const vrij = new Map<string, number>();
  const bezetVoor = new Map<string, number>();
  for (const uitvoering of invoer.uitvoeringen) {
    vrij.set(uitvoering.id, Math.max(uitvoering.maximum - uitvoering.bezet, 0));
    bezetVoor.set(uitvoering.id, uitvoering.bezet);
  }

  const perRonde = new Map<string, IndelingUitvoering[]>();
  for (const uitvoering of invoer.uitvoeringen) {
    const lijst = perRonde.get(uitvoering.rondeId);
    if (lijst) lijst.push(uitvoering);
    else perRonde.set(uitvoering.rondeId, [uitvoering]);
  }

  // Een kopie, zodat de invoer onaangeroerd blijft. Het scherm toont straks
  // het voorstel naast de huidige stand; die twee moeten niet door elkaar
  // gaan lopen doordat deze berekening iets bijwerkt.
  const meedoeners = invoer.deelnemers
    .filter((deelnemer) => !deelnemer.vrijgesteld)
    .map((deelnemer) => ({ ...deelnemer, keuzes: { ...deelnemer.keuzes } }));

  // De workshops die iemand al doet. Met herhaling uit mag dat niet nog eens.
  const gedaan = new Map<string, Set<string>>();
  const sessieNaarWorkshop = new Map(invoer.uitvoeringen.map((u) => [u.id, u.workshopId]));
  for (const deelnemer of meedoeners) {
    const set = new Set<string>();
    for (const sessieId of Object.values(deelnemer.keuzes)) {
      const workshopId = sessieNaarWorkshop.get(sessieId);
      if (workshopId) set.add(workshopId);
    }
    gedaan.set(deelnemer.id, set);
  }

  const gaten: Gat[] = [];
  for (const deelnemer of meedoeners) {
    for (const ronde of rondes) {
      if (!deelnemer.keuzes[ronde.id]) gaten.push({ deelnemer, ronde });
    }
  }

  const deelnemersMetGat = new Set(gaten.map((gat) => gat.deelnemer.id));

  const toewijzingen: Toewijzing[] = [];
  const nietGelukt: NietGelukt[] = [];
  const open = [...gaten];

  /** Wat kan deze deelnemer in deze ronde nog, op dit moment. */
  const mogelijkheden = (gat: Gat): IndelingUitvoering[] => {
    const alGedaan = gedaan.get(gat.deelnemer.id) ?? new Set<string>();
    return (perRonde.get(gat.ronde.id) ?? [])
      .filter((uitvoering) => magErin(uitvoering, gat.deelnemer.groepId))
      .filter((uitvoering) => invoer.herhalingToegestaan || !alGedaan.has(uitvoering.workshopId))
      .filter((uitvoering) => (vrij.get(uitvoering.id) ?? 0) > 0);
  };

  while (open.length > 0) {
    // Het krapste gat eerst. Bij gelijk spel op naam en ronde, zodat dezelfde
    // invoer altijd dezelfde uitkomst geeft.
    let beste = 0;
    let besteAantal = mogelijkheden(open[0]).length;
    for (let i = 1; i < open.length; i += 1) {
      const aantal = mogelijkheden(open[i]).length;
      if (aantal > besteAantal) continue;
      if (
        aantal < besteAantal ||
        open[i].deelnemer.naam.localeCompare(open[beste].deelnemer.naam, "nl") < 0 ||
        (open[i].deelnemer.naam === open[beste].deelnemer.naam &&
          open[i].ronde.label.localeCompare(open[beste].ronde.label, "nl") < 0)
      ) {
        beste = i;
        besteAantal = aantal;
      }
    }

    const gat = open.splice(beste, 1)[0];
    const opties = mogelijkheden(gat);

    if (opties.length === 0) {
      const binnenKlas = (perRonde.get(gat.ronde.id) ?? []).filter((uitvoering) =>
        magErin(uitvoering, gat.deelnemer.groepId),
      );
      const reden =
        binnenKlas.length === 0
          ? `geen workshop voor ${gat.deelnemer.groepNaam} in deze ronde`
          : binnenKlas.every((uitvoering) => (vrij.get(uitvoering.id) ?? 0) <= 0)
            ? "alle workshops in deze ronde zitten vol"
            : "alle overgebleven workshops heeft deze leerling al gehad";

      nietGelukt.push({
        deelnemerId: gat.deelnemer.id,
        naam: gat.deelnemer.naam,
        groepNaam: gat.deelnemer.groepNaam,
        rondeLabel: gat.ronde.label,
        reden,
      });
      continue;
    }

    // De ruimste uitvoering wint, zodat alles gelijkmatig volloopt.
    const keuze = [...opties].sort(
      (a, b) =>
        (vrij.get(b.id) ?? 0) - (vrij.get(a.id) ?? 0) ||
        a.workshopNaam.localeCompare(b.workshopNaam, "nl") ||
        a.id.localeCompare(b.id),
    )[0];

    vrij.set(keuze.id, (vrij.get(keuze.id) ?? 0) - 1);
    gedaan.get(gat.deelnemer.id)?.add(keuze.workshopId);
    gat.deelnemer.keuzes[gat.ronde.id] = keuze.id;

    toewijzingen.push({
      deelnemerId: gat.deelnemer.id,
      naam: gat.deelnemer.naam,
      groepNaam: gat.deelnemer.groepNaam,
      rondeId: gat.ronde.id,
      rondeLabel: gat.ronde.label,
      sessieId: keuze.id,
      workshopNaam: keuze.workshopNaam + (keuze.label ? ` · ${keuze.label}` : ""),
    });
  }

  const compleet = meedoeners.filter((deelnemer) =>
    rondes.every((ronde) => Boolean(deelnemer.keuzes[ronde.id])),
  ).length;

  const rondeLabel = new Map(invoer.rondes.map((ronde) => [ronde.id, ronde.label]));
  const ruimte: RuimteRegel[] = invoer.uitvoeringen
    .map((uitvoering) => ({
      sessieId: uitvoering.id,
      rondeLabel: rondeLabel.get(uitvoering.rondeId) ?? "",
      workshopNaam: uitvoering.workshopNaam + (uitvoering.label ? ` · ${uitvoering.label}` : ""),
      maximum: uitvoering.maximum,
      bezetVoor: bezetVoor.get(uitvoering.id) ?? 0,
      bezetNa: uitvoering.maximum - (vrij.get(uitvoering.id) ?? 0),
    }))
    .sort((a, b) => a.rondeLabel.localeCompare(b.rondeLabel, "nl") || a.workshopNaam.localeCompare(b.workshopNaam, "nl"));

  return {
    toewijzingen,
    nietGelukt,
    aantalMetGat: deelnemersMetGat.size,
    aantalCompleet: compleet,
    aantalVrijgesteld: invoer.deelnemers.length - meedoeners.length,
    ruimte,
  };
}
