import "server-only";

/**
 * Een e-mail met bijlagen opbouwen.
 *
 * De bestaande buildMessageMime() stuurt platte tekst zonder bijlagen, en die
 * werkt prima voor uitnodigingen. Lijsten moeten mee als bestand, dus dit
 * bouwt een multipart-bericht. Bewust ernaast gezet in plaats van de
 * bestaande functie te verbouwen: die wordt elders gebruikt en werkt.
 */

export interface Bijlage {
  naam: string;
  type: string;
  data: Uint8Array;
}

function kopTekst(waarde: string): string {
  // Niet-ASCII in een onderwerp of bestandsnaam moet gecodeerd worden.
  return /^[\x20-\x7e]*$/.test(waarde)
    ? waarde
    : `=?UTF-8?B?${Buffer.from(waarde, "utf8").toString("base64")}?=`;
}

function inStukken(base64: string): string {
  return (base64.match(/.{1,76}/g) ?? []).join("\r\n");
}

export function maakBericht(params: {
  van: string;
  naar: string[];
  kopie?: string[];
  /**
   * Waar een antwoord heen gaat. Zonder dit komt een antwoord in de mailbox
   * waaruit verstuurd is, en dat is niet altijd waar iemand het leest.
   */
  antwoordNaar?: string;
  onderwerp: string;
  tekst: string;
  html?: string;
  bijlagen?: Bijlage[];
}): string {
  const grens = `skool-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const binnenGrens = `${grens}-tekst`;
  const bijlagen = params.bijlagen ?? [];

  const regels: string[] = [
    `From: ${params.van}`,
    `To: ${params.naar.join(", ")}`,
    ...(params.kopie && params.kopie.length > 0 ? [`Cc: ${params.kopie.join(", ")}`] : []),
    ...(params.antwoordNaar ? [`Reply-To: ${params.antwoordNaar}`] : []),
    `Subject: ${kopTekst(params.onderwerp)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${grens}"`,
    "",
    `--${grens}`,
  ];

  if (params.html) {
    regels.push(
      `Content-Type: multipart/alternative; boundary="${binnenGrens}"`,
      "",
      `--${binnenGrens}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      inStukken(Buffer.from(params.tekst, "utf8").toString("base64")),
      "",
      `--${binnenGrens}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      inStukken(Buffer.from(params.html, "utf8").toString("base64")),
      "",
      `--${binnenGrens}--`,
    );
  } else {
    regels.push(
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      inStukken(Buffer.from(params.tekst, "utf8").toString("base64")),
    );
  }

  for (const bijlage of bijlagen) {
    regels.push(
      "",
      `--${grens}`,
      `Content-Type: ${bijlage.type}; name="${kopTekst(bijlage.naam)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${kopTekst(bijlage.naam)}"`,
      "",
      inStukken(Buffer.from(bijlage.data).toString("base64")),
    );
  }

  regels.push("", `--${grens}--`, "");

  return Buffer.from(regels.join("\r\n"), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
