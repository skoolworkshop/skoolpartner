import { describe, expect, it } from "vitest";

import {
  AFSPRAAK_STANDEN,
  HUBSPOT_FASES,
  LIFECYCLE_MAP,
  ZZP_LIFECYCLE,
  bepaalFase,
  leesAfspraak,
  leesBedrag,
  leesContact,
  leesDeal,
  kiesContact,
  leesEmail,
  leesMoment,
  leesNaam,
  leesNotitie,
  leesTelefoon,
  naarPlatteTekst,
  maakTelling,
  ontdubbelContacten,
  samenvatting,
  tellRedenen,
  type ContactRij,
  type DealOpties,
} from "@/lib/crm/hubspot-import";

const NU = new Date("2026-09-02T10:00:00.000Z");
const OPTIES: DealOpties = { nu: NU, oudeEvaluaties: "sluiten" };

describe("kleine opschoners", () => {
  it("keurt alleen adressen goed die een adres kunnen zijn", () => {
    expect(leesEmail("Anne@School.NL")).toBe("anne@school.nl");
    expect(leesEmail("  anne@school.nl ")).toBe("anne@school.nl");
    expect(leesEmail("anne@school")).toBeNull();
    expect(leesEmail("@school.nl")).toBeNull();
    expect(leesEmail("anne@")).toBeNull();
    expect(leesEmail("anne school.nl")).toBeNull();
    expect(leesEmail("")).toBeNull();
    expect(leesEmail(null)).toBeNull();
  });

  it("laat telefoonnummers staan zoals ze zijn, maar keurt onzin af", () => {
    expect(leesTelefoon("06 12 34 56 78")).toBe("06 12 34 56 78");
    expect(leesTelefoon("+31 (0)20 123 4567")).toBe("+31 (0)20 123 4567");
    expect(leesTelefoon("123")).toBeNull();
    expect(leesTelefoon("onbekend")).toBeNull();
  });

  it("verzint geen landnummer", () => {
    expect(leesTelefoon("0612345678")).toBe("0612345678");
    expect(leesTelefoon("0612345678")).not.toContain("+31");
  });

  it("maakt van voornaam en achternaam een naam, en anders niets", () => {
    expect(leesNaam("Anne", "de Vries")).toBe("Anne de Vries");
    expect(leesNaam("  Anne  ", "")).toBe("Anne");
    expect(leesNaam("", "")).toBeNull();
    expect(leesNaam("A", "")).toBeNull();
  });

  it("leest datums in beide vormen en weigert onzin", () => {
    expect(leesMoment("2026-03-01T09:00:00Z")).toBe("2026-03-01T09:00:00.000Z");
    expect(leesMoment(1772352000000)).toMatch(/^2026-/);
    expect(leesMoment("")).toBeNull();
    expect(leesMoment("morgen")).toBeNull();
    expect(leesMoment("1970-01-01T00:00:00Z")).toBeNull();
  });

  it("rekent bedragen om naar centen en weigert onzin", () => {
    expect(leesBedrag("1250.50")).toBe(125050);
    expect(leesBedrag("1250,50")).toBe(125050);
    expect(leesBedrag(0)).toBe(0);
    expect(leesBedrag(-100)).toBe(0);
    expect(leesBedrag("")).toBe(0);
    expect(leesBedrag(99_999_999)).toBe(0);
  });
});

