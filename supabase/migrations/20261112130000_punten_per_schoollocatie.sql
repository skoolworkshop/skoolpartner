-- =============================================================================
-- SkoolPartner - 045 - SkoolPoints horen bij de schoollocatie
-- =============================================================================
-- WAAROM
--
--   Het saldo is van de school, niet van de medewerker. Boeken twee collega's
--   van dezelfde locatie, dan sparen ze samen voor één saldo. Vertrekt een
--   collega, dan blijven de punten bij de school.
--
--   Het grootboek deed dat al goed: elke regel draagt de locatie. Wat eromheen
--   zat rekende nog per persoon: de saldoweergave, het beschikbare saldo, het
--   inwisselen en de leesrechten. Dat zet deze migratie om.
--
-- WAT DIT DOET
--
--   1. Eén toekenning per bron per locatie (welkomstbonus, boeking, review),
--      op een manier die de applicatie ook echt kan gebruiken. Tot nu toe liep
--      elke toekenning vast op de vorm van deze index.
--   2. De saldoweergave telt per locatie.
--   3. Alle actieve contactpersonen van een locatie zien het saldo, de
--      geschiedenis en de lopende inwisselverzoeken van die locatie.
--   4. Inwisselen toetst en reserveert op het saldo van de locatie, met een
--      slot per locatie zodat twee verzoeken tegelijk nooit samen meer kunnen
--      reserveren dan er is.
--   5. Een verzoek ontstaat alleen nog via de functie die ook reserveert. Een
--      losse rij in de tabel zetten kan niet meer.
--   6. Verval rekent per locatie. Dat deed het sinds de persoonlijke punten
--      niet meer: punten werden wel als verlopen gemerkt, maar het saldo ging
--      niet omlaag.
--   7. Meerdere vertrokken contactpersonen per locatie zijn toegestaan. Tot nu
--      toe liep het verwijderen van een tweede vertrekker vast.
--   8. De CJP-bonus wordt één keer per locatie geboekt. Met twee collega's op
--      één locatie liep het bevestigen van CJP-tegoed vast.
--   9. Functies die alleen de server hoort aan te roepen, zijn voor klanten en
--      bezoekers ook echt dicht. Bij een paar stond nog een route open.
--
-- WAT DIT NIET DOET
--
--   Geen enkele bestaande rij verandert van inhoud. De puntenwaarde, de
--   berekening, de geldigheidsduur en de voorwaarden blijven zoals ze waren.
--   Bij elke regel blijft staan welke contactpersoon erbij betrokken was.
--
-- ALS DEZE MIGRATIE WEIGERT
--
--   Dan staat dezelfde toekenning twee keer bij één locatie, bijvoorbeeld twee
--   welkomstbonussen. Zoek ze op met de query onderaan dit bestand, draai er
--   één terug in het beheer, en draai de migratie opnieuw.

begin;

-- -----------------------------------------------------------------------------
-- 0. Vooraf: staat er iets dubbel binnen één locatie?
-- -----------------------------------------------------------------------------
do $$
declare
  v_dubbel integer;
begin
  select count(*) into v_dubbel
  from (
    select 1
      from public.loyalty_transactions
     where external_reference is not null
     group by organization_id, type, external_reference
    having count(*) > 1
  ) dubbel;

  if v_dubbel > 0 then
    raise exception
      'Migratie 045 gestopt: % toekenning(en) staan dubbel binnen één locatie. Er is niets gewijzigd. Zie de query onderaan de migratie.',
      v_dubbel;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Eén toekenning per bron, per locatie
