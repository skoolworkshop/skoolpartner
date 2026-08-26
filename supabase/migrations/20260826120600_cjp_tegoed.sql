-- =============================================================================
-- SkoolPartner - 021 - CJP-tegoed parkeren
-- =============================================================================
-- Scholen parkeren hun resterende CJP-budget bij Skool Workshop als geldtegoed.
--
-- KERNGEDACHTE
--   Euro's en punten zijn twee verschillende dingen en blijven dat.
--
--   SkoolPoints   loyaliteitspunten, staan in loyalty_transactions
--   CJP-tegoed    een geldbedrag in eurocenten, staat in een eigen grootboek
--
--   Het geparkeerde bedrag wordt nooit omgerekend naar punten. De bonus van
--   1.000 SkoolPoints is een aparte boeking in het bestaande puntensysteem, en
--   heeft niets met de hoogte van het bedrag te maken.
--
-- WAT ERBIJ KOMT
--   1. cjp_parking_requests      de aanvraag, met een momentopname van de
--                                budgethouder
--   2. cjp_credit_transactions   het geldgrootboek: bij, af, en waarom
--   3. cjp_credit_balances       een view die het saldo altijd uit het
--                                grootboek berekent, nooit uit een los veld
--   4. confirm_cjp_parking()     bevestigen in één transactie, herhaalbaar
--   5. spend_cjp_credit()        afboeken, nooit meer dan er staat
--   6. loyalty_transaction_type krijgt de waarde 'cjp_bonus' erbij
--   7. een paar instellingen in app_settings
--
-- WELKE BESTAANDE DATA WORDT GERAAKT
--   Geen. Er komen alleen nieuwe tabellen bij. Bestaande punten, facturen,
--   boekingen en instellingen blijven onaangeroerd. Er wordt niets omgezet en
--   niets verwijderd.
--
-- BEDRAGEN IN CENTEN
--   Overal integers in eurocenten, net als bij facturen en de puntwaarde.
--   Met kommagetallen krijg je vroeg of laat afrondingsfouten in geld, en dat
--   wil je niet in een administratie.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. De aanvraag
-- -----------------------------------------------------------------------------
-- De gegevens van de budgethouder staan hier als momentopname. Wisselt de
-- contactpersoon later, dan blijft bij een oude aanvraag zichtbaar wie het
-- destijds was. Daarom zijn het gewone tekstvelden en geen verwijzing naar
-- profiles.
create table if not exists public.cjp_parking_requests (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,

  -- Momentopname, bewust niet gekoppeld aan een profiel.
  school_name           text not null,
  cjp_school_number     text not null,
  holder_name           text not null,
  holder_email          text not null,
  holder_phone          text,

  amount_cents          integer not null,
  status                text not null default 'requested',

  -- Wie diende het in, voor intern gebruik.
  requested_by          uuid references public.profiles (id) on delete set null,
  requested_by_email    text,

  decided_by            uuid references public.profiles (id) on delete set null,
  decided_at            timestamptz,
  decision_note         text,

  -- Gevuld zodra er daadwerkelijk tegoed van is gemaakt.
  credit_transaction_id uuid,
  bonus_transaction_id  uuid,

  notified_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint cjp_requests_amount_positive check (amount_cents > 0),
  constraint cjp_requests_amount_sane check (amount_cents <= 5000000),
  constraint cjp_requests_status_valid
    check (status in ('requested', 'in_review', 'confirmed', 'rejected')),
  constraint cjp_requests_school_number_filled
    check (length(trim(cjp_school_number)) >= 3),
  constraint cjp_requests_email_filled
    check (position('@' in holder_email) > 1)
);

create index if not exists cjp_requests_org_idx
  on public.cjp_parking_requests (organization_id, created_at desc);
create index if not exists cjp_requests_status_idx
  on public.cjp_parking_requests (status) where status in ('requested', 'in_review');

