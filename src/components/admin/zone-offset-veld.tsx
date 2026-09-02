"use client";

/**
 * Geeft de tijdzone van de browser mee aan een formulier.
 *
 * WAAROM DIT NODIG IS
 *
 *   Een invoerveld van het type datetime-local levert "2026-09-10T14:00" op,
 *   zonder zone. Op de server wordt dat gelezen met de zone van de server, en
 *   die staat op Vercel niet in Nederland. Een afspraak van twee uur 's
 *   middags zou dan als twaalf uur worden opgeslagen, en 's zomers weer een
 *   uur anders dan 's winters.
 *
 *   Dit veld stuurt daarom mee hoeveel minuten de invoer voorloopt op UTC.
 *   Voor Nederland is dat 60 in de winter en 120 in de zomer, en de browser
 *   weet dat precies.
 *
 * WAAROM EEN REF EN GEEN STATE
 *
 *   De waarde hoeft nooit te veranderen en niets op het scherm hangt ervan af.
 *   Met state in een effect zou React na het laden nog een keer renderen voor
 *   een verborgen veld dat niemand ziet. De waarde een keer in het element
 *   zetten is genoeg.
 *
 * WAT ER GEBEURT ALS JAVASCRIPT UITSTAAT
 *
 *   Dan blijft er 0 staan en wordt de invoer als UTC gelezen. Dat is een uur
 *   of twee mis, maar het is voorspelbaar en het formulier blijft werken.
 *   Beter dan een leeg veld waar de server niets mee kan.
 */
export function ZoneOffsetVeld({ naam = "zoneOffsetMinuten" }: { naam?: string }) {
  return (
    <input
      type="hidden"
      name={naam}
      defaultValue="0"
      ref={(element) => {
        // getTimezoneOffset telt de andere kant op: voor UTC+2 geeft hij -120.
        if (element) element.value = String(-new Date().getTimezoneOffset());
      }}
    />
  );
}
