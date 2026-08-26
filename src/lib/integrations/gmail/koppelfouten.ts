/**
 * Wat er mis kan gaan bij het koppelen van Gmail, in gewone taal.
 *
 * De callback stuurt alleen een korte code terug in de URL. De uitleg staat
 * hier, zodat er nooit een foutmelding van Google in een adresbalk of in een
 * logregel belandt: daar kan een client secret of een token in staan.
 *
 * Pure tekst zonder server, dus testbaar.
 */

export interface Koppelfout {
  titel: string;
  uitleg: string;
  /** Concrete stappen. Leeg betekent: niets zelf te doen, gewoon opnieuw proberen. */
  stappen: string[];
}

const ALGEMEEN: Koppelfout = {
  titel: "Koppelen is niet gelukt",
  uitleg:
    "Google gaf een fout terug die wij niet konden thuisbrengen. De precieze melding staat in de serverlog van Vercel.",
  stappen: ["Probeer het opnieuw.", "Blijft het misgaan, kijk dan in Vercel bij Logs."],
};

const FOUTEN: Record<string, Koppelfout> = {
  "google-credentials": {
    titel: "De Google-gegevens ontbreken",
    uitleg: "Zonder client id en secret kan de koppeling niet starten.",
    stappen: [
      "Zet GOOGLE_CLIENT_ID en GOOGLE_CLIENT_SECRET in Vercel, scope Production.",
      "Deploy daarna opnieuw, want deze waarden worden bij de build ingelezen.",
    ],
  },

  "google-client": {
    titel: "Google herkent de app niet",
    uitleg:
      "De combinatie van client id en client secret klopt niet. Meestal hoort het secret bij een ander project, of is er een spatie meegekopieerd.",
    stappen: [
      "Open de Google Cloud Console, APIs en services, Credentials.",
      "Kies de OAuth-client die hoort bij het GOOGLE_CLIENT_ID uit Vercel.",
      "Maak zo nodig een nieuw client secret aan en zet dat in Vercel.",
      "Let op spaties of een regeleinde aan het begin of eind van de waarde.",
      "Deploy opnieuw.",
    ],
  },

  "google-redirect": {
    titel: "De redirect URI komt niet overeen",
    uitleg:
      "Google accepteert alleen adressen die exact in de OAuth-client staan. Eén tekentje verschil is al genoeg.",
    stappen: [
      "Zet in de Google Cloud Console bij Authorised redirect URIs exact het adres dat hieronder op deze pagina staat.",
      "Zorg dat GOOGLE_REDIRECT_URI in Vercel precies datzelfde adres bevat.",
      "Let op https, geen slash aan het eind, en het juiste domein.",
    ],
  },

  "google-verlopen": {
    titel: "De inlogpoging was niet meer geldig",
    uitleg:
      "De code van Google is maar kort bruikbaar en kan maar één keer worden gebruikt. Dit gebeurt bijvoorbeeld als de pagina is ververst of als de terugkomst te lang duurde.",
    stappen: ["Klik gewoon opnieuw op Gmail koppelen."],
  },

  "google-scopes": {
    titel: "De gevraagde rechten worden niet geaccepteerd",
    uitleg: "De Gmail API staat mogelijk niet aan voor dit Google Cloud-project.",
    stappen: [
      "Open de Google Cloud Console en zet de Gmail API aan voor dit project.",
      "Controleer of de app op het OAuth consent screen de Gmail-scopes mag gebruiken.",
    ],
  },

  "google-geweigerd": {
    titel: "Toestemming niet gegeven",
    uitleg: "Er is op Annuleren geklikt in het Google-scherm.",
    stappen: ["Klik opnieuw op Gmail koppelen en daarna op Toestaan."],
  },

  "geen-code": {
    titel: "Google stuurde geen inlogcode mee",
    uitleg: "De terugkomst uit Google was niet compleet.",
    stappen: ["Probeer het opnieuw."],
  },

  "geen-refresh-token": {
    titel: "Google gaf geen blijvende toegang",
    uitleg:
      "Zonder refresh token zou de koppeling na een uur stoppen met werken. Dit gebeurt als deze app al eerder is goedgekeurd voor dit account.",
    stappen: [
      "Ga naar myaccount.google.com, Beveiliging, Apps van derden met accounttoegang.",
      "Verwijder daar de toegang van deze app.",
      "Klik daarna in SkoolPartner opnieuw op Gmail koppelen.",
    ],
  },

  "oauth-state": {
    titel: "De beveiligingscontrole klopte niet",
    uitleg:
      "Het kenmerk dat wij bij het starten meegeven kwam niet terug. Dat is een bescherming tegen een vervalste terugkomst. Meestal is er gewoon te lang gewacht of is de link in een ander venster geopend.",
    stappen: [
      "Begin opnieuw via de knop Gmail koppelen op deze pagina.",
      "Rond het inloggen binnen tien minuten af, in hetzelfde browservenster.",
    ],
  },

  "sleutel-ontbreekt": {
    titel: "APP_ENCRYPTION_KEY ontbreekt",
    uitleg:
      "Zonder die sleutel kunnen wij de Google-token niet versleuteld opslaan. Onversleuteld bewaren doen wij niet.",
    stappen: [
      "Maak een sleutel met: openssl rand -base64 32",
      "Zet die als APP_ENCRYPTION_KEY in Vercel, scope Production, type Secret.",
      "Deploy opnieuw.",
      "Let op: verander deze sleutel later niet zomaar, want dan zijn bestaande koppelingen niet meer te lezen.",
    ],
  },

  "sleutel-ongeldig": {
    titel: "APP_ENCRYPTION_KEY heeft niet de juiste lengte",
    uitleg:
      "De sleutel moet precies 32 bytes zijn, als base64 opgeschreven. Een zelfverzonnen wachtwoord werkt dus niet.",
    stappen: [
      "Maak een nieuwe met: openssl rand -base64 32",
      "Dat levert een reeks van 44 tekens op die eindigt met een isgelijkteken.",
      "Zet die in Vercel en deploy opnieuw.",
    ],
  },

  "database-sleutel": {
    titel: "SUPABASE_SERVICE_ROLE_KEY ontbreekt",
    uitleg: "Zonder die sleutel kan de server de koppeling niet opslaan.",
    stappen: [
      "Haal de service role key op in Supabase, Project Settings, API keys.",
      "Zet die in Vercel als SUPABASE_SERVICE_ROLE_KEY en deploy opnieuw.",
    ],
  },

  "database-rechten": {
    titel: "De database weigerde het opslaan",
    uitleg:
      "De server mocht niet schrijven. Dat betekent vrijwel altijd dat de waarde onder SUPABASE_SERVICE_ROLE_KEY niet de echte service role key is, maar bijvoorbeeld de anon key of een publishable key.",
    stappen: [
      "Open Supabase, Project Settings, API keys.",
      "Neem de sleutel met het label service_role, of bij de nieuwe sleutels de secret key.",
      "Vergelijk die met wat er in Vercel staat onder SUPABASE_SERVICE_ROLE_KEY.",
      "Zet de juiste waarde erin en deploy opnieuw.",
      "Deze fout raakt ook de facturensync, dus hiermee los je twee dingen tegelijk op.",
    ],
  },

  "opslaan-mislukt": {
    titel: "De koppeling kon niet worden opgeslagen",
    uitleg: "Google gaf toestemming, maar het bewaren in de database lukte niet.",
    stappen: ["Probeer het opnieuw.", "Blijft het misgaan, kijk dan in Vercel bij Logs."],
  },
};

export function koppelfout(code: string | null | undefined): Koppelfout {
  if (!code) return ALGEMEEN;
  return FOUTEN[code] ?? ALGEMEEN;
}

/** Alle codes, zodat een test kan controleren dat er geen tekst ontbreekt. */
export const KOPPELFOUT_CODES = Object.keys(FOUTEN);
