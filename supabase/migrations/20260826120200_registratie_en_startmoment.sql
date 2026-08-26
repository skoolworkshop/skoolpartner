-- =============================================================================
-- SkoolPartner - 018 - Registratiegegevens en het echte boekingsmoment
-- =============================================================================
-- Hoort bij de regel dat SkoolPartner pas begint bij een afgeronde registratie
-- en dat er niets met terugwerkende kracht meetelt.
--
-- Het startmoment zelf staat al in loyalty_accounts.enrolled_at. Dat blijft de
-- enige bron. Hier komen alleen de gegevens bij die het registratieformulier en
-- de puntenregel nodig hebben:
--
--   bookings.booked_at        wanneer de boeking tot stand kwam, niet wanneer
--                             wij hem binnenhaalden
--   profiles.first_name/last_name
--   organizations.street / house_number / house_number_addition
--   organization_members.requested_details
--                             wat een aanvrager invulde over een BESTAANDE
--                             organisatie, pas overnemen na goedkeuring
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Wanneer kwam de boeking tot stand
-- -----------------------------------------------------------------------------
alter table public.bookings
  add column if not exists booked_at timestamptz;

comment on column public.bookings.booked_at is
  'Moment waarop de boeking bij Skool Workshop tot stand kwam. Bepaalt of de boeking binnen de SkoolPartner-periode van de klant valt. Niet de factuurdatum en niet het moment van importeren.';

-- Bestaande boekingen krijgen wat er nu ook al voor werd gebruikt.
update public.bookings
set booked_at = created_at
where booked_at is null;

create index if not exists bookings_booked_at_idx
  on public.bookings (organization_id, booked_at);

-- -----------------------------------------------------------------------------
-- 2. Voornaam en achternaam
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name  text;

-- full_name blijft leidend voor alles wat er nu mee werkt. Is het gevuld en de
-- twee nieuwe velden niet, dan splitsen wij het één keer voorzichtig: alles tot
-- de eerste spatie is de voornaam, de rest de achternaam. Namen met een
-- tussenvoegsel blijven zo netjes heel ("de Vries").
update public.profiles
set first_name = nullif(split_part(trim(full_name), ' ', 1), ''),
    last_name  = nullif(trim(substring(trim(full_name) from position(' ' in trim(full_name)) + 1)), '')
where full_name is not null
  and position(' ' in trim(full_name)) > 0
  and first_name is null
  and last_name is null;

-- -----------------------------------------------------------------------------
-- 3. Adres in losse velden
-- -----------------------------------------------------------------------------
alter table public.organizations
  add column if not exists street                text,
  add column if not exists house_number          text,
  add column if not exists house_number_addition text;

comment on column public.organizations.street is
  'Straatnaam. address_line blijft bestaan en wordt hieruit samengesteld.';

-- address_line automatisch bijhouden zodra de losse velden gevuld zijn, zodat
-- er nooit twee versies van hetzelfde adres naast elkaar staan.
create or replace function public.organizations_compose_address()
returns trigger
language plpgsql
as $$
begin
  if new.street is not null and length(trim(new.street)) > 0 then
    new.address_line :=
      trim(new.street) ||
      coalesce(' ' || nullif(trim(coalesce(new.house_number, '')), ''), '') ||
      coalesce(' ' || nullif(trim(coalesce(new.house_number_addition, '')), ''), '');
  end if;
  return new;
end;
$$;

drop trigger if exists organizations_compose_address on public.organizations;
create trigger organizations_compose_address
  before insert or update on public.organizations
  for each row execute function public.organizations_compose_address();

-- -----------------------------------------------------------------------------
-- 4. Wat iemand invult over een bestaande organisatie
-- -----------------------------------------------------------------------------
alter table public.organization_members
  add column if not exists requested_details jsonb;

comment on column public.organization_members.requested_details is
  'Wat de aanvrager bij registratie invulde over de organisatie. Wordt pas naar organizations geschreven nadat een beheerder de aanvraag goedkeurt.';
