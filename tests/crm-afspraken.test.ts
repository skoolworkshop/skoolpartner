import { describe, expect, it } from "vitest";

import {
  botsendeAfspraken,
  controleerAfspraak,
  deelAfsprakenIn,
  duurInMinuten,
  formatDuur,
  isAfgerond,
  leesInvoerTijd,
  magStatusWorden,
  naarInvoerTijd,
  opDezelfdeDag,
  overlapt,
  type AfspraakKern,
} from "@/lib/crm/afspraken-regels";

/**
 * Controles op de afspraken.
 *
 * Waar het hier vooral om gaat:
 *
 *   1. Een tijd uit een invoerveld moet met zone worden omgezet, anders schuift
 *      een afspraak in de zomer een uur op.
 *   2. Aansluitende afspraken zijn geen overlap.
 *   3. Een afspraak die gepland staat en waarvan het moment voorbij is, komt
 *      terecht in "achterstallig" en niet stilletjes bij "komend".
 *   4. Je kunt een afspraak die nog moet plaatsvinden niet afvinken als
 *      gehouden.
 */

const NU = "2026-09-10T12:00:00.000Z";

describe("leesInvoerTijd", () => {
  it("leest een lokale invoer als UTC bij offset nul", () => {
    expect(leesInvoerTijd("2026-09-10T14:00")).toBe("2026-09-10T14:00:00.000Z");
  });

  it("verschuift met de zone-offset", () => {
    // Nederlandse zomertijd is UTC+2, dus 14:00 lokaal is 12:00 UTC.
    expect(leesInvoerTijd("2026-09-10T14:00", 120)).toBe("2026-09-10T12:00:00.000Z");
  });

  it("verschuift ook de andere kant op", () => {
    expect(leesInvoerTijd("2026-09-10T14:00", -120)).toBe("2026-09-10T16:00:00.000Z");
  });

  it("verdraagt seconden in de invoer", () => {
    expect(leesInvoerTijd("2026-09-10T14:00:30")).toBe("2026-09-10T14:00:30.000Z");
  });

  it("leest een volledig tijdstip met zone gewoon door", () => {
    expect(leesInvoerTijd("2026-09-10T12:00:00Z")).toBe("2026-09-10T12:00:00.000Z");
  });

  it("weigert een dag die niet bestaat", () => {
    // Zonder deze controle schuift 31 februari stil door naar 3 maart.
    expect(leesInvoerTijd("2026-02-31T10:00")).toBeNull();
    expect(leesInvoerTijd("2026-13-01T10:00")).toBeNull();
  });

  it("geeft null bij niets of onzin", () => {
    expect(leesInvoerTijd(null)).toBeNull();
    expect(leesInvoerTijd("")).toBeNull();
    expect(leesInvoerTijd("morgenmiddag")).toBeNull();
  });

  it("is omkeerbaar met naarInvoerTijd", () => {
    const iso = leesInvoerTijd("2026-09-10T14:30", 120);
    expect(naarInvoerTijd(iso, 120)).toBe("2026-09-10T14:30");
  });

  it("naarInvoerTijd geeft een lege string bij niets", () => {
    expect(naarInvoerTijd(null)).toBe("");
    expect(naarInvoerTijd("onzin")).toBe("");
  });
});

describe("duurInMinuten", () => {
  it("rekent een gewone afspraak uit", () => {
    expect(duurInMinuten("2026-09-10T10:00:00Z", "2026-09-10T11:30:00Z")).toBe(90);
  });

  it("geeft null als het eind voor het begin ligt", () => {
    expect(duurInMinuten("2026-09-10T11:00:00Z", "2026-09-10T10:00:00Z")).toBeNull();
  });

  it("geeft null bij een duur van nul", () => {
    expect(duurInMinuten("2026-09-10T10:00:00Z", "2026-09-10T10:00:00Z")).toBeNull();
  });

  it("geeft null bij ontbrekende tijden", () => {
    expect(duurInMinuten(null, "2026-09-10T10:00:00Z")).toBeNull();
  });
});

describe("formatDuur", () => {
  it("schrijft minuten, uren en de combinatie uit", () => {
    expect(formatDuur(45)).toBe("45 min");
    expect(formatDuur(60)).toBe("1 uur");
    expect(formatDuur(120)).toBe("2 uur");
    expect(formatDuur(90)).toBe("1 uur 30 min");
  });

  it("geeft een streepje bij niets", () => {
    expect(formatDuur(null)).toBe("—");
    expect(formatDuur(0)).toBe("—");
  });
});