drop trigger if exists cjp_requests_set_updated_at on public.cjp_parking_requests;
create trigger cjp_requests_set_updated_at before update on public.cjp_parking_requests
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 2. Het geldgrootboek
-- -----------------------------------------------------------------------------
create table if not exists public.cjp_credit_transactions (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,

  -- Positief is erbij, negatief is eraf. Nooit nul.
  amount_cents       integer not null,
  type               text not null,
  description        text not null,

  request_id         uuid references public.cjp_parking_requests (id) on delete set null,
  booking_id         uuid references public.bookings (id) on delete set null,
  invoice_number     text,

  -- Zorgt dat dezelfde bron nooit twee keer geld oplevert.
  external_reference text,

  created_by         uuid references public.profiles (id) on delete set null,
  note               text,
  occurred_at        timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint cjp_credit_amount_not_zero check (amount_cents <> 0),
  constraint cjp_credit_type_valid
    check (type in ('parking', 'spend', 'correction', 'refund')),
  -- Het teken moet bij de soort passen. Zo kan een afboeking nooit per ongeluk
  -- geld toevoegen.
  constraint cjp_credit_sign_matches_type check (
    case
      when type in ('parking', 'refund') then amount_cents > 0
      when type = 'spend' then amount_cents < 0
      else true
    end
  ),
  -- Een correctie zonder uitleg is later niet te verantwoorden.
  constraint cjp_credit_correction_needs_note
    check (type <> 'correction' or (note is not null and length(trim(note)) > 2))
);

create index if not exists cjp_credit_org_idx
  on public.cjp_credit_transactions (organization_id, occurred_at desc);

create unique index if not exists cjp_credit_external_key
  on public.cjp_credit_transactions (organization_id, type, external_reference)
  where external_reference is not null;

drop trigger if exists cjp_credit_set_updated_at on public.cjp_credit_transactions;
create trigger cjp_credit_set_updated_at before update on public.cjp_credit_transactions
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 3. Het saldo, altijd berekend
-- -----------------------------------------------------------------------------
-- Net als bij SkoolPoints: nooit een saldo in een losse kolom bewaren. Een
-- kolom kan uit de pas gaan lopen met de boekingen eronder; een som niet.
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
left join public.cjp_credit_transactions t on t.organization_id = o.id
group by o.id;

comment on view public.cjp_credit_balances is
  'Het CJP- of Skool Workshop-tegoed in eurocenten, altijd berekend uit het grootboek. Los van SkoolPoints.';


-- -----------------------------------------------------------------------------
-- 4. De bonus krijgt een eigen soort
-- -----------------------------------------------------------------------------
-- De bonus blijft een gewone regel in het bestaande puntensysteem. Er komt dus
-- geen tweede puntensysteem bij; alleen een naam zodat klant en beheerder zien
-- waar die punten vandaan komen.
--
-- Let op bij het uitvoeren: Postgres staat niet toe dat een zojuist toegevoegde
-- enum-waarde in diezelfde transactie ook gebruikt wordt. Dat gebeurt hier niet
-- (de waarde staat alleen als tekst in een functie, die pas later draait), dus
-- dit bestand mag in één keer. Draai het wel af voordat de eerste aanvraag
-- bevestigd wordt.
alter type public.loyalty_transaction_type add value if not exists 'cjp_bonus';


-- -----------------------------------------------------------------------------
-- 5. Instellingen
-- -----------------------------------------------------------------------------
insert into public.app_settings (key, value, label, description, group_name, value_type, is_public, sort_order)
values
  ('cjp_parking_enabled', 'true'::jsonb, 'CJP-tegoed parkeren aanzetten',
   'Toont de knop CJP-tegoed parkeren in het klantportaal.',
   'skoolpartner', 'boolean', true, 180),

  ('cjp_bonus_enabled', 'true'::jsonb, 'Bonus bij CJP-tegoed',
   'Kent bonuspunten toe zodra een CJP-aanvraag wordt bevestigd.',
   'skoolpartner', 'boolean', true, 181),

  ('cjp_bonus_points', '1000'::jsonb, 'Bonuspunten bij CJP-tegoed',
   'Aantal SkoolPoints per bevestigde CJP-parkeeraanvraag.',
   'skoolpartner', 'number', true, 182),

  ('cjp_bonus_cooldown_days', '90'::jsonb, 'Wachttijd tussen twee CJP-bonussen',
   'Binnen dit aantal dagen krijgt dezelfde organisatie maar één keer de bonus. Het tegoed zelf wordt wel gewoon bijgeschreven. Op 0 zetten betekent: elke bevestigde aanvraag levert de bonus op.',
   'skoolpartner', 'number', false, 183),

  -- Publiek, want de klant moet in het formulier kunnen zien wat het
  -- minimumbedrag is voordat hij iets invult.
  ('cjp_minimum_amount_cents', '5000'::jsonb, 'Minimumbedrag om te parkeren',
   'In eurocenten. Voorkomt aanvragen van een paar euro.',
   'skoolpartner', 'number', true, 184),

  ('cjp_notify_email', '""'::jsonb, 'E-mailadres voor CJP-aanvragen',
   'Hier komt de melding van een nieuwe CJP-aanvraag binnen. Leeg laten betekent: naar het algemene supportadres.',
   'skoolpartner', 'text', false, 185)
