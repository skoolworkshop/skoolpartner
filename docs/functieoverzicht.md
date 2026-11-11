# SkoolPartner | Compleet functieoverzicht

Wat de applicatie op dit moment daadwerkelijk kan. Opgemaakt op 11 november
2026, op basis van de code zoals die in de laatste commit staat.

Elke regel heeft een stempel:

| Stempel | Betekenis |
| --- | --- |
| **A** | Gebouwd en getest, inclusief geautomatiseerde tests tegen de echte database |
| **B** | Gebouwd, maar nog niet op de live omgeving met echte gegevens doorlopen |
| **C** | Niet aanwezig |

Op dit moment staat **alles wat met het inschrijfsysteem te maken heeft op B of
hoger**, omdat de nieuwe versie nog niet gepubliceerd is. Wat op A staat, is
getest met de echte migraties in een database in het geheugen, met dezelfde
functies die in productie draaien.

---

## Beheeromgeving (mijn.skoolworkshop.nl/admin)

De schermen die er zijn: Dashboard, Organisaties, Boekingen, Facturen,
Inschrijvingen, SkoolPoints, Inwisselen, CJP-tegoed, Berichten, Resultaten,
Gebruikers, Integraties, Instellingen, Controle, Logboek.

### Dashboard

| Functie | Stempel |
| --- | --- |
| Overzicht met aantallen en wat er aandacht vraagt | B |

### Organisaties en contactpersonen

| Functie | Stempel |
| --- | --- |
| Organisatie aanmaken, bewerken, verifiëren | B |
| Contactpersonen koppelen en verifiëren | B |
| E-maildomeinen koppelen (publieke domeinen worden geweigerd) | A |
| Uitnodiging naar het klantenportaal sturen, intrekken, laten verlopen | B |
| Leden en rollen (beheerder, lid) per organisatie | B |

### Boekingen

| Functie | Stempel |
| --- | --- |
| Boeking handmatig aanmaken en bewerken | B |
| Boeking herkennen uit een bevestigingsmail (parser) | B |
| Boekingen ter controle aanbieden bij twijfel | B |
| Koppeling boeking aan factuur | A |

### Facturen

| Functie | Stempel |
| --- | --- |
| Facturen ophalen uit Moneybird | B |
| Factuurregels en bedragen bewaren | B |
| Factuur koppelen aan een organisatie via een stabiel Moneybird-contact-id | A |
| Geen koppeling bij twijfel: de factuur blijft zonder organisatie staan | A |
| Dubbele facturen voorkomen via een unieke index op het Moneybird-id | A |
| Factuur-PDF tonen in het klantenportaal | B |

### SkoolPoints (loyaliteit)

| Functie | Stempel |
| --- | --- |
| Spaaraccount per organisatie | A |
| Punten toekennen op basis van gewerkte minuten | A |
| Puntenwaarde en tarieven uit de instellingen | A |
| Saldo: beschikbaar, in behandeling, gereserveerd, totaal gespaard | A |
| Punten vrijgeven zodra een factuur betaald is | A |
| Dubbele toekenning blokkeren op externe referentie | A |
| Welkomstbonus precies één keer per gebruiker | A |
| Punten laten vervallen op de vervaldatum | A |
| Handmatige correctie, verplicht met reden | A |
| Puntengeschiedenis per organisatie | B |
| Inwisselverzoek aanvragen, goedkeuren, afwijzen, annuleren | A |
| Reservering bij een openstaand verzoek | A |

### CJP-tegoed

| Functie | Stempel |
| --- | --- |
| Tegoed per organisatie, aanvragen en besteden | B |
| Welkomstbonus CJP | A |

### Inschrijfsysteem

| Functie | Stempel |
| --- | --- |
| Cultuurdag aanmaken per school | B |
| Rondes in één keer genereren, los toevoegen, aanpassen | A |
| Pauzerondes die nergens meetellen | A |
| Workshops kiezen uit het eigen aanbod (29 workshops) | A |
| Uitvoeringen per ronde, meerdere naast elkaar, aan en uit | A |
| Maximum per uitvoering, ruimte en docent | A |
| Klasbeperking per uitvoering | A |
| Klassenlijst importeren uit Excel, Word, PDF, CSV | A |
| Voorbeeld vóór het importeren, met kolommen aanwijzen | A |
| Leerjaar en klas apart herkennen | A |
| Persoonlijke inschrijfcode per leerling | A |
| Gedeelde toegangscode per dag, intrekken en opnieuw maken | A |
| Verificatie per schoolmail met een cijfercode | A |
| Pogingenteller tegen raden, werkt over meerdere servers | A |
| Leerling schrijft zichzelf in, wisselt, ziet vol is vol | A |
| Herhaling van dezelfde workshop toestaan of weigeren | A |
| Vrijstellingen | A |
| Automatisch indelen na sluiting, met voorbeeld en goedkeuring | A |
| Klassenlijsten en workshoplijsten als Excel en PDF | A |
| Codelijsten per klas als Excel en PDF | A |
| Lijsten per mail naar de school, met voorbeeld vooraf | B |
| Beveiligde klantomgeving met link en losse code | A |
| Persoonlijke bevestiging naar leerlingen, met app-links en benodigdheden | B |
| Leerling zoeken, nieuwe code, vrijstellen, verwijderen | B |
| Verkeerd geclaimde naam vrijgeven zonder de keuzes te raken | A |
| Leerlinggegevens automatisch verwijderen na de bewaartermijn | A |

