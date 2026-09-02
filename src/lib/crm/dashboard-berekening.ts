/**
 * De rekenkern van het commerciele dashboard.
 *
 * Alles hier is pure logica zonder database, net als regels.ts. Dat is met
 * opzet: een dashboard is precies het soort scherm waar een rekenfout stil
 * doorwerkt in een beslissing. Wat hieronder staat is daarom apart te testen,
 * zonder Supabase en zonder scherm.
 *
 * ============================================================================
 * DE BELANGRIJKSTE BESLISSING VAN DIT BESTAND: WAT IS OMZET
 * ============================================================================
 *
 * Er zijn in dit systeem drie getallen die op omzet lijken, en ze betekenen
 * alle drie iets anders:
 *
 *   1. crm_deals.value_cents      wat wij verwachten te verdienen
 *   2. invoices.total_paid_cents  wat een school daadwerkelijk heeft betaald
 *   3. crm_suri_payments          wat een deelnemer daadwerkelijk heeft betaald
 *
 * Alleen 2 en 3 zijn feiten. De dealwaarde is een verwachting en telt daarom
 * uitsluitend mee in de openstaande pijplijnwaarde, nooit in de omzet. Anders
 * zou dezelfde euro twee keer geteld worden: een keer als verwachting bij het
 * winnen van de deal, en een keer als betaling bij de factuur.
 *
 * Bron 2 en bron 3 kunnen elkaar niet overlappen. Een factuur hangt aan een
 * organisatie, en Suri Impact verkoopt niet aan organisaties maar aan
 * personen: de database dwingt af dat een Suri-deal een contact_id heeft.
 * Een Suri-betaling hangt aan een deal en nooit aan een factuur. De twee
 * bronnen zijn dus per merk gescheiden:
 *
 *   Skool Workshop -> betaalde facturen
 *   Suri Impact    -> ontvangen deelnemersbetalingen
 *
 * Bij het filter "Alles" worden ze opgeteld, en dat mag omdat ze elkaar
 * uitsluiten. De test crm-dashboard.test.ts bewijst dat.
 *
 * ============================================================================
 * WAT ER NIET GEBEURT
 * ============================================================================
 *
 * Er wordt hier nergens een benchmark, een prognose of een percentage
 * verzonnen. Als er te weinig gegevens zijn om iets te zeggen, komt er
 * "onvoldoende data" uit en geen getal. Een dashboard dat gokt is erger dan
 * een dashboard dat zwijgt.
 */

import type { Merk } from "@/lib/crm/merk";
import { dagenTussen, leesDatum, type DatumString } from "@/lib/crm/regels";

// -----------------------------------------------------------------------------
// Het merkfilter
// -----------------------------------------------------------------------------

export const MERK_FILTERS = ["alles", "skool_workshop", "suri_impact"] as const;
export type MerkFilter = (typeof MERK_FILTERS)[number];

export function isMerkFilter(waarde: unknown): waarde is MerkFilter {
  return typeof waarde === "string" && (MERK_FILTERS as readonly string[]).includes(waarde);
}

export function parseMerkFilter(waarde: unknown): MerkFilter {
  return isMerkFilter(waarde) ? waarde : "alles";
}

export const MERK_FILTER_LABELS: Record<MerkFilter, string> = {
  alles: "Alles",
  skool_workshop: "Skool Workshop",
  suri_impact: "Suri Impact",
};

/** Hoort dit merk bij het gekozen filter? */
export function merkPast(merk: Merk, filter: MerkFilter): boolean {
  return filter === "alles" || merk === filter;
}

// -----------------------------------------------------------------------------
// De periode
// -----------------------------------------------------------------------------

export const PERIODE_KEYS = [
  "vandaag",
  "deze-week",
  "deze-maand",
  "vorig-kwartaal",
  "dit-jaar",
  "aangepast",
] as const;

export type PeriodeKey = (typeof PERIODE_KEYS)[number];

export function isPeriodeKey(waarde: unknown): waarde is PeriodeKey {
  return typeof waarde === "string" && (PERIODE_KEYS as readonly string[]).includes(waarde);
}

export const PERIODE_LABELS: Record<PeriodeKey, string> = {
  vandaag: "Vandaag",
  "deze-week": "Deze week",
  "deze-maand": "Deze maand",
  "vorig-kwartaal": "Vorig kwartaal",
  "dit-jaar": "Dit jaar",
  aangepast: "Aangepast",
};

export interface Periode {
  key: PeriodeKey;
  /** Eerste dag, meegerekend. */
  vanaf: DatumString;
  /** Laatste dag, ook meegerekend. */
  tot: DatumString;
  label: string;
}

function alsDatumString(datum: Date): DatumString {
  return datum.toISOString().slice(0, 10);
}

function verschuif(datum: Date, dagen: number): Date {
  return new Date(datum.getTime() + dagen * 86_400_000);
}

/**
 * Van een keuze een echte periode maken.
 *
 * De week begint op maandag, want dat is hoe hier gewerkt wordt. "Vorig
 * kwartaal" is het volledige kwartaal voor het huidige: een afgesloten blok
 * waar je iets over kunt zeggen, in plaats van een halve lopende periode.
 */
