/**
 * Het dagrooster uitrekenen.
 *
 * WAT HIER WEGGAAT
 *
 *   Vijf keer een begin- en eindtijd intypen, en dan zelf uitrekenen hoe laat
 *   ronde 3 begint als de tweede pauze een kwartier is. Dat is precies het
 *   soort rekenwerk waar een fout in sluipt die je pas op de dag zelf merkt.
 *
 *   Je geeft het aantal rondes, hoe laat de eerste begint, hoe lang een ronde
 *   duurt en hoeveel pauze ertussen zit. De rest volgt daaruit.
 *
 * DE PAUZE STAAT OP HET ROOSTER
 *
 *   Een pauze tussen twee rondes wordt een eigen regel, met kind 'pauze'. Dan
 *   klopt het rooster dat de school uitprint, ziet een leerling waar hij aan
 *   toe is, en valt er in die regel niets te kiezen. Dat laatste zit in de
 *   database, niet hier.
 *
 * DIT REKENT ALLEEN
 *
 *   Geen database. Daardoor te testen zonder iets aan te maken, en daardoor
 *   kan het scherm precies hetzelfde rooster laten zien als wat er straks
 *   wordt opgeslagen.
 */

export interface RoosterRegel {
  label: string;
  /** Altijd uu:mm, 24-uurs. */
  begin: string;
  eind: string;
  pauze: boolean;
}

export interface RoosterInvoer {
  aantal: number;
  /** Hoe laat de eerste ronde begint, als uu:mm. */
  start: string;
  duurMinuten: number;
  pauzeMinuten: number;
  /**
   * Een langere pauze na een bepaalde ronde, bijvoorbeeld de lunch na ronde 2.
   * Leeg betekent: overal dezelfde pauze.
   */
  langePauzeNa?: number | null;
  langePauzeMinuten?: number | null;
  /** Hoe de rondes gaan heten. Het nummer komt er vanzelf achter. */
  naam?: string;
}

export interface Rooster {
  regels: RoosterRegel[];
  fouten: string[];
  /** Hoe laat de dag klaar is. Leeg als er niets te berekenen viel. */
  eindtijd: string | null;
}

const TIJD = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function naarMinuten(tijd: string): number | null {
  const treffer = TIJD.exec(tijd.trim());
  if (!treffer) return null;
  return Number(treffer[1]) * 60 + Number(treffer[2]);
}

