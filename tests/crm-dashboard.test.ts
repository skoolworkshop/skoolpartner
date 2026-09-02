import { describe, expect, it } from "vitest";

import {
  analyseerKlanten,
  analyseerPijplijn,
  bepaalOpvolging,
  berekenDashboard,
  berekenKlantenbehoud,
  berekenKpis,
  berekenOmzet,
  doorlooptijdPerFase,
  formatDagen,
  inPeriode,
  maakPeriode,
  meting,
  omzetPerMaand,
  parseMerkFilter,
  takenVoorMerk,
  afsprakenVoorMerk,
  type AfspraakInvoer,
  type DashboardInvoer,
  type DealGebeurtenisInvoer,
  type DealInvoer,
  type FactuurInvoer,
  type FaseInvoer,
  type SuriBetalingInvoer,
  type TaakInvoer,
} from "@/lib/crm/dashboard-berekening";

/**
 * De controles op het commerciele dashboard.
 *
 * Waar het hier vooral om gaat, en waarom deze test bestaat:
 *
 *   1. GEEN DUBBELE OMZET. De dealwaarde is een verwachting en mag nooit bij
 *      de betaalde facturen worden opgeteld. De twee echte bronnen, facturen
 *      en Suri-betalingen, mogen elkaar niet overlappen.
 *   2. Het merkfilter moet overal doorwerken en nergens iets laten weglekken.
 *   3. Het periodefilter moet op de grenzen kloppen, inclusief beide dagen.
 *   4. Gewonnen en verloren moeten geteld worden op de fase en het moment van
 *      afsluiten, niet op iets anders.
 *   5. Een doorlooptijd zonder genoeg metingen levert geen getal op.
 *   6. De pijplijnwaarde bevat alleen lopende deals.
 *   7. Er wordt nergens een CRM-contact aan een SkoolPartner-account gekoppeld.
 */

// -----------------------------------------------------------------------------
// Een klein maar volledig testwereldje
// -----------------------------------------------------------------------------

const SW_NIEUW: FaseInvoer = {
  id: "sw-1",
  brand: "skool_workshop",
  key: "nieuwe_aanvraag",
  label: "Nieuwe aanvraag",
  position: 10,
  isWon: false,
  isLost: false,
};
const SW_OFFERTE: FaseInvoer = {
  id: "sw-2",
  brand: "skool_workshop",
  key: "offerte_verstuurd",
  label: "Offerte verstuurd",
  position: 30,
  isWon: false,
  isLost: false,
};
const SW_AFGEROND: FaseInvoer = {
  id: "sw-9",
  brand: "skool_workshop",
  key: "afgerond",
  label: "Afgerond",
  position: 100,
  isWon: true,
  isLost: false,
};
const SW_VERLOREN: FaseInvoer = {
  id: "sw-0",
  brand: "skool_workshop",
  key: "verloren",
  label: "Niet doorgegaan",
  position: 200,
  isWon: false,
  isLost: true,
};
const SU_AANMELDING: FaseInvoer = {
  id: "su-1",
  brand: "suri_impact",
  key: "aanmelding",
  label: "Aanmelding",
  position: 10,
  isWon: false,
  isLost: false,
};
const SU_BETAALD: FaseInvoer = {
  id: "su-9",
  brand: "suri_impact",
  key: "volledig_betaald",
  label: "Volledig betaald",
  position: 100,
  isWon: true,
  isLost: false,
};

const FASES = [SW_NIEUW, SW_OFFERTE, SW_AFGEROND, SW_VERLOREN, SU_AANMELDING, SU_BETAALD];

const VANDAAG = "2026-09-02";

function deal(waarden: Partial<DealInvoer> & { id: string; stageId: string }): DealInvoer {
  return {
    brand: "skool_workshop",
    title: `Deal ${waarden.id}`,
    organizationId: "org-1",
    contactId: null,
    valueCents: 100_000,
    expectedDate: null,
    createdAt: "2026-08-01T10:00:00Z",
    closedAt: null,
    stageSince: "2026-08-01T10:00:00Z",
    ownerId: null,
    ...waarden,
  };
}

function taak(waarden: Partial<TaakInvoer> & { id: string }): TaakInvoer {
  return {
    title: `Taak ${waarden.id}`,
    dueOn: null,
    doneAt: null,
    dealId: null,
    organizationId: null,
    contactId: null,
    ownerId: null,
    ...waarden,
  };
}

// -----------------------------------------------------------------------------
// Periodes
// -----------------------------------------------------------------------------