describe("contacten", () => {
  it("neemt een compleet contact over", () => {
    const uitkomst = leesContact({
      id: "101",
      firstname: "Anne",
      lastname: "de Vries",
      email: "Anne@School.nl",
      phone: "06 12345678",
      jobtitle: "Cultuurcoordinator",
      city: "Utrecht",
      lifecyclestage: "customer",
    });

    expect(uitkomst.ok).toBe(true);
    if (!uitkomst.ok) return;
    expect(uitkomst.rij).toMatchObject({
      hubspot_id: "101",
      full_name: "Anne de Vries",
      email: "anne@school.nl",
      job_title: "Cultuurcoordinator",
      city: "Utrecht",
      lifecycle: "klant",
      is_unsubscribed: false,
    });
  });

  it("gebruikt het e-mailadres als naam wanneer de naam ontbreekt, en verzint niets", () => {
    const uitkomst = leesContact({ id: "102", email: "info@school.nl" });
    expect(uitkomst.ok).toBe(true);
    if (!uitkomst.ok) return;
    expect(uitkomst.rij.full_name).toBe("info@school.nl");
    expect(uitkomst.naamUitEmail).toBe(true);
    expect(uitkomst.rij.email).toBe("info@school.nl");
  });

  it("slaat alleen over wat geen naam en geen adres heeft", () => {
    const uitkomst = leesContact({ id: "106", phone: "0612345678" });
    expect(uitkomst.ok).toBe(false);
    if (uitkomst.ok) return;
    expect(uitkomst.reden).toBe("geen naam en geen e-mailadres");
  });

  it("neemt een ZZP-er over als leverancier, buiten de verkooppijplijn", () => {
    const bron = {
      id: "103",
      firstname: "Joris",
      lastname: "Bakker",
      email: "joris@example.nl",
      lifecyclestage: ZZP_LIFECYCLE,
    };

    const uitkomst = leesContact(bron);
    expect(uitkomst.ok).toBe(true);
    if (!uitkomst.ok) return;
    expect(uitkomst.rij.contact_type).toBe("leverancier");
    expect(uitkomst.rij.lifecycle).toBeNull();

    const overgeslagen = leesContact(bron, { zzp: "overslaan" });
    expect(overgeslagen.ok).toBe(false);
    if (overgeslagen.ok) return;
    expect(overgeslagen.reden).toContain("ZZP");
  });

  it("houdt een afmelding voor commerciele mail overeind", () => {
    const uitkomst = leesContact({
      id: "104",
      firstname: "Ilse",
      lastname: "Jansen",
      email: "ilse@school.nl",
      hs_email_optout: "true",
    });
    expect(uitkomst.ok).toBe(true);
    if (!uitkomst.ok) return;
    expect(uitkomst.rij.is_unsubscribed).toBe(true);
  });

  it("kent geen levensfase toe aan een waarde die het niet kent", () => {
    const uitkomst = leesContact({
      id: "105",
      firstname: "Sam",
      lastname: "Peters",
      lifecyclestage: "iets_nieuws",
    });
    expect(uitkomst.ok).toBe(true);
    if (!uitkomst.ok) return;
    expect(uitkomst.rij.lifecycle).toBeNull();
  });

  it("voegt alleen samen op een gelijk adres, nooit op een gelijke naam", () => {
    const rijen: ContactRij[] = [
      maakContact("1", "Anne de Vries", "anne@school.nl"),
      maakContact("2", "A. de Vries", "anne@school.nl"),
      maakContact("3", "Anne de Vries", null),
      maakContact("4", "Anne de Vries", null),
    ];

    const { uniek, dubbel } = ontdubbelContacten(rijen);
    expect(uniek.map((r) => r.hubspot_id)).toEqual(["1", "3", "4"]);
    expect(dubbel).toEqual([{ hubspot_id: "2", zelfdeAls: "1", email: "anne@school.nl" }]);
  });
});

