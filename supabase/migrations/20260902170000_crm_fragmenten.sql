-- =============================================================================
-- SkoolPartner - 033 - CRM: fragmenten
-- =============================================================================
-- Fase 8: herbruikbare tekstblokken met personalisatie. Het eerste van de drie
-- onderdelen fragmenten, meetings en sequences.
--
-- WAAROM DIT HET EERSTE IS
--
--   Een sequence is niet meer dan een reeks fragmenten met een wachttijd
--   ertussen. Als de personalisatie hier goed staat, hoeft die daar niet nog
--   een keer. Andersom zou betekenen dat sequences hun eigen tekstsysteem
--   krijgen en er straks twee plekken zijn waar een standaardzin kan staan.
--
-- TWEE TABELLEN, EN WAAROM DE TWEEDE
--
--   crm_snippets     het fragment zelf
--   crm_snippet_uses elke keer dat er een is gebruikt
--
--   Een teller op het fragment zelf zou eenvoudiger zijn, maar dat is precies
--   het soort getal dat na een half jaar niet meer klopt. Net als bij het
--   CJP-tegoed en de bezetting van een reisperiode: het aantal wordt geteld
--   uit de regels en nooit apart bijgehouden.
--
--   Bijkomend voordeel: je ziet niet alleen hoe vaak, maar ook waarbij. Een
--   fragment dat alleen bij verloren deals wordt gebruikt, zegt iets.
--
-- Er verandert niets aan een bestaande tabel.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- crm_snippets: het fragment
-- -----------------------------------------------------------------------------
create table if not exists public.crm_snippets (
  id          uuid primary key default gen_random_uuid(),

  -- Leeg betekent: geldt voor allebei de merken. Dat is het normale geval voor
  -- een fragment over betaalvoorwaarden, en niet voor een fragment over het
  -- programma van het Breekjaar.
  brand       public.crm_brand,

  -- Waarmee je hem terugvindt en straks kunt aanroepen. Kleine letters en
  -- streepjes, zodat je hem kunt typen zonder na te denken over hoofdletters.
  shortcut    text not null,
  name        text not null,
  body        text not null,

  -- Vrije groepering: 'offerte', 'opvolging', 'praktisch'. Bewust geen vaste
  -- lijst; welke groepen nuttig zijn blijkt pas bij gebruik.
  category    text,

  is_archived boolean not null default false,

  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint crm_snippets_naam_niet_leeg check (length(trim(name)) > 1),
  constraint crm_snippets_inhoud_niet_leeg check (length(trim(body)) > 1),

  -- De sneltoets moet typbaar zijn en blijven. Deze regel staat in de database
  -- en niet alleen in het formulier, zodat een import of een script hem ook
  -- niet kan omzeilen.
  constraint crm_snippets_sneltoets_vorm
    check (shortcut ~ '^[a-z0-9][a-z0-9-]{1,39}$')
);

-- Een sneltoets is uniek binnen zijn merk. Twee merken mogen dezelfde sneltoets
-- hebben met een andere tekst: 'welkom' betekent bij een school iets anders dan
-- bij een deelnemer aan het Breekjaar.
--
-- Twee losse indexen, omdat een gewone unieke index op (shortcut, brand) niets
-- afdwingt zodra brand leeg is: in Postgres is null nooit gelijk aan null.
create unique index if not exists crm_snippets_sneltoets_per_merk_idx
  on public.crm_snippets (shortcut, brand)
  where brand is not null;

create unique index if not exists crm_snippets_sneltoets_beide_merken_idx
  on public.crm_snippets (shortcut)
  where brand is null;

create index if not exists crm_snippets_categorie_idx
  on public.crm_snippets (category)
  where not is_archived;

comment on table public.crm_snippets is
  'Herbruikbare tekstblokken met personalisatie. De basis waar sequences later hun inhoud uit halen.';
comment on column public.crm_snippets.brand is
  'Leeg betekent: bruikbaar bij allebei de merken.';
comment on column public.crm_snippets.shortcut is
  'Kleine letters, cijfers en streepjes. Uniek binnen het merk.';


-- -----------------------------------------------------------------------------
-- crm_snippet_uses: elke keer dat een fragment is gebruikt
-- -----------------------------------------------------------------------------
-- Bewust een aparte regel per gebruik en geen teller. Zie de kop van dit
-- bestand.
--
-- LET OP: hier staat met opzet geen kopie van de verstuurde tekst in. Dat zou
-- betekenen dat elke persoonlijke zin over een klant hier een tweede keer
-- terechtkomt, en dat is precies het soort verdubbeling dat je bij een AVG-
-- verzoek niet wilt hebben. Wat er is gezegd staat op de tijdlijn; hier staat
-- alleen dat een fragment is gebruikt.
create table if not exists public.crm_snippet_uses (
  id              uuid primary key default gen_random_uuid(),
  snippet_id      uuid not null references public.crm_snippets (id) on delete cascade,

  -- Waarbij. Alle drie mogen leeg zijn: een fragment kan ook gewoon gekopieerd
  -- worden zonder dat het ergens aan hangt.
  organization_id uuid references public.organizations (id) on delete set null,
  contact_id      uuid references public.crm_contacts (id) on delete set null,
  deal_id         uuid references public.crm_deals (id) on delete set null,

  actor_id        uuid references public.profiles (id) on delete set null,
  used_at         timestamptz not null default now()
);