export function maakPeriode(
  key: PeriodeKey,
  vandaag: DatumString,
  aangepast?: { vanaf?: string | null; tot?: string | null }
): Periode {
  const nu = leesDatum(vandaag);
  if (!nu) {
    // Onleesbare datum hoort geen scherm om te gooien.
    return { key, vanaf: vandaag, tot: vandaag, label: PERIODE_LABELS[key] };
  }

  const jaar = nu.getUTCFullYear();
  const maand = nu.getUTCMonth();

  if (key === "vandaag") {
    return { key, vanaf: vandaag, tot: vandaag, label: "Vandaag" };
  }

  if (key === "deze-week") {
    // getUTCDay(): 0 is zondag. Maandag als eerste dag betekent dus zes dagen
    // terug op zondag, en anders dag - 1.
    const dag = nu.getUTCDay();
    const terug = dag === 0 ? 6 : dag - 1;
    const start = verschuif(nu, -terug);
    return {
      key,
      vanaf: alsDatumString(start),
      tot: alsDatumString(verschuif(start, 6)),
      label: "Deze week",
    };
  }

  if (key === "deze-maand") {
    const start = new Date(Date.UTC(jaar, maand, 1));
    const eind = new Date(Date.UTC(jaar, maand + 1, 0));
    return { key, vanaf: alsDatumString(start), tot: alsDatumString(eind), label: "Deze maand" };
  }

  if (key === "vorig-kwartaal") {
    const kwartaal = Math.floor(maand / 3);
    const vorigJaar = kwartaal === 0 ? jaar - 1 : jaar;
    const vorigKwartaal = kwartaal === 0 ? 3 : kwartaal - 1;
    const start = new Date(Date.UTC(vorigJaar, vorigKwartaal * 3, 1));
    const eind = new Date(Date.UTC(vorigJaar, vorigKwartaal * 3 + 3, 0));
    return {
      key,
      vanaf: alsDatumString(start),
      tot: alsDatumString(eind),
      label: `Q${vorigKwartaal + 1} ${vorigJaar}`,
    };
  }

  if (key === "dit-jaar") {
    return { key, vanaf: `${jaar}-01-01`, tot: `${jaar}-12-31`, label: `${jaar}` };
  }

  // Aangepast. Een onvolledige of omgedraaide invoer valt terug op deze maand,
  // want een lege grafiek zonder uitleg is verwarrender dan een zichtbare
  // standaardperiode.
  const vanaf = leesDatum(aangepast?.vanaf ?? null);
  const tot = leesDatum(aangepast?.tot ?? null);
  if (!vanaf || !tot) return maakPeriode("deze-maand", vandaag);

  const [a, b] = vanaf.getTime() <= tot.getTime() ? [vanaf, tot] : [tot, vanaf];
  return {
    key: "aangepast",
    vanaf: alsDatumString(a),
    tot: alsDatumString(b),
    label: `${alsDatumString(a)} tot en met ${alsDatumString(b)}`,
  };
}

/** Valt deze datum in de periode? Beide grenzen tellen mee. */
export function inPeriode(waarde: string | null | undefined, periode: Periode): boolean {
  if (!waarde) return false;
  const dag = waarde.slice(0, 10);
  return dag >= periode.vanaf && dag <= periode.tot;
}

// -----------------------------------------------------------------------------
// De ruwe gegevens waar dit bestand mee rekent
// -----------------------------------------------------------------------------

export interface FaseInvoer {
  id: string;
  brand: Merk;
  key: string;
  label: string;
  position: number;
  isWon: boolean;
  isLost: boolean;
}

export interface DealInvoer {
  id: string;
  brand: Merk;
  title: string;
  stageId: string;
  organizationId: string | null;
  contactId: string | null;
  valueCents: number;
  expectedDate: string | null;
  /** ISO-tijdstip. */
  createdAt: string;
  /** ISO-tijdstip, of null als de deal nog loopt. */
  closedAt: string | null;
  /** ISO-tijdstip: sinds wanneer staat hij in deze fase. */
  stageSince: string | null;
  ownerId: string | null;
}

export interface DealGebeurtenisInvoer {
  dealId: string;
  fromStageId: string | null;
  toStageId: string | null;
  createdAt: string;
}

/**
 * Een betaalde factuur van Skool Workshop.
 *
 * betaaldOp is paid_at als die er is en anders de factuurdatum. Zonder een van
 * beide kan de omzet niet aan een periode worden toegewezen, en dan telt hij
 * bewust niet mee in een periodetotaal: liever een getal dat te laag is en
 * uitgelegd wordt, dan een getal dat in de verkeerde maand staat.
 */
export interface FactuurInvoer {
  organizationId: string | null;
  betaaldOp: string | null;
  betaaldCents: number;
}

/** Een ontvangen bedrag van een Suri-deelnemer. */
export interface SuriBetalingInvoer {
  dealId: string;
  amountCents: number;
  ontvangenOp: string;
}

/**
 * Een afspraak, zoals het dashboard hem nodig heeft.
 *
 * Bewust alleen de velden waar het dashboard iets mee doet. De volledige
 * afspraak staat in afspraken.ts; hier gaat het om de vraag "moet hier nog
 * iets mee gebeuren".
 */
export interface AfspraakInvoer {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: string;
  outcome: string | null;
  dealId: string | null;
  organizationId: string | null;
}

export interface TaakInvoer {
  id: string;
  title: string;
  dueOn: string | null;
  doneAt: string | null;
  dealId: string | null;
  organizationId: string | null;
  contactId: string | null;
  ownerId: string | null;
}

