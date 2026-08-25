-- =============================================================================
-- Mijn Skool - 005 - SkoolPartner: loyalty accounts, ledger en redemptions
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
