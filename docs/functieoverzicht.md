# SkoolPartner | Compleet functieoverzicht

Wat de applicatie op dit moment daadwerkelijk kan. Bijgewerkt op 18 november
2026, na de acceptatietest op de live omgeving. Wat daar precies is getest,
staat in `docs/oplevering.md`.

Elke regel heeft een stempel:

| Stempel | Betekenis |
| --- | --- |
| **L** | Op 18 november live getest op mijn.skoolworkshop.nl |
| **A** | Gebouwd en getest, inclusief geautomatiseerde tests tegen de echte database |
| **B** | Gebouwd, maar nog niet op de live omgeving met echte gegevens doorlopen |
| **C** | Niet aanwezig |

Wat op A staat, is getest met de echte migraties in een database in het
geheugen, met dezelfde functies die in productie draaien. Wat op B staat, werkt
in de code maar is niet met een geautomatiseerde test tegen de database gedekt.

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
| Schoollocatie toevoegen vanuit het beheer (naam en plaats) | L |
| Een school die zich zelf aanmeldt controleren en vrijgeven | B |
| Organisatiegegevens, logo en CJP-nummer bewerken | B |
| Contactpersoon uitnodigen met een link (veertien dagen geldig) | B |
| Meerdere contactpersonen per locatie | L |
| Contactpersoon automatisch vastleggen bij aanmelding en uitnodiging | A |
| E-maildomeinen koppelen (publieke domeinen worden geweigerd) | A |
| Uitnodiging naar het klantenportaal sturen, intrekken, laten verlopen | B |
| Binnen een locatie is elke contactpersoon gelijk: geen aparte rollen | B |
| Organisatie definitief verwijderen, met bevestiging, inclusief cultuurdagen | L |
| Gebruiker definitief verwijderen | B |

### Boekingen

| Functie | Stempel |
| --- | --- |
| Boeking herkennen uit een bevestigingsmail (parser) | B |
| Boekingen ter controle aanbieden bij twijfel, goedkeuren of afwijzen | B |
| Koppeling boeking aan factuur | A |
| Boeking met de hand invoeren in het beheer | C |

### Facturen

| Functie | Stempel |
| --- | --- |
| Facturen ophalen uit Moneybird: handmatig, via de nachtelijke taak en via de webhook, alle drie door dezelfde regels | L (handmatig), A (taak en webhook) |
| Factuurregels en bedragen bewaren, betaalstatus bijwerken | A |
| Moneybird-contact koppelen aan een locatie, op ID of op naam | B |
| Eén Moneybird-contact hoort bij één locatie; een tweede koppeling wordt geweigerd | A |
| Geen gekoppelde locatie: de factuur wordt niet binnengehaald | L |
| Twijfel (één contact bij twee locaties): de factuur wordt niet binnengehaald | A |
| Locatie doet nog niet mee, of factuur van vóór het startmoment: niet binnengehaald | A |
| De reden van elke overgeslagen factuur in het synchronisatielogboek | L |
| Dubbele facturen voorkomen via een unieke index op het Moneybird-id | A |
| Nooit proefgegevens in productie: zonder Moneybird-token een foutmelding | A |
| Factuur-PDF tonen in het klantenportaal | B |

### SkoolPoints (loyaliteit)

| Functie | Stempel |
| --- | --- |
| Eén puntensaldo per schoollocatie, gedeeld door alle contactpersonen | L |
| Twee locaties van hetzelfde bestuur hebben gescheiden saldi | L |
| Bij elke regel blijft staan welke contactpersoon en welke boeking het was | A |
| Punten toekennen op basis van gewerkte minuten | A |
| Puntenwaarde en tarieven uit de instellingen | A |
| Saldo: beschikbaar, in behandeling, gereserveerd, totaal gespaard | A |
| Punten vrijgeven zodra een factuur betaald is | A |
| Dezelfde boeking, review of bonus levert een locatie één keer punten op | A |
| Welkomstbonus precies één keer per locatie | A |
| Geen punten voor boekingen van vóór het startmoment van de locatie | A |
| Punten laten vervallen na de geldigheidsduur, per locatie | A |
| Handmatige correctie op het locatiesaldo, verplicht met reden | L |
| Een regel terugdraaien zonder de geschiedenis te wissen | A |
| Puntengeschiedenis per locatie, zichtbaar voor alle contactpersonen | A |
| Inwisselverzoek op het locatiesaldo: aanvragen, goedkeuren, verwerken, afwijzen, intrekken | L (aanvragen en verwerken), A (de rest) |
| Reservering bij een openstaand verzoek, met een slot op de locatie | A |
| Een verzoek ontstaat alleen via de reservering; verwerken kan alleen Skool Workshop | A |
| Een vertrokken contactpersoon ziet niets meer en kan niets meer aanvragen | A |
| Punten blijven bij de locatie als een contactpersoon vertrekt | A |

### CJP-tegoed

| Functie | Stempel |
| --- | --- |
| Tegoed per organisatie, aanvragen, bevestigen en afboeken | B |
| Eenmalige CJP-bonus per locatie, ook met meerdere contactpersonen | A |

### Inschrijfsysteem