export interface DashboardInvoer {
  deals: DealInvoer[];
  fases: FaseInvoer[];
  gebeurtenissen: DealGebeurtenisInvoer[];
  facturen: FactuurInvoer[];
  suriBetalingen: SuriBetalingInvoer[];
  taken: TaakInvoer[];
  afspraken: AfspraakInvoer[];
  periode: Periode;
  merk: MerkFilter;
  vandaag: DatumString;
}

// -----------------------------------------------------------------------------
// Hulpjes
// -----------------------------------------------------------------------------

export type FaseSoort = "lopend" | "gewonnen" | "verloren";

export function faseSoort(fase: FaseInvoer | undefined): FaseSoort {
  if (!fase) return "lopend";
  if (fase.isWon) return "gewonnen";
  if (fase.isLost) return "verloren";
  return "lopend";
}

function faseKaart(fases: FaseInvoer[]): Map<string, FaseInvoer> {
  return new Map(fases.map((f) => [f.id, f]));
}

function dagenSinds(tijdstip: string | null, vandaag: DatumString): number | null {
  if (!tijdstip) return null;
  return dagenTussen(tijdstip.slice(0, 10), vandaag);
}

function gemiddelde(getallen: number[]): number | null {
  if (getallen.length === 0) return null;
  return getallen.reduce((som, n) => som + n, 0) / getallen.length;
}

function mediaan(getallen: number[]): number | null {
  if (getallen.length === 0) return null;
  const gesorteerd = [...getallen].sort((a, b) => a - b);
  const midden = Math.floor(gesorteerd.length / 2);
  return gesorteerd.length % 2 === 1
    ? gesorteerd[midden]
    : (gesorteerd[midden - 1] + gesorteerd[midden]) / 2;
}

/**
 * Hoeveel metingen er minstens moeten zijn voordat een gemiddelde iets zegt.
 *
 * Vijf is geen wetenschap maar wel een eerlijke ondergrens: met drie deals is
 * een "gemiddelde doorlooptijd van 12 dagen" gewoon een toevalligheid met een
 * decimaal erachter.
 */
export const MINIMUM_METINGEN = 5;

export interface Meting {
  /** Null als er te weinig metingen zijn. */
  gemiddelde: number | null;
  mediaan: number | null;
  aantal: number;
  voldoendeData: boolean;
}

export function meting(getallen: number[], minimum = MINIMUM_METINGEN): Meting {
  const voldoende = getallen.length >= minimum;
  return {
    gemiddelde: voldoende ? gemiddelde(getallen) : null,
    mediaan: voldoende ? mediaan(getallen) : null,
    aantal: getallen.length,
    voldoendeData: voldoende,
  };
}

// -----------------------------------------------------------------------------
// Omzet
// -----------------------------------------------------------------------------

export interface Omzet {
  /** Betaalde facturen van scholen. */
  skoolWorkshopCents: number;
  /** Ontvangen deelnemersbetalingen van Suri. */
  suriImpactCents: number;
  totaalCents: number;
  /** Facturen zonder betaaldatum, die dus in geen enkele periode meetellen. */
  zonderDatumCents: number;
}

/**
 * De gerealiseerde omzet in een periode.
 *
 * Twee bronnen die elkaar uitsluiten, per merk. Dat is de hele reden dat hier
 * niets dubbel geteld kan worden: een betaalde factuur hoort bij een school en
 * een deelnemersbetaling bij een persoon, en een deal is geen van beide.
 */
export function berekenOmzet(
  facturen: FactuurInvoer[],
  suriBetalingen: SuriBetalingInvoer[],
  periode: Periode,
  merk: MerkFilter
): Omzet {
  let skool = 0;
  let zonderDatum = 0;

  if (merkPast("skool_workshop", merk)) {
    for (const factuur of facturen) {
      if (!factuur.betaaldOp) {
        zonderDatum += factuur.betaaldCents;
        continue;
      }
      if (inPeriode(factuur.betaaldOp, periode)) skool += factuur.betaaldCents;
    }
  }

  let suri = 0;
  if (merkPast("suri_impact", merk)) {
    for (const betaling of suriBetalingen) {
      if (inPeriode(betaling.ontvangenOp, periode)) suri += betaling.amountCents;
    }
  }

  return {
    skoolWorkshopCents: skool,
    suriImpactCents: suri,
    totaalCents: skool + suri,
    zonderDatumCents: zonderDatum,
  };
}

export interface MaandOmzet {
  /** Als "2026-03". */
  maand: string;
  label: string;
  skoolWorkshopCents: number;
  suriImpactCents: number;
  totaalCents: number;
}

const MAAND_NAMEN = [
  "jan",
  "feb",
  "mrt",
  "apr",
  "mei",
  "jun",
  "jul",
  "aug",
  "sep",
  "okt",
  "nov",
  "dec",
];

function maandLabel(maand: string): string {
  const [jaar, nummer] = maand.split("-");
  const index = Number(nummer) - 1;
  return `${MAAND_NAMEN[index] ?? nummer} ${jaar.slice(2)}`;
}

/**
 * De omzet per maand over de laatste maanden.
 *
 * Bewust niet gekoppeld aan het periodefilter: de KPI's beantwoorden "hoe gaat
 * het nu", deze reeks beantwoordt "hoe loopt het". Een staafdiagram van een
 * enkele dag is geen grafiek.
 */
