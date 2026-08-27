import { describe, expect, it } from "vitest";

import {
  extractBooking,
  parseConfirmationEmail,
  parseDuration,
  parseDutchDate,
  parseTimeRange,
  type ParserInput,
  type ParserSettings,
} from "@/lib/bookings/parser";

const settings: ParserSettings = {
  confirmationLabel: "Mijn Skool/Boekingsbevestiging",
  allowedFromDomains: ["skoolworkshop.nl"],
  minimumBookingMinutes: 90,
};

const confirmationBody = [
  "Beste Sanne,",
  "",
  "Hierbij bevestigen wij uw boeking. De boeking is definitief.",
  "",
  "Organisatie: De Goudse Waarden",
  "Contactpersoon: Sanne de Vries",
  "E-mail: s.devries@goudsewaarden.nl",
  "Workshop: Graffiti",
  "Aantal workshops: 4",
  "Duur: 90 minuten per workshop",
  "Datum: 12 maart 2026",
  "Tijd: 09:00 - 15:00",
  "Locatie: Kanaalstraat 5, Gouda",
  "Aantal deelnemers: 96",
  "Boekingsnummer: SW-2026-0123",
].join("\n");

function makeInput(overrides: Partial<ParserInput> = {}): ParserInput {
  return {
    messageId: "msg-1",
    threadId: "thread-1",
    from: "boekingen@skoolworkshop.nl",
    to: ["s.devries@goudsewaarden.nl"],
    cc: [],
    subject: "Bevestiging Workshops op 01 09 2026 in Gouda",
    bodyText: confirmationBody,
    labels: ["Mijn Skool/Boekingsbevestiging"],
    receivedAt: "2026-03-02T09:12:00.000Z",
    ...overrides,
  };
}

describe("losse extractiefuncties", () => {
  it("leest Nederlandse datums", () => {
    expect(parseDutchDate("12 maart 2026")).toBe("2026-03-12");
    expect(parseDutchDate("12-03-2026")).toBe("2026-03-12");
    expect(parseDutchDate("2026-03-12")).toBe("2026-03-12");
    expect(parseDutchDate("donderdag 1 mei 2026")).toBe("2026-05-01");
  });

  it("weigert onmogelijke datums", () => {
    expect(parseDutchDate("31-02-2026")).toBeNull();
    expect(parseDutchDate("binnenkort")).toBeNull();
    expect(parseDutchDate(null)).toBeNull();
  });

  it("leest tijdvakken", () => {
    expect(parseTimeRange("09:00 - 15:00")).toEqual({ start: "09:00", end: "15:00" });
    expect(parseTimeRange("9.30 tot 11.00")).toEqual({ start: "09:30", end: "11:00" });
    expect(parseTimeRange("geen tijd bekend")).toEqual({ start: null, end: null });
  });

  it("leest duur in minuten en uren", () => {
    expect(parseDuration("90 minuten per workshop")).toBe(90);
    expect(parseDuration("2 uur")).toBe(120);
    expect(parseDuration("1,5 uur")).toBe(90);
    expect(parseDuration("onbekend")).toBeNull();
  });

  it("haalt alle boekingsvelden uit de tekst", () => {
    const extracted = extractBooking(confirmationBody, "Boekingsbevestiging");
    expect(extracted.organizationName).toBe("De Goudse Waarden");
    expect(extracted.contactEmail).toBe("s.devries@goudsewaarden.nl");
    expect(extracted.workshopName).toBe("Graffiti");
    expect(extracted.workshopCount).toBe(4);
    expect(extracted.minutesPerWorkshop).toBe(90);
    expect(extracted.date).toBe("2026-03-12");
    expect(extracted.startTime).toBe("09:00");
    expect(extracted.endTime).toBe("15:00");
    expect(extracted.location).toBe("Kanaalstraat 5, Gouda");
    expect(extracted.participants).toBe(96);
    expect(extracted.reference).toBe("SW-2026-0123");
  });
});

describe("herkennen van een definitieve bevestiging", () => {
  it("herkent een complete bevestiging met label", () => {
    const result = parseConfirmationEmail(makeInput(), settings);
    expect(result.isConfirmation).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    expect(result.reviewReasons).toHaveLength(0);
    expect(result.extracted.workshopCount).toBe(4);
    expect(result.extracted.minutesPerWorkshop).toBe(90);
  });

  it("ziet een offerte NIET als boeking", () => {
    const result = parseConfirmationEmail(
      makeInput({
        subject: "Offerte projectdagen mei",
        labels: [],
        bodyText: "Hierbij een vrijblijvende offerte. Deze offerte is nog niet definitief.",
      }),
      settings
    );
    expect(result.isConfirmation).toBe(false);
  });

  it("ziet een aanvraag NIET als boeking", () => {
    const result = parseConfirmationEmail(
      makeInput({ subject: "Aanvraag workshop graffiti", labels: [] }),
      settings
    );
    expect(result.isConfirmation).toBe(false);
  });

  it("ziet een wijzigingsverzoek NIET als boeking", () => {
    const result = parseConfirmationEmail(
      makeInput({ subject: "Wijziging datum cultuurdag", labels: [] }),
      settings
    );
    expect(result.isConfirmation).toBe(false);
  });

  it("negeert automatische antwoorden", () => {
    const result = parseConfirmationEmail(
      makeInput({ headers: { "auto-submitted": "auto-replied" } }),
      settings
    );
    expect(result.isConfirmation).toBe(false);
    expect(result.reviewReasons[0]).toContain("Automatisch");
  });

  it("markeert een onbekend afzenderdomein voor controle", () => {
    const result = parseConfirmationEmail(makeInput({ from: "iemand@example.com" }), settings);
    expect(result.reviewReasons.some((r) => r.includes("Afzenderdomein"))).toBe(true);
  });

  it("vraagt om controle als de duur ontbreekt bij meerdere workshops", () => {
    const body = confirmationBody.replace("Duur: 90 minuten per workshop\n", "");
    const result = parseConfirmationEmail(makeInput({ bodyText: body }), settings);
    expect(result.reviewReasons.some((r) => r.includes("Duur") || r.includes("duur"))).toBe(true);
  });

  it("leidt de duur wel af bij één workshop met begin- en eindtijd", () => {
    const body = [
      "Hierbij bevestigen wij uw boeking. De boeking is definitief.",
      "Workshop: Podcast",
      "Aantal workshops: 1",
      "Datum: 12 maart 2026",
      "Tijd: 09:00 - 10:30",
      "Locatie: Gouda",
    ].join("\n");
    const result = parseConfirmationEmail(makeInput({ bodyText: body }), settings);
    expect(result.extracted.minutesPerWorkshop).toBe(90);
  });

  it("waarschuwt als de totale duur onder de minimale afname ligt", () => {
    const body = confirmationBody
      .replace("Aantal workshops: 4", "Aantal workshops: 1")
      .replace("Duur: 90 minuten per workshop", "Duur: 45 minuten per workshop");
    const result = parseConfirmationEmail(makeInput({ bodyText: body }), settings);
    expect(result.reviewReasons.some((r) => r.includes("minimale afname"))).toBe(true);
  });

  it("gokt nooit: zonder gegevens komt alles in de controlewachtrij", () => {
    const result = parseConfirmationEmail(
      makeInput({ bodyText: "Bedankt voor het gesprek, we spreken elkaar snel." }),
      settings
    );
    expect(result.reviewReasons.length).toBeGreaterThan(0);
  });
});
