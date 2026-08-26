import { describe, expect, it } from "vitest";

import {
  CREDIT_TYPE_LABELS,
  PARKING_STATUS_LABELS,
  amountFieldValue,
  checkSpend,
  formatCentsPlain,
  parseAmountToCents,
  remainingAfter,
  validateParkingInput,
  type ParkingInput,
} from "@/lib/tegoed/regels";

describe("bedragen inlezen", () => {
  it("leest een rond bedrag", () => {
    expect(parseAmountToCents("1250").cents).toBe(125000);
  });

  it("leest een Nederlands bedrag met punt en komma", () => {
    expect(parseAmountToCents("1.250,50").cents).toBe(125050);
    expect(parseAmountToCents("1.250,00").cents).toBe(125000);
    expect(parseAmountToCents("10.000").cents).toBe(1000000);
  });

  it("leest ook de Engelse schrijfwijze", () => {
    expect(parseAmountToCents("1250.50").cents).toBe(125050);
    expect(parseAmountToCents("1,250.50").cents).toBe(125050);
  });

  it("negeert het euroteken en spaties", () => {
    expect(parseAmountToCents("€ 750,00").cents).toBe(75000);
    expect(parseAmountToCents(" 750 ").cents).toBe(75000);
  });

  it("vult één cijfer achter de komma aan tot centen", () => {
    expect(parseAmountToCents("12,5").cents).toBe(1250);
  });

  it("weigert wat geen bedrag is", () => {
    expect(parseAmountToCents("").ok).toBe(false);
    expect(parseAmountToCents("veel").ok).toBe(false);
    expect(parseAmountToCents("-500").ok).toBe(false);
    expect(parseAmountToCents("0").ok).toBe(false);
    expect(parseAmountToCents("0,00").ok).toBe(false);
  });

  it("weigert een bedrag dat overduidelijk een typefout is", () => {
    expect(parseAmountToCents("99999999").ok).toBe(false);
  });

  it("laat het invulveld leeg als er nog geen bedrag is", () => {
    expect(amountFieldValue(null)).toBe("");
    expect(amountFieldValue(0)).toBe("");
    expect(amountFieldValue(125000)).toBe(formatCentsPlain(125000));
  });
});

describe("de aanvraag controleren", () => {
  const goed: ParkingInput = {
    schoolName: "De Goudse Waarden",
    cjpSchoolNumber: "123456",
    holderName: "Sanne de Vries",
    holderEmail: "s.devries@goudsewaarden.nl",
    holderPhone: "+31612345678",
    amount: "750,00",
  };

  it("keurt een volledig ingevulde aanvraag goed", () => {
    const uitkomst = validateParkingInput(goed, { minimumCents: 5000 });
    expect(uitkomst.ok).toBe(true);
    expect(uitkomst.snapshot).toEqual({
      schoolName: "De Goudse Waarden",
      cjpSchoolNumber: "123456",
      holderName: "Sanne de Vries",
      holderEmail: "s.devries@goudsewaarden.nl",
      holderPhone: "+31612345678",
      amountCents: 75000,
    });
  });

  it("maakt het e-mailadres klein en haalt dubbele spaties weg", () => {
    const uitkomst = validateParkingInput(
      { ...goed, holderEmail: "  S.DeVries@Goudsewaarden.NL ", holderName: "Sanne   de Vries" },
      { minimumCents: 5000 }
    );
    expect(uitkomst.snapshot?.holderEmail).toBe("s.devries@goudsewaarden.nl");
    expect(uitkomst.snapshot?.holderName).toBe("Sanne de Vries");
  });

  it("laat de telefoon leeg als die niet is ingevuld", () => {
    const uitkomst = validateParkingInput({ ...goed, holderPhone: "  " }, { minimumCents: 5000 });
    expect(uitkomst.ok).toBe(true);
    expect(uitkomst.snapshot?.holderPhone).toBeNull();
  });

  it("eist een CJP-schoolnummer, want daar draait deze aanvraag om", () => {
    const uitkomst = validateParkingInput({ ...goed, cjpSchoolNumber: "" }, { minimumCents: 5000 });
    expect(uitkomst.ok).toBe(false);
    expect(uitkomst.errors.cjpSchoolNumber).toBeTruthy();
  });

  it("weigert een adres dat geen e-mailadres is", () => {
    const uitkomst = validateParkingInput(
      { ...goed, holderEmail: "sanne apenstaartje school" },
      { minimumCents: 5000 }
    );
    expect(uitkomst.errors.holderEmail).toBeTruthy();
  });

  it("houdt zich aan het ingestelde minimumbedrag", () => {
    const uitkomst = validateParkingInput({ ...goed, amount: "20,00" }, { minimumCents: 5000 });
    expect(uitkomst.ok).toBe(false);
    expect(uitkomst.errors.amount).toContain("50,00");
  });

  it("noemt alle ontbrekende velden tegelijk, niet één voor één", () => {
    const uitkomst = validateParkingInput(
      { schoolName: "", cjpSchoolNumber: "", holderName: "", holderEmail: "", holderPhone: "", amount: "" },
      { minimumCents: 5000 }
    );
    expect(Object.keys(uitkomst.errors).sort()).toEqual([
      "amount",
      "cjpSchoolNumber",
      "holderEmail",
      "holderName",
      "schoolName",
    ]);
  });
});

