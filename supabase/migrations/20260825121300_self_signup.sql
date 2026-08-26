-- =============================================================================
-- SkoolPartner - 014 - Zelf aanmelden zonder wachtrij
-- =============================================================================
-- Een school die zich zelf aanmeldt komt voortaan meteen binnen. De organisatie
-- staat dan wel als "nog te controleren", zodat Skool Workshop hem kan
-- koppelen aan de echte klant in Moneybird.
--
-- Dat is veilig: zolang een organisatie niet gekoppeld is, hangen er geen
-- boekingen, facturen of punten aan. Er valt dus niets te zien wat niet mag.
-- Het enige verschil is dat de klant niet zit te wachten.
-- =============================================================================

alter table public.organizations
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references public.profiles (id) on delete set null;

comment on column public.organizations.verified_at is
  'Leeg betekent: door een klant zelf aangemeld en nog niet gecontroleerd door Skool Workshop.';

-- Alles wat er nu al staat is door een beheerder aangemaakt of via demodata,
-- dus dat rekenen we als gecontroleerd.
update public.organizations
set verified_at = coalesce(verified_at, created_at)
where verified_at is null;

create index if not exists organizations_unverified_idx
  on public.organizations (created_at desc) where verified_at is null;
