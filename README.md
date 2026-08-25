# Mijn Skool

De klantomgeving van Skool Workshop. Klanten zien hier hun boekingen, facturen en
e-mailcommunicatie, en sparen SkoolPoints via het loyaliteitsprogramma SkoolPartner.

Mijn Skool is een **losse webapplicatie**. De bestaande WordPress-site op
[skoolworkshop.nl](https://skoolworkshop.nl) blijft volledig ongewijzigd. Er wordt hier ook
**geen boekingssysteem** gebouwd: de knop "Nieuwe workshop aanvragen" verwijst naar de
bestaande offerteaanvraag.

Productiedomein: `https://mijn.skoolworkshop.nl`

---

## Inhoud

1. [Wat er al werkt](#wat-er-al-werkt)
2. [Techniek](#techniek)
3. [Lokaal draaien](#lokaal-draaien)
4. [Supabase inrichten](#supabase-inrichten)
5. [Environment variables](#environment-variables)
6. [Eerste beheerder aanmaken](#eerste-beheerder-aanmaken)
7. [Integraties koppelen](#integraties-koppelen)
8. [Deployen naar Vercel](#deployen-naar-vercel)
9. [Custom domein](#custom-domein)
10. [Loyaliteitsinstellingen](#loyaliteitsinstellingen)
11. [Testen](#testen)
12. [Hoe de belangrijkste stromen werken](#hoe-de-belangrijkste-stromen-werken)
13. [Beveiliging en AVG](#beveiliging-en-avg)
14. [Problemen oplossen](#problemen-oplossen)

---

## Wat er al werkt

**Klantportaal**

- Registreren en inloggen zonder wachtwoord (inloglink of 6-cijferige code)
- Organisatie kiezen via uitnodiging, domeinsuggestie of eigen aanvraag, altijd met goedkeuring
- Dashboard met saldo, eerstvolgende workshop, recente factuur en berichten
- Boekingen: aankomend en eerder
- Facturen met veilige pdf-weergave rechtstreeks uit Moneybird
- Berichtencentrum met antwoordfunctie via `boekingen@skoolworkshop.nl`
- SkoolPartner: kaart, saldo, historie, inwisselverzoeken en spelregels
- Accountpagina met eigen gegevens en organisatiekoppeling

**Beheer**

- Controlewachtrij voor onzekere boekingsbevestigingen
- Organisaties, domeinen, contactpersonen, uitnodigingen
- Gebruikersgoedkeuring en blokkade
- Volledige SkoolPoints-ledger met handmatige correctie en terugdraaien
- Inwisselverzoeken goedkeuren, afwijzen en verwerken
- Integratiestatus met handmatige synchronisatie
- Alle bedrijfsregels aanpasbaar zonder programmeerwerk
- Audit log van elke belangrijke handeling

**Nog te doen door jou** (zie [Integraties koppelen](#integraties-koppelen)): de externe
credentials invullen. Zolang die ontbreken draaien Moneybird, Gmail en HubSpot in
**testmodus** met realistische voorbeelddata, zodat alles te bekijken en te testen is.

---

## Techniek

| Onderdeel | Keuze |
| --- | --- |
| Framework | Next.js 16 (App Router, React 19, TypeScript) |
| Styling | Tailwind CSS 4, huisstijl van skoolworkshop.nl |
| Lettertypes | Titillium Web en Inter, zelf gehost (geen externe verzoeken) |
| Database | PostgreSQL via Supabase, met Row Level Security |
| Auth | Supabase Auth, passwordless (magic link + OTP) |
| Hosting | Vercel |
| Financieel | Moneybird API |
| E-mail | Gmail API |
| CRM | HubSpot API |
| Tests | Vitest |

Er wordt bewust **geen AI-dienst** gebruikt tijdens normaal gebruik. Het herkennen van
bevestigingsmails gebeurt met een deterministische parser. Bij twijfel: geen punten, maar
een melding in de wachtrij "Controle nodig".

---

## Lokaal draaien

Vereist: Node.js 20.9 of nieuwer.

```bash
npm install
cp .env.example .env.local     # vul daarna de waarden in
npm run dev                    # http://localhost:3000
```

Handige commando's:

```bash
npm run build        # productiebuild
npm run typecheck    # TypeScript controleren
npm run lint         # ESLint
npm test             # unit- en logicatests
npm run test:rls     # Row Level Security tegen een echt Supabase-project
```

---

## Supabase inrichten

1. Maak een project aan op [supabase.com](https://supabase.com). Kies een regio in Europa
   (bijvoorbeeld Frankfurt) in verband met de AVG.
2. Installeer de Supabase CLI en koppel het project:

   ```bash
   npm install -g supabase
   supabase login
   supabase link --project-ref <jouw-project-ref>
   ```

3. Zet de migraties op de database:

   ```bash
   supabase db push
   ```

   De migraties staan in `supabase/migrations/` en draaien op volgorde:

   | Bestand | Inhoud |
   | --- | --- |
   | `…120000_extensions_and_enums.sql` | extensies, enums, lijst met publieke e-maildomeinen |
   | `…120100_core_identity.sql` | profielen, organisaties, lidmaatschappen, contactpersonen |
   | `…120200_bookings.sql` | boekingen, boekingsbronnen, reviews |
   | `…120300_invoices.sql` | facturen, factuurregels, externe koppelingen |
   | `…120400_loyalty.sql` | SkoolPartner-accounts, ledger, inwisselverzoeken |
   | `…120500_messaging.sql` | e-mailthreads en berichten |
   | `…120600_integrations_settings_audit.sql` | sync-status, credentials, instellingen, audit |
   | `…120700_rls_policies.sql` | Row Level Security op alle tabellen |
   | `…120800_loyalty_functions.sql` | atomaire functies voor inwisselen en vervallen |
   | `…120900_seed_settings.sql` | startinstellingen SkoolPartner |

4. Zet in **Authentication > URL Configuration**:
   - Site URL: `http://localhost:3000` (lokaal) of `https://mijn.skoolworkshop.nl` (productie)
   - Redirect URLs: voeg `https://mijn.skoolworkshop.nl/auth/callback` toe, plus
     `http://localhost:3000/auth/callback` en de Vercel preview-URL's.
5. Zet in **Authentication > Providers > Email** de optie "Confirm email" aan en schakel
   wachtwoorden desgewenst uit; Mijn Skool gebruikt uitsluitend magic links en OTP.

Wil je de types opnieuw genereren nadat je het schema hebt aangepast:

```bash
supabase gen types typescript --project-id <ref> > src/lib/types/database.ts
```

---

## Environment variables

Alles staat toegelicht in `.env.example`. Kort overzicht van wat je waar vandaan haalt:

| Variabele | Waar vind je hem | Nodig voor |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase > Project Settings > API | alles |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | idem | alles |
| `SUPABASE_SERVICE_ROLE_KEY` | idem (**geheim**) | beheer, integraties, cron |
| `APP_ENCRYPTION_KEY` | zelf genereren: `openssl rand -base64 32` | versleutelde Gmail-token |
| `CRON_SECRET` | zelf genereren: `openssl rand -hex 32` | beveiligen van `/api/cron/*` |
| `MONEYBIRD_API_TOKEN` | Moneybird > Instellingen > Developers > API-tokens | facturen |
| `MONEYBIRD_ADMINISTRATION_ID` | het getal in de Moneybird-URL van je administratie | facturen |
| `MONEYBIRD_WEBHOOK_TOKEN` | zelf kiezen, geef je mee bij het aanmaken van de webhook | betaalstatus |
| `GOOGLE_CLIENT_ID` | Google Cloud Console > Credentials > OAuth client | Gmail |
| `GOOGLE_CLIENT_SECRET` | idem | Gmail |
| `GOOGLE_REDIRECT_URI` | `<site-url>/api/integrations/google/callback` | Gmail |
| `GMAIL_MAILBOX` | `boekingen@skoolworkshop.nl` | Gmail |
| `HUBSPOT_PRIVATE_APP_TOKEN` | HubSpot > Instellingen > Integraties > Private Apps | CRM |

In Vercel voer je ze in onder **Project Settings > Environment Variables**, en vink je per
variabele aan voor welke omgevingen hij geldt (Development, Preview, Production). Zet
`NEXT_PUBLIC_SITE_URL` en `GOOGLE_REDIRECT_URI` per omgeving op de juiste URL.

---

## Eerste beheerder aanmaken

1. Registreer jezelf op `/registreren` met je Skool Workshop-adres.
2. Zet je account op beheerder via de SQL-editor in Supabase:

   ```sql
   update public.profiles
   set is_admin = true, is_super_admin = true
   where lower(email) = 'jouwnaam@skoolworkshop.nl';
   ```

3. Ga naar `/admin`. Alleen een hoofdbeheerder (`is_super_admin`) kan andere accounts
   blokkeren of adminrechten toekennen; dat is bewust niet vanuit de interface mogelijk
   zonder die rol.

---

## Integraties koppelen

Zolang een credential ontbreekt, blijft de rest van de applicatie gewoon werken. In
**Admin > Integraties** zie je per integratie of hij live is of in testmodus draait, en
precies welke variabelen er nog ontbreken.

### Moneybird

1. Maak een API-token aan: Moneybird > Instellingen > Developers > API-tokens.
   Benodigde rechten: **lezen van verkoopfacturen en contacten**. Schrijfrechten zijn niet
   nodig; Mijn Skool wijzigt nooit iets in Moneybird.
2. Zet `MONEYBIRD_API_TOKEN` en `MONEYBIRD_ADMINISTRATION_ID` in Vercel.
3. Registreer een webhook met als URL:
   `https://mijn.skoolworkshop.nl/api/webhooks/moneybird`
   Kies minimaal de events `sales_invoice_state_changed_to_paid` en `payment_registered`.
   Zet hetzelfde geheim in `MONEYBIRD_WEBHOOK_TOKEN`.
4. Koppel Moneybird-contacten aan organisaties. Dat kan door bij de organisatie een
   geverifieerd domein toe te voegen, of door in de tabel `external_record_mappings` een
   rij te zetten met `system = 'moneybird'`, `entity_type = 'contact'` en het Moneybird
   contact-ID.

### Gmail

1. Ga naar de [Google Cloud Console](https://console.cloud.google.com), maak een project en
   zet de **Gmail API** aan.
2. Maak een OAuth 2.0 Client ID aan van het type **Web application**.
3. Voeg als geautoriseerde redirect URI toe:
   `https://mijn.skoolworkshop.nl/api/integrations/google/callback`
   (en de localhost-variant voor lokaal werken).
4. Benodigde scopes, meer niet:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
5. Zet `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` en
   `APP_ENCRYPTION_KEY` in Vercel.
6. Log in als beheerder, ga naar **Admin > Integraties** en klik op *Gmail koppelen via
   Google*. Log daar in met het account van `boekingen@skoolworkshop.nl`. De refresh token
   wordt versleuteld opgeslagen; hij komt nooit in de browser.
7. Maak in Gmail een label aan voor definitieve bevestigingen, standaard
   `Mijn Skool/Boekingsbevestiging`, en zet dat label op elke definitieve
   boekingsbevestiging. Dat label is het sterkste signaal voor de parser. De naam is aan te
   passen in Admin > Instellingen.

### HubSpot

1. HubSpot > Instellingen > Integraties > Private Apps > maak een app.
2. Benodigde scopes (alleen lezen): `crm.objects.companies.read`,
   `crm.objects.contacts.read`, `crm.objects.deals.read`.
3. Zet het token in `HUBSPOT_PRIVATE_APP_TOKEN`.

---

## Deployen naar Vercel

1. Zet de code in een Git-repository en importeer die in Vercel.
2. Framework preset: Next.js. Build command en output laat je op de standaardwaarden staan.
3. Voer de environment variables in (zie hierboven).
4. Deploy naar **Preview** en test:
   - inloggen met een magic link,
   - `/admin` bereikbaar als beheerder, en niet als gewone klant,
   - `/admin/integraties` toont de juiste status.
5. Promoveer daarna naar **Production**.

De cron jobs staan in `vercel.json`:

| Pad | Schema | Doel |
| --- | --- | --- |
| `/api/cron/sync` | ieder uur | Gmail, Moneybird en HubSpot synchroniseren |
| `/api/cron/verval-punten` | dagelijks 03:30 | verlopen SkoolPoints registreren |

Vercel stuurt automatisch `Authorization: Bearer $CRON_SECRET` mee, mits `CRON_SECRET` als
environment variable is ingesteld. Handmatig aanroepen kan met dezelfde header:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://mijn.skoolworkshop.nl/api/cron/sync
```

---

## Custom domein

1. Voeg in Vercel het domein `mijn.skoolworkshop.nl` toe aan het project.
2. Zet bij je DNS-provider een CNAME:

   ```
   mijn.skoolworkshop.nl.   CNAME   cname.vercel-dns.com.
   ```

3. Wacht tot Vercel het certificaat heeft uitgegeven.
4. Werk daarna bij:
   - `NEXT_PUBLIC_SITE_URL` en `GOOGLE_REDIRECT_URI` in Vercel,
   - de redirect URL's in Supabase Auth,
   - de redirect URI in de Google Cloud Console,
   - de webhook-URL in Moneybird.

De hoofdsite op `skoolworkshop.nl` verandert hier niet door. Voeg eventueel een gewone link
naar `https://mijn.skoolworkshop.nl` toe in het menu of de footer van de WordPress-site.

---

## Loyaliteitsinstellingen

Alle bedrijfsregels staan in de tabel `app_settings` en zijn aan te passen via
**Admin > Instellingen**, zonder programmeerwerk. De startwaarden:

| Instelling | Startwaarde |
| --- | --- |
| Punten per workshopuur | 100 |
| Minimale workshopduur | 90 minuten |
| Waarde per 100 punten | € 2,50 |
| Reviewbonus | 50 punten |
| Minimum per inwisselverzoek | 500 punten |
| Maximum per boeking | geen |
| Geldigheidsduur | 24 maanden |
| Mijlpaal | elke 500 punten |
| CTA-URL | `https://skoolworkshop.nl/offerte-aanvraag/` |

Rekenvoorbeelden die hieruit volgen: 90 minuten = 150 punten, 2 uur = 200 punten,
4 × 90 minuten = 600 punten = € 15,00 Skool Voordeel.

**Belangrijk:** een wijziging van de puntenwaarde verandert de historie niet. Elke
transactie legt de waarde van dat moment vast in `point_value_cents_per_100`, dus oude
regels blijven kloppen.

---

## Testen

```bash
npm test        # rekenregels, parser, factuurkoppeling, versleuteling
npm run test:rls
```

De unit tests dekken onder andere:

- 90 minuten → 150 punten, 2 uur → 200 punten, 4 × 90 minuten → 600 punten
- 100 punten → € 2,50 en de hele voorbeeldtabel uit de bedrijfsregels
- in behandeling → beschikbaar, reserveren, inwisselen, terugdraaien, vervallen
- onvoldoende saldo, dubbele verwerking, minimum en maximum bij inwisselen
- een offerte, aanvraag of wijzigingsverzoek wordt nooit als boeking gezien
- reiskosten, starttarief en materiaal tellen niet mee als workshopregel
- factuur correct gekoppeld, en juist niet gekoppeld bij twijfel

`npm run test:rls` draait tegen een echt Supabase-project en controleert dat gebruiker A
nooit bij de gegevens van organisatie B kan, ook niet door handmatig een ander UUID te
gebruiken. Draai die test op een ontwikkelproject, nooit op productie.

---

## Hoe de belangrijkste stromen werken

### Van bevestigingsmail naar SkoolPoints

1. Skool Workshop stuurt de definitieve bevestiging vanuit `boekingen@skoolworkshop.nl` en
   zet er het label `Mijn Skool/Boekingsbevestiging` op.
2. De uurlijkse synchronisatie leest de mailbox en bewaart elke Gmail-message maar één keer
   (unieke index op het message-ID).
3. De parser bepaalt op basis van label, afzenderdomein, onderwerp, bevestigende zinnen,
   gestructureerde velden en een boekingsreferentie of dit een definitieve bevestiging is.
4. Organisatie, workshop, aantal, duur, datum en locatie worden uitgelezen.
5. Twijfelt de applicatie ergens over, dan komt de e-mail in **Controle nodig** en gebeurt
   er verder niets. Pas na goedkeuring door een beheerder gaat de flow verder.
6. De punten worden berekend over de kwalificerende workshopduur en krijgen de status
   **in behandeling**.
7. De bijbehorende Moneybird-factuur wordt gekoppeld via referentie, factuurregels,
   organisatie en datum.
8. Zodra Moneybird meldt dat de factuur volledig is betaald, worden de punten
   **beschikbaar**.

### Inwisselen

Een klant vraagt in Mijn Skool een aantal punten aan. De databasefunctie
`request_redemption` controleert in één transactie, met een lock op het account, het saldo,
het minimum en het maximum, en zet meteen een reservering klaar. Dezelfde punten kunnen
daardoor nooit twee keer worden ingezet. Een beheerder keurt het verzoek goed en zet het op
verwerkt zodra het voordeel op een boeking is toegepast. Voor versie 1 wordt de korting nog
niet automatisch in WordPress verwerkt; dat gebeurt handmatig bij het opstellen van de
offerte.

### Berichten

Een e-mailthread is alleen zichtbaar als er een **geverifieerde contactpersoon** van een
organisatie aan deelneemt. Een match op alleen het schooldomein is uitdrukkelijk niet
genoeg. Threads zonder zo'n contactpersoon worden helemaal niet opgeslagen. Antwoorden van
klanten gaan via `boekingen@skoolworkshop.nl` en blijven in dezelfde Gmail-thread.

---

## Beveiliging en AVG

- Row Level Security staat op **alle** tabellen aan en is nooit de plek om iets snel op te
  lossen. Een gebruiker ziet uitsluitend gegevens van organisaties waar hij een actief
  lidmaatschap heeft.
- De service-role key wordt alleen server-side gebruikt en komt nooit in de browser.
- Externe API's worden uitsluitend server-side aangeroepen. De klantbrowser krijgt nooit
  toegang tot Gmail, Moneybird of HubSpot.
- De Gmail refresh token staat versleuteld (AES-256-GCM) in `integration_credentials`. Die
  tabel heeft bewust geen enkele policy: alleen de service role komt erbij.
- Uitnodigingstokens worden alleen als hash bewaard.
- Facturen worden niet gedupliceerd in Supabase; de pdf wordt server-side uit Moneybird
  opgehaald en direct doorgegeven.
- Van e-mail bewaren we alleen wat nodig is voor weergave; interne mail komt er niet in.
- Elke belangrijke beheerhandeling staat in het audit log, inclusief oude en nieuwe waarde
  en een verplichte reden bij puntencorrecties.
- Klanten kunnen hun eigen gegevens aanpassen en hun lidmaatschap beëindigen. Financiële en
  loyaltyhistorie hoort bij de organisatie en blijft daarom bestaan.
- Publieke e-maildomeinen (gmail.com, outlook.com, hotmail.com, icloud.com en tientallen
  andere) kunnen nooit aan een organisatie worden gekoppeld; de database blokkeert dat.

---

## Problemen oplossen

**"SUPABASE_SERVICE_ROLE_KEY ontbreekt"**
De beheeromgeving en de integraties hebben deze sleutel nodig. Voeg hem toe in Vercel en
deploy opnieuw.

**Inloglink werkt niet**
Controleer of de redirect-URL in Supabase Auth exact overeenkomt met
`<NEXT_PUBLIC_SITE_URL>/auth/callback`. Bij schoolmailboxen kan bezorging een paar minuten
duren; de 6-cijferige code in dezelfde e-mail werkt als alternatief.

**"Geen refresh token" bij het koppelen van Gmail**
Google geeft alleen een refresh token bij de eerste toestemming. Verwijder de toegang in
[myaccount.google.com/permissions](https://myaccount.google.com/permissions) en koppel
opnieuw; de flow vraagt bewust `prompt=consent` aan.

**Facturen komen binnen zonder organisatie**
Er is nog geen koppeling tussen het Moneybird-contact en een organisatie. Voeg bij de
organisatie een geverifieerd domein toe of leg de koppeling vast in
`external_record_mappings`.

**Alles staat in testmodus**
Dat betekent dat de betreffende credentials nog ontbreken, of dat
`INTEGRATIONS_FORCE_MOCK=true` aanstaat. Admin > Integraties laat per integratie zien welke
variabelen er nog nodig zijn.

**Punten blijven op "in behandeling" staan**
De gekoppelde factuur is nog niet volledig betaald, of er is nog geen factuur gekoppeld.
Controleer dat in Admin > Organisaties bij de betreffende organisatie.
