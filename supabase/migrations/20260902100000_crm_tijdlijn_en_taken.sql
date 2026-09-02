-- =============================================================================
-- SkoolPartner - 030 - CRM: tijdlijn en taken
-- =============================================================================
-- Fase 3 uit het plan. Twee tabellen, allebei bruikbaar voor beide merken.
--
-- WAAROM GEEN APARTE NOTITIETABEL
--
--   Het plan noemde nog crm_notes naast crm_activities. Bij het bouwen bleek
--   dat een gekunsteld onderscheid: een notitie is gewoon iets wat je op een
--   moment vastlegt, precies zoals een gesprek of een telefoontje. Twee
--   tabellen zouden betekenen dat je de tijdlijn uit twee bronnen moet
--   samenvoegen en op twee plekken moet zoeken, zonder dat er iets tegenover
--   staat. Een notitie is hier dus een activiteit met soort 'notitie'.
--
--   De vaste notitie bij een relatie blijft wel bestaan: die staat op
--   crm_organization_profiles.note en is iets anders. Dat is wat er altijd
--   geldt, niet wat er ooit is gebeurd.
--
-- HET VERSCHIL TUSSEN EEN ACTIVITEIT EN EEN TAAK
--
--   Een activiteit ligt in het verleden en is een feit. Een taak ligt in de
--   toekomst en is een voornemen. Ze in een tabel proppen met een vlaggetje
--   erbij levert een lijst op waarin je die twee door elkaar ziet lopen, en
--   dat is precies wat je in een CRM niet wilt.
--
-- Opnieuw: er verandert niets aan een bestaande tabel.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- crm_activities: wat er is gebeurd
-- -----------------------------------------------------------------------------
create table if not exists public.crm_activities (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null default 'notitie',
  summary         text not null,
  body            text,
  occurred_at     timestamptz not null default now(),

  -- Een activiteit hangt aan minstens een ding. Meerdere mag: een gesprek met
  -- een contactpersoon over een lopende deal hoort bij allebei, en dan wil je
  -- hem op beide schermen zien.
  organization_id uuid references public.organizations (id) on delete cascade,
  contact_id      uuid references public.crm_contacts (id) on delete cascade,
  deal_id         uuid references public.crm_deals (id) on delete cascade,

  actor_id        uuid references public.profiles (id) on delete set null,
  -- Automatisch aangemaakt door het systeem, of met de hand ingevoerd?
  -- Handmatige regels mag je wijzigen, systeemregels niet: die zijn een
  -- weerslag van iets wat echt is gebeurd.
  is_system       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint crm_activities_soort
    check (kind in ('notitie', 'gesprek', 'telefoon', 'email', 'afspraak', 'systeem')),
  constraint crm_activities_samenvatting_niet_leeg
    check (length(trim(summary)) > 1),
  constraint crm_activities_hangt_ergens_aan
    check (num_nonnulls(organization_id, contact_id, deal_id) >= 1)
);

create index if not exists crm_activities_org_idx
  on public.crm_activities (organization_id, occurred_at desc);
create index if not exists crm_activities_contact_idx
  on public.crm_activities (contact_id, occurred_at desc);
create index if not exists crm_activities_deal_idx
  on public.crm_activities (deal_id, occurred_at desc);

comment on table public.crm_activities is
  'De tijdlijn: wat er is gebeurd bij een relatie, een persoon of een deal. Een notitie is hier ook een activiteit.';


-- -----------------------------------------------------------------------------
-- crm_tasks: wat er nog moet gebeuren
-- -----------------------------------------------------------------------------
-- Een taak mag los staan. Niet alles wat je moet doen hoort bij een klant, en
-- een systeem dat je dwingt om overal een relatie bij te kiezen, gebruik je
-- na twee weken niet meer.
create table if not exists public.crm_tasks (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  note            text,
  due_on          date,
  owner_id        uuid references public.profiles (id) on delete set null,

  organization_id uuid references public.organizations (id) on delete cascade,
  contact_id      uuid references public.crm_contacts (id) on delete cascade,
  deal_id         uuid references public.crm_deals (id) on delete cascade,

  done_at         timestamptz,
  done_by         uuid references public.profiles (id) on delete set null,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint crm_tasks_titel_niet_leeg check (length(trim(title)) > 1),
  -- Afgerond zonder moment, of een moment zonder afronding, kan niet allebei
  -- waar zijn. Zo blijft "is dit af" een vraag met een eenduidig antwoord.
  constraint crm_tasks_afronding_compleet
    check ((done_at is null and done_by is null) or done_at is not null)
);

create index if not exists crm_tasks_open_idx
  on public.crm_tasks (due_on) where done_at is null;
create index if not exists crm_tasks_owner_idx
  on public.crm_tasks (owner_id) where done_at is null;
create index if not exists crm_tasks_org_idx on public.crm_tasks (organization_id);
create index if not exists crm_tasks_deal_idx on public.crm_tasks (deal_id);

comment on table public.crm_tasks is
  'Opvolgacties. Mag los staan van een relatie, want niet alles wat moet gebeuren hoort bij een klant.';


-- -----------------------------------------------------------------------------
-- updated_at bijhouden
-- -----------------------------------------------------------------------------

drop trigger if exists set_crm_activities_updated_at on public.crm_activities;
create trigger set_crm_activities_updated_at
  before update on public.crm_activities
  for each row execute function public.set_updated_at();

drop trigger if exists set_crm_tasks_updated_at on public.crm_tasks;
create trigger set_crm_tasks_updated_at
  before update on public.crm_tasks
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- Rechten: dicht, en dicht blijven
-- -----------------------------------------------------------------------------

alter table public.crm_activities enable row level security;
alter table public.crm_tasks      enable row level security;

alter table public.crm_activities force row level security;
alter table public.crm_tasks      force row level security;

revoke all on public.crm_activities from anon, authenticated;
revoke all on public.crm_tasks      from anon, authenticated;

grant select, insert, update, delete on public.crm_activities to service_role;
grant select, insert, update, delete on public.crm_tasks      to service_role;

-- Geen enkele policy voor authenticated. Een interne notitie over een klant is
-- precies het soort gegeven dat die klant nooit hoort te kunnen opvragen.