describe("fases", () => {
  it("dekt alle negen fases uit de HubSpot-pijplijn", () => {
    expect(Object.keys(HUBSPOT_FASES)).toHaveLength(9);
  });

  it("laat Herinnering niet als gewonnen binnenkomen", () => {
    expect(HUBSPOT_FASES.closedwon.doel).toBe("opvolging");
    expect(HUBSPOT_FASES.closedwon.sluit).toBeNull();

    const { stage_key, closed_at } = bepaalFase(
      { id: "1", dealstage: "closedwon", closedate: "2025-05-01T00:00:00Z" },
      OPTIES
    );
    expect(stage_key).toBe("opvolging");
    expect(closed_at).toBeNull();
  });

  it("sluit een afgewezen offerte op de sluitingsdatum", () => {
    const { stage_key, closed_at } = bepaalFase(
      { id: "2", dealstage: "closedlost", closedate: "2025-05-01T00:00:00Z" },
      OPTIES
    );
    expect(stage_key).toBe("verloren");
    expect(closed_at).toBe("2025-05-01T00:00:00.000Z");
  });

  it("valt bij een verloren deal zonder sluitingsdatum terug op de laatste wijziging en meldt dat", () => {
    const uitkomst = bepaalFase(
      { id: "3", dealstage: "closedlost", hs_lastmodifieddate: "2025-06-01T00:00:00Z" },
      OPTIES
    );
    expect(uitkomst.closed_at).toBe("2025-06-01T00:00:00.000Z");

    const zonder = bepaalFase({ id: "4", dealstage: "closedlost" }, OPTIES);
    expect(zonder.closed_at).toBeNull();
    expect(zonder.melding).toContain("zonder sluitingsdatum");
  });

  it("sluit oude evaluaties alleen als daarvoor is gekozen", () => {
    const deal = { id: "5", dealstage: "729498082", closedate: "2025-02-01T00:00:00Z" };

    expect(bepaalFase(deal, OPTIES).stage_key).toBe("afgerond");
    expect(bepaalFase(deal, { nu: NU, oudeEvaluaties: "laten" }).stage_key).toBe("evaluatie");
  });

  it("laat een evaluatie in de toekomst open staan", () => {
    const uitkomst = bepaalFase(
      { id: "6", dealstage: "729498082", closedate: "2026-12-01T00:00:00Z" },
      OPTIES
    );
    expect(uitkomst.stage_key).toBe("evaluatie");
    expect(uitkomst.closed_at).toBeNull();
  });

  it("meldt een onbekende fase in plaats van hem stil weg te laten", () => {
    const uitkomst = bepaalFase({ id: "7", dealstage: "999999" }, OPTIES);
    expect(uitkomst.melding).toContain("onbekende fase");
  });
});

describe("deals", () => {
  it("neemt een lopende deal over met contact en verwachte datum", () => {
    const uitkomst = leesDeal(
      {
        id: "201",
        dealname: "Workshop 3 klassen",
        dealstage: "729498081",
        amount: "1450",
        closedate: "2026-11-01T00:00:00Z",
        createdate: "2026-06-01T00:00:00Z",
        hs_lastmodifieddate: "2026-08-01T00:00:00Z",
        contactIds: ["101"],
      },
      OPTIES
    );

    expect(uitkomst.ok).toBe(true);
    if (!uitkomst.ok) return;
    expect(uitkomst.rij).toMatchObject({
      hubspot_id: "201",
      title: "Workshop 3 klassen",
      stage_key: "ingepland",
      value_cents: 145000,
      expected_date: "2026-11-01",
      closed_at: null,
      contact_hubspot_ids: ["101"],
      stage_since: "2026-08-01T00:00:00.000Z",
    });
  });

  it("slaat een deal zonder contact over, want die kan nergens aan hangen", () => {
    const uitkomst = leesDeal(
      { id: "202", dealname: "Losse deal", dealstage: "closedlost", contactIds: [] },
      OPTIES
    );
    expect(uitkomst.ok).toBe(false);
    if (uitkomst.ok) return;
    expect(uitkomst.reden).toBe("geen gekoppeld contact");
  });

  it("zet geen verwachte datum op een deal die dicht is", () => {
    const uitkomst = leesDeal(
      {
        id: "203",
        dealname: "Afgewezen offerte",
        dealstage: "closedlost",
        closedate: "2025-03-01T00:00:00Z",
        contactIds: ["101"],
      },
      OPTIES
    );
    expect(uitkomst.ok).toBe(true);
    if (!uitkomst.ok) return;
    expect(uitkomst.rij.expected_date).toBeNull();
    expect(uitkomst.rij.closed_at).toBe("2025-03-01T00:00:00.000Z");
  });
});