describe("overlapt", () => {
  const tijdvak = (id: string, van: string, tot: string) => ({
    id,
    startsAt: `2026-09-10T${van}:00Z`,
    endsAt: `2026-09-10T${tot}:00Z`,
  });

  it("ziet een echte overlap", () => {
    expect(overlapt(tijdvak("a", "10:00", "11:00"), tijdvak("b", "10:30", "11:30"))).toBe(true);
  });

  it("ziet een afspraak die volledig binnen een andere valt", () => {
    expect(overlapt(tijdvak("a", "10:00", "12:00"), tijdvak("b", "10:30", "11:00"))).toBe(true);
  });

  it("noemt aansluitend geen overlap", () => {
    // Dit is de belangrijke: eindigt om 11:00, begint om 11:00. Dat botst niet,
    // anders krijg je een waarschuwing bij elke normale dag.
    expect(overlapt(tijdvak("a", "10:00", "11:00"), tijdvak("b", "11:00", "12:00"))).toBe(false);
  });

  it("noemt los van elkaar geen overlap", () => {
    expect(overlapt(tijdvak("a", "09:00", "10:00"), tijdvak("b", "14:00", "15:00"))).toBe(false);
  });

  it("valt niet om op onleesbare tijden", () => {
    expect(overlapt({ id: "a", startsAt: "onzin", endsAt: "onzin" }, tijdvak("b", "10:00", "11:00"))).toBe(
      false
    );
  });
});

describe("botsendeAfspraken", () => {
  const bestaand = [
    { id: "1", startsAt: "2026-09-10T09:00:00Z", endsAt: "2026-09-10T10:00:00Z" },
    { id: "2", startsAt: "2026-09-10T10:30:00Z", endsAt: "2026-09-10T11:30:00Z" },
    { id: "3", startsAt: "2026-09-11T09:00:00Z", endsAt: "2026-09-11T10:00:00Z" },
  ];

  it("vindt wat er botst", () => {
    const nieuw = { id: "nieuw", startsAt: "2026-09-10T09:30:00Z", endsAt: "2026-09-10T10:45:00Z" };
    expect(botsendeAfspraken(nieuw, bestaand).map((a) => a.id)).toEqual(["1", "2"]);
  });

  it("laat de afspraak zichzelf niet tegenkomen", () => {
    const zelfde = { id: "2", startsAt: "2026-09-10T10:30:00Z", endsAt: "2026-09-10T11:30:00Z" };
    expect(botsendeAfspraken(zelfde, bestaand)).toEqual([]);
  });

  it("geeft niets terug als er niets botst", () => {
    const nieuw = { id: "nieuw", startsAt: "2026-09-10T14:00:00Z", endsAt: "2026-09-10T15:00:00Z" };
    expect(botsendeAfspraken(nieuw, bestaand)).toEqual([]);
  });
});

describe("deelAfsprakenIn", () => {
  function afspraak(waarden: Partial<AfspraakKern> & { id: string }): AfspraakKern {
    return {
      startsAt: "2026-09-15T09:00:00Z",
      endsAt: "2026-09-15T10:00:00Z",
      status: "gepland",
      outcome: null,
      ...waarden,
    };
  }

  const alles: AfspraakKern[] = [
    afspraak({ id: "straks", startsAt: "2026-09-20T09:00:00Z", endsAt: "2026-09-20T10:00:00Z" }),
    afspraak({ id: "morgen", startsAt: "2026-09-11T09:00:00Z", endsAt: "2026-09-11T10:00:00Z" }),
    // Gepland, maar het moment is voorbij. Hier moet iets mee.
    afspraak({ id: "vergeten", startsAt: "2026-09-05T09:00:00Z", endsAt: "2026-09-05T10:00:00Z" }),
    afspraak({
      id: "gehouden-met",
      startsAt: "2026-09-03T09:00:00Z",
      endsAt: "2026-09-03T10:00:00Z",
      status: "gehouden",
      outcome: "Offerte gevraagd voor maart.",
    }),
    afspraak({
      id: "gehouden-zonder",
      startsAt: "2026-09-04T09:00:00Z",
      endsAt: "2026-09-04T10:00:00Z",
      status: "gehouden",
      outcome: "   ",
    }),
    afspraak({
      id: "afgezegd",
      startsAt: "2026-09-02T09:00:00Z",
      endsAt: "2026-09-02T10:00:00Z",
      status: "geannuleerd",
    }),
  ];

  const indeling = deelAfsprakenIn(alles, NU);

  it("zet wat nog komt op volgorde, eerstvolgende voorop", () => {
    expect(indeling.komend.map((a) => a.id)).toEqual(["morgen", "straks"]);
  });

  it("zet een gepland moment dat voorbij is bij achterstallig", () => {
    expect(indeling.achterstallig.map((a) => a.id)).toEqual(["vergeten"]);
  });

  it("zet alles wat is afgesloten bij geweest, meest recente voorop", () => {
    expect(indeling.geweest.map((a) => a.id)).toEqual([
      "gehouden-zonder",
      "gehouden-met",
      "afgezegd",
    ]);
  });

  it("wijst gehouden afspraken zonder uitkomst aan", () => {
    // Een uitkomst van alleen spaties telt niet als ingevuld.
    expect(indeling.zonderUitkomst.map((a) => a.id)).toEqual(["gehouden-zonder"]);
  });

  it("rekent een geannuleerde afspraak nooit als ontbrekende uitkomst", () => {
    expect(indeling.zonderUitkomst.map((a) => a.id)).not.toContain("afgezegd");
  });

  it("verdraagt een lege lijst", () => {
    const leeg = deelAfsprakenIn([], NU);
    expect(leeg.komend).toEqual([]);
    expect(leeg.achterstallig).toEqual([]);
  });
});

