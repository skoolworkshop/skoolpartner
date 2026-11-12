-- =============================================================================
-- SkoolPartner - migraties 044 en 045 terugdraaien
-- =============================================================================
-- ALLEEN GEBRUIKEN ALS HET ECHT NODIG IS.
--
-- Dit zet de database terug naar hoe hij na migratie 043 was: het saldo rekent
-- weer per persoon. Geen van beide migraties heeft gegevens gewijzigd, dus er
-- valt ook geen gegeven terug te zetten: alleen de weergave, de functies, de
-- leesrechten en twee indexen gaan terug.
--
-- Getest: alle migraties gedraaid, daarna dit bestand, daarna migratie 045
-- opnieuw. Zie tests/punten-per-locatie.test.ts.
--
-- LET OP
--
--   * Hiermee komen ook de fouten terug die migratie 045 oploste: punten
--     vastleggen loopt dan weer vast, en verval haalt niets van het saldo af.
--     Zet daarom tegelijk de vorige versie van de applicatie terug.
--   * De aangescherpte rechten op de serverfuncties blijven staan. Die terug
--     openzetten heeft geen enkel nut.
--   * Staan er op één locatie inmiddels twee accounts zonder eigenaar (twee
--     vertrokken contactpersonen), dan weigert de regel met
--     loyalty_accounts_legacy_org_unique. Dat is dan terecht: die situatie kon
--     vóór 045 niet bestaan.
--   * Daarna in de migratiehistorie rechtzetten:
--       supabase migration repair --status reverted 20261112130000 20261112120000
--
-- Plak de inhoud in Supabase > SQL Editor en klik op Run.

begin;

-- ----- 044 -------------------------------------------------------------------
drop index if exists public.organization_contacts_moneybird_uniek;

-- ----- 045: indexen ----------------------------------------------------------
drop index if exists public.loyalty_transactions_external_key;
create unique index loyalty_transactions_external_key
  on public.loyalty_transactions (organization_id, user_id, type, external_reference)
  where external_reference is not null;

create unique index if not exists loyalty_accounts_legacy_org_unique
  on public.loyalty_accounts(organization_id) where user_id is null;

-- ----- 045: de saldoweergave per persoon -------------------------------------
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

-- ----- 045: leesrechten per persoon ------------------------------------------
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

drop policy if exists redemption_requests_insert on public.redemption_requests;
create policy redemption_requests_insert on public.redemption_requests
  for insert to authenticated
  with check (
    public.has_organization_access(organization_id)
    and requested_by = auth.uid()
    and status = 'requested'
  );
grant select, insert on public.redemption_requests to authenticated;

-- ----- 045: functies ---------------------------------------------------------
create or replace function public.loyalty_available_points(p_org uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(points),0)::integer from public.loyalty_transactions
  where organization_id=p_org and user_id=auth.uid()
    and status in ('available','reserved','redeemed','expired');
$$;

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

drop function if exists public.loyalty_location_points(uuid);

grant execute on function public.loyalty_available_points(uuid) to authenticated;
grant execute on function public.request_redemption(uuid,integer,uuid,text,text) to authenticated;
revoke all on function public.expire_loyalty_points() from public, anon, authenticated;
grant execute on function public.expire_loyalty_points() to service_role;
revoke all on function public.confirm_cjp_parking(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.confirm_cjp_parking(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';

commit;
