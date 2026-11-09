/**
 * De e-mailhandtekening van Skool Workshop, als HTML.
 *
 * WAAROM GEEN PLAATJE VAN DE HELE HANDTEKENING
 *
 *   Een handtekening als één afbeelding is op elk scherm scherp, maar verder
 *   alleen maar nadelen: je kunt het telefoonnummer niet aantikken, het
 *   e-mailadres niet kopiëren, de tekst niet zoeken en niets voorlezen. En in
 *   elke mailprogramma dat afbeeldingen blokkeert, en dat zijn er veel, blijft
 *   er niets over. Daarom is dit echte tekst met echte links.
 *
 * WAT E-MAIL WEL EN NIET KAN
 *
 *   Outlook rendert met Word. Geen flexbox, geen grid, geen stylesheet in de
 *   kop. Daarom tabellen voor de indeling en alle opmaak inline. Dat ziet er
 *   in de code ouderwets uit en is in de mailbox precies goed.
 *
 * WAT HIER NOOIT IN KOMT
 *
 *   Een verzonnen link. Elke URL hieronder staat op skoolworkshop.nl of in de
 *   instellingen van het systeem. Ontbreekt er iets, dan blijft het weg in
 *   plaats van dat er iets plausibels wordt ingevuld.
 */

export interface SocialLink {
  label: string;
  url: string;
  /**
   * Een vierkant icoon van minstens 64 bij 64 pixels op een openbaar adres.
   * Ontbreekt die, dan wordt het een nette tekstlink. Nooit een icoon van een
   * andere partij meelinken: dat laadt traag en kan zomaar verdwijnen.
   */
  icoon?: string | null;
}

export interface Handtekening {
  naam: string;
  functie: string;
  bedrijf: string;
  telefoon: string;
  /** Zoals je hem belt, zonder spaties. */
  telefoonLink: string;
  email: string;
  website: string;
  websiteLabel: string;
  adres: string;
  logo: string | null;
  logoBreedte: number;
  social: SocialLink[];
}

/**
 * De gegevens zoals ze op de website en in de instellingen staan.
 *
 * Bijgewerkt op 9 november 2026. Verandert er iets, dan pas je het hier aan,
 * of je zet een eigen versie in de instelling email_signature.
 */
export const STANDAARD_HANDTEKENING: Handtekening = {
  naam: "Clinten Piqué",
  functie: "Bedrijfsleider",
  bedrijf: "Skool Workshop",
  telefoon: "085-0653923",
  telefoonLink: "tel:0850653923",
  email: "info@skoolworkshop.nl",
  website: "https://www.skoolworkshop.nl",
  websiteLabel: "www.skoolworkshop.nl",
  adres: "Goeseelsstraat 27, Breda",
  /*
    Het logo staat in SkoolPartner zelf, onder /brand. Dat is bewust niet het
    bestand op de WordPress-website: die kan verhuizen of in onderhoud staan,
    en dan zit er een kapot plaatje in elke verstuurde mail. Het adres wordt
    bij het versturen aangevuld met het domein waarop SkoolPartner draait.
  */
  logo: "/brand/skool-workshop-logo.png",
  logoBreedte: 180,
  social: [
    { label: "LinkedIn", url: "https://www.linkedin.com/company/skool-workshop/" },
    { label: "Facebook", url: "https://www.facebook.com/skoolworkshop" },
    { label: "Instagram", url: "https://www.instagram.com/skoolworkshop/" },
    { label: "WhatsApp", url: "https://wa.me/31850653923" },
  ],
};

const ORANJE = "#F39200";
const INKT = "#1A1A1A";
const GRIJS = "#6B6B6B";
const LIJN = "#E3E3E3";
const LETTERS = "Arial, Helvetica, sans-serif";

