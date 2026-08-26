import { describe, expect, it } from "vitest";

import {
  bookingMoment,
  bookingQualifiesForPoints,
  invoiceBelongsToPeriod,
  isWithinPartnerPeriod,
} from "@/lib/loyalty/period";
import { normalizePostalCode, validateRegistration } from "@/lib/registration";

const REGISTRATIE = "2026-09-10T09:00:00.000Z";

describe("SkoolPartner-startmoment", () => {
  it("het voorbeeld dat geen punten oplevert", () => {
    // Boeking 1 september, registratie 10 september, factuur 15 september.
    const boeking = { booked_at: "2026-09-01T10:00:00.000Z", created_at: "2026-09-12T08:00:00.000Z" };

    expect(bookingQualifiesForPoints(boeking, REGISTRATIE)).toBe(false);

    // Ook al ligt de factuurdatum ná de registratie: de boeking telt.
    expect(
      invoiceBelongsToPeriod({ invoice_date: "2026-09-15" }, REGISTRATIE, bookingMoment(boeking))
    ).toBe(false);
  });

  it("het voorbeeld dat wél punten oplevert", () => {
    // Registratie 10 september, boeking 15 september, factuur 20 september.
    const boeking = { booked_at: "2026-09-15T10:00:00.000Z", created_at: "2026-09-15T10:00:00.000Z" };

    expect(bookingQualifiesForPoints(boeking, REGISTRATIE)).toBe(true);
    expect(
      invoiceBelongsToPeriod({ invoice_date: "2026-09-20" }, REGISTRATIE, bookingMoment(boeking))
    ).toBe(true);
  });

  it("kijkt naar het boekingsmoment en niet naar wanneer wij de boeking binnenhaalden", () => {
    const laatIngelezen = {
      booked_at: "2026-08-20T10:00:00.000Z",
      created_at: "2026-09-20T10:00:00.000Z",
    };
    expect(bookingMoment(laatIngelezen)).toBe("2026-08-20T10:00:00.000Z");
    expect(bookingQualifiesForPoints(laatIngelezen, REGISTRATIE)).toBe(false);
  });

  it("valt terug op created_at zolang booked_at nog leeg is", () => {
    const oud = { booked_at: null, created_at: "2026-09-20T10:00:00.000Z" };
    expect(bookingQualifiesForPoints(oud, REGISTRATIE)).toBe(true);
  });

  it("het startmoment zelf telt mee", () => {
    expect(isWithinPartnerPeriod(REGISTRATIE, REGISTRATIE)).toBe(true);
  });

  it("zonder deelname telt niets mee", () => {
    expect(bookingQualifiesForPoints({ booked_at: null, created_at: REGISTRATIE }, null)).toBe(false);
    expect(invoiceBelongsToPeriod({ invoice_date: "2026-09-20" }, null)).toBe(false);
  });

  it("een factuur zonder boeking wordt op de factuurdatum beoordeeld", () => {
    expect(invoiceBelongsToPeriod({ invoice_date: "2026-09-20" }, REGISTRATIE)).toBe(true);
    expect(invoiceBelongsToPeriod({ invoice_date: "2026-08-20" }, REGISTRATIE)).toBe(false);
  });
});

describe("registratieformulier", () => {
  const compleet = {
    firstName: "Sanne",
    lastName: "de Vries",
    jobTitle: "Cultuurcoördinator",
    phone: "06 12345678",
    organizationName: "De Goudse Waarden",
    street: "Kanaalstraat",
    houseNumber: "5",
    houseNumberAddition: "B",
    postalCode: "2801ab",
    city: "Gouda",
  };

  it("accepteert een volledig ingevuld formulier en normaliseert", () => {
    const result = validateRegistration(compleet);
    expect(result.ok).toBe(true);
    expect(result.values?.fullName).toBe("Sanne de Vries");
    expect(result.values?.phone).toBe("+31612345678");
    expect(result.values?.postalCode).toBe("2801 AB");
    expect(result.values?.houseNumber).toBe("5");
  });

  it("een toevoeging is niet verplicht", () => {
    const result = validateRegistration({ ...compleet, houseNumberAddition: "  " });
    expect(result.ok).toBe(true);
    expect(result.values?.houseNumberAddition).toBeNull();
  });

  it("weigert een onvolledige registratie en wijst het juiste veld aan", () => {
    const result = validateRegistration({
      ...compleet,
      phone: "",
      postalCode: "12345",
      houseNumber: "vijf",
      jobTitle: "",
    });

    expect(result.ok).toBe(false);
    expect(result.errors.phone).toBeTruthy();
    expect(result.errors.postalCode).toBeTruthy();
    expect(result.errors.houseNumber).toBeTruthy();
    expect(result.errors.jobTitle).toBeTruthy();
    expect(result.errors.city).toBeUndefined();
  });

  it("postcodes mogen op verschillende manieren worden ingevuld", () => {
    expect(normalizePostalCode("2801AB")).toBe("2801 AB");
    expect(normalizePostalCode("2801 ab")).toBe("2801 AB");
    expect(normalizePostalCode("2801-AB")).toBe("2801 AB");
    expect(normalizePostalCode("0801AB")).toBeNull();
    expect(normalizePostalCode("28011AB")).toBeNull();
    expect(normalizePostalCode("")).toBeNull();
  });
});
