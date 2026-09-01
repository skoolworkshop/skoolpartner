-- =============================================================================
-- SkoolPartner - 028 - CRM, fase 1: het fundament
-- =============================================================================
-- Dit is de eerste migratie van het CRM. Zij voegt uitsluitend toe.
--
-- WAT HIER BEWUST NIET GEBEURT
--
--   Er verandert niets aan een bestaande tabel. Geen kolom erbij, geen kolom
--   eraf, geen enumwaarde erbij op een bestaand type, geen bestaande rij die
--   wordt aangeraakt. Ook organizations en bookings blijven precies zoals ze
--   zijn. Code die niets van het CRM weet, merkt van deze migratie niets.
--
-- DE TWEE MERKEN ZIJN NIET HETZELFDE SOORT BEDRIJF
--
--   Skool Workshop verkoopt aan scholen: een organisatie boekt een workshop.
--   Suri Impact Breekjaar verkoopt aan één jongere tegelijk: een vierweeks
--   programma met een vast aantal plaatsen per reisperiode.
--
--   Daarom staat het merk straks op de deal en niet op de organisatie, en
--   daarom staan de pijplijnfases in een tabel in plaats van in code: de twee
--   processen delen bijna geen begrippen.
--
-- DE PRIVACYGRENS
--
--   Alle tabellen hier zijn uitsluitend voor het beheerportaal. Zij krijgen
--   RLS aan, alle rechten voor anon en authenticated worden ingetrokken, en er
--   komt geen enkele policy voor authenticated. Een klant kan deze gegevens
--   dus niet opvragen, ook niet als er ooit per ongeluk code wordt geschreven
--   die dat probeert. De grens ligt in de database, niet in de applicatie.
--
--   Dat intrekken is geen overbodige beleefdheid: Supabase geeft nieuwe
--   tabellen in het schema public standaard rechten aan anon en authenticated.
--   Zonder de revoke hieronder zou een nieuwe CRM-tabel dus meteen leesbaar
--   zijn voor iedere ingelogde klant.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

do $$ begin
  create type public.crm_brand as enum ('skool_workshop', 'suri_impact');
exception when duplicate_object then null; end $$;

-- Let op het verschil met organizations.status. Die stuurt toegang aan
-- (actief, geblokkeerd, gearchiveerd) en mag hier niet voor gebruikt worden.
-- Deze waarde zegt alleen iets over de commerciele relatie.
do $$ begin
  create type public.crm_lifecycle as enum ('prospect', 'lead', 'klant', 'oud_klant');
exception when duplicate_object then null; end $$;


-- -----------------------------------------------------------------------------
-- crm_pipeline_stages: de fases, per merk
-- -----------------------------------------------------------------------------
-- In data en niet in code, omdat de twee merken een ander proces hebben en
-- omdat een fase toevoegen dan geen programmeerwerk kost.
create table if not exists public.crm_pipeline_stages (
  id          uuid primary key default gen_random_uuid(),
  brand       public.crm_brand not null,
  key         text not null,
  label       text not null,
  description text,
  position    integer not null default 0,
  -- Een fase die telt als gewonnen of verloren sluit de deal af. Precies een
  -- van beide, of geen van beide.
  is_won      boolean not null default false,
  is_lost     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint crm_pipeline_stages_key_not_blank check (length(trim(key)) > 0),
  constraint crm_pipeline_stages_label_not_blank check (length(trim(label)) > 0),
  constraint crm_pipeline_stages_niet_beide check (not (is_won and is_lost))
);

create unique index if not exists crm_pipeline_stages_brand_key_idx
  on public.crm_pipeline_stages (brand, key);

create index if not exists crm_pipeline_stages_brand_position_idx
  on public.crm_pipeline_stages (brand, position);

comment on table public.crm_pipeline_stages is
  'De fases van de verkooppijplijn, per merk. Skool Workshop en Suri Impact hebben bewust een ander proces.';


