-- =============================================================================
-- SkoolPartner - 016 - Inwisselen koppelen aan een bevestigde boeking
-- =============================================================================
-- Een inwisselverzoek hing tot nu toe aan een vrij ingetypte boekingsreferentie.
-- Daardoor kon een klant punten koppelen aan iets wat niet doorgaat, en konden
-- wij achteraf niet aantonen op welke factuur de korting is verwerkt.
--
-- Hierna wijst een verzoek naar een echte boeking, die van dezelfde organisatie
-- moet zijn, de status 'confirmed' moet hebben en in de toekomst moet liggen.
--
-- Bestaande verzoeken houden hun booking_reference en blijven werken.
-- =============================================================================
-- -----------------------------------------------------------------------------
-- 1. Extra kolommen
-- -----------------------------------------------------------------------------
alter table public.redemption_requests
  add column if not exists booking_id uuid references public.bookings (id) on delete set null,
  add column if not exists invoice_number text,
  add column if not exists moneybird_invoice_id text,
  add column if not exists applied_by uuid references public.profiles (id) on delete set null;

comment on column public.redemption_requests.booking_id is
  'De bevestigde toekomstige boeking waarop dit voordeel wordt verrekend.';
comment on column public.redemption_requests.invoice_number is
  'Factuurnummer waarop de korting daadwerkelijk is verwerkt. Bewijs achteraf.';
comment on column public.redemption_requests.applied_by is
  'De beheerder die het voordeel daadwerkelijk heeft verwerkt.';

create index if not exists redemption_requests_booking_idx
  on public.redemption_requests (booking_id) where booking_id is not null;

-- -----------------------------------------------------------------------------
-- 2. request_redemption met controle op de boeking
-- -----------------------------------------------------------------------------
drop function if exists public.request_redemption(uuid, integer, text, text);

create or replace function public.request_redemption(
  p_org uuid,
  p_points integer,
  p_booking_id uuid default null,
  p_booking_reference text default null,
  p_note text default null
)
returns public.redemption_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account   uuid;
  v_available integer;
  v_min       integer;
  v_max       integer;
  v_value     integer;
  v_active    boolean;
  v_booking   public.bookings;
  v_request   public.redemption_requests;
  v_tx        uuid;
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

  v_min   := public.get_setting_int('redemption_minimum_points', 500);
  v_max   := public.get_setting_int('redemption_maximum_points_per_booking', 0);
  v_value := public.get_setting_int('point_value_cents_per_100', 250);

  if p_points < v_min then
    raise exception 'Minimaal % SkoolPoints per verzoek', v_min;
  end if;

  if v_max > 0 and p_points > v_max then
    raise exception 'Maximaal % SkoolPoints per boeking', v_max;
  end if;

  -- NIEUW: het voordeel moet naar een boeking die echt doorgaat.
  if p_booking_id is not null then
    select * into v_booking from public.bookings where id = p_booking_id;

    if v_booking.id is null then
      raise exception 'Deze boeking bestaat niet';
    end if;
    if v_booking.organization_id <> p_org then
      raise exception 'Deze boeking hoort niet bij uw organisatie';
    end if;
    if v_booking.status <> 'confirmed' then
      raise exception 'U kunt punten alleen gebruiken voor een bevestigde workshop';
    end if;
    if v_booking.scheduled_date is null or v_booking.scheduled_date < current_date then
      raise exception 'U kunt punten alleen gebruiken voor een workshop die nog moet komen';
    end if;
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
    point_value_cents_per_100, booking_id, booking_reference, note, status
  )
  values (
    p_org, auth.uid(), p_points, (p_points * v_value) / 100,
    v_value, p_booking_id,
    coalesce(
      nullif(trim(coalesce(p_booking_reference, '')), ''),
      v_booking.reference
    ),
    nullif(trim(coalesce(p_note, '')), ''), 'requested'
  )
  returning * into v_request;

  insert into public.loyalty_transactions (
    organization_id, account_id, type, status, points,
    point_value_cents_per_100, description, source, redemption_id,
    booking_id, created_by
  )
  values (
    p_org, v_account, 'redemption_reserve', 'reserved', -p_points,
    v_value,
    coalesce(
      'Gereserveerd voor ' || v_booking.workshop_name,
      'Gereserveerd voor inwisselverzoek'
    ),
    'portal', v_request.id, p_booking_id, auth.uid()
  )
  returning id into v_tx;

  update public.redemption_requests
  set reserve_transaction_id = v_tx
  where id = v_request.id
  returning * into v_request;

  return v_request;
end;
$$;

grant execute on function public.request_redemption(uuid, integer, uuid, text, text) to authenticated;