export function omzetPerMaand(
  facturen: FactuurInvoer[],
  suriBetalingen: SuriBetalingInvoer[],
  merk: MerkFilter,
  vandaag: DatumString,
  maanden = 12
): MaandOmzet[] {
  const nu = leesDatum(vandaag);
  if (!nu) return [];

  const reeks: MaandOmzet[] = [];
  const index = new Map<string, MaandOmzet>();

  for (let i = maanden - 1; i >= 0; i -= 1) {
    const datum = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth() - i, 1));
    const sleutel = `${datum.getUTCFullYear()}-${String(datum.getUTCMonth() + 1).padStart(2, "0")}`;
    const regel: MaandOmzet = {
      maand: sleutel,
      label: maandLabel(sleutel),
      skoolWorkshopCents: 0,
      suriImpactCents: 0,
      totaalCents: 0,
    };
    reeks.push(regel);
    index.set(sleutel, regel);
  }

  if (merkPast("skool_workshop", merk)) {
    for (const factuur of facturen) {
      if (!factuur.betaaldOp) continue;
      const regel = index.get(factuur.betaaldOp.slice(0, 7));
      if (!regel) continue;
      regel.skoolWorkshopCents += factuur.betaaldCents;
      regel.totaalCents += factuur.betaaldCents;
    }
  }

  if (merkPast("suri_impact", merk)) {
    for (const betaling of suriBetalingen) {
      const regel = index.get(betaling.ontvangenOp.slice(0, 7));
      if (!regel) continue;
      regel.suriImpactCents += betaling.amountCents;
      regel.totaalCents += betaling.amountCents;
    }
  }

  return reeks;
}

// -----------------------------------------------------------------------------
// De kerncijfers
// -----------------------------------------------------------------------------

export interface Kpis {
  /** Aangemaakt in de periode. */
  nieuweDeals: number;
  nieuweDealsWaardeCents: number;
  /** Nu open, ongeacht de periode: een momentopname. */
  openDeals: number;
  openWaardeCents: number;
  /** Afgesloten in de periode. */
  gewonnenDeals: number;
  verlorenDeals: number;
  /** Uit betaalde facturen en deelnemersbetalingen, nooit uit dealwaarde. */
  omzet: Omzet;
  /** De gemiddelde waarde van de deals die in de periode zijn gewonnen. */
  gemiddeldeDealwaardeCents: number | null;
  /** Dagen van aanmaak tot winst, voor de deals die in de periode zijn gewonnen. */
  doorlooptijd: Meting;
  /** Gewonnen gedeeld door alles wat is afgesloten. Null als er niets is afgesloten. */
  conversiePercentage: number | null;
  openstaandeTaken: number;
  achterstalligeTaken: number;
}

export function berekenKpis(invoer: DashboardInvoer): Kpis {
  const { deals, fases, facturen, suriBetalingen, taken, periode, merk, vandaag } = invoer;

  const fasePerId = faseKaart(fases);
  const relevant = deals.filter((d) => merkPast(d.brand, merk));

  let nieuweDeals = 0;
  let nieuweWaarde = 0;
  let openDeals = 0;
  let openWaarde = 0;
  let gewonnen = 0;
  let verloren = 0;
  const gewonnenWaardes: number[] = [];
  const doorlooptijden: number[] = [];

  for (const deal of relevant) {
    const soort = faseSoort(fasePerId.get(deal.stageId));

    if (inPeriode(deal.createdAt, periode)) {
      nieuweDeals += 1;
      nieuweWaarde += deal.valueCents;
    }

    if (soort === "lopend") {
      openDeals += 1;
      openWaarde += deal.valueCents;
      continue;
    }

    // Afgesloten deals tellen in de periode waarin ze zijn afgesloten. Zonder
    // closed_at is er geen moment om ze aan te hangen, en dan tellen ze niet
    // mee in een periodetelling.
    if (!inPeriode(deal.closedAt, periode)) continue;

    if (soort === "gewonnen") {
      gewonnen += 1;
      gewonnenWaardes.push(deal.valueCents);
      const dagen = dagenTussen(deal.createdAt.slice(0, 10), (deal.closedAt as string).slice(0, 10));
      if (dagen !== null && dagen >= 0) doorlooptijden.push(dagen);
    } else {
      verloren += 1;
    }
  }

  const afgesloten = gewonnen + verloren;

  let openstaand = 0;
  let achterstallig = 0;
  for (const taak of takenVoorMerk(taken, relevant, merk)) {
    if (taak.doneAt) continue;
    openstaand += 1;
    if (taak.dueOn && taak.dueOn.slice(0, 10) < vandaag) achterstallig += 1;
  }

  return {
    nieuweDeals,
    nieuweDealsWaardeCents: nieuweWaarde,
    openDeals,
    openWaardeCents: openWaarde,
    gewonnenDeals: gewonnen,
    verlorenDeals: verloren,
    omzet: berekenOmzet(facturen, suriBetalingen, periode, merk),
    gemiddeldeDealwaardeCents:
      gewonnenWaardes.length > 0
        ? Math.round(gewonnenWaardes.reduce((s, n) => s + n, 0) / gewonnenWaardes.length)
        : null,
    doorlooptijd: meting(doorlooptijden),
    conversiePercentage: afgesloten > 0 ? (gewonnen / afgesloten) * 100 : null,
    openstaandeTaken: openstaand,
    achterstalligeTaken: achterstallig,
  };
}

