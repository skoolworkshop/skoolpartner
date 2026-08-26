import { describe, expect, it } from "vitest";

import {
  betreftMailbox,
  betreftMailboxReden,
  buildScopedQuery,
  checkSendAs,
  findSendAs,
  isUitgaand,
  normalizeEmail,
  sendAsInstructie,
  sendAsLabel,
  splitAddresses,
  type SendAsEntry,
} from "@/lib/integrations/gmail/identity";

const ACCOUNT = "clinten@skoolworkshop.nl";
const MAILBOX = "boekingen@skoolworkshop.nl";

describe("adressen opschonen", () => {
  it("haalt het adres uit een naam met punthaken", () => {
    expect(normalizeEmail("Clinten <Clinten@Skoolworkshop.NL>")).toBe("clinten@skoolworkshop.nl");
    expect(normalizeEmail('"Skool Workshop" <boekingen@skoolworkshop.nl>')).toBe(MAILBOX);
  });

  it("verwerkt een kaal adres", () => {
    expect(normalizeEmail("  BOEKINGEN@skoolworkshop.nl ")).toBe(MAILBOX);
  });

  it("geeft null bij iets dat geen adres is", () => {
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("geen adres")).toBeNull();
  });

  it("splitst meerdere ontvangers", () => {
    expect(splitAddresses("A <a@school.nl>, b@school.nl, Rommel")).toEqual([
      "a@school.nl",
      "b@school.nl",
    ]);
  });
});

describe("verzenden als het boekingenadres", () => {
  const lijst: SendAsEntry[] = [
    { sendAsEmail: ACCOUNT, isPrimary: true, isDefault: true },
    {
      sendAsEmail: MAILBOX,
      displayName: "Skool Workshop",
      treatAsAlias: true,
      verificationStatus: "accepted",
    },
  ];

  it("vindt het boekingenadres ongeacht hoofdletters", () => {
    expect(findSendAs(lijst, "Boekingen@Skoolworkshop.nl")?.sendAsEmail).toBe(MAILBOX);
  });

  it("keurt een geaccepteerd alias goed", () => {
    const check = checkSendAs(lijst, MAILBOX);
    expect(check.ready).toBe(true);
    expect(check.state).toBe("gereed");
    expect(sendAsLabel(check)).toBe("Gereed");
    expect(sendAsInstructie(check, MAILBOX, ACCOUNT)).toEqual([]);
  });

  /**
   * Bij een alias binnen het eigen Workspace-domein hoeft Google niets te
   * verifiëren en blijft de status leeg. Dat is dus geen probleem, en die
   * situatie is hier vastgelegd zodat niemand hem later per ongeluk afkeurt.
   */
  it("keurt een Workspace-alias zonder verificatiestatus ook goed", () => {
    const check = checkSendAs([{ sendAsEmail: MAILBOX }], MAILBOX);
    expect(check.ready).toBe(true);
  });

  it("keurt goed als het boekingenadres het account zelf is", () => {
    const check = checkSendAs([{ sendAsEmail: ACCOUNT, isPrimary: true }], ACCOUNT);
    expect(check.ready).toBe(true);
  });

  it("weigert zolang de verificatie openstaat", () => {
    const check = checkSendAs(
      [{ sendAsEmail: MAILBOX, verificationStatus: "pending" }],
      MAILBOX
    );
    expect(check.ready).toBe(false);
    expect(check.state).toBe("verificatie-open");
    expect(sendAsLabel(check)).toBe("Configuratie vereist");
    expect(sendAsInstructie(check, MAILBOX, ACCOUNT).join(" ")).toContain("Verifiëren");
  });

  it("weigert als het adres er helemaal niet tussen staat", () => {
    const check = checkSendAs([{ sendAsEmail: ACCOUNT, isPrimary: true }], MAILBOX);
    expect(check.ready).toBe(false);
    expect(check.state).toBe("ontbreekt");
    expect(sendAsInstructie(check, MAILBOX, ACCOUNT).join(" ")).toContain("Nog een e-mailadres");
  });

  it("weigert bij een lege lijst", () => {
    expect(checkSendAs([], MAILBOX).ready).toBe(false);
  });
});

