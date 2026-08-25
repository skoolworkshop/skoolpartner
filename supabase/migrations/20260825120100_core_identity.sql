-- =============================================================================
-- Mijn Skool - 002 - Profielen, organisaties, lidmaatschappen, contacten
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
