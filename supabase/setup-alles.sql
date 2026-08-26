-- =============================================================================
-- SkoolPartner - volledige database-installatie
-- =============================================================================
-- Dit bestand is samengesteld uit supabase/migrations. Niet met de hand
-- aanpassen: pas de migratie aan en draai `node scripts/build-setup-sql.mjs`.
-- Plak de volledige inhoud in Supabase > SQL Editor en klik op Run.
-- Opnieuw draaien is veilig.
-- =============================================================================

-- >>> 20260825120000_extensions_and_enums.sql

-- =============================================================================
-- SkoolPartner - 001 - Extensies, enums en generieke helpers
-- =============================================================================
-- Deze migratie legt het fundament: extensies, alle enum-types en een aantal
-- kleine helperfuncties die door latere migraties worden gebruikt.
-- =============================================================================

-- gen_random_uuid() zit sinds PostgreSQL 13 in de kern, dus er zijn hier geen
-- extra extensies nodig. E-mailadressen en domeinen worden case-insensitive
-- gemaakt met lower() plus een unieke index, in plaats van met citext.

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

do $$ begin
  create type public.organization_kind as enum ('school', 'bedrijf', 'vereniging', 'gemeente', 'overig');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.organization_status as enum ('active', 'blocked', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.membership_role as enum ('beheerder', 'lid');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.membership_status as enum ('pending', 'active', 'rejected', 'removed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.membership_source as enum ('invite', 'domain_match', 'self_request', 'admin_manual', 'import');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.booking_status as enum ('concept', 'confirmed', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.booking_origin as enum ('email_parser', 'admin_manual', 'import', 'hubspot');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.source_match_status as enum ('pending', 'matched', 'needs_review', 'rejected', 'ignored');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.invoice_state as enum ('draft', 'open', 'pending_payment', 'late', 'paid', 'partially_paid', 'uncollectible', 'reminded', 'unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.loyalty_transaction_type as enum (
    'earn_workshop',
    'earn_review',
    'manual_adjustment',
    'redemption_reserve',
    'expiry',
    'reversal'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.loyalty_transaction_status as enum (
    'pending',
    'available',
    'reserved',
    'redeemed',
    'expired',
    'reversed',
    'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.redemption_status as enum ('requested', 'approved', 'rejected', 'applied', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.integration_system as enum ('gmail', 'moneybird', 'hubspot', 'supabase');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.thread_visibility as enum ('needs_review', 'auto_allowed', 'manual_allowed', 'blocked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.message_direction as enum ('inbound', 'outbound');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.review_status as enum ('submitted', 'verified', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.webhook_status as enum ('received', 'processed', 'failed', 'ignored');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Generieke helper: updated_at bijhouden
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Publieke e-maildomeinen: mogen NOOIT gebruikt worden voor automatische
-- organisatieherkenning (zie masterprompt hoofdstuk 8).
-- -----------------------------------------------------------------------------

create table if not exists public.public_email_domains (
  domain text primary key
);

insert into public.public_email_domains (domain) values
  ('gmail.com'), ('googlemail.com'), ('outlook.com'), ('hotmail.com'), ('hotmail.nl'),
  ('live.nl'), ('live.com'), ('icloud.com'), ('me.com'), ('yahoo.com'), ('yahoo.nl'),
  ('ziggo.nl'), ('kpnmail.nl'), ('planet.nl'), ('home.nl'), ('telfort.nl'), ('casema.nl'),
  ('chello.nl'), ('xs4all.nl'), ('upcmail.nl'), ('protonmail.com'), ('proton.me'),
  ('msn.com'), ('aol.com'), ('gmx.com'), ('gmx.net'), ('mail.com'), ('zonnet.nl'),
  ('hetnet.nl'), ('quicknet.nl'), ('online.nl'), ('solcon.nl'), ('freedom.nl')
on conflict (domain) do nothing;

create or replace function public.email_domain(p_email text)
returns text
language sql
immutable
as $$
  select nullif(lower(split_part(trim(p_email), '@', 2)), '');
$$;

create or replace function public.is_public_email_domain(p_domain text)
returns boolean
language sql
stable
as $$
  select exists (select 1 from public.public_email_domains d where d.domain = lower(p_domain));
$$;

-- >>> 20260825120100_core_identity.sql

-- =============================================================================
-- SkoolPartner - 002 - Profielen, organisaties, lidmaatschappen, contacten
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles: 1-op-1 met auth.users
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  full_name     text,
  phone         text,
  job_title     text,
  is_admin      boolean not null default false,
  is_super_admin boolean not null default false,
  is_blocked    boolean not null default false,
  marketing_opt_in boolean not null default false,
  last_seen_at  timestamptz,
  deactivated_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists profiles_email_lower_key on public.profiles (lower(email));
create index if not exists profiles_is_admin_idx on public.profiles (is_admin) where is_admin = true;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Profiel automatisch aanmaken bij registratie.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'phone', '')), '')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name),
        phone = coalesce(public.profiles.phone, excluded.phone);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- organizations
-- -----------------------------------------------------------------------------
create table if not exists public.organizations (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  slug                    text not null,
  kind                    public.organization_kind not null default 'school',
  status                  public.organization_status not null default 'active',
  contact_email           text,
  phone                   text,
  website                 text,
  address_line            text,
  postal_code             text,
  city                    text,
  country                 text not null default 'NL',
  internal_notes          text,
  skoolpartner_enrolled_at timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint organizations_name_not_blank check (length(trim(name)) > 1)
);

create unique index if not exists organizations_slug_key on public.organizations (lower(slug));
create index if not exists organizations_name_trgm_idx on public.organizations (lower(name));

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- organization_domains: alleen als *mogelijke* match, nooit als automatische
-- koppeling op zichzelf. Publieke domeinen zijn hard geblokkeerd.
-- -----------------------------------------------------------------------------
create table if not exists public.organization_domains (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  domain          text not null,
  is_verified     boolean not null default false,
  verified_at     timestamptz,
  verified_by     uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

create unique index if not exists organization_domains_domain_key on public.organization_domains (lower(domain));
create index if not exists organization_domains_org_idx on public.organization_domains (organization_id);

create or replace function public.guard_organization_domain()
returns trigger
language plpgsql
as $$
begin
  new.domain := lower(trim(new.domain));
  if new.domain like '%@%' then
    raise exception 'Vul een domein in zonder @, bijvoorbeeld goudsewaarden.nl';
  end if;
  if position('.' in new.domain) = 0 then
    raise exception 'Ongeldig domein: %', new.domain;
  end if;
  if public.is_public_email_domain(new.domain) then
    raise exception 'Publiek e-maildomein % mag niet aan een organisatie worden gekoppeld', new.domain;
  end if;
  return new;
end;
$$;

drop trigger if exists organization_domains_guard on public.organization_domains;
create trigger organization_domains_guard before insert or update on public.organization_domains
  for each row execute function public.guard_organization_domain();

-- -----------------------------------------------------------------------------
-- organization_members
-- -----------------------------------------------------------------------------
create table if not exists public.organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  role            public.membership_role not null default 'lid',
  status          public.membership_status not null default 'pending',
  source          public.membership_source not null default 'self_request',
  invited_by      uuid references public.profiles (id) on delete set null,
  approved_by     uuid references public.profiles (id) on delete set null,
  approved_at     timestamptz,
  rejected_reason text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint organization_members_unique unique (organization_id, user_id)
);

create index if not exists organization_members_user_idx on public.organization_members (user_id, status);
create index if not exists organization_members_org_idx on public.organization_members (organization_id, status);

drop trigger if exists organization_members_set_updated_at on public.organization_members;
create trigger organization_members_set_updated_at before update on public.organization_members
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- organization_invites
-- -----------------------------------------------------------------------------
create table if not exists public.organization_invites (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email           text not null,
  role            public.membership_role not null default 'lid',
  token_hash      text not null,
  expires_at      timestamptz not null,
  accepted_at     timestamptz,
  accepted_by     uuid references public.profiles (id) on delete set null,
  revoked_at      timestamptz,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

create unique index if not exists organization_invites_token_key on public.organization_invites (token_hash);
create index if not exists organization_invites_email_idx on public.organization_invites (lower(email)) where accepted_at is null and revoked_at is null;
create index if not exists organization_invites_org_idx on public.organization_invites (organization_id);

-- -----------------------------------------------------------------------------
-- organization_contacts: geverifieerde e-mailadressen per organisatie.
-- Dit is de allowlist die bepaalt welke Gmail-threads zichtbaar mogen zijn.
-- -----------------------------------------------------------------------------
create table if not exists public.organization_contacts (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  email                text not null,
  full_name            text,
  user_id              uuid references public.profiles (id) on delete set null,
  is_verified          boolean not null default false,
  verified_at          timestamptz,
  verified_by          uuid references public.profiles (id) on delete set null,
  hubspot_contact_id   text,
  moneybird_contact_id text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists organization_contacts_unique on public.organization_contacts (organization_id, lower(email));
create index if not exists organization_contacts_email_idx on public.organization_contacts (lower(email)) where is_verified = true;

drop trigger if exists organization_contacts_set_updated_at on public.organization_contacts;
create trigger organization_contacts_set_updated_at before update on public.organization_contacts
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Autorisatie-helpers (security definer zodat RLS-policies niet recursief worden)
-- -----------------------------------------------------------------------------

create or replace function public.is_admin(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_admin and not p.is_blocked from public.profiles p where p.id = p_user),
    false
  );
$$;

create or replace function public.is_super_admin(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_super_admin and not p.is_blocked from public.profiles p where p.id = p_user),
    false
  );
$$;

-- Alle organisaties waar de gebruiker een ACTIEF lidmaatschap heeft.
create or replace function public.user_organization_ids(p_user uuid default auth.uid())
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.organization_id
  from public.organization_members m
  join public.profiles p on p.id = m.user_id
  where m.user_id = p_user
    and m.status = 'active'
    and p.is_blocked = false;
$$;

create or replace function public.has_organization_access(p_org uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_org is not null and exists (
    select 1 from public.user_organization_ids(p_user) o where o = p_org
  );
$$;

create or replace function public.is_organization_beheerder(p_org uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_org
      and m.user_id = p_user
      and m.status = 'active'
      and m.role = 'beheerder'
  );
$$;

revoke all on function public.is_admin(uuid) from public;
revoke all on function public.is_super_admin(uuid) from public;
revoke all on function public.user_organization_ids(uuid) from public;
revoke all on function public.has_organization_access(uuid, uuid) from public;
revoke all on function public.is_organization_beheerder(uuid, uuid) from public;

grant execute on function public.is_admin(uuid) to authenticated, service_role;
grant execute on function public.is_super_admin(uuid) to authenticated, service_role;
grant execute on function public.user_organization_ids(uuid) to authenticated, service_role;
grant execute on function public.has_organization_access(uuid, uuid) to authenticated, service_role;
grant execute on function public.is_organization_beheerder(uuid, uuid) to authenticated, service_role;

-- >>> 20260825120200_bookings.sql

-- =============================================================================
-- SkoolPartner - 003 - Boekingen, boekingsbronnen en reviews
-- =============================================================================

-- -----------------------------------------------------------------------------
-- booking_sources: onbewerkte herkomst van een boeking (nu: Gmail-bevestiging).
-- Dit is het idempotency-anker: een Gmail message ID kan maar één keer bestaan.
-- -----------------------------------------------------------------------------
create table if not exists public.booking_sources (
  id                    uuid primary key default gen_random_uuid(),
  channel               public.integration_system not null default 'gmail',
  external_message_id   text not null,
  external_thread_id    text,
  from_email            text,
  from_name             text,
  to_emails             text[] not null default '{}',
  cc_emails             text[] not null default '{}',
  subject               text,
  received_at           timestamptz,
  snippet               text,
  body_text             text,
  parser_version        text not null default 'v1',
  parsed                jsonb not null default '{}'::jsonb,
  confidence            numeric(4,3) not null default 0,
  match_status          public.source_match_status not null default 'pending',
  review_reasons        text[] not null default '{}',
  suggested_organization_id uuid references public.organizations (id) on delete set null,
  booking_id            uuid,
  processed_at          timestamptz,
  reviewed_by           uuid references public.profiles (id) on delete set null,
  reviewed_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint booking_sources_confidence_range check (confidence >= 0 and confidence <= 1)
);

-- Idempotency: dezelfde bevestigingsmail kan nooit twee keer worden verwerkt.
create unique index if not exists booking_sources_external_key
  on public.booking_sources (channel, external_message_id);
create index if not exists booking_sources_status_idx on public.booking_sources (match_status, received_at desc);
create index if not exists booking_sources_thread_idx on public.booking_sources (external_thread_id);

drop trigger if exists booking_sources_set_updated_at on public.booking_sources;
create trigger booking_sources_set_updated_at before update on public.booking_sources
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- bookings
-- -----------------------------------------------------------------------------
create table if not exists public.bookings (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations (id) on delete restrict,
  reference               text,
  workshop_name           text not null,
  workshop_count          integer not null default 1,
  minutes_per_workshop    integer not null default 90,
  qualifying_minutes      integer not null default 0,
  scheduled_date          date,
  start_time              time,
  end_time                time,
  location                text,
  participants            integer,
  status                  public.booking_status not null default 'confirmed',
  origin                  public.booking_origin not null default 'email_parser',
  booking_source_id       uuid references public.booking_sources (id) on delete set null,
  contact_email           text,
  contact_name            text,
  hubspot_deal_id         text,
  notes                   text,
  needs_review            boolean not null default false,
  review_reasons          text[] not null default '{}',
  approved_by             uuid references public.profiles (id) on delete set null,
  approved_at             timestamptz,
  points_awarded          boolean not null default false,
  imported_from           text,
  created_by              uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint bookings_workshop_count_positive check (workshop_count > 0),
  constraint bookings_minutes_positive check (minutes_per_workshop > 0),
  constraint bookings_qualifying_minutes_nonneg check (qualifying_minutes >= 0)
);

create index if not exists bookings_org_date_idx on public.bookings (organization_id, scheduled_date desc);
create index if not exists bookings_status_idx on public.bookings (status);
create index if not exists bookings_needs_review_idx on public.bookings (needs_review) where needs_review = true;
create unique index if not exists bookings_reference_key on public.bookings (lower(reference)) where reference is not null;
create unique index if not exists bookings_source_key on public.bookings (booking_source_id) where booking_source_id is not null;

drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at before update on public.bookings
  for each row execute function public.set_updated_at();

alter table public.booking_sources
  drop constraint if exists booking_sources_booking_id_fkey;
alter table public.booking_sources
  add constraint booking_sources_booking_id_fkey
  foreign key (booking_id) references public.bookings (id) on delete set null;

-- -----------------------------------------------------------------------------
-- reviews: bron voor de reviewbonus. Maximaal één bonus per boeking.
-- -----------------------------------------------------------------------------
create table if not exists public.reviews (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  booking_id         uuid references public.bookings (id) on delete set null,
  submitted_by       uuid references public.profiles (id) on delete set null,
  platform           text not null default 'google',
  external_review_id text,
  review_url         text,
  rating             integer,
  body               text,
  status             public.review_status not null default 'submitted',
  verified_at        timestamptz,
  verified_by        uuid references public.profiles (id) on delete set null,
  rejected_reason    text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint reviews_rating_range check (rating is null or (rating between 1 and 5))
);

-- Eén geverifieerde review per boeking -> voorkomt herhaald bonuspunten verdienen.
create unique index if not exists reviews_booking_verified_key
  on public.reviews (booking_id) where booking_id is not null and status = 'verified';
create unique index if not exists reviews_external_key
  on public.reviews (platform, external_review_id) where external_review_id is not null;
create index if not exists reviews_org_idx on public.reviews (organization_id, created_at desc);

drop trigger if exists reviews_set_updated_at on public.reviews;
create trigger reviews_set_updated_at before update on public.reviews
  for each row execute function public.set_updated_at();

-- >>> 20260825120300_invoices.sql

-- =============================================================================
-- SkoolPartner - 004 - Facturen (Moneybird is de primaire financiële bron)
-- =============================================================================

create table if not exists public.invoices (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid references public.organizations (id) on delete set null,
  moneybird_invoice_id  text not null,
  moneybird_contact_id  text,
  invoice_number        text,
  reference             text,
  invoice_date          date,
  due_date              date,
  state                 public.invoice_state not null default 'unknown',
  currency              text not null default 'EUR',
  total_excl_cents      integer not null default 0,
  total_incl_cents      integer not null default 0,
  total_paid_cents      integer not null default 0,
  total_unpaid_cents    integer not null default 0,
  paid_at               timestamptz,
  fully_paid            boolean not null default false,
  public_view_expires_at timestamptz,
  needs_review          boolean not null default false,
  review_reasons        text[] not null default '{}',
  raw                   jsonb not null default '{}'::jsonb,
  synced_at             timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Idempotency: één rij per Moneybird-factuur.
create unique index if not exists invoices_moneybird_key on public.invoices (moneybird_invoice_id);
create index if not exists invoices_org_idx on public.invoices (organization_id, invoice_date desc);
create index if not exists invoices_state_idx on public.invoices (state);
create index if not exists invoices_needs_review_idx on public.invoices (needs_review) where needs_review = true;

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- invoice_lines: alleen als AANVULLENDE controle op de workshopinformatie.
-- Workshopuren worden nooit uitsluitend uit het factuurtotaal afgeleid.
-- -----------------------------------------------------------------------------
create table if not exists public.invoice_lines (
  id                 uuid primary key default gen_random_uuid(),
  invoice_id         uuid not null references public.invoices (id) on delete cascade,
  moneybird_line_id  text,
  position           integer not null default 0,
  description        text,
  amount             numeric(12,3),
  price_cents        integer,
  total_cents        integer,
  is_workshop_line   boolean not null default false,
  created_at         timestamptz not null default now()
);

create unique index if not exists invoice_lines_external_key
  on public.invoice_lines (invoice_id, moneybird_line_id) where moneybird_line_id is not null;
create index if not exists invoice_lines_invoice_idx on public.invoice_lines (invoice_id, position);

-- -----------------------------------------------------------------------------
-- booking_invoices: koppeling boeking <-> factuur (n-op-n)
-- -----------------------------------------------------------------------------
create table if not exists public.booking_invoices (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.bookings (id) on delete cascade,
  invoice_id    uuid not null references public.invoices (id) on delete cascade,
  link_method   text not null default 'automatic',
  confidence    numeric(4,3) not null default 0,
  linked_by     uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint booking_invoices_unique unique (booking_id, invoice_id),
  constraint booking_invoices_confidence_range check (confidence >= 0 and confidence <= 1)
);

create index if not exists booking_invoices_invoice_idx on public.booking_invoices (invoice_id);

-- -----------------------------------------------------------------------------
-- external_record_mappings: generieke koppeltabel naar externe systemen.
-- Nooit alleen bedrijfsnaam gebruiken als unieke koppeling.
-- -----------------------------------------------------------------------------
create table if not exists public.external_record_mappings (
  id             uuid primary key default gen_random_uuid(),
  system         public.integration_system not null,
  entity_type    text not null,
  internal_table text not null,
  internal_id    uuid not null,
  external_id    text not null,
  external_label text,
  confidence     numeric(4,3) not null default 1,
  extra          jsonb not null default '{}'::jsonb,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists external_record_mappings_external_key
  on public.external_record_mappings (system, entity_type, external_id);
create index if not exists external_record_mappings_internal_idx
  on public.external_record_mappings (internal_table, internal_id);

drop trigger if exists external_record_mappings_set_updated_at on public.external_record_mappings;
create trigger external_record_mappings_set_updated_at before update on public.external_record_mappings
  for each row execute function public.set_updated_at();

-- >>> 20260825120400_loyalty.sql

-- =============================================================================
-- SkoolPartner - 005 - SkoolPartner: loyalty accounts, ledger en redemptions
-- =============================================================================
-- Uitgangspunt: het saldo wordt NOOIT als los getal bijgehouden maar altijd
-- berekend vanuit de transactieregels (ledger). Elke regel heeft een teken
-- (+/-) en een status. De statussen bepalen hoe een regel meetelt:
--
--   pending   -> nog niet beschikbaar (wacht op betaling van de factuur)
--   available -> telt mee in het beschikbare saldo
--   reserved  -> negatieve regel die punten vasthoudt voor een lopend verzoek
--   redeemed  -> gereserveerde regel die daadwerkelijk is ingewisseld
--   expired   -> negatieve regel voor verlopen punten
--   reversed  -> teruggedraaid, telt nergens in mee
--   cancelled -> geannuleerd, telt nergens in mee
--
-- Beschikbaar saldo = som(points) over available + reserved + redeemed + expired
-- =============================================================================

create table if not exists public.loyalty_accounts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  enrolled_at     timestamptz not null default now(),
  enrolled_by     uuid references public.profiles (id) on delete set null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint loyalty_accounts_org_unique unique (organization_id)
);

drop trigger if exists loyalty_accounts_set_updated_at on public.loyalty_accounts;
create trigger loyalty_accounts_set_updated_at before update on public.loyalty_accounts
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- loyalty_transactions
-- -----------------------------------------------------------------------------
create table if not exists public.loyalty_transactions (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations (id) on delete cascade,
  account_id               uuid not null references public.loyalty_accounts (id) on delete cascade,
  type                     public.loyalty_transaction_type not null,
  status                   public.loyalty_transaction_status not null,
  points                   integer not null,
  -- Waarde van 100 punten in eurocenten op het moment van de transactie.
  -- Hierdoor blijft historie betrouwbaar als de instelling later wijzigt.
  point_value_cents_per_100 integer not null default 250,
  points_per_hour_at_time  integer,
  qualifying_minutes       integer,
  description              text not null,
  source                   text not null default 'system',
  external_reference       text,
  booking_id               uuid references public.bookings (id) on delete set null,
  invoice_id               uuid references public.invoices (id) on delete set null,
  review_id                uuid references public.reviews (id) on delete set null,
  redemption_id            uuid,
  reverses_transaction_id  uuid references public.loyalty_transactions (id) on delete set null,
  expires_at               timestamptz,
  available_at             timestamptz,
  created_by               uuid references public.profiles (id) on delete set null,
  reason                   text,
  occurred_at              timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint loyalty_transactions_points_not_zero check (points <> 0),
  constraint loyalty_transactions_value_positive check (point_value_cents_per_100 > 0),
  constraint loyalty_transactions_manual_needs_reason
    check (type <> 'manual_adjustment' or (reason is not null and length(trim(reason)) > 2)),
  constraint loyalty_transactions_sign_matches_type check (
    case
      when type in ('earn_workshop', 'earn_review') then points > 0
      when type in ('redemption_reserve', 'expiry') then points < 0
      else true
    end
  )
);

-- Idempotency: dezelfde bron kan nooit twee keer punten opleveren.
create unique index if not exists loyalty_transactions_external_key
  on public.loyalty_transactions (organization_id, type, external_reference)
  where external_reference is not null;

-- Per boeking maximaal één actieve workshop-earn.
create unique index if not exists loyalty_transactions_booking_earn_key
  on public.loyalty_transactions (booking_id)
  where type = 'earn_workshop' and status <> 'reversed' and status <> 'cancelled';

-- Per review maximaal één actieve bonus.
create unique index if not exists loyalty_transactions_review_earn_key
  on public.loyalty_transactions (review_id)
  where review_id is not null and type = 'earn_review' and status <> 'reversed' and status <> 'cancelled';

create index if not exists loyalty_transactions_org_idx
  on public.loyalty_transactions (organization_id, occurred_at desc);
create index if not exists loyalty_transactions_status_idx
  on public.loyalty_transactions (organization_id, status);
create index if not exists loyalty_transactions_expiry_idx
  on public.loyalty_transactions (expires_at) where status = 'available';

drop trigger if exists loyalty_transactions_set_updated_at on public.loyalty_transactions;
create trigger loyalty_transactions_set_updated_at before update on public.loyalty_transactions
  for each row execute function public.set_updated_at();

-- Append-only logboek van statuswijzigingen op een transactie.
create table if not exists public.loyalty_transaction_events (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.loyalty_transactions (id) on delete cascade,
  from_status    public.loyalty_transaction_status,
  to_status      public.loyalty_transaction_status not null,
  reason         text,
  actor_id       uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists loyalty_transaction_events_tx_idx
  on public.loyalty_transaction_events (transaction_id, created_at);

create or replace function public.log_loyalty_status_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.loyalty_transaction_events (transaction_id, from_status, to_status, reason, actor_id)
    values (new.id, null, new.status, 'aangemaakt', new.created_by);
  elsif new.status is distinct from old.status then
    insert into public.loyalty_transaction_events (transaction_id, from_status, to_status, reason, actor_id)
    values (new.id, old.status, new.status, new.reason, new.created_by);
  end if;
  return new;
end;
$$;

drop trigger if exists loyalty_transactions_log_status on public.loyalty_transactions;
create trigger loyalty_transactions_log_status
  after insert or update of status on public.loyalty_transactions
  for each row execute function public.log_loyalty_status_change();

-- -----------------------------------------------------------------------------
-- redemption_requests
-- -----------------------------------------------------------------------------
create table if not exists public.redemption_requests (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations (id) on delete cascade,
  requested_by             uuid references public.profiles (id) on delete set null,
  points                   integer not null,
  value_cents              integer not null,
  point_value_cents_per_100 integer not null default 250,
  booking_reference        text,
  note                     text,
  status                   public.redemption_status not null default 'requested',
  reserve_transaction_id   uuid references public.loyalty_transactions (id) on delete set null,
  decided_by               uuid references public.profiles (id) on delete set null,
  decided_at               timestamptz,
  decision_note            text,
  applied_at               timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint redemption_requests_points_positive check (points > 0),
  constraint redemption_requests_value_nonneg check (value_cents >= 0)
);

create index if not exists redemption_requests_org_idx
  on public.redemption_requests (organization_id, created_at desc);
create index if not exists redemption_requests_status_idx
  on public.redemption_requests (status) where status in ('requested', 'approved');

drop trigger if exists redemption_requests_set_updated_at on public.redemption_requests;
create trigger redemption_requests_set_updated_at before update on public.redemption_requests
  for each row execute function public.set_updated_at();

alter table public.loyalty_transactions
  drop constraint if exists loyalty_transactions_redemption_id_fkey;
alter table public.loyalty_transactions
  add constraint loyalty_transactions_redemption_id_fkey
  foreign key (redemption_id) references public.redemption_requests (id) on delete set null;

-- -----------------------------------------------------------------------------
-- Saldoberekening
-- -----------------------------------------------------------------------------
create or replace view public.loyalty_balances
with (security_invoker = true)
as
select
  a.organization_id,
  a.id as account_id,
  a.enrolled_at,
  a.is_active,
  coalesce(sum(t.points) filter (
    where t.status in ('available', 'reserved', 'redeemed', 'expired')
  ), 0)::integer as available_points,
  coalesce(sum(t.points) filter (where t.status = 'pending'), 0)::integer as pending_points,
  coalesce(-sum(t.points) filter (where t.status = 'reserved'), 0)::integer as reserved_points,
  coalesce(-sum(t.points) filter (where t.status = 'redeemed'), 0)::integer as redeemed_points,
  coalesce(-sum(t.points) filter (where t.status = 'expired'), 0)::integer as expired_points,
  coalesce(sum(t.points) filter (
    where t.points > 0 and t.status in ('available', 'reserved', 'redeemed', 'expired')
  ), 0)::integer as lifetime_earned_points,
  max(t.occurred_at) filter (where t.points > 0) as last_earned_at
from public.loyalty_accounts a
left join public.loyalty_transactions t
  on t.account_id = a.id
 and t.status not in ('reversed', 'cancelled')
group by a.organization_id, a.id, a.enrolled_at, a.is_active;

comment on view public.loyalty_balances is
  'Berekent het SkoolPoints-saldo uitsluitend vanuit de ledger. Nooit cachen in een losse kolom.';

-- >>> 20260825120500_messaging.sql

-- =============================================================================
-- SkoolPartner - 006 - Berichtencentrum (Gmail, boekingen@skoolworkshop.nl)
-- =============================================================================
-- Privacy is hier kritiek. Een klant mag NOOIT vrij in Gmail kunnen zoeken.
-- Zichtbaarheid werkt via een expliciete allowlist:
--   organisatie -> geverifieerde contactpersonen -> toegestane threads
-- Threads zonder expliciete toestemming staan op 'needs_review' of 'blocked'
-- en zijn voor klanten onzichtbaar.
-- =============================================================================

create table if not exists public.message_threads (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid references public.organizations (id) on delete set null,
  gmail_thread_id     text not null,
  subject             text,
  participant_emails  text[] not null default '{}',
  visibility          public.thread_visibility not null default 'needs_review',
  visibility_reason   text,
  matched_contact_id  uuid references public.organization_contacts (id) on delete set null,
  allowlisted_by      uuid references public.profiles (id) on delete set null,
  allowlisted_at      timestamptz,
  last_message_at     timestamptz,
  message_count       integer not null default 0,
  booking_id          uuid references public.bookings (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists message_threads_gmail_key on public.message_threads (gmail_thread_id);
create index if not exists message_threads_org_idx on public.message_threads (organization_id, last_message_at desc);
create index if not exists message_threads_visibility_idx on public.message_threads (visibility);

drop trigger if exists message_threads_set_updated_at on public.message_threads;
create trigger message_threads_set_updated_at before update on public.message_threads
  for each row execute function public.set_updated_at();

create table if not exists public.messages (
  id                uuid primary key default gen_random_uuid(),
  thread_id         uuid not null references public.message_threads (id) on delete cascade,
  gmail_message_id  text not null,
  direction         public.message_direction not null,
  from_email        text,
  from_name         text,
  to_emails         text[] not null default '{}',
  cc_emails         text[] not null default '{}',
  subject           text,
  sent_at           timestamptz not null default now(),
  snippet           text,
  body_text         text,
  body_html         text,
  has_attachments   boolean not null default false,
  attachment_meta   jsonb not null default '[]'::jsonb,
  sent_from_portal  boolean not null default false,
  sent_by           uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now()
);

-- Idempotency: dezelfde Gmail-message wordt nooit dubbel opgeslagen.
create unique index if not exists messages_gmail_key on public.messages (gmail_message_id);
create index if not exists messages_thread_idx on public.messages (thread_id, sent_at);

-- Uitgaande berichten die vanuit SkoolPartner zijn geschreven maar nog niet
-- door Gmail bevestigd zijn (retry / offline afhandeling).
create table if not exists public.outbound_messages (
  id               uuid primary key default gen_random_uuid(),
  thread_id        uuid not null references public.message_threads (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  author_id        uuid references public.profiles (id) on delete set null,
  body_text        text not null,
  in_reply_to      text,
  status           text not null default 'queued',
  attempts         integer not null default 0,
  last_error       text,
  gmail_message_id text,
  idempotency_key  text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists outbound_messages_idempotency_key
  on public.outbound_messages (idempotency_key);
create index if not exists outbound_messages_status_idx on public.outbound_messages (status, created_at);

drop trigger if exists outbound_messages_set_updated_at on public.outbound_messages;
create trigger outbound_messages_set_updated_at before update on public.outbound_messages
  for each row execute function public.set_updated_at();

-- Threadteller onderhouden.
create or replace function public.refresh_thread_stats()
returns trigger
language plpgsql
as $$
declare
  v_thread uuid := coalesce(new.thread_id, old.thread_id);
begin
  update public.message_threads t
  set message_count = (select count(*) from public.messages m where m.thread_id = v_thread),
      last_message_at = (select max(m.sent_at) from public.messages m where m.thread_id = v_thread)
  where t.id = v_thread;
  return null;
end;
$$;

drop trigger if exists messages_refresh_thread_stats on public.messages;
create trigger messages_refresh_thread_stats
  after insert or delete on public.messages
  for each row execute function public.refresh_thread_stats();

-- >>> 20260825120600_integrations_settings_audit.sql

-- =============================================================================
-- SkoolPartner - 007 - Integratiestatus, credentials, instellingen, audit, webhooks
-- =============================================================================

-- -----------------------------------------------------------------------------
-- integration_sync_state
-- -----------------------------------------------------------------------------
create table if not exists public.integration_sync_state (
  id               uuid primary key default gen_random_uuid(),
  integration      public.integration_system not null,
  key              text not null default 'default',
  status           text not null default 'idle',
  cursor           text,
  last_run_at      timestamptz,
  last_success_at  timestamptz,
  last_error_at    timestamptz,
  last_error       text,
  retry_count      integer not null default 0,
  items_processed  integer not null default 0,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint integration_sync_state_unique unique (integration, key)
);

drop trigger if exists integration_sync_state_set_updated_at on public.integration_sync_state;
create trigger integration_sync_state_set_updated_at before update on public.integration_sync_state
  for each row execute function public.set_updated_at();

insert into public.integration_sync_state (integration, key) values
  ('gmail', 'default'),
  ('moneybird', 'default'),
  ('hubspot', 'default')
on conflict (integration, key) do nothing;

-- -----------------------------------------------------------------------------
-- integration_credentials: versleutelde tokens (o.a. Gmail refresh token).
-- Deze tabel is uitsluitend benaderbaar met de service role. Geen RLS-policy
-- betekent hier: niemand met een gebruikers-JWT komt erbij.
-- -----------------------------------------------------------------------------
create table if not exists public.integration_credentials (
  id                 uuid primary key default gen_random_uuid(),
  integration        public.integration_system not null,
  label              text not null default 'default',
  account_email      text,
  encrypted_payload  text not null,
  scopes             text[] not null default '{}',
  expires_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint integration_credentials_unique unique (integration, label)
);

drop trigger if exists integration_credentials_set_updated_at on public.integration_credentials;
create trigger integration_credentials_set_updated_at before update on public.integration_credentials
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- app_settings: alle bedrijfsregels aanpasbaar zonder programmeerwerk.
-- -----------------------------------------------------------------------------
create table if not exists public.app_settings (
  key          text primary key,
  value        jsonb not null,
  label        text not null,
  description  text,
  group_name   text not null default 'algemeen',
  value_type   text not null default 'number',
  is_public    boolean not null default false,
  sort_order   integer not null default 0,
  updated_by   uuid references public.profiles (id) on delete set null,
  updated_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- audit_logs
-- -----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  actor_id        uuid references public.profiles (id) on delete set null,
  actor_email     text,
  actor_role      text not null default 'admin',
  action          text not null,
  entity_type     text not null,
  entity_id       text,
  organization_id uuid references public.organizations (id) on delete set null,
  before_state    jsonb,
  after_state     jsonb,
  reason          text,
  ip_address      text,
  user_agent      text,
  created_at      timestamptz not null default now()
);

create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);
create index if not exists audit_logs_org_idx on public.audit_logs (organization_id, created_at desc);

-- -----------------------------------------------------------------------------
-- webhook_events: idempotency voor binnenkomende webhooks
-- -----------------------------------------------------------------------------
create table if not exists public.webhook_events (
  id                uuid primary key default gen_random_uuid(),
  provider          public.integration_system not null,
  external_event_id text not null,
  event_type        text,
  payload           jsonb not null default '{}'::jsonb,
  status            public.webhook_status not null default 'received',
  error             text,
  attempts          integer not null default 0,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz
);

create unique index if not exists webhook_events_external_key
  on public.webhook_events (provider, external_event_id);
create index if not exists webhook_events_status_idx on public.webhook_events (status, received_at);

-- >>> 20260825120700_rls_policies.sql

-- =============================================================================
-- SkoolPartner - 008 - Row Level Security
-- =============================================================================
-- Uitgangspunten:
--  * RLS staat op ALLE tabellen aan. Uitzetten is nooit de oplossing.
--  * Een gewone gebruiker ziet uitsluitend data van organisaties waar hij een
--    ACTIEF lidmaatschap heeft.
--  * Schrijfacties lopen via server-side code (service role) met expliciete
--    autorisatiecontrole. De paar klantacties die wel direct mogen, staan
--    hieronder expliciet.
--  * Rauwe bronmail, credentials, audit en sync-state zijn admin-only.
-- =============================================================================

-- Standaardrechten dichtzetten: alles expliciet toekennen.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon;

grant usage on schema public to anon, authenticated;

-- -----------------------------------------------------------------------------
-- RLS inschakelen
-- -----------------------------------------------------------------------------
alter table public.profiles                   enable row level security;
alter table public.organizations              enable row level security;
alter table public.organization_domains       enable row level security;
alter table public.organization_members       enable row level security;
alter table public.organization_invites       enable row level security;
alter table public.organization_contacts      enable row level security;
alter table public.public_email_domains       enable row level security;
alter table public.bookings                   enable row level security;
alter table public.booking_sources            enable row level security;
alter table public.reviews                    enable row level security;
alter table public.invoices                   enable row level security;
alter table public.invoice_lines              enable row level security;
alter table public.booking_invoices           enable row level security;
alter table public.external_record_mappings   enable row level security;
alter table public.loyalty_accounts           enable row level security;
alter table public.loyalty_transactions       enable row level security;
alter table public.loyalty_transaction_events enable row level security;
alter table public.redemption_requests        enable row level security;
alter table public.message_threads            enable row level security;
alter table public.messages                   enable row level security;
alter table public.outbound_messages          enable row level security;
alter table public.integration_sync_state     enable row level security;
alter table public.integration_credentials    enable row level security;
alter table public.app_settings               enable row level security;
alter table public.audit_logs                 enable row level security;
alter table public.webhook_events             enable row level security;

-- Forceer RLS ook voor tabel-eigenaren (service_role blijft bypassen).
alter table public.integration_credentials force row level security;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

grant select, update on public.profiles to authenticated;

-- Voorkom rechtenescalatie: alleen een super admin mag adminvlaggen zetten.
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Zonder ingelogde gebruiker is dit geen klantactie maar een beheeractie:
  -- de service role, een migratie of de SQL Editor. Die mogen rechten zetten.
  -- Een klant heeft altijd een auth.uid(), dus die valt hier nooit onder.
  if auth.uid() is null or current_setting('role', true) = 'service_role' then
    return new;
  end if;
  if (new.is_admin is distinct from old.is_admin
      or new.is_super_admin is distinct from old.is_super_admin
      or new.is_blocked is distinct from old.is_blocked)
     and not public.is_super_admin(auth.uid()) then
    raise exception 'Onvoldoende rechten om accountrechten te wijzigen';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileges on public.profiles;
create trigger profiles_guard_privileges before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- -----------------------------------------------------------------------------
-- organizations en organisatiestructuur
-- -----------------------------------------------------------------------------
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated
  using (public.has_organization_access(id) or public.is_admin());
grant select on public.organizations to authenticated;

drop policy if exists organization_domains_select on public.organization_domains;
create policy organization_domains_select on public.organization_domains
  for select to authenticated
  using (public.has_organization_access(organization_id) or public.is_admin());
grant select on public.organization_domains to authenticated;

drop policy if exists organization_members_select on public.organization_members;
create policy organization_members_select on public.organization_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_organization_access(organization_id)
    or public.is_admin()
  );
grant select on public.organization_members to authenticated;

drop policy if exists organization_invites_select on public.organization_invites;
create policy organization_invites_select on public.organization_invites
  for select to authenticated
  using (
    public.is_admin()
    or public.is_organization_beheerder(organization_id)
  );
grant select on public.organization_invites to authenticated;

drop policy if exists organization_contacts_select on public.organization_contacts;
create policy organization_contacts_select on public.organization_contacts
  for select to authenticated
  using (public.has_organization_access(organization_id) or public.is_admin());
grant select on public.organization_contacts to authenticated;

drop policy if exists public_email_domains_select on public.public_email_domains;
create policy public_email_domains_select on public.public_email_domains
  for select to authenticated using (true);
grant select on public.public_email_domains to authenticated;

-- -----------------------------------------------------------------------------
-- Boekingen
-- -----------------------------------------------------------------------------
drop policy if exists bookings_select on public.bookings;
create policy bookings_select on public.bookings
  for select to authenticated
  using (public.has_organization_access(organization_id) or public.is_admin());
grant select on public.bookings to authenticated;

-- booking_sources bevat rauwe e-mailinhoud: uitsluitend admin.
drop policy if exists booking_sources_select on public.booking_sources;
create policy booking_sources_select on public.booking_sources
  for select to authenticated
  using (public.is_admin());
grant select on public.booking_sources to authenticated;

drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews
  for select to authenticated
  using (public.has_organization_access(organization_id) or public.is_admin());

drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews
  for insert to authenticated
  with check (
    public.has_organization_access(organization_id)
    and submitted_by = auth.uid()
    and status = 'submitted'
  );
grant select, insert on public.reviews to authenticated;

-- -----------------------------------------------------------------------------
-- Facturen
-- -----------------------------------------------------------------------------
drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select to authenticated
  using (public.has_organization_access(organization_id) or public.is_admin());
grant select on public.invoices to authenticated;

drop policy if exists invoice_lines_select on public.invoice_lines;
create policy invoice_lines_select on public.invoice_lines
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.invoices i
      where i.id = invoice_lines.invoice_id
        and public.has_organization_access(i.organization_id)
    )
  );
grant select on public.invoice_lines to authenticated;

drop policy if exists booking_invoices_select on public.booking_invoices;
create policy booking_invoices_select on public.booking_invoices
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id = booking_invoices.booking_id
        and public.has_organization_access(b.organization_id)
    )
  );
grant select on public.booking_invoices to authenticated;

drop policy if exists external_record_mappings_select on public.external_record_mappings;
create policy external_record_mappings_select on public.external_record_mappings
  for select to authenticated
  using (public.is_admin());
grant select on public.external_record_mappings to authenticated;

-- -----------------------------------------------------------------------------
-- SkoolPartner
-- -----------------------------------------------------------------------------
drop policy if exists loyalty_accounts_select on public.loyalty_accounts;
create policy loyalty_accounts_select on public.loyalty_accounts
  for select to authenticated
  using (public.has_organization_access(organization_id) or public.is_admin());
grant select on public.loyalty_accounts to authenticated;

drop policy if exists loyalty_transactions_select on public.loyalty_transactions;
create policy loyalty_transactions_select on public.loyalty_transactions
  for select to authenticated
  using (public.has_organization_access(organization_id) or public.is_admin());
grant select on public.loyalty_transactions to authenticated;

drop policy if exists loyalty_transaction_events_select on public.loyalty_transaction_events;
create policy loyalty_transaction_events_select on public.loyalty_transaction_events
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.loyalty_transactions t
      where t.id = loyalty_transaction_events.transaction_id
        and public.has_organization_access(t.organization_id)
    )
  );