describe("afboeken", () => {
  it("staat een bedrag binnen het saldo toe", () => {
    const uitkomst = checkSpend("250,00", 75000);
    expect(uitkomst.ok).toBe(true);
    expect(uitkomst.cents).toBe(25000);
  });

  it("staat precies het hele saldo toe", () => {
    expect(checkSpend("750,00", 75000).ok).toBe(true);
  });

  it("weigert één cent meer dan er staat", () => {
    const uitkomst = checkSpend("750,01", 75000);
    expect(uitkomst.ok).toBe(false);
    expect(uitkomst.message).toContain("750,00");
  });

  it("weigert afboeken zonder tegoed", () => {
    expect(checkSpend("10,00", 0).ok).toBe(false);
  });

  it("rekent het restant goed uit en gaat nooit onder nul", () => {
    expect(remainingAfter(75000, 25000)).toBe(50000);
    expect(remainingAfter(75000, 75000)).toBe(0);
    expect(remainingAfter(1000, 5000)).toBe(0);
  });
});

describe("de teksten die de klant ziet", () => {
  it("gebruikt gewone woorden, geen databasewaarden", () => {
    expect(PARKING_STATUS_LABELS.requested).toBe("Aangevraagd");
    expect(PARKING_STATUS_LABELS.in_review).toBe("In behandeling");
    expect(PARKING_STATUS_LABELS.confirmed).toBe("Bevestigd");
    expect(PARKING_STATUS_LABELS.rejected).toBe("Afgewezen");
    expect(CREDIT_TYPE_LABELS.parking).toBe("Tegoed geparkeerd");
    expect(CREDIT_TYPE_LABELS.spend).toBe("Tegoed gebruikt");
  });

  it("schrijft bedragen op zijn Nederlands", () => {
    expect(formatCentsPlain(125050)).toBe("1.250,50");
    expect(formatCentsPlain(5000)).toBe("50,00");
  });
});

/**
 * De belangrijkste regel van dit hele onderdeel, hier vastgelegd als test:
 * euro's en punten raken elkaar nergens. Als iemand ooit een omrekening
 * toevoegt, valt deze test om.
 */
describe("euro's en punten blijven gescheiden", () => {
  it("kent geen enkele functie die euro's naar punten omrekent", async () => {
    const regels = await import("@/lib/tegoed/regels");
    const namen = Object.keys(regels).join(" ").toLowerCase();
    expect(namen).not.toContain("point");
    expect(namen).not.toContain("punt");
  });
});
