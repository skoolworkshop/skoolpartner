-- =============================================================================
-- SkoolPartner - 029 - CRM: deals, reisperiodes en deelnemers
-- =============================================================================
-- Fase 2 en 4 uit het plan, in een migratie omdat ze dezelfde tabel delen:
-- de deal. Bij Skool Workshop is een deal een aanvraag van een school, bij
-- Suri Impact is het de aanmelding van een deelnemer. Hetzelfde begrip, een
-- ander onderwerp en een ander proces.
--
-- WAT HIER BEWUST NIET GEBEURT
--
--   Er verandert opnieuw niets aan een bestaande tabel. Geen kolom erbij op
--   organizations, bookings, invoices of loyalty. Alles staat in nieuwe
--   crm_-tabellen die geen enkele ingelogde gebruiker kan benaderen.
--
-- DE DRIE REGELS DIE DE DATABASE ZELF BEWAAKT
--
--   1. Een deal heeft precies een onderwerp: OF een organisatie OF een
--      persoon. Nooit allebei en nooit geen van beide.
--   2. De fase van een deal hoort bij hetzelfde merk als de deal. Dat wordt
--      afgedwongen met een samengestelde verwijzing, niet met vertrouwen.
--   3. Een reisperiode hoort alleen bij Suri, een boeking alleen bij Skool
--      Workshop.
--
--   Zulke regels in de database zetten in plaats van in de code betekent dat
--   ze ook gelden voor een import, een script of een handmatige ingreep.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Voorbereiding: de fase moet aan het merk te koppelen zijn
-- -----------------------------------------------------------------------------
-- Een gewone verwijzing naar crm_pipeline_stages(id) laat toe dat een
-- Suri-deal in een Skool Workshop-fase belandt. Met een unieke sleutel op
-- (id, brand) kan de deal naar allebei tegelijk verwijzen, en dan kan dat niet
-- meer.
do $$ begin
  alter table public.crm_pipeline_stages
    add constraint crm_pipeline_stages_id_brand_key unique (id, brand);
exception when duplicate_table then null; when duplicate_object then null; end $$;


-- -----------------------------------------------------------------------------
-- crm_suri_editions: de reisperiodes
-- -----------------------------------------------------------------------------
-- Vijftien plaatsen per periode is een harde grens uit de praktijk. Die hoort
-- in de database en niet in iemands hoofd.
create table if not exists public.crm_suri_editions (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  starts_on    date not null,
  ends_on      date not null,
  capacity     integer not null default 15,
  price_cents  integer not null default 0,
  -- concept   = nog niet open voor aanmeldingen
  -- open      = aanmelden kan
  -- gesloten  = geen nieuwe aanmeldingen meer
  -- afgerond  = de reis is geweest
  status       text not null default 'concept',
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint crm_suri_editions_naam_niet_leeg check (length(trim(name)) > 1),
  constraint crm_suri_editions_volgorde check (ends_on > starts_on),
  constraint crm_suri_editions_capaciteit check (capacity between 1 and 200),
  constraint crm_suri_editions_prijs check (price_cents >= 0),
  constraint crm_suri_editions_status check (status in ('concept', 'open', 'gesloten', 'afgerond'))
);

create unique index if not exists crm_suri_editions_naam_idx
  on public.crm_suri_editions (lower(name));

create index if not exists crm_suri_editions_start_idx
  on public.crm_suri_editions (starts_on);

comment on table public.crm_suri_editions is
  'De reisperiodes van het Suri Impact Breekjaar, met het aantal plaatsen en de prijs per deelnemer.';


-- -----------------------------------------------------------------------------
-- crm_deals: de pijplijn van beide merken
-- -----------------------------------------------------------------------------
create table if not exists public.crm_deals (
  id               uuid primary key default gen_random_uuid(),
  brand            public.crm_brand not null,
  title            text not null,
  stage_id         uuid not null,
  -- Precies een van deze twee is gevuld. Zie de check onderaan.
  organization_id  uuid references public.organizations (id) on delete cascade,
  contact_id       uuid references public.crm_contacts (id) on delete cascade,
  value_cents      integer not null default 0,
  expected_date    date,
  owner_id         uuid references public.profiles (id) on delete set null,
  source           text,
  note             text,
  -- Alleen bij Suri: in welke reisperiode staat deze deelnemer?
  edition_id       uuid references public.crm_suri_editions (id) on delete set null,
  -- Alleen bij Skool Workshop: de boeking die uit een gewonnen deal is ontstaan.
  booking_id       uuid references public.bookings (id) on delete set null,
  closed_at        timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint crm_deals_titel_niet_leeg check (length(trim(title)) > 1),
  constraint crm_deals_waarde_niet_negatief check (value_cents >= 0),

  -- Regel 1: precies een onderwerp.
  constraint crm_deals_precies_een_onderwerp
    check (num_nonnulls(organization_id, contact_id) = 1),

  -- Regel 2: de fase hoort bij hetzelfde merk.
  constraint crm_deals_fase_hoort_bij_merk
    foreign key (stage_id, brand)
    references public.crm_pipeline_stages (id, brand),

  -- Regel 3: reisperiode alleen bij Suri, boeking alleen bij Skool Workshop.
  constraint crm_deals_reisperiode_alleen_suri
    check (edition_id is null or brand = 'suri_impact'),
  constraint crm_deals_boeking_alleen_skool_workshop
    check (booking_id is null or brand = 'skool_workshop'),

  -- Een Suri-deal gaat altijd over een persoon. Er is geen school die het
  -- Breekjaar afneemt.
  constraint crm_deals_suri_is_een_persoon
    check (brand <> 'suri_impact' or contact_id is not null)
);

