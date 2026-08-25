-- =============================================================================
-- Mijn Skool - 009 - Loyalty-functies (atomair, met vergrendeling)
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
