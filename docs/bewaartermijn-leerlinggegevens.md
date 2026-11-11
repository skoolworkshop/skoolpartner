# Bewaartermijn van leerlinggegevens

Dit beschrijft wat er met de gegevens van leerlingen gebeurt en wanneer. Het is
gebouwd en getest, maar nog niet op de productiedatabase gedraaid.

## De regel

**Dertig dagen na de cultuurdag gaan de leerlinggegevens weg.**

Lang genoeg om na afloop nog een vraag van een school te beantwoorden, een lijst
opnieuw te sturen of een factuur na te lopen. Kort genoeg dat we niet jarenlang
de namen van andermans kinderen bewaren.

Spreekt een school iets anders af, dan zet je per dag een eigen datum in het
veld "Leerlinggegevens bewaren tot". Die staat gewoon in beeld, dus iedereen kan
zien tot wanneer er bewaard wordt. Het veld leeg laten betekent terug naar de
standaard.

## Wat er weggaat en wat er blijft

| Gaat weg | Blijft staan |
| --- | --- |
| Naam, klaskoppeling, e-mailadres, leerjaar | De dag zelf: naam, datum, school, locatie |
| De persoonlijke inschrijfcode en het bewijs in de browser | Het rooster: rondes en pauzes |
| Alle gemaakte workshopkeuzes | De workshops en uitvoeringen met hun maximum |
| Openstaande verificatiecodes | De klassen, met alleen hun naam |
| De pogingenteller van die dag | Het logboek, met aantallen en zonder namen |
| De toegangslink van de school, die wordt ingetrokken | |

De dag blijft dus bestaan als ons eigen werkstuk. Er staat geen kind meer in.

## Hoe het technisch wordt afgedwongen

1. **Bij het aanmaken van een dag** wordt `purge_after` meteen gevuld met de
   dagdatum plus dertig dagen. Er is dus nooit een dag zonder termijn.
2. **Bij het opslaan van de gegevens** van een dag kan Anne die datum aanpassen.
   Leeg laten zet hem terug op de standaard. Een datum vóór de cultuurdag wordt
   geweigerd.
3. **Elke nacht om 04:30** draait `/api/cron/opruimen-inschrijvingen`. Die zoekt
   de dagen waarvan de termijn voorbij is en ruimt ze op. Dagen zonder
   `purge_after`, bijvoorbeeld van voor deze wijziging, worden gerekend als
   dagdatum plus dertig dagen.
4. **Elke opruiming komt in het logboek**, met aantallen en zonder één naam.
5. **In het dagscherm** staat in gewone taal wanneer het gaat gebeuren: "De
   leerlinggegevens van deze dag worden op 12 december 2026 verwijderd, over 32
   dagen."

Het opruimen haalt eerst op welke leerlingen bij die ene dag horen en verwijdert
daarna op die id's. Er staat nergens een verwijderopdracht op datum. Een
verkeerd gezette datum kan dus nooit leerlingen van een andere dag meenemen.

Met `?proef=1` telt de taak alleen en verandert hij niets.

## De eerste keer dat dit draait

In de database staat op dit moment één inschrijfdag: de CKV Dag van 12 november
2026. Die wordt pas op 12 december 2026 opgeruimd. De eerste nachtelijke taak
verwijdert dus niets.

## De back-ups op de eigen computer

Dit is het stuk dat geen software voor je doet.

`_backup/` bevat gewone leesbare bestanden met namen, klassen en e-mailadressen.
De map staat buiten Git, maar blijft verder gewoon op de computer staan. Daar
geldt dezelfde dertig dagen voor, met één uitzondering: de back-up die vlak voor
een migratie is gemaakt, bewaar je tot die migratie bewezen goed is en gooi je
daarna weg.

Praktisch: zet een terugkerende herinnering om elke maand de mappen in `_backup/`
na te lopen die ouder zijn dan dertig dagen.

## Wat dit niet regelt

- De lijsten die naar een school zijn gestuurd. Die staan in hun mailbox en in
  hun eigen systemen. Daar gaat onze bewaartermijn niet over, en dat hoort ook
  zo: de school is daar zelf verantwoordelijk voor.
- De accounts van contactpersonen van scholen. Dat zijn geen leerlinggegevens en
  die hebben hun eigen levensduur.
- De e-mails in `boekingen@skoolworkshop.nl`. Die vallen onder het mailbeleid,
  niet onder dit.

## Wat je nog moet besluiten

- Of dertig dagen ook echt de afspraak wordt die je met scholen communiceert.
  Zet het dan in de offerte of de voorwaarden, zodat een school weet waar hij aan
  toe is.
- Of je de leerlinggegevens al eerder wilt opruimen, bijvoorbeeld zeven dagen na
  de dag. Technisch verandert daar niets aan: alleen het getal in
  `BEWAARDAGEN`.