create index if not exists crm_snippet_uses_snippet_idx
  on public.crm_snippet_uses (snippet_id, used_at desc);
create index if not exists crm_snippet_uses_used_idx
  on public.crm_snippet_uses (used_at desc);

comment on table public.crm_snippet_uses is
  'Een regel per keer dat een fragment is gebruikt. Het aantal wordt hieruit geteld en nooit apart bijgehouden.';


-- -----------------------------------------------------------------------------
-- updated_at bijhouden
-- -----------------------------------------------------------------------------

drop trigger if exists set_crm_snippets_updated_at on public.crm_snippets;
create trigger set_crm_snippets_updated_at
  before update on public.crm_snippets
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- Rechten: dicht, zoals elke CRM-tabel
-- -----------------------------------------------------------------------------
-- Een fragment bevat commerciele formuleringen en soms prijsafspraken. Dat is
-- niets voor het klantportaal. Zelfde patroon als alle andere crm_-tabellen:
-- rechten intrekken, geen enkele policy voor ingelogde gebruikers.

alter table public.crm_snippets     enable row level security;
alter table public.crm_snippet_uses enable row level security;

alter table public.crm_snippets     force row level security;
alter table public.crm_snippet_uses force row level security;

revoke all on public.crm_snippets     from anon, authenticated;
revoke all on public.crm_snippet_uses from anon, authenticated;

grant select, insert, update, delete on public.crm_snippets     to service_role;
grant select, insert, update, delete on public.crm_snippet_uses to service_role;


-- -----------------------------------------------------------------------------
-- Een handvol fragmenten om mee te beginnen
-- -----------------------------------------------------------------------------
-- Bewust neutrale, feitelijke teksten zonder verzonnen cijfers, verzonnen
-- referenties of beloftes. Ze zijn bedoeld om aangepast te worden, niet om
-- ongelezen te versturen.
--
-- on conflict do nothing: wie ze heeft aangepast of weggegooid, krijgt ze niet
-- opnieuw terug bij een volgende migratie.

insert into public.crm_snippets (brand, shortcut, name, body, category) values
  (null, 'aanhef', 'Aanhef',
   E'Beste {{voornaam|relatie}},',
   'basis'),

  ('skool_workshop', 'offerte-nabellen', 'Offerte nabellen',
   E'Beste {{voornaam|relatie}},\n\nEerder stuurde ik jullie een voorstel voor {{deal}}. Ik ben benieuwd of het zo aansluit bij wat jullie voor ogen hebben, en of er nog iets ontbreekt.\n\nAls het handiger is om even te bellen, hoor ik graag wanneer het jullie schikt.\n\nMet vriendelijke groet,\n{{mijn_naam}}',
   'opvolging'),

  ('skool_workshop', 'datum-vastleggen', 'Datum vastleggen',
   E'Beste {{voornaam|relatie}},\n\nFijn dat jullie akkoord zijn op {{deal}}. Om de datum vast te kunnen zetten heb ik nog nodig:\n\n- de gewenste dag en dagdeel\n- het aantal leerlingen en de klassen\n- de locatie en de ruimte die beschikbaar is\n- een contactpersoon op de dag zelf\n\nZodra dat rond is, zet ik het definitief in de agenda.\n\nMet vriendelijke groet,\n{{mijn_naam}}',
   'planning'),

  ('skool_workshop', 'na-afloop', 'Na afloop',
   E'Beste {{voornaam|relatie}},\n\nDank voor de samenwerking rond {{deal}}. Ik hoor graag hoe het bij jullie is bevallen en wat er beter kan.\n\nMet vriendelijke groet,\n{{mijn_naam}}',
   'evaluatie'),

  ('suri_impact', 'breekjaar-info', 'Breekjaar, korte uitleg',
   E'Beste {{voornaam|relatie}},\n\nHet Suri Impact Breekjaar is een vierweeks tussenjaarprogramma in Suriname voor jongeren van 17 tot en met 22 jaar.\n\nLaat gerust weten welke vragen er nog zijn, dan beantwoord ik ze.\n\nMet vriendelijke groet,\n{{mijn_naam}}',
   'informatie')
on conflict do nothing;
