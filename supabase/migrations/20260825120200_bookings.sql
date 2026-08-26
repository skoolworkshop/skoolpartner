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
