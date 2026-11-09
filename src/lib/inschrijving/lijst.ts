import { maakSleutels, TUSSENVOEGSELS } from "@/lib/inschrijving/naam";

/**
 * Een leerlingenlijst inlezen zoals een school hem aanlevert.
 *
 * WAT ER BINNENKOMT
 *
 *   Nooit twee keer hetzelfde. De ene school stuurt een Excel met de kolommen
 *   Voornaam, Tussenvoegsel, Achternaam en Klas. De andere plakt twee kolommen
 *   uit een bestaand bestand. Weer een ander heeft puntkomma's omdat Excel in
 *   het Nederlands daarmee opslaat, of tabs omdat het uit Word komt.
 *
 *   Daarom wordt er niets afgedwongen. Het scheidingsteken wordt geraden, de
 *   kopregel wordt herkend als die er is, en als die er niet is wordt er een
 *   verstandige gok gedaan. Wat er uitkomt, laat het scherm eerst zien voordat
 *   er iets wordt opgeslagen.
 *
 * WAT ER NOOIT GEBEURT
 *
 *   Stilzwijgend iets weggooien. Elke regel die niet gebruikt wordt, komt
 *   terug in `problemen` met de reden erbij en het regelnummer. Een lijst van
 *   164 leerlingen waar er 162 van aankomen, zonder dat iemand weet welke twee
 *   ontbreken, is erger dan een foutmelding.
 */

export interface LijstRegel {
  /** Het regelnummer in het bestand, zodat iemand het kan terugvinden. */
  regel: number;
  naam: string;
  groep: string | null;
  email: string | null;
  /**
   * Het leerjaar, als de school dat apart meelevert. Dit is géén klas: een
   * school met 353 leerlingen in 19 klassen heeft maar twee leerjaren.
   */
  leerjaar: string | null;
  /** De losse delen, voor het voorbeeld op het scherm. */
  voornaam?: string;
  achternaam?: string;
}

export interface Probleem {
  regel: number;
  tekst: string;
  reden: string;
  /** Het tabblad waar de regel vandaan komt, bij een werkmap met meerdere. */
  blad?: string;
}

export type KolomSoort =
  | "naam"
  | "voornaam"
  | "tussenvoegsel"
  | "achternaam"
  | "groep"
  | "leerjaar"
  | "email"
  | "onbekend";

/** Hoe de kolomsoorten op het scherm heten. */
export const KOLOM_LABELS: Record<KolomSoort, string> = {
  naam: "Volledige naam",
  voornaam: "Voornaam",
  tussenvoegsel: "Tussenvoegsel",
  achternaam: "Achternaam",
  groep: "Klas",
  leerjaar: "Leerjaar",
  email: "E-mail",
  onbekend: "Niet gebruiken",
};

export interface Lezing {
  regels: LijstRegel[];
  problemen: Probleem[];
  /** Per tabblad hoeveel er bruikbaar was. Leeg bij één lijst. */
  bladen?: { naam: string; aantal: number }[];
  /** Wat er van elke kolom gemaakt is. Dit staat in het voorbeeld op het scherm. */
  kolommen: KolomSoort[];
  /** De teksten uit de kopregel, als die er was. Voor het scherm. */
  kolomTitels?: string[];
  /** De eerste paar regels met gegevens, zodat je ziet wat er in een kolom staat. */
  voorbeeldRijen?: string[][];
  kopregel: boolean;
  scheidteken: ";" | "," | "\t";
}