on conflict (key) do nothing;


-- -----------------------------------------------------------------------------
-- 6. Bevestigen: in één transactie, en herhaalbaar
-- -----------------------------------------------------------------------------
-- Twee keer op Bevestigen klikken mag nooit twee keer tegoed of twee keer een
-- bonus opleveren. Dat wordt hier op drie manieren afgedwongen:
--
--   1. De aanvraagregel wordt vergrendeld (for update). Een tweede aanroep
--      wacht netjes en ziet daarna de nieuwe status.
--   2. Staat de aanvraag al op 'confirmed', dan doet de functie niets meer en
--      geeft zij gewoon de bestaande regel terug.
--   3. Beide boekingen hebben een external_reference met een unieke index. Zou
--      er ondanks alles toch een tweede poging langskomen, dan botst die op de
--      index in plaats van geld bij te schrijven.
create or replace function public.confirm_cjp_parking(
  p_request uuid,
  p_actor   uuid default null,
  p_note    text default null
)
returns public.cjp_parking_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request   public.cjp_parking_requests;
  v_credit    uuid;
  v_bonus     uuid;
  v_points    integer;
  v_bonus_aan boolean;
  v_cooldown  integer;
  v_waarde    integer;
  v_recent    boolean;
begin
  select * into v_request
  from public.cjp_parking_requests
  where id = p_request
  for update;

  if v_request.id is null then
    raise exception 'Deze aanvraag bestaat niet';
  end if;

  -- Al bevestigd: niets doen. Dit is de belangrijkste regel van deze functie.
  if v_request.status = 'confirmed' then
    return v_request;
  end if;

  if v_request.status = 'rejected' then
    raise exception 'Deze aanvraag is afgewezen en kan niet meer worden bevestigd';
  end if;

  -- Het geld erbij.
  insert into public.cjp_credit_transactions (
    organization_id, amount_cents, type, description,
    request_id, external_reference, created_by, note
  ) values (
    v_request.organization_id,
    v_request.amount_cents,
    'parking',
    'CJP-tegoed toegevoegd',
    v_request.id,
    'request:' || v_request.id::text,
    p_actor,
    p_note
  )
  returning id into v_credit;

  -- De bonus in punten. Los van het bedrag, en alleen als hij aan staat.
  v_bonus_aan := public.get_setting_bool('cjp_bonus_enabled', true);
  v_points    := public.get_setting_int('cjp_bonus_points', 1000);
  v_cooldown  := public.get_setting_int('cjp_bonus_cooldown_days', 90);
  v_waarde    := public.get_setting_int('point_value_cents_per_100', 250);

  -- Misbruik voorkomen: wie zijn bedrag in vijf aanvragen knipt, krijgt niet
  -- vijf keer de bonus. Het tegoed wordt wel gewoon volledig bijgeschreven.
  v_recent := false;
  if v_cooldown > 0 then
    select exists (
      select 1
      from public.loyalty_transactions
      where organization_id = v_request.organization_id
        and type = 'cjp_bonus'
        and occurred_at > now() - make_interval(days => v_cooldown)
    ) into v_recent;
  end if;

  if v_bonus_aan and v_points > 0 and not v_recent then
    insert into public.loyalty_transactions (
      organization_id, account_id, type, status, points,
      point_value_cents_per_100, description, source,
      external_reference, available_at, created_by
    )
    select
      v_request.organization_id,
      a.id,
      'cjp_bonus',
      'available',
      v_points,
      v_waarde,
      'Bonus bij geparkeerd CJP-tegoed',
      'portal',
      'cjp:' || v_request.id::text,
      now(),
      p_actor
    from public.loyalty_accounts a
    where a.organization_id = v_request.organization_id
      and a.is_active
    on conflict (organization_id, type, external_reference)
      where external_reference is not null
    do nothing
    returning id into v_bonus;
  end if;

  update public.cjp_parking_requests
  set status = 'confirmed',
      decided_by = p_actor,
      decided_at = now(),
      decision_note = coalesce(p_note, decision_note),
      credit_transaction_id = v_credit,
      bonus_transaction_id = v_bonus
  where id = v_request.id
  returning * into v_request;

  return v_request;