create index if not exists crm_deals_brand_stage_idx on public.crm_deals (brand, stage_id);
create index if not exists crm_deals_organization_idx on public.crm_deals (organization_id);
create index if not exists crm_deals_contact_idx on public.crm_deals (contact_id);
create index if not exists crm_deals_edition_idx on public.crm_deals (edition_id);
create index if not exists crm_deals_owner_idx on public.crm_deals (owner_id);

-- Een deelnemer hoort maar een keer in dezelfde reisperiode te staan.
create unique index if not exists crm_deals_contact_editie_idx
  on public.crm_deals (contact_id, edition_id)
  where edition_id is not null;

comment on table public.crm_deals is
  'De pijplijn. Bij Skool Workshop een aanvraag van een school, bij Suri Impact de aanmelding van een deelnemer. De database bewaakt dat de fase bij het merk hoort.';
comment on column public.crm_deals.closed_at is
  'Wanneer de deal is afgesloten. Of hij gewonnen of verloren is, leidt je af uit de fase; dat staat op een plek en niet op twee.';


-- -----------------------------------------------------------------------------
-- crm_deal_events: fasewisselingen zijn historie
-- -----------------------------------------------------------------------------
-- Een fase overschrijven wist hoe lang iets ergens heeft gestaan. Dat is
-- precies wat je later wilt weten.
create table if not exists public.crm_deal_events (
  id            uuid primary key default gen_random_uuid(),
  deal_id       uuid not null references public.crm_deals (id) on delete cascade,
  from_stage_id uuid references public.crm_pipeline_stages (id) on delete set null,
  to_stage_id   uuid references public.crm_pipeline_stages (id) on delete set null,
  actor_id      uuid references public.profiles (id) on delete set null,
  note          text,
  created_at    timestamptz not null default now()
);

create index if not exists crm_deal_events_deal_idx
  on public.crm_deal_events (deal_id, created_at desc);


-- -----------------------------------------------------------------------------
-- crm_suri_profiles: wat je van een deelnemer bijhoudt
-- -----------------------------------------------------------------------------
-- LET OP, DIT IS EEN BEWUSTE BEPERKING
--
--   Hier staat uitsluitend wat nodig is om te verkopen en te plannen. Geen
--   medische gegevens, geen dieetwensen, geen paspoortgegevens. Dat zijn
--   bijzondere persoonsgegevens onder de AVG en die horen niet in een CRM dat
--   dagelijks openstaat.
--
--   Contactgegevens van een ouder of verzorger staan er wel in, omdat een deel
--   van de deelnemers bij aanmelding nog geen achttien is en er dan
--   toestemming nodig is.
create table if not exists public.crm_suri_profiles (
  contact_id      uuid primary key references public.crm_contacts (id) on delete cascade,
  birth_date      date,
  education_level text,
  interest        text,
  guardian_name   text,
  guardian_email  text,
  guardian_phone  text,
  together_with   text,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint crm_suri_profiles_geboortedatum_redelijk
    check (birth_date is null or birth_date between date '1950-01-01' and current_date)
);

comment on table public.crm_suri_profiles is
  'Aanvullende gegevens van een deelnemer aan het Breekjaar. Bewust alleen verkoop- en planningsgegevens: geen medische, dieet- of paspoortgegevens.';
comment on column public.crm_suri_profiles.together_with is
  'Vrije tekst: met wie iemand zich samen heeft aangemeld. Wordt gebruikt bij het indelen, niet als verwijzing.';


-- -----------------------------------------------------------------------------
-- crm_suri_payments: betalingen per deelnemer
-- -----------------------------------------------------------------------------
-- De bestaande invoices-tabel kan dit niet dragen: die hangt aan een
-- organisatie en een deelnemer heeft er geen. Voorlopig met de hand, later
-- eventueel te koppelen aan Moneybird via external_reference.
create table if not exists public.crm_suri_payments (
  id                 uuid primary key default gen_random_uuid(),
  deal_id            uuid not null references public.crm_deals (id) on delete cascade,
  kind               text not null,
  amount_cents       integer not null,
  received_on        date not null default current_date,
  note               text,
  external_reference text,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),

  constraint crm_suri_payments_soort
    check (kind in ('aanbetaling', 'restant', 'correctie', 'terugbetaling')),

  -- Het teken hoort bij de soort. Zo kun je een bedrag optellen zonder eerst
  -- te moeten uitzoeken of het erbij of eraf moet.
  constraint crm_suri_payments_teken check (
    (kind in ('aanbetaling', 'restant') and amount_cents > 0)
    or (kind = 'terugbetaling' and amount_cents < 0)
    or (kind = 'correctie' and amount_cents <> 0)
  ),

  constraint crm_suri_payments_correctie_met_reden
    check (kind <> 'correctie' or (note is not null and length(trim(note)) > 2))
);