-- -----------------------------------------------------------------------------
-- crm_contacts: een persoon, met of zonder organisatie
-- -----------------------------------------------------------------------------
-- Dit staat bewust NAAST organization_contacts en vervangt die tabel niet.
--
--   organization_contacts bepaalt wie e-mail mag zien. Een geverifieerd
--   contact daarin opent e-mailverkeer in het klantportaal. Dat is de
--   gevoeligste grens van het hele platform.
--
--   crm_contacts bepaalt alleen wie je kent. Een rij hier aanmaken verandert
--   nooit iets aan wat een klant te zien krijgt. Wil je iemand wel toegang tot
--   berichten geven, dan blijft dat een aparte, bewuste handeling in de
--   bestaande tabel.
--
-- organization_id mag leeg zijn. Dat is precies wat een Suri-deelnemer nodig
-- heeft: een persoon zonder school. Het alternatief, voor elke deelnemer een
-- nepschool aanmaken, zou de cijfers, de rechten en de portaaltoegang
-- vervuilen.
create table if not exists public.crm_contacts (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid references public.organizations (id) on delete cascade,
  full_name          text not null,
  email              text,
  phone              text,
  job_title          text,
  note               text,
  -- Afgemeld voor commerciele mail. Zegt niets over de verwerking van een
  -- lopende boeking of aanmelding.
  is_unsubscribed    boolean not null default false,
  owner_id           uuid references public.profiles (id) on delete set null,
  -- Wijst naar het geverifieerde contact als die er is. Alleen een verwijzing;
  -- deze tabel maakt daar nooit zelf een aan.
  linked_contact_id  uuid references public.organization_contacts (id) on delete set null,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint crm_contacts_name_not_blank check (length(trim(full_name)) > 1),
  constraint crm_contacts_email_vorm check (email is null or position('@' in email) > 1)
);

-- Binnen een organisatie hoort een adres maar een keer voor te komen.
create unique index if not exists crm_contacts_org_email_idx
  on public.crm_contacts (organization_id, lower(email))
  where organization_id is not null and email is not null;

-- En bij personen zonder organisatie ook, want daar vangt de index hierboven
-- niets af: in een unieke index zijn twee null-waarden niet gelijk aan elkaar.
create unique index if not exists crm_contacts_los_email_idx
  on public.crm_contacts (lower(email))
  where organization_id is null and email is not null;

create index if not exists crm_contacts_organization_idx
  on public.crm_contacts (organization_id);

create index if not exists crm_contacts_naam_idx
  on public.crm_contacts (lower(full_name));

comment on table public.crm_contacts is
  'Personen die je kent. Staat los van organization_contacts, dat de privacygrens voor e-mail bewaakt. organization_id mag leeg zijn voor een deelnemer zonder school.';
comment on column public.crm_contacts.linked_contact_id is
  'Verwijzing naar het geverifieerde contact, als dat bestaat. Deze tabel maakt daar nooit zelf een aan en verifieert ook niets.';


