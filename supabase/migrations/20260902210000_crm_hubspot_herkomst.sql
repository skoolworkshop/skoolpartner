-- =============================================================================
-- SkoolPartner - 037 - CRM: herkomst uit HubSpot vastleggen
-- =============================================================================
-- Voor de overstap van HubSpot naar het eigen CRM. Deze migratie zet geen
-- enkel gegeven over. Zij voegt alleen een kolom toe waarin straks het
-- HubSpot-nummer van een rij komt te staan.
--
-- WAAROM DIE KOLOM ER MOET ZIJN VOORDAT ER IETS WORDT GEIMPORTEERD
--
--   Zonder herkomst is een import eenmalig en onomkeerbaar. Draait hij half,
--   of blijkt er achteraf een fout in de omzetting te zitten, dan is er geen
--   manier meer om te zien welke rij waar vandaan kwam. Met deze kolom is de
--   import:
--
--     herhaalbaar  - een tweede keer draaien maakt geen dubbele rijen, want
--                    het nummer is uniek;
--     controleerbaar - je kunt elke rij terugleggen naast het HubSpot-record
--                    waar hij uit komt, zolang HubSpot nog aan staat;
--     terug te draaien - alles met een hubspot_id is geimporteerd, alles
--                    zonder is met de hand ingevoerd. Dat onderscheid is
--                    precies wat je nodig hebt als er iets moet worden
--                    opgeruimd.
--
--   Dat laatste is de reden dat dit een eigen kolom is en geen notitie in het
--   tekstveld. Een import moet je kunnen aanwijzen, niet zoeken.
--
-- WAT HIER BEWUST NIET GEBEURT
--
--   Geen enkele bestaande kolom verandert, er wordt geen rij aangeraakt en er
--   komt geen koppeling naar organizations bij. Bedrijven blijven voorlopig
--   buiten de overstap; de kolom die dat later eventueel nodig heeft, komt er
--   pas als die stap ook echt gezet wordt.
--
--   Er komt ook geen kolom op bookings of organizations. Die tabellen hebben
--   al hubspot_deal_id en hubspot_contact_id uit een eerdere koppeling. Die
--   laten we met rust.
-- =============================================================================

alter table public.crm_contacts
  add column if not exists hubspot_id text;

alter table public.crm_deals
  add column if not exists hubspot_id text;

alter table public.crm_meetings
  add column if not exists hubspot_id text;

alter table public.crm_activities
  add column if not exists hubspot_id text;


-- -----------------------------------------------------------------------------
-- Uniek per nummer, en zo vaak leeg als nodig
-- -----------------------------------------------------------------------------
-- Dit is de vangrail onder de import: draait die twee keer, of twee keer
-- tegelijk, dan botst de tweede poging op de index in plaats van een dubbele
-- rij te maken. De controle zit dus in de database en niet alleen in het
-- script.
--
-- WAAROM DIT GEEN GEDEELTELIJKE INDEX IS
--
--   De voor de hand liggende vorm is "... where hubspot_id is not null", want
--   verreweg de meeste rijen hebben geen HubSpot-achtergrond. Dat werkt hier
--   toch niet, en dat is bij het proefdraaien gebleken:
--
--     insert ... on conflict (hubspot_id) do update ...
--
--   weigert een gedeeltelijke index als doel, tenzij je dezelfde where-clausule
--   in de opdracht herhaalt. De client-bibliotheek van Supabase kan dat niet
--   uitdrukken; upsert geeft alleen een kolomnaam mee. Met een gedeeltelijke
--   index zou een tweede import dus niet bijwerken maar afbreken.
--
--   Een gewone unieke index heeft dat bezwaar niet en is hier net zo streng:
--   twee null-waarden gelden in Postgres niet als gelijk, dus alle rijen
--   zonder herkomst staan gewoon naast elkaar. Het enige verschil is dat de
--   index ook de lege waarden bevat, en dat is bij deze omvang niets.

create unique index if not exists crm_contacts_hubspot_idx
  on public.crm_contacts (hubspot_id);

create unique index if not exists crm_deals_hubspot_idx
  on public.crm_deals (hubspot_id);

create unique index if not exists crm_meetings_hubspot_idx
  on public.crm_meetings (hubspot_id);

create unique index if not exists crm_activities_hubspot_idx
  on public.crm_activities (hubspot_id);


comment on column public.crm_contacts.hubspot_id is
  'Het recordnummer uit HubSpot, als deze rij daaruit is overgenomen. Leeg bij alles wat in SkoolPartner zelf is ontstaan.';
comment on column public.crm_deals.hubspot_id is
  'Het recordnummer uit HubSpot, als deze deal daaruit is overgenomen.';
comment on column public.crm_meetings.hubspot_id is
  'Het recordnummer uit HubSpot, als deze afspraak daaruit is overgenomen.';
comment on column public.crm_activities.hubspot_id is
  'Het recordnummer uit HubSpot, als deze notitie of activiteit daaruit is overgenomen.';


-- -----------------------------------------------------------------------------
-- Rechten blijven dicht
-- -----------------------------------------------------------------------------
-- Nieuwe kolommen erven de rechten van hun tabel, en die staan dicht. Voor de
-- zekerheid nog een keer expliciet.

revoke all on public.crm_contacts   from anon, authenticated;
revoke all on public.crm_deals      from anon, authenticated;
revoke all on public.crm_meetings   from anon, authenticated;
revoke all on public.crm_activities from anon, authenticated;