### Berichten

| Functie | Stempel |
| --- | --- |
| Gmail-gesprekken binnenhalen en koppelen aan een organisatie | B |
| Beantwoorden vanuit SkoolPartner | B |
| Zichtbaarheid per gesprek (alleen intern of ook voor de klant) | B |

### Resultaten

| Functie | Stempel |
| --- | --- |
| Foto's en video's per workshop klaarzetten voor de school | B |
| Downloadperiode en automatisch opruimen van bestanden | B |

### Reviews

| Functie | Stempel |
| --- | --- |
| Review opslaan en tonen bij een organisatie | B |
| Reviews koppelen aan een boeking | B |

### Gebruikers, rechten en beveiliging

| Functie | Stempel |
| --- | --- |
| Inloggen met e-mailadres en verificatiecode, zonder wachtwoord | B |
| Beheerdersrechten op het profiel | A |
| Toegang per organisatie voor klanten | A |
| Alle beheeracties achter een rechtencontrole (36 van de 36) | A |
| Logboek van beheeracties | B |
| Inschrijvingstabellen alleen bereikbaar via serveracties | A |
| De publieke sleutel heeft nergens rechten | A |

### Integraties

| Functie | Stempel |
| --- | --- |
| Gmail koppelen via Google, tokens versleuteld opgeslagen | B |
| Verbindingstest Gmail, inclusief toegestane afzenderadressen | B |
| Moneybird koppelen met een API-token | B |
| Moneybird-webhook met handtekeningcontrole | B |
| HubSpot-token aanwezig | C (geen actieve synchronisatie in de code) |
| Google Agenda | B (alleen lezen, voor de planning) |

### Automatische taken

| Taak | Tijd | Stempel |
| --- | --- | --- |
| Punten laten vervallen | 03:00 | A (de rekenregel), B (de taak zelf) |
| Workshopresultaten opruimen | 04:00 | B |
| Leerlinggegevens opruimen | 04:30 | A |
| Gmail en Moneybird synchroniseren | 05:00 | B |

Alle vier staan nu stil: `CRON_SECRET` is niet ingesteld, dus ze antwoorden met
503 en doen niets.

### Rapportages

| Functie | Stempel |
| --- | --- |
| Aantallen op het dashboard en per organisatie | B |
| Export van lijsten naar Excel en PDF (inschrijfsysteem) | A |
| Een echte rapportagemodule met grafieken of periodes | C |

---

## Klantenportaal (voor de school)

| Functie | Stempel |
| --- | --- |
| Inloggen met e-mailadres en verificatiecode | B |
| Dashboard met punten, boekingen en wat er speelt | B |
| Eigen boekingen bekijken | B |
| Nieuwe boeking aanvragen | B |
| Eigen facturen bekijken en de PDF downloaden | B |
| SkoolPoints: saldo, geschiedenis, inwisselen | B |
| CJP-tegoed aanvragen | B |
| Berichten lezen en beantwoorden | B |
| Workshopresultaten downloaden | B |
| Accountgegevens beheren | B |
| Toegang uitsluitend tot de eigen organisatie | A |

De indelingpagina voor een cultuurdag (`/indeling/<link>`) staat los van het
portaal: die werkt zonder account, met een link en een losse code.

---

## Wat er niet is

- Geen rapportagemodule met grafieken, periodes of exports buiten het
  inschrijfsysteem.
- Geen actieve HubSpot-synchronisatie. Het token staat in de omgeving, maar er
  is geen code die er gegevens mee ophaalt of wegschrijft.
- Geen automatische koppeling van een factuur aan een school op naam of adres.
  Dat is een bewuste keuze: zonder een stabiel Moneybird-contact-id blijft een
  factuur zonder organisatie staan.
- Geen app voor leerlingen. De inschrijfpagina is een gewone webpagina die op
  een telefoon werkt.
- Geen betaalmodule. Betalen loopt via Moneybird.
- Geen koppeling met Magister of Somtoday. Klassenlijsten komen als bestand
  binnen.

---

## Hoe er getest is

| Soort | Omvang |
| --- | --- |
| Geautomatiseerde tests | 538, verdeeld over 38 bestanden |
| Databaseregels | 47 controles in `npm run db:verify`, tegen de echte migraties |
| Beveiliging | rechten, RLS, policies en zoekpaden, als vaste controle |
| Visueel | elk scherm op 1280 en 390 pixels, zonder horizontale overloop |
| Herstelproef | de volledige back-up teruggezet in een lege database |
| Migratieproef | 043 gedraaid op een dag met 353 leerlingen en 352 keuzes |

Wat die tests niet dekken: de werkelijke queries tegen Supabase, de echte
Gmail-verzending, en het klikken door de live schermen. Dat is de praktijktest
die na de publicatie volgt.