describe("afspraken", () => {
  it("neemt een afspraak over met stand uit de uitkomst", () => {
    const uitkomst = leesAfspraak(
      {
        id: "301",
        hs_meeting_title: "Kennismaking",
        hs_meeting_start_time: "2026-10-01T09:00:00Z",
        hs_meeting_end_time: "2026-10-01T09:30:00Z",
        hs_meeting_outcome: "SCHEDULED",
        contactIds: ["101"],
      },
      NU
    );

    expect(uitkomst.ok).toBe(true);
    if (!uitkomst.ok) return;
    expect(uitkomst.rij.status).toBe("gepland");
    expect(uitkomst.rij.title).toBe("Kennismaking");
    expect(uitkomst.rij.contact_hubspot_ids).toEqual(["101"]);
  });

  it("zet een verzette afspraak op geannuleerd en bewaart de oorspronkelijke uitkomst", () => {
    expect(AFSPRAAK_STANDEN.RESCHEDULED).toBe("geannuleerd");

    const uitkomst = leesAfspraak(
      {
        id: "302",
        hs_meeting_start_time: "2026-01-05T09:00:00Z",
        hs_meeting_end_time: "2026-01-05T10:00:00Z",
        hs_meeting_outcome: "RESCHEDULED",
        contactIds: ["101"],
      },
      NU
    );

    expect(uitkomst.ok).toBe(true);
    if (!uitkomst.ok) return;
    expect(uitkomst.rij.status).toBe("geannuleerd");
    expect(uitkomst.rij.outcome).toContain("RESCHEDULED");
  });

  it("zet een afspraak uit het verleden zonder uitkomst niet op gepland", () => {
    const oud = leesAfspraak(
      {
        id: "303",
        hs_meeting_start_time: "2025-01-05T09:00:00Z",
        hs_meeting_end_time: "2025-01-05T10:00:00Z",
        contactIds: ["101"],
      },
      NU
    );
    expect(oud.ok).toBe(true);
    if (!oud.ok) return;
    expect(oud.rij.status).toBe("gehouden");

    const komend = leesAfspraak(
      {
        id: "304",
        hs_meeting_start_time: "2026-10-05T09:00:00Z",
        hs_meeting_end_time: "2026-10-05T10:00:00Z",
        contactIds: ["101"],
      },
      NU
    );
    expect(komend.ok).toBe(true);
    if (!komend.ok) return;
    expect(komend.rij.status).toBe("gepland");
  });

  it("weigert wat de database toch zou weigeren", () => {
    const omgekeerd = leesAfspraak(
      {
        id: "305",
        hs_meeting_start_time: "2026-10-05T10:00:00Z",
        hs_meeting_end_time: "2026-10-05T09:00:00Z",
        contactIds: ["101"],
      },
      NU
    );
    expect(omgekeerd.ok).toBe(false);

    const teLang = leesAfspraak(
      {
        id: "306",
        hs_meeting_start_time: "2026-10-05T10:00:00Z",
        hs_meeting_end_time: "2026-10-08T09:00:00Z",
        contactIds: ["101"],
      },
      NU
    );
    expect(teLang.ok).toBe(false);
    if (teLang.ok) return;
    expect(teLang.reden).toContain("langer dan een dag");
  });

  it("geeft een afspraak zonder titel een titel die de database aankan", () => {
    const uitkomst = leesAfspraak(
      {
        id: "307",
        hs_meeting_title: "",
        hs_meeting_start_time: "2026-10-05T09:00:00Z",
        hs_meeting_end_time: "2026-10-05T10:00:00Z",
        contactIds: ["101"],
      },
      NU
    );
    expect(uitkomst.ok).toBe(true);
    if (!uitkomst.ok) return;
    expect(uitkomst.rij.title.length).toBeGreaterThan(1);
  });
});

describe("notities", () => {
  it("maakt van HubSpot-HTML gewone tekst", () => {
    expect(naarPlatteTekst("<p>Gebeld met Anne.</p><p>Wil offerte voor 3 klassen.</p>")).toBe(
      "Gebeld met Anne.\nWil offerte voor 3 klassen."
    );
    expect(naarPlatteTekst("Prijs &lt; &euro;1500 &amp; korting")).toContain("<");
    expect(naarPlatteTekst("<div>een<br>twee</div>")).toBe("een\ntwee");
    expect(naarPlatteTekst(null)).toBe("");
  });

  it("kapt een samenvatting af op een woordgrens", () => {
    expect(samenvatting("Kort en klaar")).toBe("Kort en klaar");
    const lang = samenvatting("woord ".repeat(40));
    expect(lang.length).toBeLessThanOrEqual(123);
    expect(lang.endsWith("...")).toBe(true);
  });

  it("neemt een notitie over met datum, samenvatting en volledige tekst", () => {
    const uitkomst = leesNotitie({
      id: "401",
      hs_note_body: "<p>Gebeld met Anne over de cultuurdag.</p>",
      hs_timestamp: "2026-05-01T09:00:00Z",
      contactIds: ["101"],
    });

    expect(uitkomst.ok).toBe(true);
    if (!uitkomst.ok) return;
    expect(uitkomst.rij.summary).toBe("Gebeld met Anne over de cultuurdag.");
    expect(uitkomst.rij.occurred_at).toBe("2026-05-01T09:00:00.000Z");
    expect(uitkomst.rij.kind).toBe("notitie");
  });

  it("slaat een lege notitie over", () => {
    const uitkomst = leesNotitie({
      id: "402",
      hs_note_body: "<p>&nbsp;</p>",
      hs_timestamp: "2026-05-01T09:00:00Z",
      contactIds: ["101"],
    });
    expect(uitkomst.ok).toBe(false);
    if (uitkomst.ok) return;
    expect(uitkomst.reden).toBe("lege notitie");
  });

  it("slaat een notitie zonder datum over in plaats van vandaag te gebruiken", () => {
    const uitkomst = leesNotitie({
      id: "403",
      hs_note_body: "Iets belangrijks",
      contactIds: ["101"],
    });
    expect(uitkomst.ok).toBe(false);
    if (uitkomst.ok) return;
    expect(uitkomst.reden).toBe("geen datum");
  });
});

