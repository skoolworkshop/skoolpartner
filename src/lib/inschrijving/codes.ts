import { randomInt } from "node:crypto";

/**
 * De persoonlijke inschrijfcode.
 *
 * WAAROM EEN CODE
 *
 *   Alleen een naam opzoeken is geen bewijs. Iedereen in een klas kent elkaars
 *   naam, dus met alleen een naam kan een klasgenoot jouw workshop omgooien.
 *   De code staat op de klassenlijst die de mentor krijgt en wordt uitgedeeld.
 *
 * WELKE TEKENS
 *
 *   Zonder I, L, O en U. Die worden overgeschreven als 1, 1, 0 en V, en dan
 *   belt er een school. Wie ze toch intypt krijgt alsnog de goede code: bij
 *   het inlezen wordt een O een 0 en worden I en L een 1. Dezelfde aanpak als
 *   waar postcodes en licentiesleutels al jaren op leunen.
 *
 *   Acht tekens uit 32 mogelijkheden is ruim duizend miljard combinaties. Dat
 *   raadt niemand, ook niet met een hele klas die het probeert.
 */

export const CODE_ALFABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Een nieuwe code. Gebruikt de toevalsgenerator van het systeem, niet Math.random. */
export function maakCode(lengte = 8): string {
  let code = "";
  for (let i = 0; i < lengte; i += 1) {
    code += CODE_ALFABET[randomInt(CODE_ALFABET.length)];
  }
  return code;
}

/**
 * Wat iemand intypt omzetten naar de opgeslagen vorm.
 *
 * Streepjes en spaties mogen, hoofdletters hoeven niet, en de klassieke
 * leesfouten worden rechtgezet.
 */
export function leesCode(ruw: string): string {
  return (ruw ?? "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/U/g, "V");
}

/** Ziet dit eruit als een code die wij hebben uitgegeven? */
export function isCode(waarde: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{6,12}$/.test(waarde);
}

/** Met een streepje in het midden leest een code makkelijker voor. */
export function toonCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}