-- -----------------------------------------------------------------------------
-- Dezelfde boeking, review of welkomstbonus levert een locatie één keer punten
-- op, ongeacht welke collega erbij betrokken was.
--
-- De index is bewust niet meer gedeeltelijk (zonder "where external_reference
-- is not null"). De applicatie legt punten vast met een upsert op deze drie
-- kolommen, en PostgreSQL herkent een gedeeltelijke index daar niet als doel:
-- elke toekenning liep daardoor vast op "no unique or exclusion constraint
-- matching the ON CONFLICT specification". Voor regels zonder verwijzing maakt
-- het geen verschil: lege waarden botsen in een unieke index nooit met elkaar.
drop index if exists public.loyalty_transactions_external_key;
create unique index loyalty_transactions_external_key
  on public.loyalty_transactions (organization_id, type, external_reference);

-- Een account zonder eigenaar is een account van iemand die vertrokken is. Daar
-- mogen er per locatie meer van zijn.
drop index if exists public.loyalty_accounts_legacy_org_unique;

-- -----------------------------------------------------------------------------
-- 2. Het saldo per locatie
-- -----------------------------------------------------------------------------
drop view if exists public.loyalty_balances;
create view public.loyalty_balances
with (security_invoker = true)
as
with locaties as (
  select
    a.organization_id,
    min(a.enrolled_at) as enrolled_at,
    bool_or(a.is_active) as is_active
  from public.loyalty_accounts a
  group by a.organization_id
),
totalen as (
  select
    t.organization_id,
    coalesce(sum(t.points) filter (where t.status in ('available','reserved','redeemed','expired')), 0)::integer as available_points,
    coalesce(sum(t.points) filter (where t.status = 'pending'), 0)::integer as pending_points,
    coalesce(-sum(t.points) filter (where t.status = 'reserved'), 0)::integer as reserved_points,
    coalesce(-sum(t.points) filter (where t.status = 'redeemed'), 0)::integer as redeemed_points,
    coalesce(-sum(t.points) filter (where t.status = 'expired' and t.points < 0), 0)::integer as expired_points,
    coalesce(sum(t.points) filter (where t.points > 0 and t.status in ('available','reserved','redeemed','expired')), 0)::integer as lifetime_earned_points,
    max(t.occurred_at) filter (where t.points > 0) as last_earned_at
  from public.loyalty_transactions t
  where t.status not in ('reversed', 'cancelled')
  group by t.organization_id
)
select
  l.organization_id,
  l.enrolled_at,
  l.is_active,
  coalesce(t.available_points, 0) as available_points,
  coalesce(t.pending_points, 0) as pending_points,
  coalesce(t.reserved_points, 0) as reserved_points,
  coalesce(t.redeemed_points, 0) as redeemed_points,
  coalesce(t.expired_points, 0) as expired_points,
  coalesce(t.lifetime_earned_points, 0) as lifetime_earned_points,
  t.last_earned_at
from locaties l
left join totalen t on t.organization_id = l.organization_id;

comment on view public.loyalty_balances is
  'Het puntensaldo per schoollocatie. Eén rij per organisatie, opgeteld uit het grootboek.';

revoke all on public.loyalty_balances from public, anon;
grant select on public.loyalty_balances to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Leesrechten op het niveau van de locatie
-- -----------------------------------------------------------------------------
-- has_organization_access geldt alleen voor een actief lidmaatschap van een
-- niet-geblokkeerde gebruiker. Wie vertrekt, ziet dus meteen niets meer.
drop policy if exists loyalty_accounts_select on public.loyalty_accounts;
create policy loyalty_accounts_select on public.loyalty_accounts
  for select to authenticated
  using (public.is_admin() or public.has_organization_access(organization_id));

drop policy if exists loyalty_transactions_select on public.loyalty_transactions;
create policy loyalty_transactions_select on public.loyalty_transactions
  for select to authenticated
  using (public.is_admin() or public.has_organization_access(organization_id));

drop policy if exists redemption_requests_select on public.redemption_requests;
create policy redemption_requests_select on public.redemption_requests
  for select to authenticated
  using (public.is_admin() or public.has_organization_access(organization_id));

-- Een verzoek hoort altijd samen te gaan met een reservering. Dat regelt
-- request_redemption. Een losse rij rechtstreeks in de tabel zou een verzoek
-- zonder reservering opleveren, dus dat pad gaat dicht.
drop policy if exists redemption_requests_insert on public.redemption_requests;
revoke insert, update, delete on public.redemption_requests from authenticated, anon;

-- -----------------------------------------------------------------------------
-- 4. Het saldo van een locatie opvragen
-- -----------------------------------------------------------------------------
-- Voor intern gebruik door de functies hieronder. Niet aanroepbaar door
-- gebruikers, want deze controleert niet wie er vraagt.
create or replace function public.loyalty_location_points(p_org uuid)
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

revoke all on function public.loyalty_location_points(uuid) from public, anon, authenticated;
grant execute on function public.loyalty_location_points(uuid) to service_role;

-- Voor het portaal. Geeft het saldo van de locatie, maar alleen aan wie daar
-- een actief lidmaatschap heeft, of aan een beheerder van Skool Workshop.
create or replace function public.loyalty_available_points(p_org uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_admin() or public.has_organization_access(p_org)
      then public.loyalty_location_points(p_org)
    else 0
  end;
$$;

revoke all on function public.loyalty_available_points(uuid) from public, anon;
grant execute on function public.loyalty_available_points(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Inwisselen op het saldo van de locatie
-- -----------------------------------------------------------------------------
-- De voorwaarden zijn ongewijzigd: minimum, maximum, alleen voor een bevestigde
-- workshop die nog moet komen. Nieuw is alleen waartegen getoetst wordt: het
-- saldo van de locatie, met een slot op de locatie.
--
-- Een verzoek is een aanvraag. De punten worden gereserveerd, en pas na
-- goedkeuring door Skool Workshop wordt het voordeel verwerkt.
create or replace function public.request_redemption(
  p_org uuid,
  p_points integer,
  p_booking_id uuid default null,
  p_booking_reference text default null,
  p_note text default null
) returns public.redemption_requests
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
  v_booking public.bookings;
  v_request public.redemption_requests;
  v_tx uuid;
begin
  if auth.uid() is null then raise exception 'Niet ingelogd'; end if;
  if not public.has_organization_access(p_org) then raise exception 'Geen toegang tot deze organisatie'; end if;
  if not public.get_setting_bool('loyalty_enabled', true) then raise exception 'SkoolPartner is momenteel niet actief'; end if;
  if p_points is null or p_points <= 0 then raise exception 'Kies een geldig aantal punten'; end if;

  v_min := public.get_setting_int('redemption_minimum_points', 500);
  v_max := public.get_setting_int('redemption_maximum_points_per_booking', 0);
  v_value := public.get_setting_int('point_value_cents_per_100', 250);
  if p_points < v_min then raise exception 'Minimaal % SkoolPoints per verzoek', v_min; end if;
  if v_max > 0 and p_points > v_max then raise exception 'Maximaal % SkoolPoints per boeking', v_max; end if;

  if p_booking_id is not null then
    select * into v_booking from public.bookings where id = p_booking_id;
    if v_booking.id is null or v_booking.organization_id <> p_org then raise exception 'Deze boeking hoort niet bij uw organisatie'; end if;
    if v_booking.status <> 'confirmed' then raise exception 'U kunt punten alleen gebruiken voor een bevestigde workshop'; end if;
    if v_booking.scheduled_date is null or v_booking.scheduled_date < current_date then raise exception 'U kunt punten alleen gebruiken voor een workshop die nog moet komen'; end if;
  end if;

  -- Het slot op de locatie. Twee collega's die tegelijk een verzoek indienen
  -- komen hier na elkaar doorheen, en de tweede ziet de reservering van de
  -- eerste al in het saldo.
  perform 1 from public.organizations where id = p_org for update;

  if not exists (
    select 1 from public.loyalty_accounts where organization_id = p_org and is_active
  ) then
    raise exception 'Uw organisatie neemt nog niet deel aan SkoolPartner';
  end if;

  -- Het eigen account van de aanvrager legt alleen vast wie het verzoek deed.
  -- Het saldo zelf is van de locatie.
  v_account := public.ensure_loyalty_account(p_org, auth.uid());

  v_available := public.loyalty_location_points(p_org);
  if p_points > v_available then
    raise exception 'Onvoldoende saldo: % beschikbaar, % gevraagd', v_available, p_points;
  end if;

  insert into public.redemption_requests (
    organization_id, requested_by, points, value_cents, point_value_cents_per_100,
    booking_id, booking_reference, note, status
  )
  values (
    p_org, auth.uid(), p_points, (p_points * v_value) / 100, v_value, p_booking_id,
    coalesce(nullif(trim(coalesce(p_booking_reference, '')), ''), v_booking.reference),
    nullif(trim(coalesce(p_note, '')), ''), 'requested'
  )
  returning * into v_request;

  insert into public.loyalty_transactions (
    organization_id, user_id, account_id, type, status, points, point_value_cents_per_100,
    description, source, redemption_id, booking_id, created_by
  )
  values (
    p_org, auth.uid(), v_account, 'redemption_reserve', 'reserved', -p_points, v_value,
    coalesce('Gereserveerd voor ' || v_booking.workshop_name, 'Gereserveerd voor inwisselverzoek'),
    'portal', v_request.id, p_booking_id, auth.uid()
  )
  returning id into v_tx;

  update public.redemption_requests
     set reserve_transaction_id = v_tx
   where id = v_request.id
  returning * into v_request;

  return v_request;
end $$;

revoke all on function public.request_redemption(uuid, integer, uuid, text, text) from public, anon;
grant execute on function public.request_redemption(uuid, integer, uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Verval per locatie
-- -----------------------------------------------------------------------------
-- Dezelfde regel als altijd: punten waarvan de geldigheid voorbij is vervallen,
-- en er vervalt nooit meer dan er nog beschikbaar is. De geschiedenis blijft
-- staan; het verval komt er als eigen regel bij.
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
  v_account uuid;
begin
  if not public.get_setting_bool('points_expiry_enabled', true) then
    return 0;
  end if;

  for v_row in
    select organization_id, sum(points)::integer as expiring_points
    from public.loyalty_transactions
    where status = 'available'
      and points > 0
      and expires_at is not null
      and expires_at <= now()
    group by organization_id
  loop
    perform 1 from public.organizations where id = v_row.organization_id for update;

    v_remaining := least(v_row.expiring_points, public.loyalty_location_points(v_row.organization_id));

    update public.loyalty_transactions
    set status = 'expired'
    where status = 'available'
      and points > 0
      and expires_at is not null
      and expires_at <= now()
      and organization_id = v_row.organization_id;

    if v_remaining > 0 then
      select id into v_account
        from public.loyalty_accounts
       where organization_id = v_row.organization_id
       order by enrolled_at, id
       limit 1;

      insert into public.loyalty_transactions (
        organization_id, account_id, type, status, points,
        point_value_cents_per_100, description, source, external_reference
      )
      values (
        v_row.organization_id, v_account, 'expiry', 'expired', -v_remaining,
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

revoke all on function public.expire_loyalty_points() from public, anon, authenticated;
grant execute on function public.expire_loyalty_points() to service_role;

-- -----------------------------------------------------------------------------
-- 7. De CJP-bonus: één per locatie, ook met meerdere contactpersonen
-- -----------------------------------------------------------------------------
-- De bonus is al eenmalig per organisatie (cjp_bonus_awards). De boeking zelf
-- werd echter gemaakt voor elk actief account van de locatie. Met twee
-- collega's waren dat twee regels, en liep het bevestigen van het CJP-tegoed
-- vast. De functie is ongewijzigd op één punt na: de bonus wordt één keer
-- geboekt, op het oudste actieve account van de locatie.
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
    order by a.enrolled_at, a.id
    limit 1
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

revoke all on function public.confirm_cjp_parking(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.confirm_cjp_parking(uuid, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- 8. Functies die alleen de server mag aanroepen, ook echt dichtzetten
-- -----------------------------------------------------------------------------
-- Deze functies controleren zelf niet wie er vraagt: dat doet de applicatie, die
-- ze uitsluitend met de serviceclient aanroept. Dan moeten ze voor ieder ander
-- ook dicht zitten. Dat was niet overal zo: bij sommige was het recht alleen
-- ingetrokken bij "public" of alleen bij "anon" en "authenticated", en dan
-- blijft de andere route open. Hier worden alle drie ingetrokken.
--
-- Er verandert niets aan wat de applicatie kan: de serviceclient houdt zijn
-- rechten.
revoke all on function public.ensure_loyalty_account(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ensure_loyalty_account(uuid, uuid) to service_role;

revoke all on function public.release_points_for_invoice(uuid) from public, anon, authenticated;
grant execute on function public.release_points_for_invoice(uuid) to service_role;

revoke all on function public.spend_cjp_credit(uuid, integer, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.spend_cjp_credit(uuid, integer, uuid, text, uuid, text) to service_role;

revoke all on function public.enrollment_poging(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.enrollment_poging(uuid, text, integer, integer) to service_role;

revoke all on function public.enrollment_choose(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.enrollment_choose(uuid, uuid, text) to service_role;

-- Instellingen lezen is voor ingelogde gebruikers en de server, niet voor
-- bezoekers zonder account.
revoke all on function public.get_setting(text) from public, anon;
revoke all on function public.get_setting_int(text, integer) from public, anon;
revoke all on function public.get_setting_bool(text, boolean) from public, anon;
grant execute on function public.get_setting(text) to authenticated, service_role;
grant execute on function public.get_setting_int(text, integer) to authenticated, service_role;
grant execute on function public.get_setting_bool(text, boolean) to authenticated, service_role;

-- Een verzoek intrekken mag een lid van de locatie; de functie controleert dat
-- zelf. Een bezoeker zonder account heeft er niets te zoeken.
revoke all on function public.cancel_redemption(uuid, text) from public, anon;
grant execute on function public.cancel_redemption(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

-- Dubbele toekenningen opsporen (alleen lezen):
--
--   select organization_id, type, external_reference, count(*) as aantal,
--          string_agg(user_id::text, ', ') as contactpersonen
--     from public.loyalty_transactions
--    where external_reference is not null
--    group by organization_id, type, external_reference
--   having count(*) > 1;
