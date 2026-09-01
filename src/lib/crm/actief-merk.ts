import "server-only";

import { cookies } from "next/headers";

import { getSettings } from "@/lib/settings";
import { parseMerk, type Merk } from "@/lib/crm/merk";

/**
 * Welk merk staat er nu op het scherm?
 *
 * De keuze staat in een cookie, zodat hij blijft staan als je naar een andere
 * pagina gaat. Er zit bewust geen gebruikersvoorkeur in de database: dit is
 * een weergavekeuze, geen instelling, en hij mag per apparaat verschillen.
 *
 * De cookie is niet gevoelig. Hij bepaalt alleen wat je ziet, nooit wat je
 * mag. De autorisatie blijft requireAdmin() in de layout van het
 * beheerportaal, precies zoals bij elk ander beheerscherm.
 */
export const MERK_COOKIE = "skool_crm_merk";

/** Een jaar. Lang genoeg om niet te irriteren, kort genoeg om te verlopen. */
export const MERK_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export async function getActiefMerk(): Promise<Merk> {
  const store = await cookies();
  const uitCookie = store.get(MERK_COOKIE)?.value;
  if (uitCookie) return parseMerk(uitCookie);

  // Nog niets gekozen: neem het startmerk uit de instellingen.
  const settings = await getSettings();
  return parseMerk(settings.crm_default_brand);
}
