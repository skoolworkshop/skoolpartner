# Oplevering van SkoolPartner

De volgorde waarin het live gaat, met per stap wie hem doet en hoe je ziet dat
het goed is gegaan.

## Waarom sommige stappen niet vanuit de assistent kunnen

Drie dingen zijn alleen vanaf jouw Windows-omgeving te doen:

| Stap | Waarom |
| --- | --- |
| `npm run db:push` | Supabase is niet bereikbaar vanuit de omgeving waarin de assistent draait: er is daar geen DNS voor `*.supabase.co`. |
| `git push` | De inloggegevens voor GitHub zitten in GitHub Desktop op Windows, niet in de Linux-omgeving. Lezen lukt wel, pushen niet. |
| Vercel-instellingen | `api.vercel.com` is onbereikbaar en de browser van de assistent is niet ingelogd op Vercel. |

De rest kan wel: controleren, testen, documenteren, en na afloop de live
omgeving in de browser nalopen.

---

## Stap 1. Back-up (jij)

```
npm run backup:data
```

Kijk daarna of `_backup/data-<datum>/enrollment_participants.json` bestaat en
gevuld is. Zo niet: niet verder gaan.

## Stap 2. Laatste controles (assistent of jij)

```
npm run db:verify
node scripts/controle-043.mjs
npm test
```

Verwacht: "Alle migraties en databaseregels zijn in orde", "Precies gelijk aan
de back-up: ja", en alle tests groen.

## Stap 3. De testdag opruimen (jij)

De CKV Dag van De Goudse Waarden is een testdag. Eerst kijken, dan pas
verwijderen:

```
node scripts/dag-leegmaken.mjs --dag ckv-dag-2026-11-12-4c2af410
```

Dat verwijdert nog niets. Het laat zien wat eraan hangt en schrijft een eigen
back-up weg. Klopt het beeld, dan:

```
node scripts/dag-leegmaken.mjs --dag ckv-dag-2026-11-12-4c2af410 --verwijder --zeker
```

De dag zelf blijft staan, leeg en op concept. Wil je ook de dag zelf weg, doe
dat dan daarna met de knop in het beheerscherm.

Dit script raakt uitsluitend deze ene dag: elke verwijdering gaat op id's die
eerst bij deze dag zijn opgehaald. Boekingen, facturen, organisaties, accounts
en spaarpunten blijven ongemoeid.

## Stap 4. Migratie 043 (jij)

```
npm run db:push
npm run check:productie
```

In de uitvoer hoort te staan: migratie 042 uitgevoerd, migratie 043 uitgevoerd,
en of er open dagen zonder werkende toegangscode zijn.

**Pas hierna de code publiceren.** De versie die nu live staat merkt niets van
043, maar de nieuwe code zoekt kolommen die zonder 043 niet bestaan.

## Stap 5. Vercel klaarzetten (jij)

Project **skoolpartner**, omgeving Production:

| Variabele | Waarde |
| --- | --- |
| `PUBLIEKE_INSCHRIJVING` | `uit` |
| `CRON_SECRET` | een lange willekeurige tekst |

Zet `PUBLIEKE_INSCHRIJVING` op `uit` **voordat** je deployt, anders staat de
leerlingenpagina open op het moment dat de nieuwe versie live komt.

### Let op bij de geplande taken

Als `CRON_SECRET` er eenmaal staat, gaan de taken draaien. Dit zou er de eerste
nacht gebeuren:

- **03:00 verval-punten**: niets. Geen enkele transactie is verlopen.
- **04:00 opruimen-resultaten**: de bestanden van één set, "Cultuurdag
  Graffiti", verlopen op 31 augustus, worden definitief verwijderd. Kijk eerst
  of die nog nodig zijn.
- **04:30 opruimen-inschrijvingen**: niets. Er is geen dag waarvan de
  bewaartermijn voorbij is.
- **05:00 sync (Gmail)**: dit is de grote. De laatste synchronisatie was 27
  augustus. De zoekopdracht haalt alles van de laatste 60 dagen op rond
  `boekingen@skoolworkshop.nl`, ruim tweehonderd gesprekken, en elke mail met
  "bevestiging" in het onderwerp gaat door de boekingsherkenning.

  **Zet daarom eerst `gmail_sync_query` tijdelijk op `newer_than:2d`** bij de
  instellingen in het beheer. Draai de synchronisatie één keer, kijk of er geen
  dubbele boekingen of berichten ontstaan, en zet de zoekopdracht daarna pas
  terug op `newer_than:60d`.

## Stap 6. Publiceren (jij)

Push `main` met GitHub Desktop. Vercel start dan vanzelf een
productiedeployment. Volg hem in het dashboard tot hij klaar is.

## Stap 7. Nalopen op de live omgeving (samen)

1. Inloggen op mijn.skoolworkshop.nl en kijken of het beheer normaal doet.
2. Een verzonnen school en cultuurdag aanmaken, een klassenlijst inlezen,
   rondes genereren, workshops erbij.
3. Kijken of er een toegangscode onder de inschrijflink staat.
4. Onder Integraties de Gmail-verbindingstest draaien. Die hoort
   `boekingen@skoolworkshop.nl` als toegestaan afzenderadres te tonen.
5. `PUBLIEKE_INSCHRIJVING` op `aan`, deployment afwachten, en op je telefoon de
   hele inschrijving doorlopen: foute toegangscode, goede toegangscode, foute
   leerlingcode, goede leerlingcode, kiezen, wisselen, een workshop vol laten
   lopen.
6. Inschrijving sluiten, automatisch indelen, lijsten downloaden, en één mail
   naar je eigen adres sturen. Nog geen klantmail.
7. `PUBLIEKE_INSCHRIJVING` weer op `uit` tot de eerste echte school zover is.
8. Vercel Logs nalopen op fouten.

## Stap 8. De eerste echte school

- Testdagen leegmaken met `dag:leegmaken`.
- De bewaartermijn van dertig dagen opnemen in de offerte of op de site.
- Link, toegangscode en de lijst met persoonlijke codes in één mail naar de
  contactpersoon.

---

## Terug als het misgaat

- **De migratie**: het terugdraaiplan staat in
  `docs/migratie-043-toegangscode.md`, met de exacte SQL. Alles is toevoegend,
  dus terugdraaien kost geen gegevens.
- **De deployment**: in Vercel kun je met één klik terug naar de vorige
  deployment. Draai de migratie dan niet terug; de oude code werkt gewoon op de
  nieuwe database.
- **De gegevens**: de back-up van stap 1, plus de per-dag back-up die
  `dag:leegmaken` zelf wegschrijft. Terugzetten is beproefd; de volgorde staat
  in `docs/migratie-043-toegangscode.md`.