-- -----------------------------------------------------------------------------
-- crm_organization_profiles: wat je over een school bijhoudt
-- -----------------------------------------------------------------------------
-- Bewust een aparte tabel en geen kolommen op organizations. Een klant mag
-- zijn eigen organisatierij lezen, en de levensfase en de interne notitie
-- horen daar niet bij.
create table if not exists public.crm_organization_profiles (
  organization_id  uuid primary key references public.organizations (id) on delete cascade,
  lifecycle        public.crm_lifecycle not null default 'klant',
  owner_id         uuid references public.profiles (id) on delete set null,
  source           text,
  last_contact_at  timestamptz,
  next_action_at   timestamptz,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists crm_organization_profiles_lifecycle_idx
  on public.crm_organization_profiles (lifecycle);

create index if not exists crm_organization_profiles_owner_idx
  on public.crm_organization_profiles (owner_id);

comment on table public.crm_organization_profiles is
  'Interne gegevens over een organisatie: levensfase, eigenaar, laatste contact. Nooit zichtbaar voor de klant zelf.';


-- -----------------------------------------------------------------------------
-- updated_at bijhouden
-- -----------------------------------------------------------------------------

drop trigger if exists set_crm_pipeline_stages_updated_at on public.crm_pipeline_stages;
create trigger set_crm_pipeline_stages_updated_at
  before update on public.crm_pipeline_stages
  for each row execute function public.set_updated_at();

drop trigger if exists set_crm_contacts_updated_at on public.crm_contacts;
create trigger set_crm_contacts_updated_at
  before update on public.crm_contacts
  for each row execute function public.set_updated_at();

drop trigger if exists set_crm_organization_profiles_updated_at on public.crm_organization_profiles;
create trigger set_crm_organization_profiles_updated_at
  before update on public.crm_organization_profiles
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- Rechten: dicht, en dicht blijven
-- -----------------------------------------------------------------------------

alter table public.crm_pipeline_stages        enable row level security;
alter table public.crm_contacts               enable row level security;
alter table public.crm_organization_profiles  enable row level security;

-- Ook voor de tabeleigenaar afdwingen. service_role blijft RLS omzeilen, en
-- dat is precies de enige weg die het CRM gebruikt.
alter table public.crm_pipeline_stages        force row level security;
alter table public.crm_contacts               force row level security;
alter table public.crm_organization_profiles  force row level security;

revoke all on public.crm_pipeline_stages       from anon, authenticated;
revoke all on public.crm_contacts              from anon, authenticated;
revoke all on public.crm_organization_profiles from anon, authenticated;

grant select, insert, update, delete on public.crm_pipeline_stages       to service_role;
grant select, insert, update, delete on public.crm_contacts              to service_role;
grant select, insert, update, delete on public.crm_organization_profiles to service_role;

-- Er komt hier bewust GEEN create policy voor authenticated. Geen policy
-- betekent geen enkele rij, ook niet als de rechten ooit per ongeluk weer
-- worden uitgedeeld. Twee sloten op dezelfde deur.


-- -----------------------------------------------------------------------------
-- De fases waarmee je begint
-- -----------------------------------------------------------------------------
-- Aanpasbaar zodra het scherm daarvoor er is. Dit is een startsituatie, geen
-- vastgelegde waarheid.

insert into public.crm_pipeline_stages (brand, key, label, description, position, is_won, is_lost) values
  ('skool_workshop', 'nieuwe_aanvraag', 'Nieuwe aanvraag',
   'Binnengekomen via het formulier, de mail of de telefoon. Nog geen contact gehad.', 10, false, false),
  ('skool_workshop', 'contact_gelegd', 'Contact gelegd',
   'Gesproken of gemaild, wensen bekend.', 20, false, false),
  ('skool_workshop', 'offerte_verstuurd', 'Offerte verstuurd',
   'Prijs en datum liggen bij de school.', 30, false, false),
  ('skool_workshop', 'akkoord', 'Akkoord',
   'De school gaat akkoord. Nog niet ingepland.', 40, false, false),
  ('skool_workshop', 'ingepland', 'Ingepland',
   'Er staat een boeking. Hiermee is de deal gewonnen.', 50, true, false),
  ('skool_workshop', 'verloren', 'Niet doorgegaan',
   'Afgehaakt, te duur, geen datum gevonden of naar een ander gegaan.', 90, false, true),

  ('suri_impact', 'aanmelding', 'Aanmelding',
   'Aanmeldformulier binnen. Nog geen gesprek geweest.', 10, false, false),
  ('suri_impact', 'gesprek_gepland', 'Kennismakingsgesprek gepland',
   'Er staat een afspraak in de agenda.', 20, false, false),
  ('suri_impact', 'gesprek_gehad', 'Gesprek gehad',
   'Kennismaking geweest, beslissing volgt.', 30, false, false),
  ('suri_impact', 'plaats_toegezegd', 'Plaats toegezegd',
   'Er is een plaats gereserveerd in een reisperiode.', 40, false, false),
  ('suri_impact', 'aanbetaling', 'Aanbetaling ontvangen',
   'De plaats is definitief.', 50, false, false),
  ('suri_impact', 'volledig_betaald', 'Volledig betaald',
   'Alles voldaan, klaar voor vertrek. Hiermee is de deal gewonnen.', 60, true, false),
  ('suri_impact', 'afgehaakt', 'Afgehaakt',
   'Teruggetrokken, afgewezen of niet doorgegaan.', 90, false, true)
on conflict (brand, key) do nothing;


-- -----------------------------------------------------------------------------
-- Instellingen
-- -----------------------------------------------------------------------------
-- Alleen het startmerk. De kleuren van de merken staan bewust in de stijl van
-- de applicatie en niet in de database: een kleur die je in een instelling kunt
-- zetten, kun je ook op onleesbaar zetten.

insert into public.app_settings (key, value, label, description, group_name, value_type, is_public, sort_order) values
  ('crm_default_brand', '"skool_workshop"'::jsonb, 'Startmerk in het CRM',
   'Welk merk je ziet als je het beheerportaal opent. Je kunt daarna altijd wisselen.',
   'crm', 'text', false, 10)
on conflict (key) do nothing;