/*
  De kopregel herkennen.

  LEERJAAR IS GEEN KLAS

    Dit stond hier eerst wel op één hoop, en dat ging mis op een echte lijst:
    353 leerlingen met zowel een kolom Leerjaar als een kolom Klas kwamen
    binnen als twee klassen van 173 en 180. Het waren negentien klassen.
    Leerjaar heeft daarom nu zijn eigen soort en wordt nooit als klas gebruikt.
*/
const KOPPEN: [RegExp, KolomSoort][] = [
  [/^(volledige\s*)?naam$|^leerling(naam)?$|^deelnemer(naam)?$|^naam\s*leerling$/i, "naam"],
  [/^voor\s*na(a)?m$|^voornaam$|^roepnaam$|^first\s*name$/i, "voornaam"],
  [/^tussen\s*voegsel$|^tussenvoegsel$|^voorvoegsel$|^prefix$|^tv$/i, "tussenvoegsel"],
  [/^achter\s*naam$|^achternaam$|^familienaam$|^last\s*name$|^naam\s*\(achter\)$/i, "achternaam"],
  [/^klas$|^groep$|^team$|^klasgroep$|^klas\s*naam$|^groepsnaam$|^stamklas$|^class$/i, "groep"],
  [/^leer\s*jaar$|^jaar$|^jaarlaag$|^leerlaag$|^year$/i, "leerjaar"],
  [/mail/i, "email"],
];

/**
 * Het scheidingsteken raden.
 *
 * Bewust over de eerste tien regels en niet alleen de eerste. Een lijst
 * begint vaak met een titel zoals "Klassenlijst groep 5", en daar staat geen
 * enkel scheidingsteken in. Op die ene regel afgaan levert dan de verkeerde
 * gok op en valt de hele lijst in één kolom.
 */
export function raadScheidteken(tekst: string): ";" | "," | "\t" {
  const regels = tekst
    .split(/\r?\n/)
    .filter((regel) => regel.trim().length > 0)
    .slice(0, 10);

  const tel = (teken: RegExp) => regels.reduce((som, regel) => som + (regel.match(teken) ?? []).length, 0);
  const tellingen: [";" | "," | "\t", number][] = [
    [";", tel(/;/g)],
    ["\t", tel(/\t/g)],
    [",", tel(/,/g)],
  ];
  tellingen.sort((a, b) => b[1] - a[1]);
  return tellingen[0][1] > 0 ? tellingen[0][0] : ";";
}

/**
 * De tekst in cellen hakken, met aanhalingstekens zoals Excel ze schrijft.
 * Een veld tussen aanhalingstekens mag het scheidingsteken en regeleindes
 * bevatten; twee aanhalingstekens achter elkaar zijn er één.
 */
export function leesTabel(tekst: string, scheidteken: string): string[][] {
  const schoon = tekst.replace(/^﻿/, "");
  const rijen: string[][] = [];
  let rij: string[] = [];
  let cel = "";
  let inAanhaling = false;

  for (let i = 0; i < schoon.length; i += 1) {
    const teken = schoon[i];

    if (inAanhaling) {
      if (teken === '"') {
        if (schoon[i + 1] === '"') {
          cel += '"';
          i += 1;
        } else {
          inAanhaling = false;
        }
      } else {
        cel += teken;
      }
      continue;
    }

    if (teken === '"') {
      inAanhaling = true;
    } else if (teken === scheidteken) {
      rij.push(cel);
      cel = "";
    } else if (teken === "\n") {
      rij.push(cel);
      rijen.push(rij);
      rij = [];
      cel = "";
    } else if (teken !== "\r") {
      cel += teken;
    }
  }

  if (cel.length > 0 || rij.length > 0) {
    rij.push(cel);
    rijen.push(rij);
  }

  return rijen.map((regel) => regel.map((waarde) => waarde.trim()));
}

/** Ziet dit eruit als een klas of groep, en niet als een achternaam? */
export function lijktOpGroep(waarde: string): boolean {
  const schoon = waarde.trim();
  if (schoon.length === 0 || schoon.length > 20) return false;
  if (/^(groep|klas|team|jaar)\b/i.test(schoon)) return true;
  // 3A, K3E, 1/2a, 8 of 4havo: een cijfer erin en kort.
  return /\d/.test(schoon) && schoon.length <= 12;
}

function herkenKop(cellen: string[]): KolomSoort[] | null {
  const soorten = cellen.map((cel) => {
    for (const [patroon, soort] of KOPPEN) {
      if (patroon.test(cel.trim())) return soort;
    }
    return "onbekend" as KolomSoort;
  });

  const herkend = soorten.filter((soort) => soort !== "onbekend").length;
  // Eén herkend woord kan toeval zijn; vanaf twee is het echt een kopregel.
  // Bij één kolom is één herkend woord wel genoeg.
  const genoeg = cellen.length === 1 ? herkend >= 1 : herkend >= 2;
  return genoeg ? soorten : null;
}

