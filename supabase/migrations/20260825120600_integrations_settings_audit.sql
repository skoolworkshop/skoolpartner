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
