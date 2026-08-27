-- SkoolPartner - verbeteringen augustus 2026
-- CJP-tegoed is per schooljaar, de bonus is echt eenmalig en resultaten staan 3 dagen klaar.

create or replace function public.cjp_school_year(p_moment timestamptz default now())
returns text
language sql
stable
set search_path = public
as $$
  select case
    when extract(month from p_moment at time zone 'Europe/Amsterdam') >= 9
      then extract(year from p_moment at time zone 'Europe/Amsterdam')::integer::text
        || '/' || (extract(year from p_moment at time zone 'Europe/Amsterdam')::integer + 1)::text
    else (extract(year from p_moment at time zone 'Europe/Amsterdam')::integer - 1)::text
        || '/' || extract(year from p_moment at time zone 'Europe/Amsterdam')::integer::text
  end
$$;

alter table public.cjp_parking_requests
  add column if not exists school_year text;
update public.cjp_parking_requests
set school_year = public.cjp_school_year(created_at)
where school_year is null;
alter table public.cjp_parking_requests
  alter column school_year set default public.cjp_school_year(now()),
  alter column school_year set not null;

alter table public.cjp_credit_transactions
  add column if not exists school_year text;
update public.cjp_credit_transactions
set school_year = public.cjp_school_year(occurred_at)
where school_year is null;
alter table public.cjp_credit_transactions
  alter column school_year set default public.cjp_school_year(now()),
  alter column school_year set not null;

create table if not exists public.cjp_bonus_awards (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  request_id uuid references public.cjp_parking_requests(id) on delete set null,
  transaction_id uuid references public.loyalty_transactions(id) on delete set null,
  awarded_at timestamptz not null default now()
);

insert into public.cjp_bonus_awards (organization_id, transaction_id, awarded_at)
select distinct on (organization_id) organization_id, id, occurred_at
from public.loyalty_transactions
where type = 'cjp_bonus' and status <> 'cancelled'
order by organization_id, occurred_at
on conflict (organization_id) do nothing;

alter table public.cjp_bonus_awards enable row level security;
revoke all on public.cjp_bonus_awards from anon, authenticated;
grant all on public.cjp_bonus_awards to service_role;
grant all on public.cjp_parking_requests, public.cjp_credit_transactions to service_role;
grant select on public.cjp_credit_balances to service_role;

insert into public.app_settings (key, value, label, description, group_name, value_type, is_public, sort_order)
values ('cjp_bonus_minimum_amount_cents', '100000'::jsonb,
  'Minimumbedrag voor de eenmalige CJP-bonus',
  'Een organisatie ontvangt alleen bij minimaal dit geparkeerde bedrag de eenmalige bonus.',
  'skoolpartner', 'number', true, 183)
on conflict (key) do update set
  value = excluded.value,
  label = excluded.label,
  description = excluded.description;

update public.app_settings set value = '100000'::jsonb,
  label = 'Minimumbedrag om CJP-tegoed te parkeren',
  description = 'Minimaal 1.000 euro. Dit tegoed is alleen geldig binnen hetzelfde schooljaar.'
where key = 'cjp_minimum_amount_cents';
update public.app_settings set value = '0'::jsonb,
  label = 'Verouderde bonuswachttijd',
  description = 'Niet meer gebruikt: de CJP-bonus is één keer per organisatie.'
where key = 'cjp_bonus_cooldown_days';
update public.app_settings set value = '3'::jsonb where key = 'results_available_days';
update public.app_settings set value = '24'::jsonb where key = 'points_validity_months';

create or replace view public.cjp_credit_balances
with (security_invoker = true)
as
select
  o.id as organization_id,
  coalesce(sum(t.amount_cents), 0)::integer as available_cents,
  coalesce(sum(t.amount_cents) filter (where t.amount_cents > 0), 0)::integer as added_cents,
  coalesce(-sum(t.amount_cents) filter (where t.amount_cents < 0), 0)::integer as spent_cents,
  max(t.occurred_at) as last_movement_at
from public.organizations o
left join public.cjp_credit_transactions t
  on t.organization_id = o.id
 and t.school_year = public.cjp_school_year(now())
group by o.id;

create or replace function public.confirm_cjp_parking(
  p_request uuid, p_actor uuid default null, p_note text default null
)
returns public.cjp_parking_requests
language plpgsql security definer set search_path = public
as $$
declare
  v_request public.cjp_parking_requests;
  v_credit uuid; v_bonus uuid; v_points integer; v_waarde integer;
  v_bonus_claimed boolean := false;
