/**
 * Wanneer is een account compleet genoeg om mee te werken?
 *
 * Wij vragen twee dingen: een e-mailadres en een telefoonnummer. Het adres
 * hebben wij nodig om bevestigingen, facturen en resultaten te sturen, het
 * nummer om een school op de dag van de workshop te kunnen bereiken. Zonder die
 * twee kunnen wij ons werk niet goed doen.
 *
 * Het e-mailadres is tegelijk het inlogadres. Dat kan een klant daarom niet
 * zelf in het portaal wijzigen; dat loopt via ons, zodat niemand met een
 * zelfgekozen adres bij de gegevens van een andere school kan komen.
 */

export interface ProfileCompleteness {
  complete: boolean;
  /** Wat er nog ontbreekt, in gewone taal. */
  missing: ("e-mailadres" | "telefoonnummer" | "naam")[];
}

/**
 * Praktische controle, geen jacht op de perfecte reguliere expressie.
 * Iets voor de apenstaart, iets erna, een punt en minstens twee letters.
 */
export function isValidEmail(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length < 6 || trimmed.length > 254) return false;
  if (/\s/.test(trimmed)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)*\.[a-z]{2,}$/i.test(trimmed);
}

export function checkProfile(
  profile: { full_name: string | null; phone: string | null; email?: string | null } | null
): ProfileCompleteness {
  const missing: ProfileCompleteness["missing"] = [];
  if (!profile) return { complete: false, missing: ["naam", "e-mailadres", "telefoonnummer"] };

  if (!profile.full_name || profile.full_name.trim().length < 2) missing.push("naam");
  if (!isValidEmail(profile.email)) missing.push("e-mailadres");
  if (!profile.phone || profile.phone.trim() === "") missing.push("telefoonnummer");

  return { complete: missing.length === 0, missing };
}

/** Korte variant voor waar alleen ja of nee telt. */
export function isProfileComplete(
  profile: { full_name: string | null; phone: string | null; email?: string | null } | null
): boolean {
  return checkProfile(profile).complete;
}

/** "uw telefoonnummer" of "uw e-mailadres en uw telefoonnummer". */
export function missingLabel(missing: ProfileCompleteness["missing"]): string {
  const met = missing.map((m) => `uw ${m}`);
  if (met.length === 0) return "";
  if (met.length === 1) return met[0];
  return `${met.slice(0, -1).join(", ")} en ${met[met.length - 1]}`;
}
