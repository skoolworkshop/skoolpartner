/**
 * Het workshopaanbod van Skool Workshop.
 *
 * WAAROM EEN EIGEN LIJST EN GEEN KOPPELING MET DE WEBSITE
 *
 *   De website is WordPress. Die bij elke inschrijfdag bevragen betekent dat
 *   een cultuurdag niet in te stellen is als de site traag is, in onderhoud
 *   staat of een plugin stukgaat. Dat is te veel afhankelijkheid voor een
 *   lijst die een paar keer per jaar verandert.
 *
 *   Daarom staat het aanbod hier, bijgewerkt op 9 november 2026 aan de hand
 *   van https://skoolworkshop.nl/workshops/. De namen zijn letterlijk
 *   overgenomen van de website; er is niets bij verzonnen. Komt er een
 *   workshop bij, dan zet je hem hieronder erbij. Een workshop die er nog
 *   niet in staat, kun je op het scherm altijd met de hand toevoegen.
 *
 * WAT HIER NIET IN STAAT
 *
 *   Prijzen, duur en beschrijvingen. Die horen op de website thuis en
 *   veranderen vaker. Voor het inplannen van een dag heb je alleen de naam
 *   nodig, en het maximum per uitvoering regel je per dag.
 */

export interface CatalogusWorkshop {
  naam: string;
  /** De eigen pagina op de website, voor wie wil nakijken wat het inhoudt. */
  url: string;
  /** Waar deze workshop meestal onder valt. Alleen om op te kunnen zoeken. */
  soort: "dans" | "muziek" | "beeld" | "media" | "theater" | "sport";
}

export const WORKSHOP_CATALOGUS: CatalogusWorkshop[] = [
  { naam: "Workshop 3D Printerpen", url: "https://skoolworkshop.nl/workshops/workshop-3d-printerpen/", soort: "beeld" },
  { naam: "Workshop Bodypercussie", url: "https://skoolworkshop.nl/workshops/workshop-bodypercussie/", soort: "muziek" },
  { naam: "Workshop Bootcamp", url: "https://skoolworkshop.nl/workshops/workshop-bootcamp/", soort: "sport" },
  { naam: "Workshop Breakdance", url: "https://skoolworkshop.nl/workshops/workshop-breakdance/", soort: "dans" },
  {
    naam: "Workshop Caribbean Drums",
    url: "https://skoolworkshop.nl/workshops/workshop-caribbean-drums/",
    soort: "muziek",
  },
  { naam: "Workshop DJ Skills", url: "https://skoolworkshop.nl/workshops/workshop-dj-skills/", soort: "muziek" },
  { naam: "Workshop Flashmob", url: "https://skoolworkshop.nl/workshops/workshop-flashmob/", soort: "dans" },
  { naam: "Workshop Freerunning", url: "https://skoolworkshop.nl/workshops/workshop-freerunning/", soort: "sport" },
  { naam: "Workshop Ghetto Drums", url: "https://skoolworkshop.nl/workshops/workshop-ghetto-drums/", soort: "muziek" },
  { naam: "Workshop Graffiti", url: "https://skoolworkshop.nl/workshops/workshop-graffiti/", soort: "beeld" },
  { naam: "Workshop Hiphop", url: "https://skoolworkshop.nl/workshops/workshop-hiphop/", soort: "dans" },
  { naam: "Workshop Kickboksen", url: "https://skoolworkshop.nl/workshops/workshop-kickboksen/", soort: "sport" },
  {
    naam: "Workshop Korte Film Maken",
    url: "https://skoolworkshop.nl/workshops/workshop-korte-film-maken/",
    soort: "media",
  },
  {
    naam: "Workshop Light Graffiti",
    url: "https://skoolworkshop.nl/workshops/workshop-light-graffiti/",
    soort: "beeld",
  },
  { naam: "Workshop Live Looping", url: "https://skoolworkshop.nl/workshops/workshop-live-looping/", soort: "muziek" },
  { naam: "Workshop Pannavoetbal", url: "https://skoolworkshop.nl/workshops/workshop-pannavoetbal/", soort: "sport" },
  {
    naam: "Workshop Podcast Maken",
    url: "https://skoolworkshop.nl/workshops/workshop-podcast-maken/",
    soort: "media",
  },
  { naam: "Workshop Popstar", url: "https://skoolworkshop.nl/workshops/workshop-popstar/", soort: "muziek" },
  { naam: "Workshop Rap", url: "https://skoolworkshop.nl/workshops/workshop-rap/", soort: "muziek" },
  {
    naam: "Workshop Smartphonefotografie",
    url: "https://skoolworkshop.nl/workshops/workshop-smartphone-fotografie/",
    soort: "media",
  },
  { naam: "Workshop Soap Acteren", url: "https://skoolworkshop.nl/workshops/workshop-soap-acteren/", soort: "theater" },
  {
    naam: "Workshop Stage Fighting",
    url: "https://skoolworkshop.nl/workshops/workshop-stage-fighting/",
    soort: "theater",
  },
  { naam: "Workshop Stop Motion", url: "https://skoolworkshop.nl/workshops/workshop-stop-motion/", soort: "media" },
  { naam: "Workshop Streetdance", url: "https://skoolworkshop.nl/workshops/workshop-streetdance/", soort: "dans" },
  {
    naam: "Workshop T-shirt Ontwerpen",
    url: "https://skoolworkshop.nl/workshops/workshop-t-shirt-ontwerpen/",
    soort: "beeld",
  },
  { naam: "Workshop Theatersport", url: "https://skoolworkshop.nl/workshops/workshop-theatersport/", soort: "theater" },
  {
    naam: "Workshop Videoclip maken",
    url: "https://skoolworkshop.nl/workshops/workshop-videoclip-maken/",
    soort: "media",
  },
  { naam: "Workshop Vloggen", url: "https://skoolworkshop.nl/workshops/workshop-vloggen/", soort: "media" },
  {
    naam: "Workshop Zelfverdediging",
    url: "https://skoolworkshop.nl/workshops/workshop-zelfverdediging/",
    soort: "sport",
  },
];