/**
 * Zonder kopregel moeten we gokken. De gok staat altijd op het scherm, zodat
 * iemand ziet dat kolom 2 als klas is gelezen en niet als achternaam.
 */
function raadKolommen(rijen: string[][]): KolomSoort[] {
  const breedte = Math.max(...rijen.map((rij) => rij.length));
  const kolomLijktGroep = (index: number) => {
    const waarden = rijen.map((rij) => rij[index] ?? "").filter((waarde) => waarde.length > 0);
    if (waarden.length === 0) return false;
    const raak = waarden.filter(lijktOpGroep).length;
    return raak / waarden.length >= 0.8;
  };
  const kolomLijktEmail = (index: number) =>
    rijen.some((rij) => (rij[index] ?? "").includes("@"));

  if (breedte <= 1) return ["naam"];

  const soorten: KolomSoort[] = new Array(breedte).fill("onbekend");
  for (let i = 0; i < breedte; i += 1) {
    if (kolomLijktEmail(i)) soorten[i] = "email";
    else if (kolomLijktGroep(i)) soorten[i] = "groep";
  }

  const over = soorten.map((soort, index) => (soort === "onbekend" ? index : -1)).filter((i) => i >= 0);
  if (over.length === 1) {
    soorten[over[0]] = "naam";
  } else if (over.length === 2) {
    soorten[over[0]] = "voornaam";
    soorten[over[1]] = "achternaam";
  } else if (over.length >= 3) {
    soorten[over[0]] = "voornaam";
    soorten[over[1]] = "tussenvoegsel";
    soorten[over[2]] = "achternaam";
    for (const index of over.slice(3)) soorten[index] = "onbekend";
  }

  return soorten;
}

/**
 * "Vloot, van der" weer tot één achternaam maken.
 *
 * Leerlingvolgsystemen schrijven de achternaam vaak zo, met het tussenvoegsel
 * achter een komma. Alleen omdraaien is niet genoeg: "Cohen, A" is geen
 * tussenvoegsel maar een initiaal, en die hoort achteraan te blijven. Daarom
 * wordt er alleen omgedraaid als wat achter de komma staat ook echt een
 * Nederlands tussenvoegsel is.
 */
export function draaiAchternaamOm(waarde: string): { tussenvoegsel: string; achternaam: string } {
  const schoon = waarde.trim().replace(/\s+/g, " ");
  const komma = schoon.indexOf(",");
  if (komma < 1) return { tussenvoegsel: "", achternaam: schoon };

  const hoofd = schoon.slice(0, komma).trim();
  const staart = schoon.slice(komma + 1).trim();
  if (!hoofd || !staart) return { tussenvoegsel: "", achternaam: schoon };

  const isTussenvoegsel = staart
    .toLowerCase()
    .split(/\s+/)
    .every((woord) => TUSSENVOEGSELS.has(woord));

  return isTussenvoegsel
    ? { tussenvoegsel: staart, achternaam: hoofd }
    : { tussenvoegsel: "", achternaam: `${hoofd} ${staart}` };
}

interface NaamDelen {
  naam: string;
  voornaam: string;
  achternaam: string;
}

function stelNaamSamen(rij: string[], kolommen: KolomSoort[]): NaamDelen {
  const deel = (soort: KolomSoort) => {
    const index = kolommen.indexOf(soort);
    return index >= 0 ? (rij[index] ?? "").trim() : "";
  };

  const heel = deel("naam");
  if (heel) {
    const omgedraaid = draaiAchternaamOm(heel);
    const naam = omgedraaid.tussenvoegsel
      ? `${omgedraaid.tussenvoegsel} ${omgedraaid.achternaam}`.replace(/\s+/g, " ")
      : heel.replace(/\s+/g, " ");
    return { naam, voornaam: "", achternaam: "" };
  }

  const voornaam = deel("voornaam").replace(/\s+/g, " ");
  const losTussenvoegsel = deel("tussenvoegsel").replace(/\s+/g, " ");
  const uitAchternaam = draaiAchternaamOm(deel("achternaam"));
  const tussenvoegsel = [losTussenvoegsel, uitAchternaam.tussenvoegsel].filter(Boolean).join(" ");

  const naam = [voornaam, tussenvoegsel, uitAchternaam.achternaam]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    naam,
    voornaam,
    achternaam: [tussenvoegsel, uitAchternaam.achternaam].filter(Boolean).join(" ").trim(),
  };
}

