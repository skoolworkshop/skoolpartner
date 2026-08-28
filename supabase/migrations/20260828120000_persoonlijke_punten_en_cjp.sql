-- SkoolPartner: persoonlijke SkoolPoints en persoonlijke CJP-gegevens.
-- Bestaande historie blijft intact. Een bestaand organisatiesaldo wordt aan
-- de oorspronkelijke inschrijver of het oudste actieve lid gekoppeld.

alter table public.profiles
  add column if not exists cjp_school_number text,
  add column if not exists has_cjp boolean;

alter table public.profiles drop constraint if exists profiles_cjp_school_number_check;
alter table public.profiles add constraint profiles_cjp_school_number_check
  check (cjp_school_number is null or length(trim(cjp_school_number)) between 3 and 40);

-- Vul alleen lege persoonlijke velden. De organisatiekolommen blijven als
-- historische fallback bestaan en worden niet verwijderd.
update public.profiles p
set cjp_school_number = o.cjp_school_number,
    has_cjp = o.has_cjp
from public.organization_members m
join public.organizations o on o.id = m.organization_id
where m.user_id = p.id
  and m.status = 'active'
  and p.cjp_school_number is null
  and o.cjp_school_number is not null;

alter table public.loyalty_accounts
  add column if not exists user_id uuid references public.profiles(id) on delete restrict;
alter table public.loyalty_accounts drop constraint if exists loyalty_accounts_user_id_fkey;
alter table public.loyalty_accounts add constraint loyalty_accounts_user_id_fkey
  foreign key(user_id) references public.profiles(id) on delete set null;

update public.loyalty_accounts a
set user_id = coalesce(
  (select m.user_id from public.organization_members m
   where m.organization_id = a.organization_id and m.user_id = a.enrolled_by
     and m.status = 'active' limit 1),
  (select m.user_id from public.organization_members m
   where m.organization_id = a.organization_id and m.status = 'active'
   order by m.created_at, m.id limit 1)
)
where a.user_id is null;

alter table public.loyalty_transactions
  add column if not exists user_id uuid references public.profiles(id) on delete restrict;
alter table public.loyalty_transactions drop constraint if exists loyalty_transactions_user_id_fkey;
alter table public.loyalty_transactions add constraint loyalty_transactions_user_id_fkey
  foreign key(user_id) references public.profiles(id) on delete set null;
update public.loyalty_transactions t
set user_id = a.user_id
from public.loyalty_accounts a
where a.id = t.account_id and t.user_id is null;

alter table public.loyalty_accounts drop constraint if exists loyalty_accounts_org_unique;
drop index if exists public.loyalty_accounts_org_unique;
create unique index if not exists loyalty_accounts_org_user_unique
  on public.loyalty_accounts(organization_id, user_id) where user_id is not null;
create unique index if not exists loyalty_accounts_legacy_org_unique
  on public.loyalty_accounts(organization_id) where user_id is null;
create index if not exists loyalty_transactions_user_idx
  on public.loyalty_transactions(user_id, occurred_at desc);

drop index if exists public.loyalty_transactions_external_key;
create unique index loyalty_transactions_external_key
  on public.loyalty_transactions (organization_id, user_id, type, external_reference)
  where external_reference is not null;

drop view if exists public.loyalty_balances;
create view public.loyalty_balances
with (security_invoker = true)
as
select
  a.organization_id,
  a.user_id,
  a.id as account_id,
  a.enrolled_at,
  a.is_active,
  coalesce(sum(t.points) filter (where t.status in ('available','reserved','redeemed','expired')),0)::integer as available_points,
  coalesce(sum(t.points) filter (where t.status = 'pending'),0)::integer as pending_points,
  coalesce(-sum(t.points) filter (where t.status = 'reserved'),0)::integer as reserved_points,
  coalesce(-sum(t.points) filter (where t.status = 'redeemed'),0)::integer as redeemed_points,
  coalesce(-sum(t.points) filter (where t.status = 'expired'),0)::integer as expired_points,
  coalesce(sum(t.points) filter (where t.points > 0 and t.status in ('available','reserved','redeemed','expired')),0)::integer as lifetime_earned_points,
  max(t.occurred_at) filter (where t.points > 0) as last_earned_at
from public.loyalty_accounts a
left join public.loyalty_transactions t on t.account_id = a.id and t.status not in ('reversed','cancelled')
group by a.organization_id, a.user_id, a.id, a.enrolled_at, a.is_active;
grant select on public.loyalty_balances to authenticated, service_role;

drop policy if exists loyalty_accounts_select on public.loyalty_accounts;
create policy loyalty_accounts_select on public.loyalty_accounts for select using (
  public.is_admin() or user_id = auth.uid()
);
drop policy if exists loyalty_transactions_select on public.loyalty_transactions;
create policy loyalty_transactions_select on public.loyalty_transactions for select using (
  public.is_admin() or user_id = auth.uid()
);
drop policy if exists redemption_requests_select on public.redemption_requests;
create policy redemption_requests_select on public.redemption_requests for select using (
  public.is_admin() or requested_by = auth.uid()
);

