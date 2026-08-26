/**
 * Het uitzoekwerk rond schoollogo's, zonder netwerk of database.
 *
 * Bewust gescheiden van het daadwerkelijk ophalen, zodat de regels over wat
 * veilig is en welk plaatje de beste kandidaat is volledig te testen zijn.
 */

export interface LogoCandidate {
  url: string;
  /** Hoe zeker weten wij dat dit het logo is? Hoger is beter. */
  score: number;
  reason: string;
}

/** Alleen deze typen slaan wij op. Geen SVG: daar kan script in zitten. */
export const TOEGESTANE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/x-icon", "image/vnd.microsoft.icon"];

/** Ruim genoeg voor een fatsoenlijk logo, klein genoeg om nooit te blokkeren. */
export const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Mag dit adres opgehaald worden?
 *
 * Wij halen straks een pagina op van een adres dat een klant heeft ingevuld.
 * Zonder controle zou iemand ons daarmee naar een intern adres kunnen sturen en
 * zo dingen laten opvragen die alleen onze server kan zien. Daarom: alleen
 * https, geen inloggegevens in de URL, geen poortnummer, en geen adressen die
 * naar een intern netwerk wijzen.
 */
export function isVeiligeUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (host === "metadata.google.internal") return false;

  // Rechtstreekse IP-adressen accepteren wij niet. Een school heeft een naam.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host.includes(":")) return false;

  // Een domein moet minstens één punt hebben en een fatsoenlijke extensie.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return false;

  return true;
}

/** goudsewaarden.nl of www.goudsewaarden.nl -> https://goudsewaarden.nl */
export function domeinNaarUrl(domein: string): string | null {
  const schoon = domein
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");

  if (!schoon) return null;
  const url = `https://${schoon}`;
  return isVeiligeUrl(url) ? url : null;
}

function absoluut(basis: string, adres: string): string | null {
  try {
    return new URL(adres, basis).toString();
  } catch {
    return null;
  }
}

/**
 * Zoekt in de HTML van de startpagina naar het logo.
 *
 * De volgorde is niet willekeurig. Een apple-touch-icon is met opzet door de
 * school zelf neergezet, is vierkant en heeft meestal een nette resolutie. Een
 * og:image is bedoeld om gedeeld te worden en is vaak een sfeerfoto, dus die
 * scoort lager. Het gewone favicon is de laatste redding: klein, maar het is
 * altijd echt van die school.
 */
export function vindLogoKandidaten(html: string, basisUrl: string): LogoCandidate[] {
  const kandidaten: LogoCandidate[] = [];

  const voegToe = (adres: string | null | undefined, score: number, reason: string) => {
    if (!adres) return;
    const volledig = absoluut(basisUrl, adres.trim());
    if (!volledig || !isVeiligeUrl(volledig)) return;
    if (volledig.toLowerCase().endsWith(".svg")) return;
    if (kandidaten.some((k) => k.url === volledig)) return;
    kandidaten.push({ url: volledig, score, reason });
  };

  // <link rel="apple-touch-icon" href="...">
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;

    if (rel.includes("apple-touch-icon")) voegToe(href, 100, "apple-touch-icon");
    else if (rel.includes("mask-icon")) voegToe(href, 40, "mask-icon");
    else if (rel.includes("icon")) {
      const maten = /\bsizes\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
      const grootste = Math.max(
        0,
        ...maten.split(/\s+/).map((m) => Number.parseInt(m.split("x")[0] ?? "0", 10) || 0)
      );
      voegToe(href, grootste >= 96 ? 80 : 50, `icon${maten ? ` ${maten}` : ""}`);
    }
  }

  // <meta property="og:logo" of "og:image">
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const naam = (
      /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? ""
    ).toLowerCase();
    const inhoud = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!inhoud) continue;

    if (naam === "og:logo") voegToe(inhoud, 95, "og:logo");
    else if (naam === "og:image") voegToe(inhoud, 60, "og:image");
    else if (naam === "msapplication-tileimage") voegToe(inhoud, 70, "tile-image");
  }

  // "logo":"https://..." uit de schema.org-gegevens.
  for (const match of html.matchAll(/"logo"\s*:\s*"([^"]+)"/gi)) {
    voegToe(match[1], 90, "schema.org logo");
  }

  return kandidaten.sort((a, b) => b.score - a.score);
}

/** Als een site niets prijsgeeft, blijft dit over. */
export function standaardFavicon(basisUrl: string): string | null {
  return absoluut(basisUrl, "/favicon.ico");
}

/** Klopt dit met een echt plaatje, en niet met een foutpagina? */
export function isBruikbareAfbeelding(contentType: string | null, bytes: number): boolean {
  if (!contentType) return false;
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (!TOEGESTANE_TYPES.includes(type)) return false;
  // Kleiner dan dit is geen logo maar een lege pixel of een foutpagina.
  if (bytes < 200) return false;
  if (bytes > MAX_BYTES) return false;
  return true;
}

/** De bestandsnaam waaronder wij het logo bewaren. */
export function logoBestandsnaam(organizationId: string, contentType: string): string {
  const type = contentType.split(";")[0].trim().toLowerCase();
  const extensie =
    type === "image/png"
      ? "png"
      : type === "image/jpeg"
        ? "jpg"
        : type === "image/webp"
          ? "webp"
          : "ico";
  return `${organizationId}/logo.${extensie}`;
}
