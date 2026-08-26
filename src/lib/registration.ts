import { isValidEmail } from "@/lib/account";
import { cjpAnswerToBoolean, normalizeCjpNumber } from "@/lib/cjp";
import { normalizePhone } from "@/lib/phone";

/**
 * Alles wat wij bij registratie vragen, op één plek gecontroleerd.
 *
 * Waarom zo streng: SkoolPartner begint pas als de registratie compleet is.
 * Half ingevulde gegevens zouden betekenen dat wij een school niet kunnen
 * bereiken of niet weten waar de workshop moet plaatsvinden, en dat het
 * startmoment op een onduidelijk moment valt.
 */

export interface RegistrationInput {
  firstName: string;
  lastName: string;
  jobTitle: string;
  phone: string;
  organizationName: string;
  street: string;
  houseNumber: string;
  houseNumberAddition: string;
  postalCode: string;
  city: string;
  /** "ja", "nee" of "onbekend". Niet iedere school heeft een CJP-schoolnummer. */
  hasCjp: string;
  cjpSchoolNumber: string;
}

export interface RegistrationValues {
  firstName: string;
  lastName: string;
  fullName: string;
  jobTitle: string;
  /** Genormaliseerd, bijvoorbeeld +31612345678. */
  phone: string;
  organizationName: string;
  street: string;
  houseNumber: string;
  houseNumberAddition: string | null;
  /** Genormaliseerd naar 1234 AB. */
  postalCode: string;
  city: string;
  /** true = ja, false = nee, null = weet ik niet. */
  hasCjp: boolean | null;
  cjpSchoolNumber: string | null;
}

export type FieldName = keyof RegistrationInput;

export interface RegistrationResult {
  ok: boolean;
  values?: RegistrationValues;
  /** Per veld één melding, zodat het formulier het bij het juiste veld kan tonen. */
  errors: Partial<Record<FieldName, string>>;
}

/** 1234AB, 1234 ab, 1234-AB worden allemaal 1234 AB. */
export function normalizePostalCode(raw: string): string | null {
  const compact = raw.replace(/[\s.-]/g, "").toUpperCase();
  if (!/^[1-9][0-9]{3}[A-Z]{2}$/.test(compact)) return null;
  return `${compact.slice(0, 4)} ${compact.slice(4)}`;
}

/** Huisnummer: alleen cijfers, 1 tot en met 5 cijfers. */
function normalizeHouseNumber(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^[0-9]{1,5}$/.test(trimmed)) return null;
  return String(Number(trimmed));
}

export function validateRegistration(input: RegistrationInput): RegistrationResult {
  const errors: Partial<Record<FieldName, string>> = {};

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const jobTitle = input.jobTitle.trim();
  const organizationName = input.organizationName.trim();
  const street = input.street.trim();
  const city = input.city.trim();
  const addition = input.houseNumberAddition.trim();

  if (firstName.length < 2) errors.firstName = "Vul uw voornaam in.";
  if (lastName.length < 2) errors.lastName = "Vul uw achternaam in.";
  if (jobTitle.length < 2) errors.jobTitle = "Vul uw functie in, bijvoorbeeld cultuurcoördinator.";

  const phone = normalizePhone(input.phone);
  if (!phone.ok || !phone.value) {
    errors.phone = phone.message ?? "Vul uw telefoonnummer in.";
  }

  if (organizationName.length < 2) {
    errors.organizationName = "Vul de naam van uw school of organisatie in.";
  }

  if (street.length < 2) errors.street = "Vul de straatnaam in.";

  const houseNumber = normalizeHouseNumber(input.houseNumber);
  if (!houseNumber) errors.houseNumber = "Vul het huisnummer in, alleen cijfers.";
  if (addition.length > 10) errors.houseNumberAddition = "Deze toevoeging is wel erg lang.";

  const postalCode = normalizePostalCode(input.postalCode);
  if (!postalCode) errors.postalCode = "Vul een Nederlandse postcode in, bijvoorbeeld 2801 AB.";

  if (city.length < 2) errors.city = "Vul de plaats in.";

  // CJP is voor niemand verplicht. Alleen wie zelf zegt een nummer te hebben,
  // moet het ook invullen; anders slaan wij een half gegeven op.
  const hasCjp = cjpAnswerToBoolean(input.hasCjp);
  const cjp = normalizeCjpNumber(input.cjpSchoolNumber);

  if (!cjp.ok) {
    errors.cjpSchoolNumber = cjp.message ?? "Controleer het CJP-schoolnummer.";
  } else if (hasCjp === true && !cjp.value) {
    errors.cjpSchoolNumber = "Vul het CJP-schoolnummer in, of kies Nee of Weet ik niet.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    errors: {},
    values: {
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`,
      jobTitle,
      phone: phone.value!,
      organizationName,
      street,
      houseNumber: houseNumber!,
      houseNumberAddition: addition === "" ? null : addition,
      postalCode: postalCode!,
      city,
      hasCjp,
      // Zegt iemand geen nummer te hebben, dan bewaren wij ook geen nummer.
      cjpSchoolNumber: hasCjp === false ? null : (cjp.value ?? null),
    },
  };
}

/** Controle op het e-mailadres, los omdat dat al bij het aanmaken is gevraagd. */
export function isUsableLoginEmail(email: string | null | undefined): boolean {
  return isValidEmail(email);
}