create index if not exists crm_suri_payments_deal_idx
  on public.crm_suri_payments (deal_id, received_on desc);

-- Dezelfde betaling niet twee keer, bijvoorbeeld bij het overnemen uit
-- Moneybird of uit een bankexport.
create unique index if not exists crm_suri_payments_extern_idx
  on public.crm_suri_payments (deal_id, kind, external_reference)
  where external_reference is not null;


-- -----------------------------------------------------------------------------
-- De bezetting per reisperiode
-- -----------------------------------------------------------------------------
-- Berekend uit de deals, nooit als los bijgehouden getal. Dezelfde regel als
-- bij het CJP-tegoed: een aantal dat je opslaat, loopt vroeg of laat uit de
-- pas met de werkelijkheid.
create or replace view public.crm_suri_edition_capacity as
select
  e.id                                            as edition_id,
  e.name,
  e.starts_on,
  e.ends_on,
  e.status,
  e.capacity,
  e.price_cents,
  count(d.id) filter (where not s.is_lost)        as aangemeld,
  count(d.id) filter (where s.is_won)             as volledig_betaald,
  count(d.id) filter (where s.is_lost)            as afgehaakt,
  greatest(e.capacity - count(d.id) filter (where not s.is_lost), 0) as vrij,
  coalesce(sum(b.betaald_cents) filter (where not s.is_lost), 0)     as ontvangen_cents
from public.crm_suri_editions e
left join public.crm_deals d on d.edition_id = e.id
left join public.crm_pipeline_stages s on s.id = d.stage_id
left join lateral (
  select coalesce(sum(p.amount_cents), 0) as betaald_cents
  from public.crm_suri_payments p
  where p.deal_id = d.id
) b on true
group by e.id, e.name, e.starts_on, e.ends_on, e.status, e.capacity, e.price_cents;

comment on view public.crm_suri_edition_capacity is
  'Bezetting per reisperiode, altijd berekend uit de deals en de betalingen.';


-- -----------------------------------------------------------------------------
-- updated_at bijhouden
-- -----------------------------------------------------------------------------

drop trigger if exists set_crm_suri_editions_updated_at on public.crm_suri_editions;
create trigger set_crm_suri_editions_updated_at
  before update on public.crm_suri_editions
  for each row execute function public.set_updated_at();

drop trigger if exists set_crm_deals_updated_at on public.crm_deals;
create trigger set_crm_deals_updated_at
  before update on public.crm_deals
  for each row execute function public.set_updated_at();

drop trigger if exists set_crm_suri_profiles_updated_at on public.crm_suri_profiles;
create trigger set_crm_suri_profiles_updated_at
  before update on public.crm_suri_profiles
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- Rechten: dicht, en dicht blijven
-- -----------------------------------------------------------------------------
-- Zelfde regel als bij het fundament. Supabase deelt nieuwe tabellen in het
-- schema public standaard rechten uit aan anon en authenticated; die trekken
-- wij hier expliciet weer in.

alter table public.crm_suri_editions enable row level security;
alter table public.crm_deals         enable row level security;
alter table public.crm_deal_events   enable row level security;
alter table public.crm_suri_profiles enable row level security;
alter table public.crm_suri_payments enable row level security;

alter table public.crm_suri_editions force row level security;
alter table public.crm_deals         force row level security;
alter table public.crm_deal_events   force row level security;
alter table public.crm_suri_profiles force row level security;
alter table public.crm_suri_payments force row level security;

revoke all on public.crm_suri_editions from anon, authenticated;
revoke all on public.crm_deals         from anon, authenticated;
revoke all on public.crm_deal_events   from anon, authenticated;
revoke all on public.crm_suri_profiles from anon, authenticated;
revoke all on public.crm_suri_payments from anon, authenticated;
revoke all on public.crm_suri_edition_capacity from anon, authenticated;

grant select, insert, update, delete on public.crm_suri_editions to service_role;
grant select, insert, update, delete on public.crm_deals         to service_role;
grant select, insert, update, delete on public.crm_deal_events   to service_role;
grant select, insert, update, delete on public.crm_suri_profiles to service_role;
grant select, insert, update, delete on public.crm_suri_payments to service_role;
grant select on public.crm_suri_edition_capacity to service_role;

-- Opnieuw: geen enkele create policy voor authenticated.
