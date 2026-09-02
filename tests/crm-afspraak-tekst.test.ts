import { describe, expect, it } from "vitest";

import { kortAf, leesAfspraakTekst, platteTekst } from "@/lib/crm/afspraak-tekst";

/** Precies zoals het uit HubSpot in de database is beland. */
const UIT_HUBSPOT =
  'Join link for Google Meet : https://meet.google.com/hov-grgh-qup<br><b>Wil je wijzigingen ' +
  'aanbrengen?</b><br><ul><li>Opnieuw plannen:&nbsp;<a href="https://app-eu1.hubspot.com/meetings/' +
  'skool-workshop/suri-impact?rescheduleId=918810da4aae2af8b9bbd8f1cd2f56f3&amp;ms=1">https://app-eu1' +
  '.hubspot.com/meetings/skool-workshop/suri-impact?rescheduleId=918810da4aae2af8b9bbd8f1cd2f56f3&amp;' +
  'ms=1</a></li><li>Annuleren:&nbsp;<a href="https://app-eu1.hubspot.com/meetings/skool-workshop/' +
  'suri-impact?cancelId=918810da4aae2af8b9bbd8f1cd2f56f3&amp;ms=1">https://app-eu1.hubspot.com/' +
  'meetings/skool-workshop/suri-impact?cancelId=918810da4aae2af8b9bbd8f1cd2f56f3&amp;ms=1</a></li></ul>';

describe("platte tekst", () => {
  it("haalt tags en entiteiten eruit", () => {
    expect(platteTekst("<p>Gebeld met Anne &amp; Joost.</p>")).toBe("Gebeld met Anne & Joost.");
    expect(platteTekst("een<br>twee")).toBe("een\ntwee");
    expect(platteTekst("<ul><li>eerst</li><li>daarna</li></ul>")).toBe("• eerst\n• daarna");
    expect(platteTekst(null)).toBe("");
  });

  it("laat gewone tekst met rust", () => {
    expect(platteTekst("Kennismaking op school, 3 klassen")).toBe(
      "Kennismaking op school, 3 klassen"
    );
  });
});

describe("de omschrijving van een afspraak uit HubSpot", () => {
  const uitkomst = leesAfspraakTekst(UIT_HUBSPOT);

  it("houdt de videolink apart", () => {
    expect(uitkomst.gesprek).toEqual({
      url: "https://meet.google.com/hov-grgh-qup",
      dienst: "Google Meet",
    });
  });

  it("laat de HubSpot-links weg en telt ze", () => {
    expect(uitkomst.weggelaten).toBe(2);
    expect(uitkomst.tekst).not.toContain("hubspot");
    expect(uitkomst.tekst).not.toContain("rescheduleId");
  });

  it("laat geen HTML en geen losse adressen achter", () => {
    expect(uitkomst.tekst).not.toMatch(/<[^>]+>/);
    expect(uitkomst.tekst).not.toContain("&nbsp;");
    expect(uitkomst.tekst).not.toContain("http");
  });

  it("laat de bijschriften van de weggehaalde links ook weg", () => {
    expect(uitkomst.tekst).not.toMatch(/opnieuw plannen/i);
    expect(uitkomst.tekst).not.toMatch(/annuleren/i);
    expect(uitkomst.tekst).not.toMatch(/wil je wijzigingen/i);
  });

  it("laat een echte zin staan", () => {
    const metZin = leesAfspraakTekst(
      "Kennismaking met de teamleider.<br>Opnieuw plannen: https://app-eu1.hubspot.com/meetings/x"
    );
    expect(metZin.tekst).toBe("Kennismaking met de teamleider.");
  });

  it("houdt niets over, want er stond niets in", () => {
    /*
      Deze omschrijving bestond volledig uit de vaste tekst van HubSpot: een
      videolink met bijschrift en twee links om te verzetten of af te zeggen.
      Zonder die links blijft er letterlijk niets te lezen over, en dan hoort er
      ook niets te staan. Het scherm toont dan alleen de knop naar het gesprek.
    */
    expect(uitkomst.tekst).toBe("");
    expect(uitkomst.gesprek).not.toBeNull();
  });
});

describe("randgevallen", () => {
  it("geeft een lege uitkomst bij niets", () => {
    expect(leesAfspraakTekst("")).toEqual({ tekst: "", gesprek: null, weggelaten: 0 });
    expect(leesAfspraakTekst(null).tekst).toBe("");
  });

  it("laat een gewone omschrijving ongemoeid", () => {
    const uitkomst = leesAfspraakTekst("Kennismaking op school met de teamleider onderbouw.");
    expect(uitkomst.tekst).toBe("Kennismaking op school met de teamleider onderbouw.");
    expect(uitkomst.gesprek).toBeNull();
  });

  it("herkent ook Zoom en Teams, en neemt de eerste videolink", () => {
    expect(leesAfspraakTekst("Bellen via https://zoom.us/j/123").gesprek?.dienst).toBe("Zoom");
    expect(
      leesAfspraakTekst("https://teams.microsoft.com/l/meetup-join/abc").gesprek?.dienst
    ).toBe("Teams");
  });

  it("haalt de punt achter een adres van de link af", () => {
    const uitkomst = leesAfspraakTekst("We bellen via https://meet.google.com/abc-defg-hij.");
    expect(uitkomst.gesprek?.url).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("kort af op een woordgrens en meldt dat", () => {
    expect(kortAf("Kort en klaar")).toEqual({ kort: "Kort en klaar", ingekort: false });
    const lang = kortAf("woord ".repeat(60));
    expect(lang.ingekort).toBe(true);
    expect(lang.kort.endsWith("...")).toBe(true);
    expect(lang.kort.length).toBeLessThanOrEqual(223);
  });
});
