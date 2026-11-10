# Migratie 043: gedeelde toegangscode en verificatie

Dit is het plan voor `supabase/migrations/20261110120000_gedeelde_toegangscode.sql`.
De migratie is voorbereid en getest, maar **nog niet uitgevoerd**.

## Wat de migratie doet

**Toevoegen aan `enrollment_events`**

| Kolom | Wat het is |
| --- | --- |
| `shared_code` | De gedeelde toegangscode van de dag. Acht tekens, zonder I, L, O en U. |
| `shared_code_active` | Staat de code aan. Standaard ja. |
| `shared_code_changed_at` | Wanneer de code voor het laatst is gewisseld. |

De controle op `access_mode` wordt verbreed van `('code','naam')` naar
`('code','schoolmail','naam')`.

**Toevoegen aan `enrollment_participants`**

| Kolom | Wat het is |
| --- | --- |
| `claim_email` | Het adres waarmee de inschrijving is bevestigd. |
| `claimed_at` | Wanneer dat gebeurd is. |

**Twee nieuwe tabellen**

- `enrollment_verifications`: de eenmalige cijfercodes. Alleen de versleutelde
  vorm, nooit de code zelf. Vervalt na tien minuten, na vijf foute pogingen of
  na één keer gebruiken.
- `enrollment_attempts`: de pogingenteller. Telt op een versleuteld kenmerk van
  de bezoeker, nooit op een IP-adres.

**Eén nieuwe functie**

`enrollment_poging(event, bucket, max, seconden)` telt één poging en zegt of er
nog een mag. Staat in de database en niet in het geheugen van de server, omdat
er op Vercel meerdere servers naast elkaar draaien.

**Twee nieuwe instellingen**

`enrollment_shared_attempts` (10) en `enrollment_verify_minutes` (10), met
`on conflict do nothing`.

**Eén regel die bestaande gegevens aanraakt**

Elke dag die nog geen code heeft, krijgt er een. Zonder dat zou een dag die nu
open staat na de migratie voor iedereen dicht zitten. Het vult alleen de nieuwe,
lege kolom; aan de dag zelf verandert niets.

## Gevolgen voor wat er nu in de database staat

| Wat | Gevolg |
| --- | --- |
| Inschrijfdagen | Krijgen een code in een nieuwe kolom. Naam, datum, status, slug, tijden: ongewijzigd. |
| Klassen, rondes, workshops, uitvoeringen | Niets. Geen kolom aangeraakt. |
| Deelnemers | Twee nieuwe lege kolommen. De persoonlijke codes (`access_code`) en de bewijzen (`claim_token`) blijven precies zoals ze zijn. |
| Gemaakte keuzes | Niets. Geen rij wordt aangeraakt, geen plek komt vrij. |
| Boekingen, facturen, organisaties, spaarpunten, accounts | Niets. De migratie komt buiten `enrollment_*` niet, op de twee rijen in `app_settings` na. |

Er wordt niets verwijderd, hernoemd of omgezet. Alles staat in één transactie:
gaat er iets mis, dan draait alles terug.

## Wat er verandert voor Anne en voor de leerlingen

1. Elke dag heeft een toegangscode. Die staat in het dagscherm onder de
   inschrijflink, met een knop om link en code samen te kopiëren.
2. Een leerling vult eerst die code in, en bewijst daarna wie hij is: met zijn
   persoonlijke code of met een cijfercode op zijn schooladres.
3. Alleen een naam aanklikken kan nog steeds, maar staat standaard uit.
4. De code uitzetten is de noodrem: er komt dan niemand meer binnen, ook niet
   wie het scherm nog open heeft staan. Gemaakte keuzes blijven staan.
5. Een dag openzetten zonder code kan niet meer. Staat er nog geen, dan wordt er
   automatisch een klaargezet. Staat hij bewust uit, dan zegt het scherm dat.

## Vooraf

1. Back-up maken en controleren dat de inschrijvingen erin staan:

   ```
   npm run backup:data
   ```

   Kijk of `_backup/data-<datum>/enrollment_events.json`,
   `enrollment_participants.json` en `enrollment_choices.json` er staan en gevuld
   zijn. Staan ze er niet, voer de migratie dan niet uit.

2. De migratie droog draaien tegen een Postgres in het geheugen:

   ```
   npm run db:verify
   ```

   Dit moet eindigen met "Alle migraties en databaseregels zijn in orde."

3. De tests:

   ```
   npm test
   ```

## Uitvoeren

```
npm run db:push
```

## Daarna controleren

```
npm run check:productie
```

Daar hoort nu bij te staan:

- `Migratie 043 (toegangscode)  uitgevoerd`
- `Toegangscodes  N open dag(en), allemaal met werkende code`
- `enrollment_verifications  bereikbaar`

En in de beheeromgeving: open een dag en kijk of er onder de inschrijflink een
toegangscode staat.

## Terug als het misgaat

De migratie voegt alleen toe. Terugdraaien kan dus zonder gegevensverlies:

```sql
begin;

drop function if exists public.enrollment_poging(uuid, text, integer, integer);
drop table if exists public.enrollment_attempts;
drop table if exists public.enrollment_verifications;

alter table public.enrollment_participants
  drop constraint if exists enrollment_participants_claim_email_check,
  drop column if exists claimed_at,
  drop column if exists claim_email;

alter table public.enrollment_events
  drop constraint if exists enrollment_events_shared_code_check,
  drop column if exists shared_code_changed_at,
  drop column if exists shared_code_active,
  drop column if exists shared_code;

-- Let op: zet eerst elke dag die op 'schoolmail' staat terug naar 'code',
-- anders gaat de smallere controle niet aan.
update public.enrollment_events set access_mode = 'code' where access_mode = 'schoolmail';

alter table public.enrollment_events
  drop constraint if exists enrollment_events_access_mode_check;
alter table public.enrollment_events
  add constraint enrollment_events_access_mode_check check (access_mode in ('code', 'naam'));

delete from public.app_settings
 where key in ('enrollment_shared_attempts', 'enrollment_verify_minutes');

commit;
```

Wat je daarmee kwijtraakt: de toegangscodes, de bevestigingsadressen en de
openstaande cijfercodes. Dat is alles wat deze migratie zelf heeft aangemaakt.
Deelnemers, klassen, rondes, workshops en keuzes blijven ongemoeid.

De code die bij deze migratie hoort, hoort dan ook terug. Draai die dus terug in
dezelfde stap, anders zoekt de applicatie naar kolommen die er niet meer zijn.