describe("koppelen aan het juiste contact", () => {
  it("kiest het eerste contact dat ook echt meekomt", () => {
    const bekend = new Set(["102", "103"]);
    expect(kiesContact(["101", "102"], bekend)).toBe("102");
    expect(kiesContact(["102", "103"], bekend)).toBe("102");
    expect(kiesContact(["101"], bekend)).toBeNull();
    expect(kiesContact([], bekend)).toBeNull();
  });

  it("bewaart alle gekoppelde contacten van een deal, niet alleen de eerste", () => {
    const uitkomst = leesDeal(
      {
        id: "204",
        dealname: "Twee contactpersonen",
        dealstage: "729498081",
        contactIds: ["101", "102"],
      },
      OPTIES
    );
    expect(uitkomst.ok).toBe(true);
    if (!uitkomst.ok) return;
    expect(uitkomst.rij.contact_hubspot_ids).toEqual(["101", "102"]);
  });
});

describe("de telling", () => {
  it("sluit als alles is verantwoord", () => {
    const telling = maakTelling("deals", 665, 654, [{ reden: "geen gekoppeld contact", aantal: 11 }]);
    expect(telling).toMatchObject({ inHubSpot: 665, geimporteerd: 654, uitgesloten: 11, klopt: true });
  });

  it("valt door de mand als de getallen niet optellen", () => {
    const telling = maakTelling("deals", 665, 634, [{ reden: "geen gekoppeld contact", aantal: 11 }]);
    expect(telling.klopt).toBe(false);
  });

  it("zet de grootste reden bovenaan", () => {
    const telling = maakTelling("contacten", 10, 4, [
      { reden: "klein", aantal: 1 },
      { reden: "groot", aantal: 5 },
    ]);
    expect(telling.redenen[0].reden).toBe("groot");
    expect(telling.klopt).toBe(true);
  });
});

describe("verslag", () => {
  it("telt de redenen van overslaan, meeste eerst", () => {
    const redenen = tellRedenen([
      { ok: false, reden: "geen naam" },
      { ok: true },
      { ok: false, reden: "geen gekoppeld contact" },
      { ok: false, reden: "geen naam" },
    ]);
    expect(redenen).toEqual([
      { reden: "geen naam", aantal: 2 },
      { reden: "geen gekoppeld contact", aantal: 1 },
    ]);
  });
});

describe("levensfases", () => {
  it("maakt van een HubSpot-lead een prospect en van een kans een lead", () => {
    expect(LIFECYCLE_MAP.lead).toBe("prospect");
    expect(LIFECYCLE_MAP.opportunity).toBe("lead");
    expect(LIFECYCLE_MAP.customer).toBe("klant");
    expect(LIFECYCLE_MAP[ZZP_LIFECYCLE]).toBeUndefined();
  });
});

function maakContact(id: string, naam: string, email: string | null): ContactRij {
  return {
    hubspot_id: id,
    full_name: naam,
    contact_type: null,
    email,
    phone: null,
    job_title: null,
    city: null,
    lifecycle: null,
    is_unsubscribed: false,
    last_contact_at: null,
  };
}