grant select on public.loyalty_transaction_events to authenticated;

grant select on public.loyalty_balances to authenticated;

drop policy if exists redemption_requests_select on public.redemption_requests;
create policy redemption_requests_select on public.redemption_requests
  for select to authenticated
  using (public.has_organization_access(organization_id) or public.is_admin());

drop policy if exists redemption_requests_insert on public.redemption_requests;
create policy redemption_requests_insert on public.redemption_requests
  for insert to authenticated
  with check (
    public.has_organization_access(organization_id)
    and requested_by = auth.uid()
    and status = 'requested'
  );
grant select, insert on public.redemption_requests to authenticated;

-- -----------------------------------------------------------------------------
-- Berichten: dubbele beveiliging (organisatie EN expliciete allowlist)
-- -----------------------------------------------------------------------------
drop policy if exists message_threads_select on public.message_threads;
create policy message_threads_select on public.message_threads
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.has_organization_access(organization_id)
      and visibility in ('auto_allowed', 'manual_allowed')
    )
  );
grant select on public.message_threads to authenticated;

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.message_threads t
      where t.id = messages.thread_id
        and t.visibility in ('auto_allowed', 'manual_allowed')
        and public.has_organization_access(t.organization_id)
    )
  );
grant select on public.messages to authenticated;