describe("isAfgerond", () => {
  it("noemt alleen gepland niet afgerond", () => {
    expect(isAfgerond("gepland")).toBe(false);
    expect(isAfgerond("gehouden")).toBe(true);
    expect(isAfgerond("geannuleerd")).toBe(true);
    expect(isAfgerond("niet_verschenen")).toBe(true);
  });
});

describe("opDezelfdeDag", () => {
  it("vergelijkt op de dag en niet op het tijdstip", () => {
    expect(opDezelfdeDag("2026-09-10T23:30:00Z", "2026-09-10")).toBe(true);
    expect(opDezelfdeDag("2026-09-11T00:30:00Z", "2026-09-10")).toBe(false);
  });
});

describe("magStatusWorden", () => {
  const straks = { startsAt: "2026-09-20T09:00:00Z", status: "gepland" as const };
  const geweest = { startsAt: "2026-09-05T09:00:00Z", status: "gepland" as const };

  it("weigert een toekomstige afspraak af te vinken als gehouden", () => {
    const oordeel = magStatusWorden(straks, "gehouden", NU);
    expect(oordeel.toegestaan).toBe(false);
    expect(oordeel.reden).toContain("moet nog plaatsvinden");
  });

  it("weigert ook niet-verschenen voor iets wat nog moet komen", () => {
    expect(magStatusWorden(straks, "niet_verschenen", NU).toegestaan).toBe(false);
  });

  it("staat annuleren van een toekomstige afspraak wel toe", () => {
    expect(magStatusWorden(straks, "geannuleerd", NU).toegestaan).toBe(true);
  });

  it("staat afvinken toe zodra het moment is geweest", () => {
    expect(magStatusWorden(geweest, "gehouden", NU).toegestaan).toBe(true);
    expect(magStatusWorden(geweest, "niet_verschenen", NU).toegestaan).toBe(true);
  });

  it("staat terugzetten naar gepland toe, ook achteraf", () => {
    // Een vergissing corrigeren moet kunnen zonder de afspraak weg te gooien.
    const afgevinkt = { startsAt: "2026-09-05T09:00:00Z", status: "gehouden" as const };
    expect(magStatusWorden(afgevinkt, "gepland", NU).toegestaan).toBe(true);
  });

  it("laat dezelfde stand altijd toe", () => {
    expect(magStatusWorden(straks, "gepland", NU).toegestaan).toBe(true);
  });
});

describe("controleerAfspraak", () => {
  const goed = {
    title: "Kennismaking Markenhage",
    startsAt: "2026-09-20T09:00:00Z",
    endsAt: "2026-09-20T10:00:00Z",
    soort: "kennismaking",
    vorm: "op_locatie",
    heeftOnderwerp: true,
  };

  it("laat een correcte afspraak door", () => {
    expect(controleerAfspraak(goed)).toEqual([]);
  });

  it("meldt alles wat mis is in een keer", () => {
    const fouten = controleerAfspraak({
      title: "x",
      startsAt: null,
      endsAt: null,
      soort: "onzin",
      vorm: "onzin",
      heeftOnderwerp: false,
    });
    // Titel, begintijd, eindtijd, soort, vorm en onderwerp: zes dingen mis,
    // zes meldingen. Niet alleen de eerste.
    expect(fouten).toHaveLength(6);
  });

  it("weigert een afspraak die eindigt voor hij begint", () => {
    const fouten = controleerAfspraak({
      ...goed,
      startsAt: "2026-09-20T10:00:00Z",
      endsAt: "2026-09-20T09:00:00Z",
    });
    expect(fouten).toContain("De afspraak moet eindigen na het moment waarop hij begint.");
  });

  it("wantrouwt een afspraak van meer dan een dag", () => {
    const fouten = controleerAfspraak({
      ...goed,
      startsAt: "2026-09-20T09:00:00Z",
      endsAt: "2026-09-22T09:00:00Z",
    });
    expect(fouten).toHaveLength(1);
    expect(fouten[0]).toContain("meer dan een dag");
  });

  it("eist dat een afspraak ergens bij hoort", () => {
    const fouten = controleerAfspraak({ ...goed, heeftOnderwerp: false });
    expect(fouten).toEqual([
      "Een afspraak hoort bij een organisatie, een contactpersoon of een deal.",
    ]);
  });
});