describe("hoort dit bericht bij het boekingenadres", () => {
  it("herkent het adres in To", () => {
    expect(betreftMailbox({ to: `Skool Workshop <${MAILBOX}>` }, MAILBOX)).toBe(true);
  });

  it("herkent het adres in From", () => {
    expect(betreftMailbox({ from: MAILBOX }, MAILBOX)).toBe(true);
  });

  it("herkent het adres in Cc en Bcc", () => {
    expect(betreftMailbox({ cc: `a@school.nl, ${MAILBOX}` }, MAILBOX)).toBe(true);
    expect(betreftMailbox({ bcc: MAILBOX }, MAILBOX)).toBe(true);
  });

  it("herkent het adres in Reply-To", () => {
    expect(betreftMailbox({ "reply-to": MAILBOX }, MAILBOX)).toBe(true);
  });

  /**
   * Dit is het geval dat je mist als je alleen naar To kijkt: post aan een
   * alias komt binnen met het persoonlijke adres in To en het aliasadres
   * alleen in Delivered-To.
   */
  it("herkent het adres in Delivered-To bij een alias", () => {
    expect(
      betreftMailbox({ to: ACCOUNT, "delivered-to": MAILBOX }, MAILBOX)
    ).toBe(true);
  });

  it("herkent het adres in X-Original-To", () => {
    expect(betreftMailbox({ to: ACCOUNT, "x-original-to": MAILBOX }, MAILBOX)).toBe(true);
  });

  /* ---- en dit mag er juist NIET doorheen ---- */

  it("laat privémail aan het persoonlijke account niet door", () => {
    expect(
      betreftMailbox({ to: ACCOUNT, from: "zwager@familie.nl", subject: "Verjaardag" }, MAILBOX)
    ).toBe(false);
  });

  it("laat mail van een bekende school aan het persoonlijke account niet door", () => {
    expect(
      betreftMailbox({ to: ACCOUNT, from: "s.devries@goudsewaarden.nl" }, MAILBOX)
    ).toBe(false);
  });

  it("laat een sollicitatie niet door", () => {
    expect(
      betreftMailbox({ to: `vacatures@skoolworkshop.nl`, from: "iemand@gmail.com" }, MAILBOX)
    ).toBe(false);
  });

  it("trapt niet in een adres dat er alleen op lijkt", () => {
    expect(betreftMailbox({ to: "boekingen@skoolworkshop.nl.kwaadaardig.nl" }, MAILBOX)).toBe(false);
    expect(betreftMailbox({ to: "nepboekingen@skoolworkshop.nl" }, MAILBOX)).toBe(false);
  });

  it("laat niets door als er geen boekingenadres is ingesteld", () => {
    expect(betreftMailbox({ to: MAILBOX }, "")).toBe(false);
  });

  it("legt uit waarom een bericht wel of niet meetelt", () => {
    expect(betreftMailboxReden({ "delivered-to": MAILBOX }, MAILBOX)).toContain("delivered-to");
    expect(betreftMailboxReden({ to: ACCOUNT }, MAILBOX)).toContain("komt in dit bericht niet voor");
  });
});

describe("de zoekopdracht naar Gmail", () => {
  it("beperkt tot het boekingenadres en houdt de eigen filters", () => {
    const query = buildScopedQuery(MAILBOX, "newer_than:60d -in:spam -in:trash");
    expect(query).toContain(`to:${MAILBOX}`);
    expect(query).toContain(`from:${MAILBOX}`);
    expect(query).toContain(`cc:${MAILBOX}`);
    expect(query).toContain(`bcc:${MAILBOX}`);
    expect(query).toContain(`deliveredto:${MAILBOX}`);
    expect(query).toContain("newer_than:60d");
    // De adresvoorwaarden staan tussen accolades, zodat het een OR-groep is en
    // de rest van de filters daar los overheen gaat.
    expect(query.startsWith("{")).toBe(true);
  });

  it("werkt ook zonder eigen filters", () => {
    expect(buildScopedQuery(MAILBOX, "  ")).toBe(
      `{to:${MAILBOX} OR from:${MAILBOX} OR cc:${MAILBOX} OR bcc:${MAILBOX} OR deliveredto:${MAILBOX}}`
    );
  });

  it("laat de zoekopdracht met rust als er geen adres is", () => {
    expect(buildScopedQuery("", "newer_than:60d")).toBe("newer_than:60d");
  });
});

describe("in- of uitgaand", () => {
  it("noemt post van het boekingenadres uitgaand", () => {
    expect(isUitgaand(MAILBOX, MAILBOX, ACCOUNT)).toBe(true);
  });

  it("noemt post van het gekoppelde account ook uitgaand", () => {
    expect(isUitgaand(ACCOUNT, MAILBOX, ACCOUNT)).toBe(true);
  });

  it("noemt post van een klant inkomend", () => {
    expect(isUitgaand("s.devries@goudsewaarden.nl", MAILBOX, ACCOUNT)).toBe(false);
  });

  it("gaat goed zonder bekend account", () => {
    expect(isUitgaand(MAILBOX, MAILBOX, null)).toBe(true);
    expect(isUitgaand("iemand@school.nl", MAILBOX, null)).toBe(false);
    expect(isUitgaand(null, MAILBOX, ACCOUNT)).toBe(false);
  });
});