create or replace function public.ensure_loyalty_account(p_org uuid, p_actor uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_user uuid := coalesce(p_actor, auth.uid());
begin
  -- Achterwaartse compatibiliteit voor oude systeemcalls: zij mogen een al
  -- bestaand account terugvinden, maar nooit een nieuw gedeeld account maken.
  if v_user is null then
    select id into v_id from public.loyalty_accounts
      where organization_id=p_org order by enrolled_at,id limit 1;
    if v_id is null then raise exception 'Een gebruiker is verplicht voor een nieuw puntenaccount'; end if;
    return v_id;
  end if;
  select id into v_id from public.loyalty_accounts
    where organization_id = p_org and user_id = v_user;
  if v_id is null then
    insert into public.loyalty_accounts(organization_id,user_id,enrolled_by)
    values(p_org,v_user,v_user)
    on conflict (organization_id,user_id) where user_id is not null
    do update set updated_at=now() returning id into v_id;
    update public.organizations set skoolpartner_enrolled_at=coalesce(skoolpartner_enrolled_at,now()) where id=p_org;
  end if;
  return v_id;
end $$;

create or replace function public.loyalty_available_points(p_org uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(points),0)::integer from public.loyalty_transactions
  where organization_id=p_org and user_id=auth.uid()
    and status in ('available','reserved','redeemed','expired');
$$;

-- De meest recente inwisselfunctie, nu met een account-lock en saldo per gebruiker.
create or replace function public.request_redemption(
  p_org uuid, p_points integer, p_booking_id uuid default null,
  p_booking_reference text default null, p_note text default null
) returns public.redemption_requests language plpgsql security definer set search_path=public as $$
declare v_account uuid; v_available integer; v_min integer; v_max integer; v_value integer;
  v_booking public.bookings; v_request public.redemption_requests; v_tx uuid;
begin
  if auth.uid() is null then raise exception 'Niet ingelogd'; end if;
  if not public.has_organization_access(p_org) then raise exception 'Geen toegang tot deze organisatie'; end if;
  if not public.get_setting_bool('loyalty_enabled',true) then raise exception 'SkoolPartner is momenteel niet actief'; end if;
  if p_points is null or p_points<=0 then raise exception 'Kies een geldig aantal punten'; end if;
  v_min:=public.get_setting_int('redemption_minimum_points',500);
  v_max:=public.get_setting_int('redemption_maximum_points_per_booking',0);
  v_value:=public.get_setting_int('point_value_cents_per_100',250);
  if p_points<v_min then raise exception 'Minimaal % SkoolPoints per verzoek',v_min; end if;
  if v_max>0 and p_points>v_max then raise exception 'Maximaal % SkoolPoints per boeking',v_max; end if;
  if p_booking_id is not null then
    select * into v_booking from public.bookings where id=p_booking_id;
    if v_booking.id is null or v_booking.organization_id<>p_org then raise exception 'Deze boeking hoort niet bij uw organisatie'; end if;
    if v_booking.status<>'confirmed' then raise exception 'U kunt punten alleen gebruiken voor een bevestigde workshop'; end if;
    if v_booking.scheduled_date is null or v_booking.scheduled_date<current_date then raise exception 'U kunt punten alleen gebruiken voor een workshop die nog moet komen'; end if;
  end if;
  select id into v_account from public.loyalty_accounts
    where organization_id=p_org and user_id=auth.uid() for update;
  if v_account is null then raise exception 'U heeft nog geen persoonlijk SkoolPartner-puntenaccount'; end if;
  select coalesce(sum(points),0)::integer into v_available from public.loyalty_transactions
    where account_id=v_account and status in ('available','reserved','redeemed','expired');
  if p_points>v_available then raise exception 'Onvoldoende saldo: % beschikbaar, % gevraagd',v_available,p_points; end if;
  insert into public.redemption_requests(organization_id,requested_by,points,value_cents,point_value_cents_per_100,booking_id,booking_reference,note,status)
  values(p_org,auth.uid(),p_points,(p_points*v_value)/100,v_value,p_booking_id,
    coalesce(nullif(trim(coalesce(p_booking_reference,'')),''),v_booking.reference),nullif(trim(coalesce(p_note,'')),''),'requested') returning * into v_request;
  insert into public.loyalty_transactions(organization_id,user_id,account_id,type,status,points,point_value_cents_per_100,description,source,redemption_id,booking_id,created_by)
  values(p_org,auth.uid(),v_account,'redemption_reserve','reserved',-p_points,v_value,
    coalesce('Gereserveerd voor '||v_booking.workshop_name,'Gereserveerd voor inwisselverzoek'),'portal',v_request.id,p_booking_id,auth.uid()) returning id into v_tx;
  update public.redemption_requests set reserve_transaction_id=v_tx where id=v_request.id returning * into v_request;
  return v_request;
end $$;

grant execute on function public.ensure_loyalty_account(uuid,uuid) to authenticated, service_role;
grant execute on function public.loyalty_available_points(uuid) to authenticated;
grant execute on function public.request_redemption(uuid,integer,uuid,text,text) to authenticated;

alter table public.workshop_result_files add column if not exists description text;