/** Tekst die veilig in HTML mag staan. */
export function veilig(waarde: string): string {
  return waarde
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Alleen adressen waarvan we weten waar ze heen gaan.
 *
 * Een handtekening die uit instellingen komt, is een plek waar iemand per
 * ongeluk of expres iets anders neer kan zetten. Vandaar deze zeef.
 */
export function veiligeUrl(url: string): string | null {
  const schoon = url.trim();
  if (/^https:\/\/[^\s"'<>]+$/i.test(schoon)) return schoon;
  // Alleen zodat het logo zichtbaar is als je lokaal het voorbeeld bekijkt.
  // In een echte mailbox komt zo'n adres nooit aan, en dat hoeft ook niet.
  if (/^http:\/\/localhost(:\d+)?\/[^\s"'<>]*$/i.test(schoon)) return schoon;
  if (/^tel:[0-9+\-\s]+$/i.test(schoon)) return schoon;
  if (/^mailto:[^\s"'<>@]+@[^\s"'<>@]+$/i.test(schoon)) return schoon;
  return null;
}

function link(url: string, tekst: string, kleur = INKT, vet = false): string {
  const veiligUrl = veiligeUrl(url);
  const inhoud = veilig(tekst);
  if (!veiligUrl) return inhoud;
  return `<a href="${veilig(veiligUrl)}" style="color:${kleur};text-decoration:none;${
    vet ? "font-weight:bold;" : ""
  }">${inhoud}</a>`;
}

/**
 * De handtekening zoals hij onder de mail komt.
 *
 * De indeling volgt de bestaande handtekening: links de naam en de functie,
 * rechts de contactgegevens met een oranje streep ertussen, en daaronder het
 * logo met de socialmedialinks.
 */
export function maakHandtekening(gegevens: Handtekening = STANDAARD_HANDTEKENING): string {
  const regels: { icoon: string; inhoud: string }[] = [];

  if (gegevens.telefoon) {
    regels.push({ icoon: "Tel", inhoud: link(gegevens.telefoonLink, gegevens.telefoon) });
  }
  if (gegevens.email) {
    regels.push({ icoon: "Mail", inhoud: link(`mailto:${gegevens.email}`, gegevens.email) });
  }
  if (gegevens.website) {
    regels.push({ icoon: "Web", inhoud: link(gegevens.website, gegevens.websiteLabel) });
  }
  if (gegevens.adres) {
    regels.push({ icoon: "Adres", inhoud: veilig(gegevens.adres) });
  }

  const contactRegels = regels
    .map(
      (regel) => `
            <tr>
              <td style="padding:0 10px 6px 0;font:11px/16px ${LETTERS};color:${ORANJE};white-space:nowrap;">${veilig(
                regel.icoon,
              )}</td>
              <td style="padding:0 0 6px 0;font:14px/18px ${LETTERS};color:${INKT};">${regel.inhoud}</td>
            </tr>`,
    )
    .join("");

  const socialCellen = gegevens.social
    .map((item) => {
      const url = veiligeUrl(item.url);
      if (!url) return "";
      const icoon = item.icoon ? veiligeUrl(item.icoon) : null;
      const inhoud = icoon
        ? `<img src="${veilig(icoon)}" width="28" height="28" alt="${veilig(
            item.label,
          )}" style="display:block;border:0;border-radius:14px;" />`
        : `<span style="font:bold 12px/28px ${LETTERS};color:#FFFFFF;">${veilig(item.label)}</span>`;

      return `<td style="padding:0 0 0 8px;">
                <a href="${veilig(url)}" style="text-decoration:none;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background:${ORANJE};border-radius:14px;">
                    <tr><td align="center" style="padding:0 ${
                      icoon ? "0" : "10px"
                    };height:28px;">${inhoud}</td></tr>
                  </table>
                </a>
              </td>`;
    })
    .join("");

  const logo = gegevens.logo && veiligeUrl(gegevens.logo);

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;">
  <tr>
    <td style="padding:18px 0 0 0;font:14px/20px ${LETTERS};color:${INKT};">Met vriendelijke groet,</td>
  </tr>
  <tr>
    <td style="padding:14px 0 0 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="top" style="padding:0 24px 0 0;">
            <div style="font:bold 17px/22px ${LETTERS};color:${INKT};">${veilig(gegevens.naam)}</div>
            <div style="font:14px/20px ${LETTERS};color:${INKT};">${veilig(gegevens.functie)} | ${veilig(
              gegevens.bedrijf,
            )}</div>
          </td>
          <td valign="top" style="border-left:2px solid ${ORANJE};padding:0 0 0 24px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">${contactRegels}
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding:16px 0 0 0;border-top:1px solid ${LIJN};"></td>
  </tr>
  <tr>
    <td style="padding:14px 0 0 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td valign="middle">${
            logo
              ? `<img src="${veilig(logo)}" width="${gegevens.logoBreedte}" alt="${veilig(
                  gegevens.bedrijf,
                )}" style="display:block;border:0;width:${gegevens.logoBreedte}px;max-width:100%;height:auto;" />`
              : `<span style="font:bold 16px/20px ${LETTERS};color:${INKT};">${veilig(gegevens.bedrijf)}</span>`
          }</td>
          <td valign="middle" align="right">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${socialCellen}</tr></table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`.trim();
}

/** Dezelfde gegevens als platte tekst, voor wie geen HTML krijgt of wil. */
export function handtekeningTekst(gegevens: Handtekening = STANDAARD_HANDTEKENING): string {
  return [
    "Met vriendelijke groet,",
    "",
    gegevens.naam,
    `${gegevens.functie} | ${gegevens.bedrijf}`,
    gegevens.telefoon,
    gegevens.email,
    gegevens.websiteLabel,
    gegevens.adres,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * De hele mail: de tekst van de medewerker met de handtekening eronder.
 *
 * Alinea's worden gescheiden door een lege regel, losse regelafbrekingen
 * blijven staan. Zo komt wat iemand in het tekstvak typt er ook zo uit.
 */
/** Het logo heeft een volledig adres nodig: een mailbox kent ons domein niet. */
export function metDomein(gegevens: Handtekening, siteUrl: string): Handtekening {
  if (!gegevens.logo || !gegevens.logo.startsWith("/")) return gegevens;
  return { ...gegevens, logo: `${siteUrl.replace(/\/+$/, "")}${gegevens.logo}` };
}

export function maakMailHtml(params: {
  tekst: string;
  handtekening?: Handtekening;
  /** Een regel onderaan, bijvoorbeeld een link naar de online indeling. */
  naschrift?: { tekst: string; url: string } | null;
}): string {
  const alineas = params.tekst
    .split(/\n\s*\n/)
    .map((stuk) => stuk.trim())
    .filter(Boolean)
    .map(
      (stuk) =>
        `<p style="margin:0 0 14px 0;font:15px/22px ${LETTERS};color:${INKT};">${veilig(stuk).replace(
          /\n/g,
          "<br />",
        )}</p>`,
    )
    .join("\n      ");

  const naschrift =
    params.naschrift && veiligeUrl(params.naschrift.url)
      ? `<p style="margin:0 0 14px 0;font:15px/22px ${LETTERS};color:${INKT};">${link(
          params.naschrift.url,
          params.naschrift.tekst,
          ORANJE,
          true,
        )}</p>`
      : "";

  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Skool Workshop</title>
</head>
<body style="margin:0;padding:0;background:#F6F6F6;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F6F6F6;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;background:#FFFFFF;border-radius:12px;">
          <tr>
            <td style="padding:28px 28px 24px 28px;">
      ${alineas}
      ${naschrift}
      ${maakHandtekening(params.handtekening)}
            </td>
          </tr>
        </table>
        <div style="font:11px/16px ${LETTERS};color:${GRIJS};padding:12px 0 0 0;">
          Deze mail komt uit SkoolPartner, het inschrijfsysteem van Skool Workshop.
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