describe("maakPeriode", () => {
  it("vandaag is een dag, begin en eind gelijk", () => {
    const p = maakPeriode("vandaag", "2026-09-02");
    expect(p.vanaf).toBe("2026-09-02");
    expect(p.tot).toBe("2026-09-02");
  });

  it("de week begint op maandag", () => {
    // 2 september 2026 is een woensdag.
    const p = maakPeriode("deze-week", "2026-09-02");
    expect(p.vanaf).toBe("2026-08-31");
    expect(p.tot).toBe("2026-09-06");
  });

  it("op zondag hoort de week bij de maandag ervoor", () => {
    // 6 september 2026 is een zondag. Zonder de correctie zou de week hier
    // opnieuw beginnen en zou de zondag in zijn eentje staan.
    const p = maakPeriode("deze-week", "2026-09-06");
    expect(p.vanaf).toBe("2026-08-31");
    expect(p.tot).toBe("2026-09-06");
  });

  it("de maand loopt tot en met de laatste dag", () => {
    expect(maakPeriode("deze-maand", "2026-02-14")).toMatchObject({
      vanaf: "2026-02-01",
      tot: "2026-02-28",
    });
  });

  it("vorig kwartaal is een afgesloten blok", () => {
    // September zit in Q3, dus vorig kwartaal is Q2.
    expect(maakPeriode("vorig-kwartaal", "2026-09-02")).toMatchObject({
      vanaf: "2026-04-01",
      tot: "2026-06-30",
    });
  });

  it("vorig kwartaal in januari kijkt naar het jaar ervoor", () => {
    expect(maakPeriode("vorig-kwartaal", "2026-01-15")).toMatchObject({
      vanaf: "2025-10-01",
      tot: "2025-12-31",
    });
  });

  it("dit jaar is het hele kalenderjaar", () => {
    expect(maakPeriode("dit-jaar", "2026-09-02")).toMatchObject({
      vanaf: "2026-01-01",
      tot: "2026-12-31",
    });
  });

  it("een aangepaste periode mag omgedraaid worden ingevoerd", () => {
    const p = maakPeriode("aangepast", VANDAAG, { vanaf: "2026-05-10", tot: "2026-03-01" });
    expect(p.vanaf).toBe("2026-03-01");
    expect(p.tot).toBe("2026-05-10");
  });

  it("een onvolledige aangepaste periode valt terug op deze maand", () => {
    const p = maakPeriode("aangepast", VANDAAG, { vanaf: "2026-05-10", tot: null });
    expect(p.vanaf).toBe("2026-09-01");
  });
});

