import type { ParserInput } from "@/lib/bookings/parser";

export interface MockGmailMessage extends ParserInput {
  direction: "inbound" | "outbound";
  bodyHtml?: string | null;
  inReplyTo?: string | null;
}

/**
 * Voorbeeldberichten voor ontwikkeling zolang de Gmail-koppeling nog niet
 * geautoriseerd is. Bevat bewust ook een offerteaanvraag, zodat te testen is
 * dat die NIET als definitieve boeking wordt gezien.
 */
export const MOCK_GMAIL_MESSAGES: MockGmailMessage[] = [
  {
    direction: "outbound",
    messageId: "mock-msg-confirm-1",
    threadId: "mock-thread-1",
    from: "boekingen@skoolworkshop.nl",
    fromName: "Skool Workshop",
    to: ["s.devries@goudsewaarden.nl"],
    cc: [],
    subject: "Boekingsbevestiging Cultuurdag 12 maart",
    labels: ["Mijn Skool/Boekingsbevestiging"],
    receivedAt: "2026-03-02T09:12:00.000Z",
    bodyText: [
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
      "",
      "Met vriendelijke groet,",
      "Team Skool Workshop",
    ].join("\n"),
  },
  {
    direction: "inbound",
    messageId: "mock-msg-reply-1",
    threadId: "mock-thread-1",
    from: "s.devries@goudsewaarden.nl",
    fromName: "Sanne de Vries",
    to: ["boekingen@skoolworkshop.nl"],
    cc: [],
    subject: "Re: Boekingsbevestiging Cultuurdag 12 maart",
    labels: [],
    receivedAt: "2026-03-02T13:40:00.000Z",
    inReplyTo: "mock-msg-confirm-1",
    bodyText:
      "Dank voor de bevestiging. Kunnen de leerlingen zelf oude kleding meenemen, of regelen jullie schorten?",
  },
  {
    direction: "outbound",
    messageId: "mock-msg-quote-1",
    threadId: "mock-thread-2",
    from: "boekingen@skoolworkshop.nl",
    fromName: "Skool Workshop",
    to: ["s.devries@goudsewaarden.nl"],
    cc: [],
    subject: "Offerte projectdagen mei",
    labels: [],
    receivedAt: "2026-04-11T10:05:00.000Z",
    bodyText: [
      "Beste Sanne,",
      "",
      "Hierbij een vrijblijvende offerte voor de projectdagen in mei.",
      "",
      "Workshop: Podcast",
      "Aantal workshops: 2",
      "Duur: 90 minuten per workshop",
      "Datum: 21 mei 2026",
      "",
      "Deze offerte is nog niet definitief.",
    ].join("\n"),
  },
];