drop policy if exists outbound_messages_select on public.outbound_messages;
create policy outbound_messages_select on public.outbound_messages
  for select to authenticated
  using (public.has_organization_access(organization_id) or public.is_admin());
grant select on public.outbound_messages to authenticated;

-- -----------------------------------------------------------------------------
-- Instellingen: alleen publieke sleutels zijn leesbaar voor klanten
-- -----------------------------------------------------------------------------
drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings
  for select to authenticated
  using (is_public or public.is_admin());
grant select on public.app_settings to authenticated;

-- -----------------------------------------------------------------------------
-- Admin-only tabellen
-- -----------------------------------------------------------------------------
drop policy if exists integration_sync_state_select on public.integration_sync_state;
create policy integration_sync_state_select on public.integration_sync_state
  for select to authenticated using (public.is_admin());
grant select on public.integration_sync_state to authenticated;

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated using (public.is_admin());
grant select on public.audit_logs to authenticated;

drop policy if exists webhook_events_select on public.webhook_events;
create policy webhook_events_select on public.webhook_events
  for select to authenticated using (public.is_admin());
grant select on public.webhook_events to authenticated;

-- integration_credentials krijgt met opzet GEEN policy en GEEN grant:
-- alleen de service role (die RLS bypast) komt erbij.