end;
$$;


-- -----------------------------------------------------------------------------
-- 7. Afboeken: nooit meer dan er staat
-- -----------------------------------------------------------------------------
-- De organisatieregel wordt vergrendeld voordat het saldo wordt gelezen. Twee
-- beheerders die tegelijk hetzelfde tegoed willen gebruiken, kunnen daardoor
-- samen nooit meer afboeken dan er is.
create or replace function public.spend_cjp_credit(
  p_org            uuid,
  p_amount_cents   integer,
  p_booking        uuid default null,
  p_invoice_number text default null,
  p_actor          uuid default null,
  p_note           text default null
)
returns public.cjp_credit_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock      uuid;
  v_saldo     integer;
  v_booking   public.bookings;
  v_row       public.cjp_credit_transactions;
  v_omschrijving text;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Vul een bedrag groter dan nul in';
  end if;

  select id into v_lock from public.organizations where id = p_org for update;
  if v_lock is null then
    raise exception 'Deze organisatie bestaat niet';
  end if;

  select coalesce(sum(amount_cents), 0)::integer into v_saldo
  from public.cjp_credit_transactions
  where organization_id = p_org;

  if p_amount_cents > v_saldo then
    raise exception 'Onvoldoende tegoed: % beschikbaar, % gevraagd', v_saldo, p_amount_cents;
  end if;

  v_omschrijving := 'CJP-tegoed gebruikt';

  if p_booking is not null then
    select * into v_booking from public.bookings where id = p_booking;

    if v_booking.id is null then
      raise exception 'Deze boeking bestaat niet';
    end if;
    if v_booking.organization_id <> p_org then
      raise exception 'Deze boeking hoort niet bij deze organisatie';
    end if;

    v_omschrijving := v_booking.workshop_name;
  end if;

  insert into public.cjp_credit_transactions (
    organization_id, amount_cents, type, description,
    booking_id, invoice_number, created_by, note
  ) values (
    p_org, -p_amount_cents, 'spend', v_omschrijving,
    p_booking, p_invoice_number, p_actor, p_note
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.confirm_cjp_parking(uuid, uuid, text) from public;
revoke all on function public.spend_cjp_credit(uuid, integer, uuid, text, uuid, text) from public;
grant execute on function public.confirm_cjp_parking(uuid, uuid, text) to service_role;
grant execute on function public.spend_cjp_credit(uuid, integer, uuid, text, uuid, text) to service_role;


-- -----------------------------------------------------------------------------
-- 8. Row Level Security
-- -----------------------------------------------------------------------------
-- Een klant ziet uitsluitend het tegoed en de aanvragen van zijn eigen
-- organisatie. Aanmaken, bevestigen en afboeken gebeurt via de server met de
-- service role, precies zoals bij de andere onderdelen.
alter table public.cjp_parking_requests enable row level security;
alter table public.cjp_credit_transactions enable row level security;

drop policy if exists cjp_requests_select on public.cjp_parking_requests;
create policy cjp_requests_select on public.cjp_parking_requests
  for select to authenticated
  using (public.has_organization_access(organization_id) or public.is_admin());

drop policy if exists cjp_credit_select on public.cjp_credit_transactions;
create policy cjp_credit_select on public.cjp_credit_transactions
  for select to authenticated
  using (public.has_organization_access(organization_id) or public.is_admin());

grant select on public.cjp_parking_requests to authenticated;
grant select on public.cjp_credit_transactions to authenticated;
grant select on public.cjp_credit_balances to authenticated;
