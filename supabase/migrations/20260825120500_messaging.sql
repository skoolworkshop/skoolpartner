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
