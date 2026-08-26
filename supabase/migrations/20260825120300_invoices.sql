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