/**
 * De hele lijst inlezen.
 *
 * `standaardGroep` wordt gebruikt voor regels zonder klas, bijvoorbeeld als
 * iemand één klas tegelijk aanlevert in een bestand zonder klaskolom.
 */
export function leesLijst(
  tekst: string,
  standaardGroep?: string | null,
  /**
   * Zelf bepalen wat elke kolom is. Wordt gebruikt als het scherm het raden
   * corrigeert: dan telt wat de gebruiker aanwijst, niet wat wij denken.
   */
  overschrijving?: KolomSoort[] | null,
): Lezing {
  const scheidteken = raadScheidteken(tekst);
  const tabel = leesTabel(tekst, scheidteken).filter((rij) =>
    rij.some((cel) => cel.trim().length > 0),
  );

  if (tabel.length === 0) {
    return { regels: [], problemen: [], kolommen: [], kopregel: false, scheidteken };
  }

  /*
    De kopregel staat niet altijd bovenaan.

    Een afdruk uit een leerlingvolgsysteem begint vaak met de naam van de
    school of de datum van vandaag. Daarom wordt in de eerste vijf regels
    gezocht naar een kopregel. Wat daarboven staat is een titel en wordt
    overgeslagen; dat is geen gegeven dat verloren gaat.
  */
  let kopIndex = -1;
  let uitKop: KolomSoort[] | null = null;
  for (let i = 0; i < Math.min(5, tabel.length); i += 1) {
    const poging = herkenKop(tabel[i]);
    if (poging) {
      kopIndex = i;
      uitKop = poging;
      break;
    }
  }

  const kopregel = uitKop !== null;
  const gegevens = kopregel ? tabel.slice(kopIndex + 1) : tabel;
  const kolommen = overschrijving && overschrijving.length > 0 ? overschrijving : (uitKop ?? raadKolommen(gegevens));
  const verschoven = kopregel ? kopIndex + 1 : 0;

  const regels: LijstRegel[] = [];
  const problemen: Probleem[] = [];
  const gezien = new Map<string, number>();

  gegevens.forEach((rij, index) => {
    // Regelnummer zoals in het bestand: één gebaseerd, kopregel meegeteld.
    const regelnummer = index + 1 + verschoven;
    const ruweTekst = rij.join(scheidteken === "\t" ? " | " : scheidteken);

    const delen = stelNaamSamen(rij, kolommen);
    const naam = delen.naam;
    if (naam.length < 2) {
      problemen.push({ regel: regelnummer, tekst: ruweTekst, reden: "geen naam gevonden" });
      return;
    }

    const leerjaarIndex = kolommen.indexOf("leerjaar");
    const leerjaar = (leerjaarIndex >= 0 ? (rij[leerjaarIndex] ?? "").trim() : "") || null;

    const groepIndex = kolommen.indexOf("groep");
    const groep = (groepIndex >= 0 ? (rij[groepIndex] ?? "").trim() : "") || standaardGroep || null;
    if (!groep) {
      problemen.push({ regel: regelnummer, tekst: ruweTekst, reden: "geen klas of groep" });
      return;
    }

    const emailIndex = kolommen.indexOf("email");
    const ruwEmail = emailIndex >= 0 ? (rij[emailIndex] ?? "").trim() : "";
    const email = ruwEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ruwEmail) ? ruwEmail : null;
    if (ruwEmail && !email) {
      problemen.push({ regel: regelnummer, tekst: ruwEmail, reden: "e-mailadres klopt niet, de rest is wel gebruikt" });
    }

    // Twee keer dezelfde naam in dezelfde klas in hetzelfde bestand is bijna
    // altijd een dubbele regel, geen tweeling. De tweede regel wordt daarom
    // gemeld in plaats van opgeslagen.
    const sleutel = `${groep.toLowerCase()}::${maakSleutels(naam).sleutel}`;
    const eerder = gezien.get(sleutel);
    if (eerder) {
      problemen.push({
        regel: regelnummer,
        tekst: `${naam} (${groep})`,
        reden: `staat ook al op regel ${eerder}`,
      });
      return;
    }
    gezien.set(sleutel, regelnummer);

    regels.push({
      regel: regelnummer,
      naam,
      groep,
      email,
      leerjaar,
      voornaam: delen.voornaam || undefined,
      achternaam: delen.achternaam || undefined,
    });
  });

  return {
    regels,
    problemen,
    kolommen,
    kolomTitels: kopregel ? tabel[kopIndex] : undefined,
    voorbeeldRijen: gegevens.slice(0, 3),
    kopregel,
    scheidteken,
  };
}