describe("inPeriode", () => {
  const p = maakPeriode("deze-maand", VANDAAG);

  it("neemt beide grenzen mee", () => {
    expect(inPeriode("2026-09-01", p)).toBe(true);
    expect(inPeriode("2026-09-30", p)).toBe(true);
  });

  it("laat de dag ervoor en erna buiten", () => {
    expect(inPeriode("2026-08-31", p)).toBe(false);
    expect(inPeriode("2026-10-01", p)).toBe(false);
  });

  it("negeert de tijd achter een tijdstip", () => {
    expect(inPeriode("2026-09-30T23:59:00Z", p)).toBe(true);
  });

  it("iets zonder datum valt nooit in een periode", () => {
    expect(inPeriode(null, p)).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Omzet: de belangrijkste controle van dit bestand
// -----------------------------------------------------------------------------

describe("berekenOmzet", () => {
  const facturen: FactuurInvoer[] = [
    { organizationId: "org-1", betaaldOp: "2026-09-10", betaaldCents: 145_000 },
    { organizationId: "org-2", betaaldOp: "2026-09-20", betaaldCents: 55_000 },
    { organizationId: "org-3", betaaldOp: "2026-08-31", betaaldCents: 999_999 },
    { organizationId: "org-4", betaaldOp: null, betaaldCents: 42_000 },
  ];
  const suri: SuriBetalingInvoer[] = [
    { dealId: "d-suri", amountCents: 60_000, ontvangenOp: "2026-09-05" },
    { dealId: "d-suri", amountCents: -10_000, ontvangenOp: "2026-09-06" },
    { dealId: "d-suri2", amountCents: 30_000, ontvangenOp: "2026-07-01" },
  ];
  const periode = maakPeriode("deze-maand", VANDAAG);

  it("telt bij Alles de twee bronnen op, en niets anders", () => {
    const omzet = berekenOmzet(facturen, suri, periode, "alles");
    expect(omzet.skoolWorkshopCents).toBe(200_000);
    expect(omzet.suriImpactCents).toBe(50_000);
    expect(omzet.totaalCents).toBe(250_000);
  });

  it("telt de omzet van beide merken samen precies een keer", () => {
    // De harde controle op dubbeltelling: het totaal bij Alles moet exact
    // gelijk zijn aan de twee merken los opgeteld. Geen euro meer, geen minder.
    const alles = berekenOmzet(facturen, suri, periode, "alles");
    const skool = berekenOmzet(facturen, suri, periode, "skool_workshop");
    const suriOmzet = berekenOmzet(facturen, suri, periode, "suri_impact");

    expect(alles.totaalCents).toBe(skool.totaalCents + suriOmzet.totaalCents);
    expect(skool.suriImpactCents).toBe(0);
    expect(suriOmzet.skoolWorkshopCents).toBe(0);
  });

  it("rekent een terugbetaling eraf in plaats van erbij", () => {
    expect(berekenOmzet([], suri, periode, "suri_impact").suriImpactCents).toBe(50_000);
  });

  it("houdt een factuur zonder betaaldatum apart in plaats van hem stilletjes mee te tellen", () => {
    const omzet = berekenOmzet(facturen, suri, periode, "skool_workshop");
    expect(omzet.zonderDatumCents).toBe(42_000);
    expect(omzet.skoolWorkshopCents).toBe(200_000);
  });
});

describe("omzet en dealwaarde blijven gescheiden", () => {
  /*
    Dit is het scenario waar het misgaat als iemand ooit besluit dat een
    gewonnen deal "ook wel omzet is": dezelfde opdracht van 1450 euro staat
    dan zowel als dealwaarde als als betaalde factuur in het systeem, en het
    dashboard laat 2900 euro zien.
  */
  const gewonnen = deal({
    id: "d-1",
    stageId: SW_AFGEROND.id,
    valueCents: 145_000,
    createdAt: "2026-08-20T09:00:00Z",
    closedAt: "2026-09-01T09:00:00Z",
  });
  const facturen: FactuurInvoer[] = [
    { organizationId: "org-1", betaaldOp: "2026-09-10", betaaldCents: 145_000 },
  ];

  it("telt de gewonnen dealwaarde niet bij de omzet op", () => {
    const kpis = berekenKpis({
      deals: [gewonnen],
      fases: FASES,
      gebeurtenissen: [],
      facturen,
      suriBetalingen: [],
      taken: [],
      afspraken: [],
      periode: maakPeriode("deze-maand", VANDAAG),
      merk: "alles",
      vandaag: VANDAAG,
    });

    expect(kpis.gewonnenDeals).toBe(1);
    expect(kpis.gemiddeldeDealwaardeCents).toBe(145_000);
    // En de omzet is het bedrag van de factuur, niet het dubbele.
    expect(kpis.omzet.totaalCents).toBe(145_000);
  });

  it("rekent de gewonnen deal niet mee in de open pijplijnwaarde", () => {
    const kpis = berekenKpis({
      deals: [gewonnen, deal({ id: "d-2", stageId: SW_OFFERTE.id, valueCents: 80_000 })],
      fases: FASES,
      gebeurtenissen: [],
      facturen: [],
      suriBetalingen: [],
      taken: [],
      afspraken: [],
      periode: maakPeriode("deze-maand", VANDAAG),
      merk: "alles",
      vandaag: VANDAAG,
    });

    expect(kpis.openDeals).toBe(1);
    expect(kpis.openWaardeCents).toBe(80_000);
  });
});

// -----------------------------------------------------------------------------
// De kerncijfers
// -----------------------------------------------------------------------------

describe("berekenKpis", () => {
  const deals: DealInvoer[] = [
    // Deze maand aangemaakt, loopt nog.
    deal({ id: "open-1", stageId: SW_NIEUW.id, createdAt: "2026-09-01T08:00:00Z", valueCents: 50_000 }),
    // Vorige maand aangemaakt, loopt nog.
    deal({ id: "open-2", stageId: SW_OFFERTE.id, createdAt: "2026-08-05T08:00:00Z", valueCents: 70_000 }),
    // Deze maand gewonnen.
    deal({
      id: "gewonnen-1",
      stageId: SW_AFGEROND.id,
      createdAt: "2026-08-02T08:00:00Z",
      closedAt: "2026-09-01T08:00:00Z",
      valueCents: 120_000,
    }),
    // Deze maand verloren.
    deal({
      id: "verloren-1",
      stageId: SW_VERLOREN.id,
      createdAt: "2026-07-01T08:00:00Z",
      closedAt: "2026-09-02T08:00:00Z",
      valueCents: 30_000,
    }),
    // Vorige maand gewonnen: telt niet mee in deze maand.
    deal({
      id: "gewonnen-oud",
      stageId: SW_AFGEROND.id,
      createdAt: "2026-06-01T08:00:00Z",
      closedAt: "2026-08-15T08:00:00Z",
      valueCents: 900_000,
    }),
    // Suri, deze maand gewonnen.
    deal({
      id: "suri-1",
      brand: "suri_impact",
      stageId: SU_BETAALD.id,
      organizationId: null,
      contactId: "c-1",
      createdAt: "2026-08-10T08:00:00Z",
      closedAt: "2026-09-01T08:00:00Z",
      valueCents: 250_000,
    }),
  ];

  const basis: DashboardInvoer = {
    deals,
    fases: FASES,
    gebeurtenissen: [],
    facturen: [],
    suriBetalingen: [],
    taken: [],
    afspraken: [],
    periode: maakPeriode("deze-maand", VANDAAG),
    merk: "alles",
    vandaag: VANDAAG,
  };

  it("telt nieuwe, open, gewonnen en verloren deals uit elkaar", () => {
    const kpis = berekenKpis(basis);
    expect(kpis.nieuweDeals).toBe(1);
    expect(kpis.openDeals).toBe(2);
    expect(kpis.openWaardeCents).toBe(120_000);
    expect(kpis.gewonnenDeals).toBe(2);
    expect(kpis.verlorenDeals).toBe(1);
  });

  it("rekent de conversie over wat er in de periode is afgesloten", () => {
    // Twee gewonnen, een verloren.
    expect(berekenKpis(basis).conversiePercentage).toBeCloseTo((2 / 3) * 100, 5);
  });

  it("geeft geen conversiepercentage als er niets is afgesloten", () => {
    const kpis = berekenKpis({ ...basis, periode: maakPeriode("vandaag", "2026-09-15") });
    expect(kpis.conversiePercentage).toBeNull();
  });

  it("filtert op merk zonder iets te laten weglekken", () => {
    const skool = berekenKpis({ ...basis, merk: "skool_workshop" });
    const suri = berekenKpis({ ...basis, merk: "suri_impact" });
    const alles = berekenKpis(basis);

    expect(skool.gewonnenDeals).toBe(1);
    expect(suri.gewonnenDeals).toBe(1);
    expect(alles.gewonnenDeals).toBe(skool.gewonnenDeals + suri.gewonnenDeals);
    expect(alles.openDeals).toBe(skool.openDeals + suri.openDeals);
    expect(alles.openWaardeCents).toBe(skool.openWaardeCents + suri.openWaardeCents);
  });

  it("rekent de gemiddelde dealwaarde over de gewonnen deals van de periode", () => {
    const skool = berekenKpis({ ...basis, merk: "skool_workshop" });
    expect(skool.gemiddeldeDealwaardeCents).toBe(120_000);
  });

  it("telt een deal die vorige maand is gewonnen niet mee in deze maand", () => {
    const vorige = berekenKpis({
      ...basis,
      afspraken: [],
      periode: maakPeriode("aangepast", VANDAAG, { vanaf: "2026-08-01", tot: "2026-08-31" }),
      merk: "skool_workshop",
    });
    expect(vorige.gewonnenDeals).toBe(1);
    expect(vorige.gemiddeldeDealwaardeCents).toBe(900_000);
  });

  it("telt een afgesloten deal zonder afsluitmoment nergens mee", () => {
    const zonder = berekenKpis({
      ...basis,
      deals: [deal({ id: "raar", stageId: SW_AFGEROND.id, closedAt: null })],
    });
    expect(zonder.gewonnenDeals).toBe(0);
    expect(zonder.openDeals).toBe(0);
  });
});

describe("openstaande en achterstallige taken", () => {
  const deals = [
    deal({ id: "sw-deal", stageId: SW_NIEUW.id }),
    deal({
      id: "suri-deal",
      brand: "suri_impact",
      stageId: SU_AANMELDING.id,
      organizationId: null,
      contactId: "c-1",
    }),
  ];
  const taken = [
    taak({ id: "t1", dealId: "sw-deal", dueOn: "2026-08-20" }),
    taak({ id: "t2", dealId: "sw-deal", dueOn: "2026-09-10" }),
    taak({ id: "t3", dealId: "suri-deal", dueOn: "2026-08-01" }),
    taak({ id: "t4", dueOn: "2026-08-01" }),
    taak({ id: "t5", dealId: "sw-deal", dueOn: "2026-01-01", doneAt: "2026-02-01T10:00:00Z" }),
  ];

  const basis: DashboardInvoer = {
    deals,
    fases: FASES,
    gebeurtenissen: [],
    facturen: [],
    suriBetalingen: [],
    taken,
    afspraken: [],
    periode: maakPeriode("deze-maand", VANDAAG),
    merk: "alles",
    vandaag: VANDAAG,
  };

  it("telt alleen wat nog niet af is", () => {
    const kpis = berekenKpis(basis);
    expect(kpis.openstaandeTaken).toBe(4);
    expect(kpis.achterstalligeTaken).toBe(3);
  });

  it("hangt een taak aan het merk van zijn deal", () => {
    expect(berekenKpis({ ...basis, merk: "skool_workshop" }).openstaandeTaken).toBe(2);
    expect(berekenKpis({ ...basis, merk: "suri_impact" }).openstaandeTaken).toBe(1);
  });

  it("laat een losse taak alleen bij Alles meetellen", () => {
    expect(takenVoorMerk(taken, deals, "alles")).toHaveLength(5);
    expect(takenVoorMerk(taken, deals, "skool_workshop").map((t) => t.id)).toEqual([
      "t1",
      "t2",
      "t5",
    ]);
  });
});

// -----------------------------------------------------------------------------
// De pijplijn
// -----------------------------------------------------------------------------

describe("analyseerPijplijn", () => {
  const deals: DealInvoer[] = [
    deal({ id: "a", stageId: SW_NIEUW.id, stageSince: "2026-09-01T00:00:00Z", valueCents: 10_000 }),
    deal({ id: "b", stageId: SW_NIEUW.id, stageSince: "2026-06-01T00:00:00Z", valueCents: 20_000 }),
    deal({ id: "c", stageId: SW_OFFERTE.id, stageSince: "2026-08-30T00:00:00Z", valueCents: 30_000 }),
    // Afgesloten: hoort niet in de pijplijnkolommen.
    deal({
      id: "d",
      stageId: SW_AFGEROND.id,
      closedAt: "2026-09-01T00:00:00Z",
      valueCents: 999_000,
    }),
  ];

  it("toont alleen lopende fases en telt daar de waarde van", () => {
    const analyse = analyseerPijplijn(deals, FASES, "skool_workshop", VANDAAG);
    expect(analyse.fases.map((f) => f.fase.key)).toEqual(["nieuwe_aanvraag", "offerte_verstuurd"]);
    expect(analyse.totaalOpen).toBe(3);
    expect(analyse.totaalWaardeCents).toBe(60_000);
  });

  it("wijst de oudste deal aan", () => {
    const analyse = analyseerPijplijn(deals, FASES, "skool_workshop", VANDAAG);
    expect(analyse.oudste?.id).toBe("b");
    expect(analyse.oudste?.dagen).toBe(93);
  });

  it("telt hoeveel deals te lang stilstaan", () => {
    const analyse = analyseerPijplijn(deals, FASES, "skool_workshop", VANDAAG, 30);
    expect(analyse.teLangTotaal).toBe(1);
  });

  it("houdt de merken uit elkaar", () => {
    const metSuri = [
      ...deals,
      deal({
        id: "s",
        brand: "suri_impact",
        stageId: SU_AANMELDING.id,
        organizationId: null,
        contactId: "c-1",
        valueCents: 250_000,
      }),
    ];
    expect(analyseerPijplijn(metSuri, FASES, "skool_workshop", VANDAAG).totaalWaardeCents).toBe(
      60_000
    );
    expect(analyseerPijplijn(metSuri, FASES, "suri_impact", VANDAAG).totaalWaardeCents).toBe(
      250_000
    );
    expect(analyseerPijplijn(metSuri, FASES, "alles", VANDAAG).totaalWaardeCents).toBe(310_000);
  });
});

// -----------------------------------------------------------------------------
// Doorlooptijden uit de echte historie
// -----------------------------------------------------------------------------

describe("doorlooptijdPerFase", () => {
  function reeks(id: string, dagenInEerste: number, dagenInTweede: number): {
    deal: DealInvoer;
    gebeurtenissen: DealGebeurtenisInvoer[];
  } {
    const start = Date.parse("2026-01-01T00:00:00Z");
    const eerste = start + dagenInEerste * 86_400_000;
    const tweede = eerste + dagenInTweede * 86_400_000;
    return {
      deal: deal({
        id,
        stageId: SW_AFGEROND.id,
        createdAt: new Date(start).toISOString(),
        closedAt: new Date(tweede).toISOString(),
      }),
      gebeurtenissen: [
        {
          dealId: id,
          fromStageId: SW_NIEUW.id,
          toStageId: SW_OFFERTE.id,
          createdAt: new Date(eerste).toISOString(),
        },
        {
          dealId: id,
          fromStageId: SW_OFFERTE.id,
          toStageId: SW_AFGEROND.id,
          createdAt: new Date(tweede).toISOString(),
        },
      ],
    };
  }

  it("zegt onvoldoende data als er te weinig verblijven zijn", () => {
    const een = reeks("x", 5, 10);
    const uitkomst = doorlooptijdPerFase(
      [een.deal],
      een.gebeurtenissen,
      FASES,
      "skool_workshop"
    );
    const nieuw = uitkomst.find((r) => r.fase.key === "nieuwe_aanvraag");
    expect(nieuw?.meting.aantal).toBe(1);
    expect(nieuw?.meting.voldoendeData).toBe(false);
    expect(nieuw?.meting.gemiddelde).toBeNull();
    expect(formatDagen(nieuw!.meting)).toBe("onvoldoende data");
  });

  it("rekent het gemiddelde zodra er genoeg metingen zijn", () => {
    const alles = [2, 4, 6, 8, 10].map((d, i) => reeks(`d${i}`, d, 3));
    const uitkomst = doorlooptijdPerFase(
      alles.map((a) => a.deal),
      alles.flatMap((a) => a.gebeurtenissen),
      FASES,
      "skool_workshop"
    );

    const nieuw = uitkomst.find((r) => r.fase.key === "nieuwe_aanvraag");
    expect(nieuw?.meting.aantal).toBe(5);
    expect(nieuw?.meting.gemiddelde).toBe(6);
    expect(nieuw?.meting.mediaan).toBe(6);
    expect(formatDagen(nieuw!.meting)).toBe("6 dagen");

    const offerte = uitkomst.find((r) => r.fase.key === "offerte_verstuurd");
    expect(offerte?.meting.gemiddelde).toBe(3);
  });

  it("rekent de fase waar een deal nu in staat niet mee", () => {
    // Een deal die net is aangemaakt en nergens heen is gegaan, levert geen
    // enkele meting op. Zou de huidige fase wel meetellen, dan zouden alle
    // gemiddelden structureel te laag worden.
    const lopend = deal({ id: "lopend", stageId: SW_NIEUW.id, createdAt: "2026-09-01T00:00:00Z" });
    const uitkomst = doorlooptijdPerFase([lopend], [], FASES, "skool_workshop");
    expect(uitkomst.every((r) => r.meting.aantal === 0)).toBe(true);
  });

  it("negeert de historie van een deal van het andere merk", () => {
    const een = reeks("x", 5, 10);
    const uitkomst = doorlooptijdPerFase(
      [een.deal],
      een.gebeurtenissen,
      FASES,
      "suri_impact"
    );
    expect(uitkomst.every((r) => r.meting.aantal === 0)).toBe(true);
  });
});

describe("meting", () => {
  it("berekent de mediaan bij een even aantal", () => {
    expect(meting([1, 2, 3, 4, 5, 6], 3).mediaan).toBe(3.5);
  });

  it("zwijgt onder de ondergrens", () => {
    expect(meting([10, 10], 5)).toMatchObject({ gemiddelde: null, voldoendeData: false });
  });
});

// -----------------------------------------------------------------------------
// Omzet per maand
// -----------------------------------------------------------------------------

describe("omzetPerMaand", () => {
  const facturen: FactuurInvoer[] = [
    { organizationId: "org-1", betaaldOp: "2026-09-10", betaaldCents: 100_000 },
    { organizationId: "org-1", betaaldOp: "2026-08-10", betaaldCents: 50_000 },
    { organizationId: "org-1", betaaldOp: "2024-01-10", betaaldCents: 777_000 },
  ];
  const suri: SuriBetalingInvoer[] = [
    { dealId: "d", amountCents: 20_000, ontvangenOp: "2026-09-15" },
  ];

  it("geeft precies de gevraagde reeks maanden, oplopend", () => {
    const reeks = omzetPerMaand(facturen, suri, "alles", VANDAAG, 12);
    expect(reeks).toHaveLength(12);
    expect(reeks[0].maand).toBe("2025-10");
    expect(reeks[11].maand).toBe("2026-09");
  });

  it("houdt de merken in dezelfde maand uit elkaar", () => {
    const reeks = omzetPerMaand(facturen, suri, "alles", VANDAAG, 12);
    const september = reeks.find((r) => r.maand === "2026-09");
    expect(september).toMatchObject({
      skoolWorkshopCents: 100_000,
      suriImpactCents: 20_000,
      totaalCents: 120_000,
    });
  });

  it("laat wat buiten de reeks valt gewoon weg", () => {
    const totaal = omzetPerMaand(facturen, suri, "skool_workshop", VANDAAG, 12).reduce(
      (som, r) => som + r.totaalCents,
      0
    );
    expect(totaal).toBe(150_000);
  });
});

// -----------------------------------------------------------------------------
// Klanten
// -----------------------------------------------------------------------------

describe("analyseerKlanten", () => {
  const facturen: FactuurInvoer[] = [
    { organizationId: "oud", betaaldOp: "2024-03-01", betaaldCents: 100_000 },
    { organizationId: "oud", betaaldOp: "2026-09-05", betaaldCents: 80_000 },
    { organizationId: "nieuw", betaaldOp: "2026-09-08", betaaldCents: 200_000 },
    { organizationId: "nieuw", betaaldOp: "2026-09-20", betaaldCents: 20_000 },
    { organizationId: null, betaaldOp: "2026-09-08", betaaldCents: 5_000 },
  ];
  const periode = maakPeriode("deze-maand", VANDAAG);

  it("noemt een klant nieuw als zijn eerste betaling in de periode valt", () => {
    const analyse = analyseerKlanten(facturen, periode);
    expect(analyse.nieuweKlanten).toBe(1);
    expect(analyse.bestaandeKlanten).toBe(1);
    expect(analyse.omzetNieuwCents).toBe(220_000);
    expect(analyse.omzetBestaandCents).toBe(80_000);
  });

  it("sorteert op omzet en telt de facturen per organisatie", () => {
    const analyse = analyseerKlanten(facturen, periode);
    expect(analyse.perOrganisatie[0]).toMatchObject({
      organizationId: "nieuw",
      omzetCents: 220_000,
      aantalFacturen: 2,
    });
  });

  it("negeert een factuur zonder organisatie", () => {
    const analyse = analyseerKlanten(facturen, periode);
    expect(analyse.perOrganisatie).toHaveLength(2);
  });
});

describe("berekenKlantenbehoud", () => {
  const deals: DealInvoer[] = [
    deal({
      id: "h1",
      organizationId: "herhaal",
      stageId: SW_AFGEROND.id,
      closedAt: "2024-05-01T00:00:00Z",
    }),
    deal({
      id: "h2",
      organizationId: "herhaal",
      stageId: SW_AFGEROND.id,
      closedAt: "2026-01-01T00:00:00Z",
    }),
    deal({
      id: "e1",
      organizationId: "eenmalig",
      stageId: SW_AFGEROND.id,
      closedAt: "2023-01-01T00:00:00Z",
    }),
    deal({ id: "l1", organizationId: "lopend", stageId: SW_NIEUW.id }),
  ];

  it("telt herhaalklanten", () => {
    const behoud = berekenKlantenbehoud(deals, FASES, "skool_workshop", VANDAAG);
    expect(behoud.klantenMetWinst).toBe(2);
    expect(behoud.herhaalklanten).toBe(1);
    expect(behoud.herhaalPercentage).toBe(50);
  });

  it("noemt een klant slapend als hij lang niets meer heeft en niets loopt", () => {
    const behoud = berekenKlantenbehoud(deals, FASES, "skool_workshop", VANDAAG, 365);
    expect(behoud.slapend.map((s) => s.organizationId)).toEqual(["eenmalig"]);
  });

  it("noemt een klant met een lopende deal nooit slapend", () => {
    const metLopend = [
      ...deals,
      deal({ id: "e2", organizationId: "eenmalig", stageId: SW_OFFERTE.id }),
    ];
    expect(berekenKlantenbehoud(metLopend, FASES, "skool_workshop", VANDAAG).slapend).toHaveLength(
      0
    );
  });
});

// -----------------------------------------------------------------------------
// Opvolging
// -----------------------------------------------------------------------------

describe("bepaalOpvolging", () => {
  const deals: DealInvoer[] = [
    deal({ id: "stil", stageId: SW_OFFERTE.id, stageSince: "2026-06-01T00:00:00Z" }),
    deal({ id: "vers", stageId: SW_NIEUW.id, stageSince: "2026-09-01T00:00:00Z" }),
    deal({
      id: "afgerond",
      stageId: SW_AFGEROND.id,
      stageSince: "2026-01-01T00:00:00Z",
      closedAt: "2026-02-01T00:00:00Z",
    }),
  ];
  const taken = [
    taak({ id: "laat", dealId: "stil", dueOn: "2026-08-01" }),
    taak({ id: "nu", dealId: "stil", dueOn: VANDAAG }),
    taak({ id: "klaar", dealId: "vers", dueOn: "2026-08-01", doneAt: "2026-08-02T09:00:00Z" }),
  ];

  it("zet achterstallige taken vooraan en de taken van vandaag apart", () => {
    const opvolging = bepaalOpvolging(deals, FASES, taken, "skool_workshop", VANDAAG);
    expect(opvolging.achterstalligeTaken.map((t) => t.id)).toEqual(["laat"]);
    expect(opvolging.takenVandaag.map((t) => t.id)).toEqual(["nu"]);
  });

  it("laat alleen lopende deals zien die te lang stilstaan", () => {
    const opvolging = bepaalOpvolging(deals, FASES, taken, "skool_workshop", VANDAAG);
    expect(opvolging.stilstaandeDeals.map((d) => d.id)).toEqual(["stil"]);
  });

  it("wijst lopende deals aan waar niets aan hangt", () => {
    // 'vers' heeft alleen een afgeronde taak, dus daar staat niets open.
    const opvolging = bepaalOpvolging(deals, FASES, taken, "skool_workshop", VANDAAG);
    expect(opvolging.dealsZonderTaak.map((d) => d.id)).toEqual(["vers"]);
  });
});

// -----------------------------------------------------------------------------
// Het geheel, en wat er niet in zit
// -----------------------------------------------------------------------------

describe("berekenDashboard", () => {
  const invoer: DashboardInvoer = {
    deals: [
      deal({ id: "a", stageId: SW_NIEUW.id }),
      deal({
        id: "b",
        brand: "suri_impact",
        stageId: SU_AANMELDING.id,
        organizationId: null,
        contactId: "c-1",
      }),
    ],
    fases: FASES,
    gebeurtenissen: [],
    facturen: [{ organizationId: "org-1", betaaldOp: "2026-09-01", betaaldCents: 100_000 }],
    suriBetalingen: [{ dealId: "b", amountCents: 50_000, ontvangenOp: "2026-09-01" }],
    taken: [taak({ id: "t", dealId: "a", dueOn: "2026-08-01" })],
    afspraken: [],
    periode: maakPeriode("deze-maand", VANDAAG),
    merk: "alles",
    vandaag: VANDAAG,
  };

  it("levert alle blokken op", () => {
    const cijfers = berekenDashboard(invoer);
    expect(cijfers.kpis.omzet.totaalCents).toBe(150_000);
    expect(cijfers.pijplijn.totaalOpen).toBe(2);
    expect(cijfers.maandOmzet).toHaveLength(12);
    expect(cijfers.klanten.perOrganisatie).toHaveLength(1);
  });

  it("laat de klantanalyse leeg bij Suri, want die verkoopt niet aan organisaties", () => {
    const cijfers = berekenDashboard({ ...invoer, merk: "suri_impact" });
    expect(cijfers.klanten.perOrganisatie).toHaveLength(0);
    expect(cijfers.kpis.omzet.skoolWorkshopCents).toBe(0);
    expect(cijfers.kpis.omzet.suriImpactCents).toBe(50_000);
  });

  it("kent geen enkel begrip van een SkoolPartner-account", () => {
    /*
      Het dashboard rekent met deals, fases, facturen, betalingen en taken.
      Nergens komt een portal_user_id, een profiel of een lidmaatschap voorbij,
      en dat hoort zo: een contact in het CRM is geen gebruiker van het
      klantportaal. Deze controle is een vangnet tegen een latere uitbreiding
      die dat onderscheid per ongeluk weggooit.
    */
    const cijfers = berekenDashboard(invoer);
    const alsTekst = JSON.stringify(cijfers);
    expect(alsTekst).not.toContain("portal");
    expect(alsTekst).not.toContain("user_id");
    expect(alsTekst).not.toContain("auth");
  });
});

describe("parseMerkFilter", () => {
  it("valt terug op alles bij onzin", () => {
    expect(parseMerkFilter("kapot")).toBe("alles");
    expect(parseMerkFilter(undefined)).toBe("alles");
    expect(parseMerkFilter("suri_impact")).toBe("suri_impact");
  });
});

// -----------------------------------------------------------------------------
// Afspraken in de opvolging
// -----------------------------------------------------------------------------

describe("afspraken in bepaalOpvolging", () => {
  function afspraak(waarden: Partial<AfspraakInvoer> & { id: string }): AfspraakInvoer {
    return {
      title: `Afspraak ${waarden.id}`,
      startsAt: "2026-09-15T09:00:00.000Z",
      endsAt: "2026-09-15T10:00:00.000Z",
      status: "gepland",
      outcome: null,
      dealId: null,
      organizationId: "org-1",
      ...waarden,
    };
  }

  const deals = [
    deal({ id: "sw-deal", stageId: SW_NIEUW.id }),
    deal({
      id: "suri-deal",
      brand: "suri_impact",
      stageId: SU_AANMELDING.id,
      organizationId: null,
      contactId: "c-1",
    }),
  ];

  const afspraken: AfspraakInvoer[] = [
    // Gepland en het moment is voorbij: hier is niets bijgewerkt.
    afspraak({
      id: "blijft-liggen",
      dealId: "sw-deal",
      startsAt: "2026-08-20T09:00:00.000Z",
      endsAt: "2026-08-20T10:00:00.000Z",
    }),
    // Vandaag.
    afspraak({
      id: "vandaag",
      dealId: "sw-deal",
      startsAt: "2026-09-02T14:00:00.000Z",
      endsAt: "2026-09-02T15:00:00.000Z",
    }),
    // Morgen.
    afspraak({
      id: "morgen",
      dealId: "sw-deal",
      startsAt: "2026-09-03T10:00:00.000Z",
      endsAt: "2026-09-03T11:00:00.000Z",
    }),
    // Volgende week: nog niet "binnenkort".
    afspraak({ id: "volgende-week", dealId: "sw-deal" }),
    // Gehouden zonder dat er iets is vastgelegd.
    afspraak({
      id: "geen-uitkomst",
      dealId: "sw-deal",
      status: "gehouden",
      outcome: "   ",
      startsAt: "2026-08-25T09:00:00.000Z",
      endsAt: "2026-08-25T10:00:00.000Z",
    }),
    // Gehouden met uitkomst: klaar, hoort nergens in de opvolging.
    afspraak({
      id: "netjes",
      dealId: "sw-deal",
      status: "gehouden",
      outcome: "Offerte gevraagd voor maart.",
      startsAt: "2026-08-26T09:00:00.000Z",
      endsAt: "2026-08-26T10:00:00.000Z",
    }),
    // Afgezegd: telt nooit als ontbrekende uitkomst.
    afspraak({
      id: "afgezegd",
      dealId: "sw-deal",
      status: "geannuleerd",
      startsAt: "2026-08-27T09:00:00.000Z",
      endsAt: "2026-08-27T10:00:00.000Z",
    }),
    // Van het andere merk.
    afspraak({
      id: "suri",
      dealId: "suri-deal",
      organizationId: null,
      startsAt: "2026-08-21T09:00:00.000Z",
      endsAt: "2026-08-21T10:00:00.000Z",
    }),
  ];

  it("wijst afspraken aan die blijven liggen", () => {
    const opvolging = bepaalOpvolging(deals, FASES, [], "alles", VANDAAG, afspraken);
    // Meest recente voorop: suri is van 21 augustus, blijft-liggen van 20 augustus.
    // Een gehouden afspraak hoort hier niet bij, ook niet zonder uitkomst.
    expect(opvolging.afsprakenBlijvenLiggen.map((a) => a.id)).toEqual(["suri", "blijft-liggen"]);
  });

  it("toont alleen vandaag en morgen bij binnenkort", () => {
    const opvolging = bepaalOpvolging(deals, FASES, [], "alles", VANDAAG, afspraken);
    expect(opvolging.afsprakenBinnenkort.map((a) => a.id)).toEqual(["vandaag", "morgen"]);
  });

  it("wijst gehouden afspraken zonder uitkomst aan, en alleen die", () => {
    const opvolging = bepaalOpvolging(deals, FASES, [], "alles", VANDAAG, afspraken);
    expect(opvolging.afsprakenZonderUitkomst.map((a) => a.id)).toEqual(["geen-uitkomst"]);
  });

  it("houdt de merken uit elkaar", () => {
    const skool = bepaalOpvolging(deals, FASES, [], "skool_workshop", VANDAAG, afspraken);
    const suri = bepaalOpvolging(deals, FASES, [], "suri_impact", VANDAAG, afspraken);

    expect(skool.afsprakenBlijvenLiggen.map((a) => a.id)).toEqual(["blijft-liggen"]);
    expect(suri.afsprakenBlijvenLiggen.map((a) => a.id)).toEqual(["suri"]);
    expect(suri.afsprakenZonderUitkomst).toEqual([]);
  });

  it("laat een afspraak zonder deal alleen bij Alles meetellen", () => {
    const los = [afspraak({ id: "los", dealId: null, organizationId: "org-9" })];
    expect(afsprakenVoorMerk(los, deals, "alles")).toHaveLength(1);
    expect(afsprakenVoorMerk(los, deals, "skool_workshop")).toHaveLength(0);
  });

  it("werkt zonder afspraken, want die lijst mag leeg zijn", () => {
    const opvolging = bepaalOpvolging(deals, FASES, [], "alles", VANDAAG);
    expect(opvolging.afsprakenBlijvenLiggen).toEqual([]);
    expect(opvolging.afsprakenBinnenkort).toEqual([]);
    expect(opvolging.afsprakenZonderUitkomst).toEqual([]);
  });
});
