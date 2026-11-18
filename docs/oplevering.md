# Eindrapport SkoolPartner

Acceptatietest op de live omgeving, 17 en 18 november 2026. Versie in productie:
`3114132` op mijn.skoolworkshop.nl.

Alle testgegevens waren verzonnen ("ACCEPTATIETEST", "Testleerling",
"@acceptatie.test"). Er is geen mail naar een klant, leerling of school gegaan,
en in Moneybird, Gmail en HubSpot is niets aangemaakt, gewijzigd of verwijderd.

---

## Wat aantoonbaar live werkt

Getest op de echte site en de echte database.

### Schoollocaties en contactpersonen

| Getest | Uitkomst |
| --- | --- |
| Twee locaties van één bestuur toevoegen in Organisatiebeheer | Werkt |
| Dezelfde naam een tweede keer toevoegen | Geweigerd, met uitleg |
| Twee contactpersonen bij één locatie, zichtbaar onder Gebruikers | Werkt, na herstel (zie fouten) |
| Klantportaal bekijken als contactpersoon (Ga naar klantportaal) | Werkt |
| Locatie definitief verwijderen, inclusief cultuurdag | Werkt, na herstel (zie fouten) |

### Moneybird

| Getest | Uitkomst |
| --- | --- |
| Handmatige synchronisatie zonder gekoppelde locatie | 8 echte Moneybird-facturen opgehaald, alle 8 overgeslagen met reden "geen-koppeling", 0 opgeslagen |
| Contact zoeken op naam die niet bestaat | "Geen Moneybird-contact gevonden", niets gekoppeld |
| Webhook met een verkeerde sleutel | Geweigerd (401) |
| Dashboard na afloop | 0 facturen, 0 zonder koppeling, € 0,00 openstaand |

### SkoolPoints per locatie

| Getest | Uitkomst |
| --- | --- |
| Twee collega's sparen voor één saldo | Noord: 700 beschikbaar uit Anna's boekingen, zichtbaar voor Bram |
| Correctie via het beheerscherm, zonder contactpersoon | +150, saldo 850 |
| Inwisselverzoek van Bram op punten die Anna spaarde | 800 gereserveerd, 50 beschikbaar, verzoek zichtbaar voor beide |
| Verwerken zonder factuurnummer | Geweigerd: "Vul het factuurnummer in" |
| Verwerken met factuurnummer | Verwerkt, punten definitief afgeschreven |
| Zusterlocatie | Eigen saldo, ziet niets van Noord |

Daarnaast een blok van 39 controles op de live database, dat zichzelf
volledig terugdraait (`supabase/acceptatietest-live.sql`). Uitslag:
**39 van 39 goed**. Het blok toetst onder meer: één welkomstbonus per locatie,
dezelfde boeking nooit twee keer punten, een betaalde factuur maakt de punten
vrij, wie wat mag zien als ingelogde klant (met Row Level Security aan), een
contactpersoon van Zuid kan niet op Noord inwisselen, een klant kan geen
verzoek buiten de reservering om maken of zelf goedkeuren, verval gaat van het
saldo af, een vertrokken contactpersoon ziet niets meer, de CJP-bonus één keer
per locatie, en een volle workshop weigert de volgende leerling. Na afloop
stond er aantoonbaar niets meer van in de database.

### Cultuurdag

| Getest | Uitkomst |
| --- | --- |
| Dag aanmaken, rooster van 3 rondes met pauzes | Werkt |
| 3 workshops uit het aanbod, maximum 3 | Werkt |
| 2 klassen en 6 leerlingen plakken | Werkt |
| Openzetten, gedeelde toegangscode zichtbaar | Werkt |
| Leerling opzoeken, nieuwe code geven | Werkt, oude code vervalt |
| Inschrijven langs de echte inschrijffunctie, ook "vol is vol" | Werkt |
| Sluiten, voorstel bekijken, automatisch indelen | 13 plekken ingedeeld, iedereen elke ronde een workshop, geen workshop dubbel, nergens boven het maximum |
| Klassen- en workshoplijsten, Excel en PDF | Alle vier downloadbaar |
| Codelijsten voor de mentoren, Excel en PDF | Werkt, na herstel (zie fouten) |
| Mail met lijsten aan de school | Voorbeeld bekeken, bewust niet verstuurd |
| Online inzage voor de school | Foute code geweigerd, goede code toont de indeling, codelijsten niet op te halen |
| Bewaartermijn | Automatisch op dagdatum plus 30 dagen |

### Beveiliging

| Getest | Uitkomst |
| --- | --- |
| Beheer zonder inloggen | Doorgestuurd naar inloggen |
| Leerlingenpagina terwijl de schakelaar uit staat | 404, ook bij een dag die open staat |
| Geplande taken zonder geheim | Alle vier 503 |
| Functies die alleen de server mag aanroepen | Dicht voor klanten en bezoekers |
| Pagina's in een frame op een andere site | Geweigerd (X-Frame-Options: DENY) |

---

## Fouten gevonden en opgelost

Alle vier kwamen pas boven op de live omgeving. Voor elk staat nu een vaste
controle in de tests, zodat hij niet terug kan komen.

1. **Codelijsten gaven een 404.** "Inschrijfcodes (PDF)" en "(Excel)" werkten
   niet. Opgelost en live nagekeken.