export function naarTijd(minuten: number): string {
  const uren = Math.floor(minuten / 60);
  const rest = minuten % 60;
  return `${String(uren).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/**
 * Het rooster uitrekenen.
 *
 * Alles wat niet klopt komt terug in `fouten`, en dan is `regels` leeg. Er
 * wordt dus nooit een half rooster getoond waar je overheen kunt lezen.
 */
export function maakRooster(invoer: RoosterInvoer): Rooster {
  const fouten: string[] = [];

  const aantal = Math.trunc(invoer.aantal);
  if (!Number.isFinite(aantal) || aantal < 1) fouten.push("Kies minstens één ronde.");
  if (aantal > 10) fouten.push("Tien rondes is het maximum.");

  const start = naarMinuten(invoer.start);
  if (start === null) fouten.push("Vul een begintijd in, bijvoorbeeld 09:15.");

  const duur = Math.trunc(invoer.duurMinuten);
  if (!Number.isFinite(duur) || duur < 15) fouten.push("Een ronde duurt minstens 15 minuten.");
  if (duur > 240) fouten.push("Een ronde van meer dan vier uur klopt waarschijnlijk niet.");

  const pauze = Math.trunc(invoer.pauzeMinuten);
  if (!Number.isFinite(pauze) || pauze < 0) fouten.push("Een pauze kan niet negatief zijn.");
  if (pauze > 120) fouten.push("Een pauze van meer dan twee uur klopt waarschijnlijk niet.");

  const langePauzeNa = invoer.langePauzeNa ?? null;
  const langePauze = invoer.langePauzeMinuten ?? null;
  if (langePauzeNa !== null) {
    if (langePauzeNa < 1 || langePauzeNa >= aantal) {
      fouten.push("De lange pauze moet na een ronde vallen die er ook is.");
    }
    if (langePauze === null || langePauze < 1 || langePauze > 240) {
      fouten.push("Vul in hoe lang de lange pauze duurt.");
    }
  }

  if (fouten.length > 0 || start === null) return { regels: [], fouten, eindtijd: null };

  const naam = (invoer.naam ?? "Workshopronde").trim() || "Workshopronde";
  const regels: RoosterRegel[] = [];
  let wijzer = start;

  for (let nummer = 1; nummer <= aantal; nummer += 1) {
    regels.push({
      label: `${naam} ${nummer}`,
      begin: naarTijd(wijzer),
      eind: naarTijd(wijzer + duur),
      pauze: false,
    });
    wijzer += duur;

    if (nummer === aantal) break;

    const dezePauze = langePauzeNa === nummer && langePauze !== null ? langePauze : pauze;
    if (dezePauze > 0) {
      regels.push({
        // Een lange pauze midden op de dag heet bij vrijwel elke school lunch.
        label: dezePauze >= 30 ? "Pauze (lunch)" : "Pauze",
        begin: naarTijd(wijzer),
        eind: naarTijd(wijzer + dezePauze),
        pauze: true,
      });
      wijzer += dezePauze;
    }
  }

  if (wijzer > 24 * 60) {
    return {
      regels: [],
      fouten: ["Met deze tijden loopt de dag door tot na middernacht. Kijk de duur of de starttijd na."],
      eindtijd: null,
    };
  }

  return { regels, fouten: [], eindtijd: naarTijd(wijzer) };
}

export interface TijdProbleem {
  regel: number;
  tekst: string;
}

/**
 * Een rooster nakijken, ook als de tijden met de hand zijn aangepast.
 *
 * Een school schuift er altijd iets in: ronde 3 een kwartier later omdat de
 * gymzaal pas om half twee vrij is. Dat mag, maar dan moet er wel iemand
 * zeggen dat ronde 2 en 3 nu over elkaar heen vallen.
 */
export function controleerTijden(regels: RoosterRegel[]): TijdProbleem[] {
  const problemen: TijdProbleem[] = [];

  regels.forEach((regel, index) => {
    const begin = naarMinuten(regel.begin);
    const eind = naarMinuten(regel.eind);

    if (begin === null || eind === null) {
      problemen.push({ regel: index + 1, tekst: `${regel.label}: de tijd klopt niet. Gebruik uu:mm.` });
      return;
    }
    if (eind <= begin) {
      problemen.push({ regel: index + 1, tekst: `${regel.label}: de eindtijd ligt niet na de begintijd.` });
      return;
    }

    const vorige = regels[index - 1];
    if (!vorige) return;
    const vorigEind = naarMinuten(vorige.eind);
    if (vorigEind !== null && begin < vorigEind) {
      problemen.push({
        regel: index + 1,
        tekst: `${regel.label} begint om ${regel.begin}, terwijl ${vorige.label} pas om ${vorige.eind} klaar is.`,
      });
    }
  });

  return problemen;
}

/** Een korte samenvatting voor op het scherm: "4 rondes van 60 minuten, klaar om 15:15". */
export function vatSamen(rooster: Rooster): string {
  const rondes = rooster.regels.filter((regel) => !regel.pauze);
  if (rondes.length === 0) return "";

  const eerste = naarMinuten(rondes[0].begin);
  const eersteEind = naarMinuten(rondes[0].eind);
  const duur = eerste !== null && eersteEind !== null ? eersteEind - eerste : 0;

  return `${rondes.length} ${rondes.length === 1 ? "ronde" : "rondes"} van ${duur} minuten, van ${rondes[0].begin} tot ${rooster.eindtijd}`;
}