/**
 * Welke taken bij het gekozen merk horen.
 *
 * Een taak kent zelf geen merk. Hangt hij aan een deal, dan volgt het merk uit
 * die deal. Hangt hij nergens aan, of aan een organisatie zonder deal, dan
 * telt hij alleen mee bij "Alles". Zo wordt een taak nooit aan het verkeerde
 * merk toegeschreven, en verdwijnt hij ook nergens stilletjes uit beeld.
 */
export function takenVoorMerk(
  taken: TaakInvoer[],
  deals: DealInvoer[],
  merk: MerkFilter
): TaakInvoer[] {
  if (merk === "alles") return taken;
  // Bewust hier nog een keer op merk filteren en niet vertrouwen op een
  // voorgefilterde lijst: dat is precies het soort aanname dat later stil
  // omvalt als een aanroeper de volledige lijst meegeeft.
  const dealIds = new Set(deals.filter((d) => merkPast(d.brand, merk)).map((d) => d.id));
  return taken.filter((taak) => taak.dealId !== null && dealIds.has(taak.dealId));
}

// -----------------------------------------------------------------------------
// De pijplijn
// -----------------------------------------------------------------------------

export interface FaseAnalyse {
  fase: FaseInvoer;
  aantal: number;
  waardeCents: number;
  /** Hoe lang de deals die er nu staan er gemiddeld staan. */
  gemiddeldDagenInFase: number | null;
  /** De deal die er het langst staat. */
  oudste: { id: string; title: string; dagen: number } | null;
  /** Hoeveel deals hier langer staan dan de drempel. */
  teLang: number;
}

export interface PijplijnAnalyse {
  fases: FaseAnalyse[];
  totaalOpen: number;
  totaalWaardeCents: number;
  /** De oudste lopende deal van de hele pijplijn. */
  oudste: { id: string; title: string; dagen: number } | null;
  teLangTotaal: number;
  drempelDagen: number;
}

/**
 * Vanaf hoeveel dagen een deal in dezelfde fase opvalt.
 *
 * Dertig dagen is bewust ruim. Een schoolaanvraag loopt over weken, en een
 * drempel die te laag staat kleurt de hele pijplijn rood en wordt daarna
 * genegeerd.
 */
export const TE_LANG_DAGEN = 30;

export function analyseerPijplijn(
  deals: DealInvoer[],
  fases: FaseInvoer[],
  merk: MerkFilter,
  vandaag: DatumString,
  drempelDagen = TE_LANG_DAGEN
): PijplijnAnalyse {
  const relevanteFases = fases
    .filter((f) => merkPast(f.brand, merk) && !f.isWon && !f.isLost)
    .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));

  const perFase = new Map<string, DealInvoer[]>();
  for (const deal of deals) {
    if (!merkPast(deal.brand, merk)) continue;
    const lijst = perFase.get(deal.stageId);
    if (lijst) lijst.push(deal);
    else perFase.set(deal.stageId, [deal]);
  }

  let totaalOpen = 0;
  let totaalWaarde = 0;
  let oudsteAlgemeen: { id: string; title: string; dagen: number } | null = null;
  let teLangTotaal = 0;

  const analyses: FaseAnalyse[] = relevanteFases.map((fase) => {
    const inFase = perFase.get(fase.id) ?? [];
    const dagen: number[] = [];
    let oudste: { id: string; title: string; dagen: number } | null = null;
    let teLang = 0;
    let waarde = 0;

    for (const deal of inFase) {
      waarde += deal.valueCents;
      const d = dagenSinds(deal.stageSince ?? deal.createdAt, vandaag);
      if (d === null || d < 0) continue;
      dagen.push(d);
      if (d >= drempelDagen) teLang += 1;
      if (!oudste || d > oudste.dagen) oudste = { id: deal.id, title: deal.title, dagen: d };
    }

    totaalOpen += inFase.length;
    totaalWaarde += waarde;
    teLangTotaal += teLang;
    if (oudste && (!oudsteAlgemeen || oudste.dagen > oudsteAlgemeen.dagen)) {
      oudsteAlgemeen = oudste;
    }

    const gem = gemiddelde(dagen);

    return {
      fase,
      aantal: inFase.length,
      waardeCents: waarde,
      gemiddeldDagenInFase: gem === null ? null : Math.round(gem),
      oudste,
      teLang,
    };
  });

  return {
    fases: analyses,
    totaalOpen,
    totaalWaardeCents: totaalWaarde,
    oudste: oudsteAlgemeen,
    teLangTotaal,
    drempelDagen,
  };
}

// -----------------------------------------------------------------------------
// Doorlooptijd per fase, uit de echte historie
// -----------------------------------------------------------------------------

export interface FaseDoorlooptijd {
  fase: FaseInvoer;
  meting: Meting;
}

/**
 * Hoe lang een deal gemiddeld in een fase blijft, gemeten aan afgeronde
 * verblijven.
 *
 * Alleen intervallen die echt zijn afgesloten tellen mee: van het moment dat
 * een deal een fase binnenkwam tot het moment dat hij eruit ging. De fase waar
 * een deal nu in staat telt niet mee, want die is nog bezig, en meerekenen zou
 * elk gemiddelde structureel te laag maken.
 *
 * De eerste fase begint bij het aanmaken van de deal. Dat is de enige plek
 * waar geen gebeurtenis van bestaat, en het is wel het moment waarop hij daar
 * kwam te staan.
 */
