/**
 * Koppelt een workshopnaam aan een foto op skoolworkshop.nl.
 *
 * De koppeling staat als instelling in de database (sleutel workshop_images),
 * zodat je hem kunt aanpassen via Admin > Instellingen zonder programmeerwerk.
 * De sleutels zijn kleine letters; de langste passende sleutel wint, zodat
 * "light graffiti" niet per ongeluk de gewone graffitifoto pakt.
 */

export type WorkshopImageMap = Record<string, string>;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function findWorkshopImage(
  workshopName: string | null | undefined,
  map: WorkshopImageMap
): string | null {
  if (!workshopName) return null;
  const naam = normalize(workshopName);
  if (!naam) return null;

  let beste: string | null = null;
  let besteLengte = 0;

  for (const [sleutel, url] of Object.entries(map)) {
    if (!url) continue;
    const genormaliseerd = normalize(sleutel);
    if (!genormaliseerd) continue;
    if (naam.includes(genormaliseerd) && genormaliseerd.length > besteLengte) {
      beste = url;
      besteLengte = genormaliseerd.length;
    }
  }

  return beste;
}

/** Leest de instelling veilig uit; bij twijfel geen foto in plaats van een fout. */
export function parseWorkshopImages(raw: unknown): WorkshopImageMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: WorkshopImageMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && value.startsWith("https://")) {
      result[key] = value;
    }
  }
  return result;
}