begin
  select * into v_request from public.cjp_parking_requests where id = p_request for update;
  if v_request.id is null then raise exception 'Deze aanvraag bestaat niet'; end if;
  if v_request.status = 'confirmed' then return v_request; end if;
  if v_request.status = 'rejected' then raise exception 'Deze aanvraag is afgewezen en kan niet meer worden bevestigd'; end if;

  insert into public.cjp_credit_transactions
    (organization_id, amount_cents, type, description, request_id,
     external_reference, created_by, note, school_year)
  values (v_request.organization_id, v_request.amount_cents, 'parking',
    'CJP-tegoed toegevoegd voor schooljaar ' || v_request.school_year,
    v_request.id, 'request:' || v_request.id::text, p_actor, p_note, v_request.school_year)
  returning id into v_credit;

  if public.get_setting_bool('cjp_bonus_enabled', true)
     and v_request.amount_cents >= public.get_setting_int('cjp_bonus_minimum_amount_cents', 100000) then
    insert into public.cjp_bonus_awards (organization_id, request_id)
    values (v_request.organization_id, v_request.id)
    on conflict (organization_id) do nothing
    returning true into v_bonus_claimed;
  end if;

  if coalesce(v_bonus_claimed, false) then
    v_points := public.get_setting_int('cjp_bonus_points', 1000);
    v_waarde := public.get_setting_int('point_value_cents_per_100', 250);
    insert into public.loyalty_transactions
      (organization_id, account_id, type, status, points, point_value_cents_per_100,
       description, source, external_reference, available_at, expires_at, created_by)
    select v_request.organization_id, a.id, 'cjp_bonus', 'available', v_points, v_waarde,
      'Eenmalige bonus bij minimaal € 1.000 geparkeerd CJP-tegoed', 'portal',
      'cjp:' || v_request.id::text, now(),
      now() + (public.get_setting_int('points_validity_months', 24) || ' months')::interval,
      p_actor
    from public.loyalty_accounts a
    where a.organization_id = v_request.organization_id and a.is_active
    returning id into v_bonus;
    update public.cjp_bonus_awards set transaction_id = v_bonus where organization_id = v_request.organization_id;
  end if;

  update public.cjp_parking_requests set status = 'confirmed', decided_by = p_actor,
    decided_at = now(), decision_note = coalesce(p_note, decision_note),
    credit_transaction_id = v_credit, bonus_transaction_id = v_bonus
  where id = v_request.id returning * into v_request;
  return v_request;
end;
$$;

create or replace function public.spend_cjp_credit(
  p_org uuid, p_amount_cents integer, p_booking uuid default null,
  p_invoice_number text default null, p_actor uuid default null, p_note text default null
)
returns public.cjp_credit_transactions
language plpgsql security definer set search_path = public
as $$
declare
  v_lock uuid; v_saldo integer; v_booking public.bookings;
  v_row public.cjp_credit_transactions; v_omschrijving text := 'CJP-tegoed gebruikt';
  v_school_year text := public.cjp_school_year(now());
begin
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'Vul een bedrag groter dan nul in'; end if;
  select id into v_lock from public.organizations where id = p_org for update;
  if v_lock is null then raise exception 'Deze organisatie bestaat niet'; end if;
  select coalesce(sum(amount_cents), 0)::integer into v_saldo
  from public.cjp_credit_transactions where organization_id = p_org and school_year = v_school_year;
  if p_amount_cents > v_saldo then raise exception 'Onvoldoende tegoed: % beschikbaar, % gevraagd', v_saldo, p_amount_cents; end if;
  if p_booking is not null then
    select * into v_booking from public.bookings where id = p_booking;
    if v_booking.id is null then raise exception 'Deze boeking bestaat niet'; end if;
    if v_booking.organization_id <> p_org then raise exception 'Deze boeking hoort niet bij deze organisatie'; end if;
    v_omschrijving := v_booking.workshop_name;
  end if;
  insert into public.cjp_credit_transactions
    (organization_id, amount_cents, type, description, booking_id, invoice_number,
     created_by, note, school_year)
  values (p_org, -p_amount_cents, 'spend', v_omschrijving, p_booking,
    p_invoice_number, p_actor, p_note, v_school_year)
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.confirm_cjp_parking(uuid, uuid, text) from public;
revoke all on function public.spend_cjp_credit(uuid, integer, uuid, text, uuid, text) from public;
grant execute on function public.confirm_cjp_parking(uuid, uuid, text) to service_role;
grant execute on function public.spend_cjp_credit(uuid, integer, uuid, text, uuid, text) to service_role;
notify pgrst, 'reload schema';