export function doorlooptijdPerFase(
  deals: DealInvoer[],
  gebeurtenissen: DealGebeurtenisInvoer[],
  fases: FaseInvoer[],
  merk: MerkFilter,
  minimum = MINIMUM_METINGEN
): FaseDoorlooptijd[] {
  const relevanteDeals = deals.filter((d) => merkPast(d.brand, merk));
  const dealPerId = new Map(relevanteDeals.map((d) => [d.id, d]));

  const perDeal = new Map<string, DealGebeurtenisInvoer[]>();
  for (const gebeurtenis of gebeurtenissen) {
    if (!dealPerId.has(gebeurtenis.dealId)) continue;
    const lijst = perDeal.get(gebeurtenis.dealId);
    if (lijst) lijst.push(gebeurtenis);
    else perDeal.set(gebeurtenis.dealId, [gebeurtenis]);
  }

  const dagenPerFase = new Map<string, number[]>();
  const voegToe = (faseId: string, van: string, tot: string) => {
    const dagen = (Date.parse(tot) - Date.parse(van)) / 86_400_000;
    if (!Number.isFinite(dagen) || dagen < 0) return;
    const lijst = dagenPerFase.get(faseId);
    if (lijst) lijst.push(dagen);
    else dagenPerFase.set(faseId, [dagen]);
  };

  for (const [dealId, ruwe] of perDeal) {
    const deal = dealPerId.get(dealId);
    if (!deal) continue;

    const opVolgorde = [...ruwe].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    // Het verblijf in de eerste fase loopt van het aanmaken tot de eerste
    // wisseling. Welke fase dat was, staat in from_stage_id van die eerste
    // gebeurtenis.
    let sinds = deal.createdAt;
    for (const gebeurtenis of opVolgorde) {
      if (gebeurtenis.fromStageId) voegToe(gebeurtenis.fromStageId, sinds, gebeurtenis.createdAt);
      sinds = gebeurtenis.createdAt;
    }
    // De huidige fase blijft buiten beschouwing: die is nog bezig.
  }

  return fases
    .filter((f) => merkPast(f.brand, merk) && !f.isWon && !f.isLost)
    .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label))
    .map((fase) => ({ fase, meting: meting(dagenPerFase.get(fase.id) ?? [], minimum) }));
}

// -----------------------------------------------------------------------------
// Klanten: nieuw, bestaand, terugkerend
// -----------------------------------------------------------------------------

export interface OrganisatieOmzet {
  organizationId: string;
  omzetCents: number;
  /** Hoeveel betaalde facturen er in de periode zijn. */
  aantalFacturen: number;
  /** Is de allereerste betaling van deze klant in deze periode gedaan? */
  nieuw: boolean;
}

export interface KlantAnalyse {
  /** Op omzet in de periode, hoogste eerst. */
  perOrganisatie: OrganisatieOmzet[];
  nieuweKlanten: number;
  bestaandeKlanten: number;
  omzetNieuwCents: number;
  omzetBestaandCents: number;
}

/**
 * Wie er in de periode heeft betaald, en of dat een nieuwe klant was.
 *
 * Nieuw betekent hier: de eerste betaling ooit van deze organisatie valt in
 * deze periode. Dat is te bepalen uit de facturen zelf en heeft geen aparte
 * administratie nodig, dus het kan ook niet uit de pas gaan lopen.
 *
 * Dit gaat alleen over Skool Workshop. Suri verkoopt aan personen en een
 * deelnemer komt niet terug voor een tweede Breekjaar; herhaalomzet is daar
 * geen zinnig begrip.
 */
export function analyseerKlanten(facturen: FactuurInvoer[], periode: Periode): KlantAnalyse {
  const eerstePerOrg = new Map<string, string>();
  for (const factuur of facturen) {
    if (!factuur.organizationId || !factuur.betaaldOp || factuur.betaaldCents <= 0) continue;
    const dag = factuur.betaaldOp.slice(0, 10);
    const huidig = eerstePerOrg.get(factuur.organizationId);
    if (!huidig || dag < huidig) eerstePerOrg.set(factuur.organizationId, dag);
  }

  const perOrg = new Map<string, OrganisatieOmzet>();
  for (const factuur of facturen) {
    if (!factuur.organizationId || !inPeriode(factuur.betaaldOp, periode)) continue;
    const bestaand = perOrg.get(factuur.organizationId);
    if (bestaand) {
      bestaand.omzetCents += factuur.betaaldCents;
      bestaand.aantalFacturen += 1;
    } else {
      const eerste = eerstePerOrg.get(factuur.organizationId);
      perOrg.set(factuur.organizationId, {
        organizationId: factuur.organizationId,
        omzetCents: factuur.betaaldCents,
        aantalFacturen: 1,
        nieuw: eerste !== undefined && inPeriode(eerste, periode),
      });
    }
  }

  const lijst = [...perOrg.values()].sort((a, b) => b.omzetCents - a.omzetCents);

  return {
    perOrganisatie: lijst,
    nieuweKlanten: lijst.filter((o) => o.nieuw).length,
    bestaandeKlanten: lijst.filter((o) => !o.nieuw).length,
    omzetNieuwCents: lijst.filter((o) => o.nieuw).reduce((s, o) => s + o.omzetCents, 0),
    omzetBestaandCents: lijst.filter((o) => !o.nieuw).reduce((s, o) => s + o.omzetCents, 0),
  };
}

