# Oplevering van SkoolPartner

De volgorde waarin het live gaat, wie welke stap doet, en hoe je ziet dat het
goed is gegaan. Bijgewerkt op 12 november 2026.

## Wat alleen vanaf jouw computer kan

| Stap | Waarom |
| --- | --- |
| Back-up en migraties | Supabase is niet bereikbaar vanuit de omgeving van de assistent, en een terminal op jouw computer mag de assistent alleen bekijken, niet bedienen. |
| `git push` | De inloggegevens voor GitHub staan op jouw computer. |
| Geheime waarden op Vercel | Een geheim zoals `CRON_SECRET` vult de assistent nooit zelf in. |

Wat de assistent wel kan, via jouw ingelogde Chrome: de live database
uitlezen in het Supabase-dashboard, het beheer van SkoolPartner bedienen, en de
Vercel-deployment nakijken.

---

## Stap 1. Back-up, migraties en publiceren (jij, één opdracht)

```
npm run livegang
```

Het script doet dit in vaste volgorde en stopt bij de eerste stap die niet
klopt:

1. Werkmap schoon en op main.
2. Verse back-up, en controle dat die er staat en van zojuist is.
3. Controle vooraf: geen Moneybird-contact bij twee locaties (044), geen dubbele
   toekenning binnen één locatie (045).
4. Migratiestatus: 043 moet erin staan, en alleen 044 en 045 mogen klaarstaan.
5. `supabase db push`. De CLI vraagt zelf om bevestiging: `Y`.
6. Controle achteraf: beide migraties staan erin, het saldo rekent per locatie.
7. `git push origin main`. Vercel publiceert daarna vanzelf.

Opnieuw draaien mag altijd. Wat al gedaan is, wordt overgeslagen.

### Wat de migraties doen

| Migratie | Inhoud | Raakt gegevens? |
| --- | --- | --- |
| 044 | Eén Moneybird-contact kan bij maar één locatie horen | Nee, één index |
| 045 | Het puntensaldo is van de locatie; vijf fouten rond punten opgelost; serverfuncties dichtgezet | Nee, alleen weergave, functies, leesrechten en indexen |

Het project zit op het gratis Supabase-abonnement. Daar zijn **geen
automatische back-ups**. De back-up uit stap 2 van het script is dus de enige.

## Stap 2. De 36 losse facturen opruimen (jij)

Pas nadat stap 1 klaar is en de nieuwe versie live staat. Anders haalt de oude
code ze bij de volgende synchronisatie gewoon opnieuw binnen.

Eerst kijken, dat verwijdert nog niets:

```
node scripts/opschonen.mjs --ook-losse-facturen
```

Klopt het beeld (36 facturen, geen organisaties), dan:

```
node scripts/opschonen.mjs --ook-losse-facturen --verwijder --zeker
```

Het script eist een back-upmap van vandaag; die is er dan net. In Moneybird
zelf verandert er niets.

Daarna hoort het dashboard nul facturen, nul zonder koppeling en € 0,00
openstaand te tonen.

## Stap 3. Vercel (jij)

Project **skoolpartner**, omgeving Production:

| Variabele | Waarde | Wanneer |
| --- | --- | --- |
| `PUBLIEKE_INSCHRIJVING` | `aan` | Zodra de eerste cultuurdag open moet. Zonder deze variabele blijft de leerlingenpagina in productie dicht. |
| `CRON_SECRET` | een lange willekeurige tekst | Zodra de nachtelijke taken mogen draaien |

### Let op bij de nachtelijke taken

Zolang `CRON_SECRET` ontbreekt, antwoorden alle vier de taken met 503 en doen
ze niets. Staat hij er eenmaal, dan draait dit elke nacht:

- **03:00 punten laten vervallen**. Werkt sinds migratie 045 per locatie.
- **04:00 workshopresultaten opruimen**.
- **04:30 leerlinggegevens opruimen**, dertig dagen na de cultuurdag.
- **05:00 Gmail en Moneybird synchroniseren**.

Zet vóór de eerste nacht `gmail_sync_query` bij de instellingen in het beheer
tijdelijk op `newer_than:2d`. De Gmail-synchronisatie heeft nog nooit een
beginpunt opgeslagen en zou anders alles van de laatste zestig dagen ophalen.
Draai hem één keer met de hand, kijk wat er binnenkomt, en zet de zoekopdracht
daarna terug.

Moneybird heeft dat probleem niet: het beginpunt staat op 12 november, en
zonder gekoppelde locatie komt er sowieso niets binnen.

## Stap 4. De eerste echte school

1. Organisatiebeheer → Schoollocatie toevoegen.
2. Contactpersoon uitnodigen.
3. Moneybird-contact koppelen.
4. Voor een cultuurdag: zie de handleiding voor Anne.
5. De bewaartermijn van dertig dagen opnemen in de offerte of op de site.

---

## Terug als het misgaat

- **De migraties**: `supabase/terugdraaien-044-045.sql`. Getest door hem na de
  migraties te draaien en 044 en 045 daarna opnieuw uit te voeren. Er valt geen
  gegeven terug te zetten, want de migraties hebben er geen gewijzigd. Zet dan
  ook de vorige versie van de applicatie terug.
- **De deployment**: in Vercel met één klik terug naar de vorige deployment.
- **De gegevens**: de back-up uit stap 1. Terugzetten is beproefd in een lege
  database; de volgorde staat in `docs/migratie-043-toegangscode.md`.
