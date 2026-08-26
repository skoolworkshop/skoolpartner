/**
 * Telefoonnummers: één manier van opslaan, één manier van tonen.
 *
 * Opslaan doen we in internationaal formaat zonder spaties, bijvoorbeeld
 * +31612345678. Zo is een nummer altijd vergelijkbaar, ook als de een het met
 * spaties invult en de ander met streepjes.
 *
 * Tonen doen we leesbaar, want +31612345678 leest niemand prettig.
 *
 * Nederlandse nummers zonder landcode krijgen automatisch +31. Andere landen
 * moeten zelf hun landcode invullen; dat vragen we ook in de hint.
 */

export interface PhoneResult {
  ok: boolean;
  /** Genormaliseerd, klaar om op te slaan. */
  value?: string;
  message?: string;
}

export function normalizePhone(raw: string): PhoneResult {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, message: "Vul uw telefoonnummer in." };
  }

  // Alles weghalen wat geen cijfer of leidende plus is.
  const heeftPlus = trimmed.startsWith("+") || trimmed.startsWith("00");
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length < 8) {
    return { ok: false, message: "Dit telefoonnummer lijkt te kort." };
  }
  if (digits.length > 15) {
    return { ok: false, message: "Dit telefoonnummer lijkt te lang." };
  }

  // 0031 6 12345678 -> +31612345678
  if (trimmed.startsWith("00")) {
    return { ok: true, value: `+${digits.slice(2)}` };
  }

  if (heeftPlus) {
    return { ok: true, value: `+${digits}` };
  }

  // Nederlands nummer met een 0 ervoor: 06 12345678 of 085 065 39 23.
  if (digits.startsWith("0")) {
    const zonderNul = digits.slice(1);
    if (zonderNul.length !== 9) {
      return {
        ok: false,
        message: "Een Nederlands nummer heeft negen cijfers na de 0, bijvoorbeeld 06 12345678.",
      };
    }
    return { ok: true, value: `+31${zonderNul}` };
  }

  // Negen cijfers zonder nul ervoor is ook een Nederlands nummer.
  if (digits.length === 9) {
    return { ok: true, value: `+31${digits}` };
  }

  return {
    ok: false,
    message: "Vul een Nederlands nummer in, of zet de landcode ervoor, bijvoorbeeld +32.",
  };
}

/** Leesbare weergave voor in de interface. */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed.startsWith("+")) return trimmed;

  // Nederlandse mobiele nummers: +31 6 12 34 56 78
  if (trimmed.startsWith("+316") && trimmed.length === 12) {
    const d = trimmed.slice(3);
    return `+31 ${d[0]} ${d.slice(1, 3)} ${d.slice(3, 5)} ${d.slice(5, 7)} ${d.slice(7)}`;
  }

  // Overige Nederlandse nummers: +31 85 065 39 23
  if (trimmed.startsWith("+31") && trimmed.length === 12) {
    const d = trimmed.slice(3);
    return `+31 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7)}`;
  }

  return trimmed;
}