export interface Klantenbehoud {
  /** Organisaties met minstens een gewonnen deal. */
  klantenMetWinst: number;
  /** Daarvan: organisaties met meer dan een gewonnen deal. */
  herhaalklanten: number;
  /** Aandeel herhaalklanten, of null als er nog geen klanten zijn. */
  herhaalPercentage: number | null;
  /** Klanten met een gewonnen deal die al lang niets nieuws hebben lopen. */
  slapend: { organizationId: string; laatsteWinst: string; dagen: number }[];
}

/**
 * Wie er terugkomt, en wie er stil is geworden.
 *
 * Slapend betekent: ooit gewonnen, geen enkele lopende deal, en de laatste
 * winst is langer geleden dan de drempel. Dat is de lijst waar herhaalomzet
 * vandaan komt, en die staat nergens anders in het systeem.
 */
export function berekenKlantenbehoud(
  deals: DealInvoer[],
  fases: FaseInvoer[],
  merk: MerkFilter,
  vandaag: DatumString,
  slaapDagen = 365
): Klantenbehoud {
  const fasePerId = faseKaart(fases);

  const gewonnenPerOrg = new Map<string, string[]>();
  const heeftLopend = new Set<string>();

  for (const deal of deals) {
    if (!merkPast(deal.brand, merk) || !deal.organizationId) continue;
    const soort = faseSoort(fasePerId.get(deal.stageId));
    if (soort === "lopend") {
      heeftLopend.add(deal.organizationId);
      continue;
    }
    if (soort !== "gewonnen") continue;
    const moment = (deal.closedAt ?? deal.createdAt).slice(0, 10);
    const lijst = gewonnenPerOrg.get(deal.organizationId);
    if (lijst) lijst.push(moment);
    else gewonnenPerOrg.set(deal.organizationId, [moment]);
  }

  const slapend: { organizationId: string; laatsteWinst: string; dagen: number }[] = [];
  let herhaal = 0;

  for (const [organizationId, momenten] of gewonnenPerOrg) {
    if (momenten.length > 1) herhaal += 1;
    if (heeftLopend.has(organizationId)) continue;
    const laatste = momenten.reduce((a, b) => (a > b ? a : b));
    const dagen = dagenTussen(laatste, vandaag);
    if (dagen !== null && dagen >= slaapDagen) {
      slapend.push({ organizationId, laatsteWinst: laatste, dagen });
    }
  }

  slapend.sort((a, b) => b.dagen - a.dagen);
  const klanten = gewonnenPerOrg.size;

  return {
    klantenMetWinst: klanten,
    herhaalklanten: herhaal,
    herhaalPercentage: klanten > 0 ? (herhaal / klanten) * 100 : null,
    slapend,
  };
}

// -----------------------------------------------------------------------------
// Opvolging: wat moet er vandaag gebeuren
// -----------------------------------------------------------------------------

export interface OpvolgingDeal {
  id: string;
  title: string;
  faseLabel: string;
  dagenInFase: number;
  waardeCents: number;
  reden: string;
}

export interface OpvolgingAfspraak {
  id: string;
  title: string;
  startsAt: string;
  dealId: string | null;
  organizationId: string | null;
}

export interface Opvolging {
  achterstalligeTaken: TaakInvoer[];
  takenVandaag: TaakInvoer[];
  /** Gepland, en het moment is voorbij zonder dat er iets is bijgewerkt. */
  afsprakenBlijvenLiggen: OpvolgingAfspraak[];
  /** Gehouden, maar er staat niet wat eruit kwam. */
  afsprakenZonderUitkomst: OpvolgingAfspraak[];
  /** Wat er vandaag en morgen in de agenda staat. */
  afsprakenBinnenkort: OpvolgingAfspraak[];
  /** Lopende deals die te lang stilstaan, langste eerst. */
  stilstaandeDeals: OpvolgingDeal[];
  /** Lopende deals waar geen enkele openstaande taak aan hangt. */
  dealsZonderTaak: OpvolgingDeal[];
}

