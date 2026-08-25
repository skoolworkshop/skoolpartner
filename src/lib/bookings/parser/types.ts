export interface ParserSettings {
  /** Gmail-label dat Skool Workshop op een definitieve bevestiging zet. */
  confirmationLabel: string;
  /** Afzenderdomeinen die als betrouwbaar gelden. */
  allowedFromDomains: string[];
  /** Minimale workshopduur volgens de bedrijfsregels. */
  minimumBookingMinutes: number;
}

export interface ParserInput {
  messageId: string;
  threadId: string | null;
  from: string | null;
  fromName?: string | null;
  to: string[];
  cc?: string[];
  subject: string | null;
  bodyText: string;
  labels?: string[];
  receivedAt?: string | null;
  headers?: Record<string, string>;
}

export interface ExtractedBooking {
  organizationName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  workshopName: string | null;
  workshopCount: number | null;
  minutesPerWorkshop: number | null;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  participants: number | null;
  reference: string | null;
}

export interface ParseResult {
  /** Is dit met voldoende zekerheid een definitieve boekingsbevestiging? */
  isConfirmation: boolean;
  /** 0 tot 1. Bepaalt of de boeking automatisch of via Controle nodig loopt. */
  confidence: number;
  /** Signalen die meetelden, voor uitleg in de adminwachtrij. */
  signals: string[];
  /** Redenen waarom handmatige controle nodig is. */
  reviewReasons: string[];
  extracted: ExtractedBooking;
  parserVersion: string;
}