/** Het standaardmaximum per uitvoering, zoals het ook op de website staat. */
export const STANDAARD_MAXIMUM = 25;

export const SOORT_LABELS: Record<CatalogusWorkshop["soort"], string> = {
  dans: "Dans",
  muziek: "Muziek",
  beeld: "Beeldend",
  media: "Media",
  theater: "Theater",
  sport: "Sport",
};

/** Hoofdletters, accenten en leestekens weg, zodat zoeken soepel werkt. */
export function normaliseer(waarde: string): string {
  return waarde
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Zoeken in het aanbod.
 *
 * Zonder zoekterm komt alles terug. Met een zoekterm telt elk los woord: wie
 * "dj" typt vindt DJ Skills, wie "film" typt vindt Korte Film Maken en
 * Videoclip. Ook de soort doet mee, dus "dans" geeft alle dansworkshops.
 */
export function zoekWorkshops(term: string): CatalogusWorkshop[] {
  const schoon = normaliseer(term);
  if (!schoon) return WORKSHOP_CATALOGUS;

  const woorden = schoon.split(" ").filter(Boolean);
  return WORKSHOP_CATALOGUS.filter((workshop) => {
    const doorzoekbaar = `${normaliseer(workshop.naam)} ${normaliseer(SOORT_LABELS[workshop.soort])}`;
    return woorden.every((woord) => doorzoekbaar.includes(woord));
  });
}

/**
 * Staat deze workshop al op de dag?
 *
 * Vergelijken gebeurt op de genormaliseerde naam, zodat "workshop dj skills"
 * en "DJ Skills" als hetzelfde worden gezien. Zo komt er nooit twee keer
 * dezelfde workshop op één dag te staan.
 */
export function staatErAl(naam: string, bestaande: string[]): boolean {
  const gezocht = normaliseer(naam).replace(/^workshop /, "");
  return bestaande.some((bestaand) => normaliseer(bestaand).replace(/^workshop /, "") === gezocht);
}