export function bepaalOpvolging(
  deals: DealInvoer[],
  fases: FaseInvoer[],
  taken: TaakInvoer[],
  merk: MerkFilter,
  vandaag: DatumString,
  afspraken: AfspraakInvoer[] = [],
  drempelDagen = TE_LANG_DAGEN,
  maximumPerLijst = 8
): Opvolging {
  const fasePerId = faseKaart(fases);
  const relevanteDeals = deals.filter((d) => merkPast(d.brand, merk));
  const eigenTaken = takenVoorMerk(taken, relevanteDeals, merk).filter((t) => !t.doneAt);

  const achterstallig = eigenTaken
    .filter((t) => t.dueOn && t.dueOn.slice(0, 10) < vandaag)
    .sort((a, b) => (a.dueOn ?? "").localeCompare(b.dueOn ?? ""));

  const vandaagLijst = eigenTaken.filter((t) => t.dueOn && t.dueOn.slice(0, 10) === vandaag);

  const dealsMetTaak = new Set(
    eigenTaken.map((t) => t.dealId).filter((id): id is string => Boolean(id))
  );

  const stil: OpvolgingDeal[] = [];
  const zonderTaak: OpvolgingDeal[] = [];

  for (const deal of relevanteDeals) {
    const fase = fasePerId.get(deal.stageId);
    if (faseSoort(fase) !== "lopend") continue;

    const dagen = dagenSinds(deal.stageSince ?? deal.createdAt, vandaag) ?? 0;
    const basis = {
      id: deal.id,
      title: deal.title,
      faseLabel: fase?.label ?? "onbekende fase",
      dagenInFase: dagen,
      waardeCents: deal.valueCents,
    };

    if (dagen >= drempelDagen) {
      stil.push({ ...basis, reden: `${dagen} dagen in ${basis.faseLabel}` });
    }
    if (!dealsMetTaak.has(deal.id)) {
      zonderTaak.push({ ...basis, reden: "geen openstaande taak" });
    }
  }

  stil.sort((a, b) => b.dagenInFase - a.dagenInFase);
  zonderTaak.sort((a, b) => b.waardeCents - a.waardeCents || b.dagenInFase - a.dagenInFase);

  const eigenAfspraken = afsprakenVoorMerk(afspraken, relevanteDeals, merk);
  const dagGrens = `${vandaag}T00:00:00.000Z`;
  const overmorgen = new Date(Date.parse(dagGrens) + 2 * 86_400_000).toISOString();

  const blijvenLiggen: OpvolgingAfspraak[] = [];
  const zonderUitkomst: OpvolgingAfspraak[] = [];
  const binnenkort: OpvolgingAfspraak[] = [];

  for (const afspraak of eigenAfspraken) {
    const kort: OpvolgingAfspraak = {
      id: afspraak.id,
      title: afspraak.title,
      startsAt: afspraak.startsAt,
      dealId: afspraak.dealId,
      organizationId: afspraak.organizationId,
    };

    if (afspraak.status === "gepland") {
      // Het moment is voorbij en er is niets bijgewerkt. Zolang dat zo blijft,
      // klopt de telling van gehouden gesprekken niet.
      if (afspraak.endsAt < dagGrens) blijvenLiggen.push(kort);
      else if (afspraak.startsAt < overmorgen) binnenkort.push(kort);
      continue;
    }

    if (afspraak.status === "gehouden" && !afspraak.outcome?.trim()) {
      zonderUitkomst.push(kort);
    }
  }

  blijvenLiggen.sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  zonderUitkomst.sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  binnenkort.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return {
    achterstalligeTaken: achterstallig.slice(0, maximumPerLijst),
    takenVandaag: vandaagLijst.slice(0, maximumPerLijst),
    afsprakenBlijvenLiggen: blijvenLiggen.slice(0, maximumPerLijst),
    afsprakenZonderUitkomst: zonderUitkomst.slice(0, maximumPerLijst),
    afsprakenBinnenkort: binnenkort.slice(0, maximumPerLijst),
    stilstaandeDeals: stil.slice(0, maximumPerLijst),
    dealsZonderTaak: zonderTaak.slice(0, maximumPerLijst),
  };
}

/**
 * Welke afspraken bij het gekozen merk horen.
 *
 * Dezelfde regel als bij taken: hangt hij aan een deal, dan volgt het merk uit
 * die deal. Hangt hij alleen aan een organisatie, dan telt hij mee bij
 * "Alles". Zo wordt een afspraak nooit aan het verkeerde merk toegeschreven en
 * verdwijnt hij ook nergens stilletjes uit beeld.
 */
export function afsprakenVoorMerk(
  afspraken: AfspraakInvoer[],
  deals: DealInvoer[],
  merk: MerkFilter
): AfspraakInvoer[] {
  if (merk === "alles") return afspraken;
  const dealIds = new Set(deals.filter((d) => merkPast(d.brand, merk)).map((d) => d.id));
  return afspraken.filter((a) => a.dealId !== null && dealIds.has(a.dealId));
}

// -----------------------------------------------------------------------------
// Alles bij elkaar
// -----------------------------------------------------------------------------

export interface DashboardCijfers {
  kpis: Kpis;
  pijplijn: PijplijnAnalyse;
  faseDoorlooptijden: FaseDoorlooptijd[];
  maandOmzet: MaandOmzet[];
  klanten: KlantAnalyse;
  klantenbehoud: Klantenbehoud;
  opvolging: Opvolging;
}

export function berekenDashboard(invoer: DashboardInvoer): DashboardCijfers {
  const { deals, fases, gebeurtenissen, facturen, suriBetalingen, taken, afspraken, periode, merk, vandaag } =
    invoer;

  return {
    kpis: berekenKpis(invoer),
    pijplijn: analyseerPijplijn(deals, fases, merk, vandaag),
    faseDoorlooptijden: doorlooptijdPerFase(deals, gebeurtenissen, fases, merk),
    maandOmzet: omzetPerMaand(facturen, suriBetalingen, merk, vandaag),
    klanten:
      merkPast("skool_workshop", merk)
        ? analyseerKlanten(facturen, periode)
        : {
            perOrganisatie: [],
            nieuweKlanten: 0,
            bestaandeKlanten: 0,
            omzetNieuwCents: 0,
            omzetBestaandCents: 0,
          },
    klantenbehoud: berekenKlantenbehoud(deals, fases, merk, vandaag),
    opvolging: bepaalOpvolging(deals, fases, taken, merk, vandaag, afspraken),
  };
}

/** Een percentage netjes op het scherm, zonder nepprecisie. */
export function formatPercentage(waarde: number | null): string {
  if (waarde === null) return "—";
  return `${waarde.toFixed(waarde < 10 ? 1 : 0).replace(".", ",")}%`;
}

/** Een aantal dagen als tekst, of "onvoldoende data" als het er te weinig zijn. */
export function formatDagen(m: Meting): string {
  if (!m.voldoendeData || m.gemiddelde === null) return "onvoldoende data";
  const dagen = Math.round(m.gemiddelde);
  return dagen === 1 ? "1 dag" : `${dagen} dagen`;
}