/**
 * De ingelezen regels terug naar tekst, om ze mee te sturen naar de server.
 *
 * Het voorbeeld op het scherm is gemaakt in de browser, maar de server leest
 * alles nog een keer zelf in. Wat de browser stuurt is dus een voorstel, geen
 * waarheid. Dit formaat is bewust simpel: naam, tab, groep, tab, e-mail.
 */
export function naarTekst(regels: LijstRegel[]): string {
  return [
    "Naam\tKlas\tE-mail\tLeerjaar",
    ...regels.map(
      (regel) => `${regel.naam}\t${regel.groep ?? ""}\t${regel.email ?? ""}\t${regel.leerjaar ?? ""}`,
    ),
  ].join("\n");
}

/** Namen die Excel zelf verzint en dus niets over een klas zeggen. */
export function lijktOpStandaardTabnaam(naam: string): boolean {
  return /^(blad|sheet|tabblad|werkblad)\s*\d*$/i.test(naam.trim());
}

export interface BladInvoer {
  naam: string;
  tekst: string;
}

/**
 * Een werkmap met meerdere tabbladen inlezen.
 *
 * Scholen leveren het op twee manieren aan, en allebei moeten gewoon werken:
 *
 *   1. Eén tabblad met alle klassen, en een kolom Klas erbij.
 *   2. Een tabblad per klas, waarbij de naam van het tabblad de klas is.
 *
 * Een kolom met de klas erin wint altijd van de tabnaam. Heet een tabblad
 * Blad1 of Sheet2, dan zegt die naam niets en blijft de regel zonder klas
 * staan, met een melding in plaats van een gok.
 */
export function leesBladen(
  bladen: BladInvoer[],
  standaardGroep?: string | null,
  overschrijving?: KolomSoort[] | null,
): Lezing {
  const regels: LijstRegel[] = [];
  const problemen: Probleem[] = [];
  const telling: { naam: string; aantal: number }[] = [];
  const gezien = new Map<string, string>();

  let kolommen: KolomSoort[] = [];
  let kolomTitels: string[] | undefined;
  let voorbeeldRijen: string[][] | undefined;
  let kopregel = false;
  let scheidteken: ";" | "," | "\t" = "\t";

  for (const blad of bladen) {
    const bruikbareTabnaam = blad.naam.trim().length > 0 && !lijktOpStandaardTabnaam(blad.naam);
    const terugval = standaardGroep || (bruikbareTabnaam ? blad.naam : null);
    const lezing = leesLijst(blad.tekst, terugval, overschrijving);

    if (kolommen.length === 0 && lezing.regels.length > 0) {
      kolommen = lezing.kolommen;
      kolomTitels = lezing.kolomTitels;
      voorbeeldRijen = lezing.voorbeeldRijen;
      kopregel = lezing.kopregel;
      scheidteken = lezing.scheidteken;
    }

    let bruikbaar = 0;
    for (const regel of lezing.regels) {
      const sleutel = `${(regel.groep ?? "").toLowerCase()}::${maakSleutels(regel.naam).sleutel}`;
      const eerder = gezien.get(sleutel);
      if (eerder) {
        problemen.push({
          regel: regel.regel,
          blad: blad.naam,
          tekst: `${regel.naam} (${regel.groep ?? ""})`,
          reden: `staat ook al in ${eerder}`,
        });
        continue;
      }
      gezien.set(sleutel, `${blad.naam} op regel ${regel.regel}`);
      regels.push(regel);
      bruikbaar += 1;
    }

    for (const probleem of lezing.problemen) {
      problemen.push({ ...probleem, blad: blad.naam });
    }

    telling.push({ naam: blad.naam, aantal: bruikbaar });
  }

  return {
    regels,
    problemen,
    bladen: telling,
    kolommen,
    kolomTitels,
    voorbeeldRijen,
    kopregel,
    scheidteken,
  };
}