2. **Gebruikers per locatie onzichtbaar.** Bij elke organisatie stond "Nog geen
   gebruikers gekoppeld", en "Wachten op goedkeuring" bleef altijd leeg, ook als
   er wel iemand wachtte. Daardoor was bij een correctie ook geen contactpersoon
   te kiezen. Opgelost en live nagekeken.
3. **Verwijderen liep vast op een cultuurdag.** Een locatie met een inschrijfdag
   bleef half verwijderd achter. Opgelost en live nagekeken: beide testlocaties
   zijn daarna netjes verwijderd.
4. **Melding na automatisch indelen.** Er stond "13 deelnemers ingedeeld" bij
   vijf leerlingen; het getal telt plekken. Opgelost en gepubliceerd.

---

## Wat alleen geautomatiseerd is getest

| Onderdeel | Waarom niet live |
| --- | --- |
| De leerlingenpagina (toegangscode, eigen code, kiezen, wisselen) | De schakelaar `PUBLIEKE_INSCHRIJVING` staat uit. De onderliggende inschrijffunctie is wel live getest. |
| Inschrijven met een cijfercode per schoolmail | Idem, en het zou mail versturen |
| Bevestigingen naar leerlingen en de lijstenmail echt versturen | Bewust niet: geen mail naar verzonnen of echte adressen |
| Inloggen als klant en zelf een inwisselverzoek indienen in het portaal | Inloggen gaat met een code per mail; ik log niet in als een ander. De databasefunctie erachter is live getest als ingelogde klant. |
| Factuur koppelen en punten vrijgeven via Moneybird | Er is geen echte school gekoppeld, en ik koppel geen echt Moneybird-contact voor een test. De regels zijn live getest op de database. |
| Mobiel | Het browservenster liet zich niet verkleinen. Elk scherm is in de visuele controle op 390 pixels gemaakt, zonder horizontale overloop. |

Geautomatiseerd: 618 tests in 44 bestanden, `db:verify`, de CJP-controle, en
de visuele controle op 1280 en 390 pixels. Allemaal groen.

---

## Geplande taken

Ze staan alle vier stil zolang `CRON_SECRET` ontbreekt. Wat er de eerste nacht
zou gebeuren als hij er komt, met de database zoals hij nu is:

| Taak | Effect |
| --- | --- |
| 03:00 punten laten vervallen | Niets, er zijn geen punten |
| 04:00 resultaten opruimen | Niets, er zijn geen resultaten |
| 04:30 leerlinggegevens opruimen | Niets, er zijn geen dagen |
| 05:00 Moneybird | Niets opgeslagen zolang er geen locatie gekoppeld is (live aangetoond) |
| 05:00 Gmail | **Let op.** De zoekopdracht staat op 60 dagen en er is nog nooit een beginpunt opgeslagen. Elke mail met "bevestiging" in het onderwerp komt dan als boekingsmail onder Controle nodig, met de tekst van de mail erbij, ook van scholen die niet meedoen. Gewone mailgesprekken worden niet opgeslagen zolang er geen geverifieerde contactpersonen zijn. |

---

## Wat nog openstaat

Dit zijn handelingen in jouw accounts. Er is geen fout meer bekend die echte
scholen in de weg zit.

1. **Voordat `CRON_SECRET` erin gaat:** in het beheer bij Instellingen
   `gmail_sync_query` op `newer_than:2d -in:spam -in:trash -in:drafts` zetten.
   Dan pas het geheim in Vercel. Zonder geheim draaien vervallen, opruimen en
   synchroniseren niet vanzelf.
2. **De leerlingenpagina aanzetten** zodra de eerste echte cultuurdag open moet:
   in Vercel `PUBLIEKE_INSCHRIJVING` op `aan`, daarna opnieuw publiceren
   (Deployments, de bovenste, Redeploy). Loop dan één keer op je telefoon de
   inschrijving door met een testdag.
3. **Back-ups.** Het Supabase-project zit op het gratis abonnement: geen
   automatische back-ups. Draai `npm run backup:data` vóór elke grote wijziging,
   of neem het Pro-abonnement.
4. **Drie oude boekingsmails** staan nog in de database (uit de periode vóór de
   opschoning, zonder organisatie). Niet door de test ontstaan en nergens
   zichtbaar. Laten staan of meenemen bij de volgende opschoning.

---

## Kan SkoolPartner veilig met echte scholen gebruikt worden?

Ja, voor het loyaliteitsprogramma en het beheer van cultuurdagen. De
toegangsregels, de puntenregels en de factuurregels zijn op de echte database
getoetst, de vier fouten die de test vond zijn opgelost, en de omgeving is
schoon: alleen het beheeraccount contact@skoolworkshop.nl, de instellingen en
de koppelingen staan er nog.

Twee voorwaarden. Leerlingen kunnen zich pas inschrijven als punt 2 is gedaan,
en de automatische taken draaien pas na punt 1. Doe bij de eerste echte
cultuurdag met de leerlingenpagina aan eerst zelf een korte proef op je
telefoon; dat ene stuk is niet live doorlopen.

---

## Terug als het misgaat

- **Code**: in Vercel met één klik terug naar de vorige deployment.
- **Migraties 044 en 045**: `supabase/terugdraaien-044-045.sql`.
- **Gegevens**: de back-up in `_backup/` van 12 november, gemaakt vlak voor de
  livegang.