| Functie | Stempel |
| --- | --- |
| Cultuurdag aanmaken per school | L |
| Rondes in één keer genereren, los toevoegen, aanpassen | L (genereren), A |
| Pauzerondes die nergens meetellen | A |
| Workshops kiezen uit het eigen aanbod (29 workshops) | L |
| Uitvoeringen per ronde, meerdere naast elkaar, aan en uit | A |
| Maximum per uitvoering, ruimte en docent | A |
| Klasbeperking per uitvoering | A |
| Klassenlijst importeren uit Excel, Word, PDF, CSV | A |
| Voorbeeld vóór het importeren, met kolommen aanwijzen | A |
| Leerjaar en klas apart herkennen | A |
| Persoonlijke inschrijfcode per leerling | L |
| Gedeelde toegangscode per dag, intrekken en opnieuw maken | L (aanmaken), A |
| Verificatie per schoolmail met een cijfercode | A |
| Pogingenteller tegen raden, werkt over meerdere servers | A |
| Leerling schrijft zichzelf in, wisselt, ziet vol is vol | A |
| Herhaling van dezelfde workshop toestaan of weigeren | A |
| Vrijstellingen | A |
| Automatisch indelen na sluiting, met voorbeeld en goedkeuring | L |
| Klassenlijsten en workshoplijsten als Excel en PDF | L |
| Codelijsten per klas als Excel en PDF | L |
| Lijsten per mail naar de school, met voorbeeld vooraf | L (voorbeeld), B (versturen) |
| Beveiligde klantomgeving met link en losse code | L |
| Persoonlijke bevestiging naar leerlingen, met app-links en benodigdheden | B |
| Leerling zoeken, nieuwe code, vrijstellen, verwijderen | L (zoeken, nieuwe code), B |
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
| Alle beheeracties achter een rechtencontrole (37 van de 37) | A |
| Serverfuncties in de database niet aanroepbaar door klanten of bezoekers | A |
| Logboek van beheeracties | B |
| Inschrijvingstabellen alleen bereikbaar via serveracties | A |
| De publieke sleutel heeft nergens rechten | A |

### Integraties

| Functie | Stempel |
| --- | --- |
| Gmail koppelen via Google, tokens versleuteld opgeslagen | B |
| Verbindingstest Gmail, inclusief toegestane afzenderadressen | B |
| Moneybird koppelen met een API-token | B |
| Moneybird-webhook met handtekeningcontrole | L (verkeerde sleutel geweigerd) |
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
| SkoolPoints: saldo, geschiedenis, inwisselen | L (saldo, geschiedenis, verzoek zichtbaar), A (zelf indienen) |
| CJP-tegoed aanvragen | B |
| Berichten lezen en beantwoorden | B |
| Workshopresultaten downloaden | B |
| Accountgegevens beheren | B |
| Toegang uitsluitend tot de eigen organisatie | L (op de database, als ingelogde klant) |

De indelingpagina voor een cultuurdag (`/indeling/<link>`) staat los van het
portaal: die werkt zonder account, met een link en een losse code.

---

## Wat er niet is

- Geen rapportagemodule met grafieken, periodes of exports buiten het
  inschrijfsysteem.
- Geen actieve HubSpot-synchronisatie. Het token staat in de omgeving, maar er
  is geen code die er gegevens mee ophaalt of wegschrijft.
- Geen automatische koppeling van een factuur aan een school op naam of adres.
  Dat is een bewuste keuze: zonder een gekoppeld Moneybird-contact wordt een
  factuur niet binnengehaald.
- Geen handmatige invoer van boekingen. Een boeking ontstaat uit een
  bevestigingsmail.
- Geen aparte rollen binnen een school. Elke contactpersoon van een locatie mag
  hetzelfde; de definitieve verwerking van punten ligt bij Skool Workshop.
- Geen app voor leerlingen. De inschrijfpagina is een gewone webpagina die op
  een telefoon werkt.
- Geen betaalmodule. Betalen loopt via Moneybird.
- Geen koppeling met Magister of Somtoday. Klassenlijsten komen als bestand
  binnen.

---

## Hoe er getest is

| Soort | Omvang |
| --- | --- |
| Live, via de schermen | Locaties, contactpersonen, correctie, inwisselen, cultuurdag van aanmaken tot lijsten, online inzage, Moneybird-synchronisatie |
| Live, op de database | 39 controles die zichzelf terugdraaien (`supabase/acceptatietest-live.sql`), 39 goed |
| Geautomatiseerde tests | 618, verdeeld over 44 bestanden |
| Databaseregels | `npm run db:verify`, tegen de echte migraties |
| Beveiliging | rechten op tabellen en functies, RLS, policies en zoekpaden, met de standaardrechten van Supabase |
| Vaste controles op de code | elke upsert heeft een passende index, elke ingesloten tabel is eenduidig, elke downloadknop heeft een bestand, verwijderen loopt niet vast |
| Visueel | de schermen van het inschrijfsysteem op 1280 en 390 pixels, zonder horizontale overloop |

Wat niet live is doorlopen: de leerlingenpagina zelf (de schakelaar staat uit),
het echt versturen van mail, en inloggen als klant. Zie `docs/oplevering.md`.
