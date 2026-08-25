import { describe, expect, it } from "vitest";

import { amountToCents } from "@/lib/integrations/moneybird/client";
import {
  extractLineHint,
  isWorkshopLine,
  mapInvoiceState,
  matchInvoiceToBooking,
  type BookingCandidate,
} from "@/lib/integrations/moneybird/matching";

const booking: BookingCandidate = {
  id: "booking-1",
  reference: "SW-2026-0123",
  workshop_name: "Graffiti",
  scheduled_date: "2026-03-12",
  workshop_count: 4,
  minutes_per_workshop: 90,
};

describe("factuurregels", () => {
  it("herkent workshopregels", () => {
    expect(isWorkshopLine("Workshop Graffiti - 4 x 90 minuten")).toBe(true);
    expect(isWorkshopLine("Cultuurdag programma")).toBe(true);
  });

  it("sluit niet-kwalificerende kosten uit", () => {
    expect(isWorkshopLine("Reiskosten")).toBe(false);
    expect(isWorkshopLine("Starttarief")).toBe(false);
    expect(isWorkshopLine("Materiaalkosten")).toBe(false);
    expect(isWorkshopLine("Extra deelnemers")).toBe(false);
    expect(isWorkshopLine("Toeslag avonduren")).toBe(false);
    expect(isWorkshopLine(null)).toBe(false);
  });

  it("leest aantal en duur uit een workshopregel", () => {
    const hint = extractLineHint({
      id: "line-1",
      description: "Workshop Graffiti - 4 x 90 minuten",
      amount: "4",
      price: "195.00",
      total_price_excl_tax_with_discount: "780.00",
    });
    expect(hint.workshopCount).toBe(4);
    expect(hint.minutesPerWorkshop).toBe(90);
    expect(hint.workshopName).toBe("Workshop Graffiti");
  });

  it("geeft niets terug voor een reiskostenregel", () => {
    const hint = extractLineHint({
      id: "line-2",
      description: "Reiskosten",
      amount: "1",
      price: "45.00",
      total_price_excl_tax_with_discount: "45.00",
    });
    expect(hint.workshopCount).toBeNull();
    expect(hint.minutesPerWorkshop).toBeNull();
  });
});

describe("bedragen", () => {
  it("rekent bedragen om naar centen zonder afrondingsfouten", () => {
    expect(amountToCents("1250.00")).toBe(125000);
    expect(amountToCents("1033.06")).toBe(103306);
    expect(amountToCents("0.10")).toBe(10);
    expect(amountToCents(null)).toBe(0);
    expect(amountToCents("geen bedrag")).toBe(0);
  });
});

describe("factuur aan boeking koppelen", () => {
  it("koppelt op referentie, naam, omvang en datum", () => {
    const outcome = matchInvoiceToBooking(
      {
        reference: "Cultuurdag SW-2026-0123",
        invoiceDate: "2026-03-14",
        lineHints: [
          { workshopName: "Workshop Graffiti", workshopCount: 4, minutesPerWorkshop: 90 },
        ],
      },
      [booking]
    );
    expect(outcome.bookingId).toBe("booking-1");
    expect(outcome.confidence).toBeGreaterThan(0.9);
  });

  it("koppelt niet bij onvoldoende zekerheid", () => {
    const outcome = matchInvoiceToBooking(
      { reference: null, invoiceDate: "2026-11-01", lineHints: [] },
      [booking]
    );
    expect(outcome.bookingId).toBeNull();
    expect(outcome.reasons.length).toBeGreaterThan(0);
  });

  it("koppelt niet als er geen boekingen zijn", () => {
    const outcome = matchInvoiceToBooking(
      { reference: "SW-2026-0123", invoiceDate: "2026-03-14", lineHints: [] },
      []
    );
    expect(outcome.bookingId).toBeNull();
  });

  it("kiest de boeking met de meeste overeenkomsten", () => {
    const other: BookingCandidate = {
      id: "booking-2",
      reference: "SW-2026-0999",
      workshop_name: "Podcast",
      scheduled_date: "2026-03-13",
      workshop_count: 2,
      minutesPerWorkshop: 90,
    } as unknown as BookingCandidate;

    const outcome = matchInvoiceToBooking(
      {
        reference: "SW-2026-0123",
        invoiceDate: "2026-03-14",
        lineHints: [
          { workshopName: "Workshop Graffiti", workshopCount: 4, minutesPerWorkshop: 90 },
        ],
      },
      [other, booking]
    );
    expect(outcome.bookingId).toBe("booking-1");
  });
});

describe("factuurstatus", () => {
  it("vertaalt Moneybird-statussen", () => {
    expect(mapInvoiceState("paid")).toBe("paid");
    expect(mapInvoiceState("late")).toBe("late");
    expect(mapInvoiceState("scheduled")).toBe("open");
    expect(mapInvoiceState("iets_nieuws")).toBe("unknown");
    expect(mapInvoiceState(null)).toBe("unknown");
  });
});