// -----------------------------------------------------------------------------
// Het voorbeeld voor het scherm
// -----------------------------------------------------------------------------

export interface Dubbel {
  naam: string;
  groep: string;
  regels: number[];
}

export interface LijstOverzicht {
  aantal: number;
  klassen: { naam: string; aantal: number }[];
  leerjaren: { naam: string; aantal: number }[];
  dubbel: Dubbel[];
  /** Regels die zijn overgeslagen, zonder de dubbelen. */
  overgeslagen: Probleem[];
  zonderLeerjaar: number;
  zonderEmail: number;
  /** Kolommen waar we niets mee doen, met hun nummer (1 = A). */
  ongebruikteKolommen: number[];
}

function tel(waarden: (string | null)[]): { naam: string; aantal: number }[] {
  const telling = new Map<string, number>();
  for (const waarde of waarden) {
    const sleutel = (waarde ?? "").trim();
    if (!sleutel) continue;
    telling.set(sleutel, (telling.get(sleutel) ?? 0) + 1);
  }
  return [...telling.entries()]
    .map(([naam, aantal]) => ({ naam, aantal }))
    .sort((a, b) => a.naam.localeCompare(b.naam, "nl", { numeric: true }));
}

/**
 * Alles wat iemand wil zien vóórdat er iets wordt opgeslagen.
 *
 * WAAROM DIT APART STAAT
 *
 *   Een import die 353 leerlingen vindt maar ze in twee klassen stopt, ziet er
 *   op het eerste gezicht goed uit: het aantal klopt immers. Pas als je de
 *   klassen met hun aantallen ziet staan, valt op dat er iets niet deugt.
 *   Daarom staat die verdeling altijd op het scherm, ook als er geen enkel
 *   probleem is gevonden.
 */
export function maakOverzicht(lezing: Lezing): LijstOverzicht {
  const dubbelPatroon = /^staat ook al/i;
  const dubbel: Dubbel[] = [];
  const overgeslagen: Probleem[] = [];

  for (const probleem of lezing.problemen) {
    if (dubbelPatroon.test(probleem.reden)) {
      const regelnummer = Number.parseInt(probleem.reden.replace(/\D+/g, ""), 10);
      const [naam, groep] = probleem.tekst.split(" (");
      dubbel.push({
        naam: naam.trim(),
        groep: (groep ?? "").replace(/\)$/, "").trim(),
        regels: Number.isFinite(regelnummer) ? [regelnummer, probleem.regel] : [probleem.regel],
      });
    } else {
      overgeslagen.push(probleem);
    }
  }

  return {
    aantal: lezing.regels.length,
    klassen: tel(lezing.regels.map((regel) => regel.groep)),
    leerjaren: tel(lezing.regels.map((regel) => regel.leerjaar)),
    dubbel,
    overgeslagen,
    zonderLeerjaar: lezing.regels.filter((regel) => !regel.leerjaar).length,
    zonderEmail: lezing.regels.filter((regel) => !regel.email).length,
    ongebruikteKolommen: lezing.kolommen
      .map((soort, index) => (soort === "onbekend" ? index + 1 : -1))
      .filter((nummer) => nummer > 0),
  };
}