-- >>> 20260825120800_loyalty_functions.sql

-- =============================================================================
-- SkoolPartner - 009 - Loyalty-functies (atomair, met vergrendeling)
-- =============================================================================
-- Alle mutaties op punten lopen via deze functies zodat saldo, reservering en
-- historie altijd consistent blijven, ook bij gelijktijdige verzoeken.
-- =============================================================================

create or replace function public.get_setting(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select value from public.app_settings where key = p_key;
$$;

create or replace function public.get_setting_int(p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((public.get_setting(p_key))::text::integer, p_default);
$$;

create or replace function public.get_setting_bool(p_key text, p_default boolean)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((public.get_setting(p_key))::text::boolean, p_default);
$$;

-- -----------------------------------------------------------------------------
-- Zorg dat er een loyalty account bestaat (idempotent).
-- -----------------------------------------------------------------------------
create or replace function public.ensure_loyalty_account(p_org uuid, p_actor uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.loyalty_accounts where organization_id = p_org;
  if v_id is null then
    insert into public.loyalty_accounts (organization_id, enrolled_by)
    values (p_org, p_actor)
    on conflict (organization_id) do update set updated_at = now()
    returning id into v_id;

    update public.organizations
    set skoolpartner_enrolled_at = coalesce(skoolpartner_enrolled_at, now())
    where id = p_org;
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Saldo opvragen met vergrendeling (voor gebruik binnen transacties).
-- -----------------------------------------------------------------------------
create or replace function public.loyalty_available_points(p_org uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(points), 0)::integer
  from public.loyalty_transactions
  where organization_id = p_org
    and status in ('available', 'reserved', 'redeemed', 'expired');
$$;

-- -----------------------------------------------------------------------------
-- Inwisselverzoek aanmaken. Reserveert de punten meteen zodat dezelfde punten
-- niet twee keer kunnen worden gebruikt.
-- -----------------------------------------------------------------------------
create or replace function public.request_redemption(
  p_org uuid,
  p_points integer,
  p_booking_reference text default null,
  p_note text default null
)
returns public.redemption_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
  v_available integer;
  v_min integer;
  v_max integer;
  v_value integer;
  v_active boolean;
  v_request public.redemption_requests;
  v_tx uuid;
begin
  if auth.uid() is null then
    raise exception 'Niet ingelogd';
  end if;

  if not public.has_organization_access(p_org) then
    raise exception 'Geen toegang tot deze organisatie';
  end if;

  v_active := public.get_setting_bool('loyalty_enabled', true);
  if not v_active then
    raise exception 'SkoolPartner is momenteel niet actief';
  end if;

  if p_points is null or p_points <= 0 then
    raise exception 'Kies een geldig aantal punten';
  end if;

  v_min := public.get_setting_int('redemption_minimum_points', 500);
  v_max := public.get_setting_int('redemption_maximum_points_per_booking', 0);
  v_value := public.get_setting_int('point_value_cents_per_100', 250);

  if p_points < v_min then
    raise exception 'Minimaal % SkoolPoints per verzoek', v_min;
  end if;

  if v_max > 0 and p_points > v_max then
    raise exception 'Maximaal % SkoolPoints per boeking', v_max;
  end if;

  -- Vergrendel het account zodat gelijktijdige verzoeken niet hetzelfde saldo zien.
  select id into v_account from public.loyalty_accounts
  where organization_id = p_org
  for update;

  if v_account is null then
    raise exception 'Deze organisatie neemt nog niet deel aan SkoolPartner';
  end if;

  v_available := public.loyalty_available_points(p_org);
  if p_points > v_available then
    raise exception 'Onvoldoende saldo: % beschikbaar, % gevraagd', v_available, p_points;
  end if;

  insert into public.redemption_requests (
    organization_id, requested_by, points, value_cents,
    point_value_cents_per_100, booking_reference, note, status
  )
  values (
    p_org, auth.uid(), p_points, (p_points * v_value) / 100,
    v_value, nullif(trim(coalesce(p_booking_reference, '')), ''),
    nullif(trim(coalesce(p_note, '')), ''), 'requested'
  )
  returning * into v_request;

  insert into public.loyalty_transactions (
    organization_id, account_id, type, status, points,
    point_value_cents_per_100, description, source, redemption_id, created_by
  )
  values (
    p_org, v_account, 'redemption_reserve', 'reserved', -p_points,
    v_value, 'Gereserveerd voor inwisselverzoek', 'portal', v_request.id, auth.uid()
  )
  returning id into v_tx;

  update public.redemption_requests
  set reserve_transaction_id = v_tx
  where id = v_request.id
  returning * into v_request;

  return v_request;
end;
$$;

-- -----------------------------------------------------------------------------
-- Verzoek annuleren (door klant of admin): reservering vrijgeven.
-- -----------------------------------------------------------------------------
create or replace function public.cancel_redemption(p_request uuid, p_reason text default null)
returns public.redemption_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.redemption_requests;
begin
  select * into v_request from public.redemption_requests where id = p_request for update;
  if v_request.id is null then
    raise exception 'Verzoek niet gevonden';
  end if;

  if not (public.is_admin() or public.has_organization_access(v_request.organization_id)) then
    raise exception 'Geen toegang tot dit verzoek';
  end if;

  if v_request.status not in ('requested', 'approved') then
    raise exception 'Dit verzoek kan niet meer worden geannuleerd';
  end if;

  update public.loyalty_transactions
  set status = 'cancelled', reason = coalesce(p_reason, 'Verzoek geannuleerd')
  where id = v_request.reserve_transaction_id;

  update public.redemption_requests
  set status = 'cancelled', decided_at = now(), decided_by = auth.uid(),
      decision_note = p_reason
  where id = p_request
  returning * into v_request;

  return v_request;
end;
$$;

-- -----------------------------------------------------------------------------
-- Punten beschikbaar maken zodra de bijbehorende factuur volledig betaald is.
-- Idempotent: al beschikbare regels blijven ongemoeid.
-- -----------------------------------------------------------------------------
create or replace function public.release_points_for_invoice(p_invoice uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid boolean;
  v_count integer := 0;
begin
  select fully_paid into v_paid from public.invoices where id = p_invoice;
  if not coalesce(v_paid, false) then
    return 0;
  end if;

  with released as (
    update public.loyalty_transactions t
    set status = 'available',
        available_at = now(),
        expires_at = case
          when public.get_setting_int('points_validity_months', 24) > 0
            then now() + (public.get_setting_int('points_validity_months', 24) || ' months')::interval
          else null
        end
    where t.status = 'pending'
      and t.type = 'earn_workshop'
      and t.booking_id in (
        select bi.booking_id from public.booking_invoices bi where bi.invoice_id = p_invoice
      )
    returning 1
  )
  select count(*) into v_count from released;

  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Verlopen punten registreren als transactie (nooit historie verwijderen).
-- -----------------------------------------------------------------------------
create or replace function public.expire_loyalty_points()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_count integer := 0;
  v_remaining integer;
begin
  if not public.get_setting_bool('points_expiry_enabled', true) then
    return 0;
  end if;

  for v_row in
    select organization_id, account_id, sum(points) as expiring_points
    from public.loyalty_transactions
    where status = 'available'
      and points > 0
      and expires_at is not null
      and expires_at <= now()
    group by organization_id, account_id
  loop
    -- Nooit meer laten verlopen dan er daadwerkelijk beschikbaar is.
    v_remaining := least(v_row.expiring_points, public.loyalty_available_points(v_row.organization_id));

    update public.loyalty_transactions
    set status = 'expired'
    where status = 'available'
      and points > 0
      and expires_at is not null
      and expires_at <= now()
      and organization_id = v_row.organization_id;

    if v_remaining > 0 then
      insert into public.loyalty_transactions (
        organization_id, account_id, type, status, points,
        point_value_cents_per_100, description, source, external_reference
      )
      values (
        v_row.organization_id, v_row.account_id, 'expiry', 'expired', -v_remaining,
        public.get_setting_int('point_value_cents_per_100', 250),
        'SkoolPoints verlopen', 'system',
        'expiry:' || v_row.organization_id::text || ':' || to_char(now(), 'YYYY-MM-DD')
      )
      on conflict do nothing;
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.request_redemption(uuid, integer, text, text) from public, anon;
revoke all on function public.cancel_redemption(uuid, text) from public, anon;
revoke all on function public.release_points_for_invoice(uuid) from public, anon, authenticated;
revoke all on function public.expire_loyalty_points() from public, anon, authenticated;
revoke all on function public.ensure_loyalty_account(uuid, uuid) from public, anon, authenticated;

grant execute on function public.request_redemption(uuid, integer, text, text) to authenticated, service_role;
grant execute on function public.cancel_redemption(uuid, text) to authenticated, service_role;
grant execute on function public.release_points_for_invoice(uuid) to service_role;
grant execute on function public.expire_loyalty_points() to service_role;
grant execute on function public.ensure_loyalty_account(uuid, uuid) to service_role;
grant execute on function public.get_setting(text) to authenticated, service_role;
grant execute on function public.get_setting_int(text, integer) to authenticated, service_role;
grant execute on function public.get_setting_bool(text, boolean) to authenticated, service_role;
grant execute on function public.loyalty_available_points(uuid) to authenticated, service_role;

-- >>> 20260825120900_seed_settings.sql

-- =============================================================================
-- SkoolPartner - 010 - Startinstellingen SkoolPartner
-- =============================================================================
-- Deze waarden zijn de startsituatie. Ze zijn allemaal aanpasbaar via
-- Admin > Instellingen, zonder programmeerwerk.
-- =============================================================================

insert into public.app_settings (key, value, label, description, group_name, value_type, is_public, sort_order) values
  ('loyalty_enabled', 'true'::jsonb, 'SkoolPartner actief',
   'Zet het volledige loyaliteitsprogramma aan of uit. Uit betekent: geen nieuwe punten en geen inwisselverzoeken.',
   'programma', 'boolean', true, 10),

  ('program_name', '"SkoolPartner"'::jsonb, 'Naam programma',
   'Zoals getoond in het portaal.', 'programma', 'text', true, 20),

  ('points_name', '"SkoolPoints"'::jsonb, 'Naam punten',
   'Zoals getoond in het portaal.', 'programma', 'text', true, 30),

  ('points_per_workshop_hour', '100'::jsonb, 'Punten per workshopuur',
   'Basisregel voor het verdienen van punten. 90 minuten levert dus 150 punten op.',
   'verdienen', 'number', true, 40),

  ('minimum_booking_minutes', '90'::jsonb, 'Minimale workshopduur (minuten)',
   'De minimale afname per dag bij Skool Workshop. Wordt gebruikt als plausibiliteitscontrole bij het inlezen van bevestigingen.',
   'verdienen', 'number', true, 50),

  ('review_bonus_points', '50'::jsonb, 'Bonuspunten per geverifieerde review',
   'Maximaal één keer per boeking.', 'verdienen', 'number', true, 60),

  ('point_value_cents_per_100', '250'::jsonb, 'Waarde per 100 punten (in centen)',
   '250 betekent: 100 SkoolPoints = € 2,50 Skool Voordeel. Wijzigen geldt alleen voor nieuwe transacties; bestaande historie behoudt de waarde van dat moment.',
   'waarde', 'number', true, 70),

  ('redemption_minimum_points', '500'::jsonb, 'Minimum aantal punten per inwisselverzoek',
   'Onder deze grens kan een klant geen verzoek indienen.', 'inwisselen', 'number', true, 80),

  ('redemption_maximum_points_per_booking', '0'::jsonb, 'Maximum punten per boeking',
   '0 betekent geen maximum.', 'inwisselen', 'number', true, 90),

  ('points_expiry_enabled', 'true'::jsonb, 'Punten laten verlopen',
   'Uit betekent: punten blijven onbeperkt geldig.', 'geldigheid', 'boolean', true, 100),

  ('points_validity_months', '24'::jsonb, 'Geldigheidsduur (maanden)',
   'Geteld vanaf het moment dat de punten beschikbaar komen. Verlopen punten blijven zichtbaar in de historie.',
   'geldigheid', 'number', true, 110),

  ('milestone_step_points', '500'::jsonb, 'Mijlpaal per aantal punten',
   'Gebruikt voor de subtiele voortgangsmelding op het dashboard.', 'programma', 'number', true, 120),

  ('new_booking_cta_url', '"https://skoolworkshop.nl/offerte-aanvraag/"'::jsonb, 'URL nieuwe workshop aanvragen',
   'SkoolPartner bouwt geen eigen boekingssysteem. Deze knop verwijst naar de bestaande offerteaanvraag.',
   'programma', 'url', true, 130),

  ('new_booking_cta_label', '"Nieuwe workshop aanvragen"'::jsonb, 'Tekst op de knop',
   null, 'programma', 'text', true, 140),

  ('support_email', '"boekingen@skoolworkshop.nl"'::jsonb, 'Centrale mailbox',
   'Alle klantcommunicatie loopt via dit adres.', 'programma', 'text', true, 150),

  ('rules_text', '"SkoolPoints worden toegekend over de daadwerkelijk afgenomen workshopuren van een definitieve boeking. Reiskosten, starttarief, materiaalkosten, extra deelnemers en toeslagen tellen niet mee.\n\nPunten komen beschikbaar zodra de bijbehorende factuur volledig is voldaan. Tot die tijd staan ze als punten in behandeling in uw overzicht.\n\nSkoolPoints horen bij uw organisatie en niet bij een individuele medewerker. Ze zijn niet overdraagbaar naar een andere organisatie, niet uitbetaalbaar en niet inwisselbaar voor contant geld.\n\nPunten zijn te gebruiken als voordeel op een volgende boeking. U dient daarvoor een inwisselverzoek in via SkoolPartner. Zolang een verzoek loopt, zijn die punten gereserveerd.\n\nDeelname begint op het moment van registratie. Boekingen van voor uw registratie leveren geen punten op."'::jsonb,
   'Spelregels SkoolPartner', 'Getoond op de SkoolPartner-pagina.', 'teksten', 'longtext', true, 160),

  ('how_it_works_text', '"U boekt een workshop via de gebruikelijke offerteaanvraag. Zodra de boeking definitief is bevestigd, rekenen wij de workshopuren om naar SkoolPoints. Na betaling van de factuur komen die punten beschikbaar in SkoolPartner. Bij een volgende aanvraag geeft u aan hoeveel punten u wilt gebruiken."'::jsonb,
   'Zo werkt SkoolPartner', 'Korte uitleg bovenaan de SkoolPartner-pagina.', 'teksten', 'longtext', true, 170),

  ('parser_enabled', 'true'::jsonb, 'Automatisch bevestigingsmails inlezen',
   'Uit betekent: alle boekingen komen handmatig in de controlewachtrij.', 'boekingen', 'boolean', false, 180),

  ('parser_auto_approve_threshold', '95'::jsonb, 'Drempel automatisch goedkeuren (%)',
   'Bevestigingen met een lagere zekerheid komen altijd in Controle nodig. 100 betekent: altijd handmatig controleren.',
   'boekingen', 'number', false, 190),

  ('booking_confirmation_from_domains', '["skoolworkshop.nl"]'::jsonb, 'Toegestane afzenderdomeinen',
   'Alleen bevestigingen vanaf deze domeinen worden als betrouwbaar beschouwd.', 'boekingen', 'json', false, 200),

  ('booking_confirmation_label', '"Mijn Skool/Boekingsbevestiging"'::jsonb, 'Gmail-label definitieve bevestiging',
   'Het label dat Skool Workshop op een definitieve bevestigingsmail zet. Dit is het meest betrouwbare signaal.',
   'boekingen', 'text', false, 210),

  ('gmail_sync_query', '"newer_than:60d -in:spam -in:trash -in:drafts"'::jsonb, 'Gmail zoekopdracht voor synchronisatie',
   'Bepaalt welk deel van de mailbox wordt ingelezen. Alleen threads met een geverifieerde contactpersoon worden bewaard.',
   'berichten', 'text', false, 220)
on conflict (key) do nothing;

-- >>> 20260825121000_chat_and_naming.sql

-- =============================================================================
-- SkoolPartner - 011 - Chatknop en naamgeving
-- =============================================================================
-- 1. Nieuwe instellingen voor de WhatsApp-chatknop. Zolang er geen nummer is
--    ingevuld blijft de knop verborgen, zodat er nooit een dood adres in het
--    portaal staat.
-- 2. De portaalnaam in bestaande teksten bijwerken naar SkoolPartner. Dit raakt
--    alleen tekst die de klant ziet, niet de Gmail-labels of andere technische
--    waarden.
-- =============================================================================

insert into public.app_settings (key, value, label, description, group_name, value_type, is_public, sort_order) values
  ('chat_enabled', 'true'::jsonb, 'Chatknop tonen',
   'Zet de knop "Liever even chatten?" in het klantportaal aan of uit.',
   'contact', 'boolean', true, 230),

  ('chat_whatsapp_url', '"https://wa.me/31850653923"'::jsonb, 'WhatsApp-adres',
   'Bijvoorbeeld https://wa.me/31612345678. Laat leeg om de knop verborgen te houden. Vul hier het zakelijke nummer in, zonder plusteken en zonder spaties.',
   'contact', 'url', true, 240),

  ('chat_label', '"Liever even chatten?"'::jsonb, 'Tekst op de chatknop',
   null, 'contact', 'text', true, 250),

  ('chat_help_text',
   '"Stel uw vraag via WhatsApp. Op werkdagen reageren wij meestal binnen een paar uur."'::jsonb,
   'Toelichting bij de chatknop',
   'Korte zin onder de knop op de berichtenpagina.', 'contact', 'text', true, 260)
on conflict (key) do nothing;

-- Als het adres nog leeg is, zetten we het nummer van Skool Workshop erin.
update public.app_settings
set value = '"https://wa.me/31850653923"'::jsonb
where key = 'chat_whatsapp_url'
  and coalesce(nullif(trim(value #>> '{}'), ''), '') = '';

-- Naamgeving bijwerken in teksten die al in de database staan.
update public.app_settings
set value = to_jsonb(replace(value #>> '{}', 'Mijn Skool', 'SkoolPartner'))
where key in ('rules_text', 'how_it_works_text', 'program_name')
  and value #>> '{}' like '%Mijn Skool%';

update public.app_settings
set description = replace(description, 'Mijn Skool', 'SkoolPartner')
where description like '%Mijn Skool%'
  and key <> 'booking_confirmation_label';

-- >>> 20260825121100_workshop_images.sql

-- =============================================================================
-- SkoolPartner - 012 - Foto's per workshopsoort
-- =============================================================================
-- De foto's staan op skoolworkshop.nl zelf. Hier leggen we alleen vast welke
-- foto bij welke workshopnaam hoort. Aanpasbaar via Admin > Instellingen,
-- zonder programmeerwerk: het is gewoon een lijstje sleutel naar adres.
--
-- De sleutel wordt gezocht in de workshopnaam van de boeking. De langste
-- passende sleutel wint, zodat "light graffiti" niet de gewone graffitifoto
-- pakt. Staat er niets bij, dan toont het portaal een rustig vlak in de
-- huisstijl in plaats van een verkeerde foto.
-- =============================================================================

insert into public.app_settings (key, value, label, description, group_name, value_type, is_public, sort_order) values
  ('workshop_images', '{
  "3d printerpen": "https://skoolworkshop.nl/wp-content/uploads/2024/07/MDC05556-scaled-e1781612569521-1024x382.jpg",
  "bodypercussie": "https://skoolworkshop.nl/wp-content/uploads/2020/07/Workshop-Ghetto-Drums-10-1024x683.jpg",
  "bootcamp": "https://skoolworkshop.nl/wp-content/uploads/2026/06/Workshop-Bootcamp-e1781614313226-1024x416.jpg",
  "breakdance": "https://skoolworkshop.nl/wp-content/uploads/2020/07/Website-fotos-Hersteld_0008s_0008_6L6A5965-Verbeterd-NR-1024x576.jpg",
  "caribbean drums": "https://skoolworkshop.nl/wp-content/uploads/2020/10/6-Workshop-Carribean-Drums-1024x576.jpg",
  "cultuurdag": "https://skoolworkshop.nl/wp-content/uploads/2020/07/Cultuurdag-op-school-1024x683.jpg",
  "dans": "https://skoolworkshop.nl/wp-content/uploads/2019/12/Dans-Website-1024x683.jpg",
  "dj": "https://skoolworkshop.nl/wp-content/uploads/2023/02/2-Workshop-Dj-Skills-1024x576.jpg",
  "dj skills": "https://skoolworkshop.nl/wp-content/uploads/2023/02/2-Workshop-Dj-Skills-1024x576.jpg",
  "flashmob": "https://skoolworkshop.nl/wp-content/uploads/2026/06/Workshop-Flashmob-1024x576.jpg",
  "freerunning": "https://skoolworkshop.nl/wp-content/uploads/2020/07/Website-fotos-Hersteld_0006s_0000_Workshop-ISL-30-1024x576.jpg",
  "ghetto drums": "https://skoolworkshop.nl/wp-content/uploads/2020/07/Workshop-Ghetto-Drums-12-1024x683.jpg",
  "graffiti": "https://skoolworkshop.nl/wp-content/uploads/2020/06/0006s_0000_8-Montessori-Lyceum-Rotterdam-1024x576.jpg",
  "hiphop": "https://skoolworkshop.nl/wp-content/uploads/2019/12/Dans-Website-1024x683.jpg",
  "kickboksen": "https://skoolworkshop.nl/wp-content/uploads/2020/07/6L6A5932-Verbeterd-NR-1024x576.jpg",
  "korte film": "https://skoolworkshop.nl/wp-content/uploads/2020/07/0004s_0000_15-Workshops-British-School-1024x576.jpg",
  "liedje maken": "https://skoolworkshop.nl/wp-content/uploads/2025/10/5-Workshop-Rap-Zang-1.jpg",
  "light graffiti": "https://skoolworkshop.nl/wp-content/uploads/2020/07/1-Wrokshop-Light-Graffiti--1024x576.jpg",
  "live looping": "https://skoolworkshop.nl/wp-content/uploads/2025/10/1-Workshop-Rap-Zang.jpg",
  "pannavoetbal": "https://skoolworkshop.nl/wp-content/uploads/2026/06/Workshop-Pannavoetbal-1024x576.jpg",
  "podcast": "https://skoolworkshop.nl/wp-content/uploads/2023/02/Website-fotos_0000s_0001_14-Introductiedag-Curio-Breda-1024x576.jpg",
  "popstar": "https://skoolworkshop.nl/wp-content/uploads/2025/10/5-Workshop-Rap-Zang-1.jpg",
  "rap": "https://skoolworkshop.nl/wp-content/uploads/2020/07/Website-fotos-Hersteld_0010s_0001_17-Comenius-College-Hilversum-1024x576.jpg",
  "smartphone fotografie": "https://skoolworkshop.nl/wp-content/uploads/2020/11/Foto-6-1024x682.jpg",
  "soap acteren": "https://skoolworkshop.nl/wp-content/uploads/2026/06/Workshop-Soap-1024x576.jpg",
  "stage fighting": "https://skoolworkshop.nl/wp-content/uploads/2020/07/Website-fotos-Hersteld_0009s_0001_3-Workshopdag-Curio-Roosendaal-1024x576.jpg",
  "stop motion": "https://skoolworkshop.nl/wp-content/uploads/2020/07/0008s_0002_MDC05818-1024x576.jpg",
  "streetdance": "https://skoolworkshop.nl/wp-content/uploads/2020/09/hele-groep-1024x517.jpg",
  "t shirt ontwerpen": "https://skoolworkshop.nl/wp-content/uploads/2020/07/23-Workshops-British-School-1024x683.jpg",
  "theatersport": "https://skoolworkshop.nl/wp-content/uploads/2019/12/Theater.jpg",
  "videoclip": "https://skoolworkshop.nl/wp-content/uploads/2025/07/Videoclip-Maken_0007_Workshop-ISL-16-1024x576.jpg",
  "vloggen": "https://skoolworkshop.nl/wp-content/uploads/2021/04/Vloggen-workshop-1024x801.jpg",
  "zelfverdediging": "https://skoolworkshop.nl/wp-content/uploads/2020/07/6L6A6020-Verbeterd-NR-1024x576.jpg"
}'::jsonb, 'Foto per workshopsoort',
   'Een lijst met workshopnaam en het adres van de foto. De foto''s staan op skoolworkshop.nl, dus een nieuwe foto op de website betekent automatisch een nieuwe foto in het portaal.',
   'programma', 'json', true, 270)
on conflict (key) do nothing;

-- >>> 20260825121200_workshop_results.sql

-- =============================================================================
-- SkoolPartner - 013 - Resultaten van workshops
-- =============================================================================
-- Na een workshop zet Skool Workshop het opgeleverde werk klaar: een rapnummer,
-- een videoclip, een podcast, foto's. De klant downloadt het uit het portaal.
--
-- Levensloop van een set resultaten:
--   concept    -> alleen zichtbaar in de beheeromgeving, nog niets verstuurd
--   published  -> zichtbaar voor de klant, mail is verstuurd, bestanden staan
--                 klaar tot expires_at
--   expired    -> de bestanden zijn echt uit de opslag verwijderd. De klant
--                 ziet nog een melding dat het verlopen is, tot purge_at
--   (weg)      -> na purge_at wordt de hele set verwijderd, geen spoor meer
--
-- Grote bestanden worden nooit door de server heen gestuurd: de browser
-- uploadt rechtstreeks naar Supabase Storage met een tijdelijke, door de
-- server ondertekende link. Downloaden gaat net zo, met een link die maar een
-- paar minuten geldig is en pas wordt gemaakt nadat de toegang is gecontroleerd.
--
-- Past een bestand niet binnen de limiet van het Supabase-abonnement, dan kan
-- er een externe link bij, bijvoorbeeld WeTransfer. Die telt niet mee voor de
-- opslag, maar heeft ook een eigen vervaldatum bij die dienst.
-- =============================================================================

do $$ begin
  create type public.result_status as enum ('concept', 'published', 'expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.result_item_kind as enum ('file', 'link');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- workshop_results
-- -----------------------------------------------------------------------------
create table if not exists public.workshop_results (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  booking_id       uuid references public.bookings (id) on delete set null,
  title            text not null,
  description      text,
  status           public.result_status not null default 'concept',
  published_at     timestamptz,
  expires_at       timestamptz,
  purge_at         timestamptz,
  notified_at      timestamptz,
  notified_email   text,
  notify_error     text,
  files_removed_at timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint workshop_results_title_not_empty check (length(trim(title)) > 1)
);

create index if not exists workshop_results_org_idx
  on public.workshop_results (organization_id, published_at desc);
create index if not exists workshop_results_status_idx
  on public.workshop_results (status);
create index if not exists workshop_results_expiry_idx
  on public.workshop_results (expires_at) where status = 'published';
create index if not exists workshop_results_purge_idx
  on public.workshop_results (purge_at) where status = 'expired';

drop trigger if exists workshop_results_set_updated_at on public.workshop_results;
create trigger workshop_results_set_updated_at before update on public.workshop_results
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- workshop_result_files
-- -----------------------------------------------------------------------------
create table if not exists public.workshop_result_files (
  id            uuid primary key default gen_random_uuid(),
  result_id     uuid not null references public.workshop_results (id) on delete cascade,
  kind          public.result_item_kind not null default 'file',
  storage_path  text,
  external_url  text,
  file_name     text not null,
  mime_type     text,
  size_bytes    bigint,
  position      integer not null default 0,
  removed_at    timestamptz,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint workshop_result_files_target check (
    (kind = 'file' and storage_path is not null and external_url is null)
    or (kind = 'link' and external_url is not null and storage_path is null)
  )
);

create index if not exists workshop_result_files_result_idx
  on public.workshop_result_files (result_id, position);
create unique index if not exists workshop_result_files_path_key
  on public.workshop_result_files (storage_path) where storage_path is not null;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.workshop_results      enable row level security;
alter table public.workshop_result_files enable row level security;

-- De klant ziet alleen gepubliceerde of verlopen sets van de eigen organisatie.
-- Concepten blijven volledig binnen de beheeromgeving.
drop policy if exists workshop_results_select on public.workshop_results;
create policy workshop_results_select on public.workshop_results
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.has_organization_access(organization_id)
      and status in ('published', 'expired')
    )
  );
grant select on public.workshop_results to authenticated;

drop policy if exists workshop_result_files_select on public.workshop_result_files;
create policy workshop_result_files_select on public.workshop_result_files
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.workshop_results r
      where r.id = workshop_result_files.result_id
        and r.status = 'published'
        and public.has_organization_access(r.organization_id)
    )
  );
grant select on public.workshop_result_files to authenticated;

-- Schrijven gebeurt uitsluitend server-side met de service role, na een
-- expliciete controle op beheerdersrechten. Daarom geen insert- of
-- update-policies voor gewone gebruikers.

-- -----------------------------------------------------------------------------
-- Opslagbucket
-- -----------------------------------------------------------------------------
-- Bewust niet openbaar. Er komen ook geen policies op storage.objects: alleen
-- de service role komt erbij, en die maakt per download een korte link.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('workshop-resultaten', 'workshop-resultaten', false)
    on conflict (id) do nothing;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Instellingen
-- -----------------------------------------------------------------------------
insert into public.app_settings (key, value, label, description, group_name, value_type, is_public, sort_order) values
  ('results_enabled', 'true'::jsonb, 'Resultaten van workshops tonen',
   'Zet het onderdeel Resultaten in het klantportaal aan of uit.',
   'resultaten', 'boolean', true, 300),

  ('results_available_days', '7'::jsonb, 'Aantal dagen beschikbaar',
   'Zoveel dagen na publiceren kan de klant downloaden. Daarna worden de bestanden echt uit de opslag verwijderd.',
   'resultaten', 'number', true, 310),

  ('results_notice_days', '7'::jsonb, 'Aantal dagen melding na verlopen',
   'Zoveel dagen blijft er nog een melding staan dat de resultaten verlopen zijn. Daarna verdwijnt de set helemaal uit het portaal.',
   'resultaten', 'number', true, 320),

  ('results_max_upload_mb', '45'::jsonb, 'Maximale bestandsgrootte (MB)',
   'Let op: dit kan nooit hoger dan wat je Supabase-abonnement toestaat. Op het gratis plan is dat 50 MB per bestand. Voor grotere video''s heb je Supabase Pro nodig, of je voegt een externe link toe.',
   'resultaten', 'number', false, 330),

  ('results_email_subject', '"De resultaten van uw workshop staan klaar"'::jsonb,
   'Onderwerp van de mail', null, 'resultaten', 'text', false, 340)
on conflict (key) do nothing;

-- >>> 20260825121300_self_signup.sql

-- =============================================================================
-- SkoolPartner - 014 - Zelf aanmelden zonder wachtrij
-- =============================================================================
-- Een school die zich zelf aanmeldt komt voortaan meteen binnen. De organisatie
-- staat dan wel als "nog te controleren", zodat Skool Workshop hem kan
-- koppelen aan de echte klant in Moneybird.
--
-- Dat is veilig: zolang een organisatie niet gekoppeld is, hangen er geen
-- boekingen, facturen of punten aan. Er valt dus niets te zien wat niet mag.
-- Het enige verschil is dat de klant niet zit te wachten.
-- =============================================================================

alter table public.organizations
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references public.profiles (id) on delete set null;

comment on column public.organizations.verified_at is
  'Leeg betekent: door een klant zelf aangemeld en nog niet gecontroleerd door Skool Workshop.';

-- Alles wat er nu al staat is door een beheerder aangemaakt of via demodata,
-- dus dat rekenen we als gecontroleerd.
update public.organizations
set verified_at = coalesce(verified_at, created_at)
where verified_at is null;

create index if not exists organizations_unverified_idx
  on public.organizations (created_at desc) where verified_at is null;

