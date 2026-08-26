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
