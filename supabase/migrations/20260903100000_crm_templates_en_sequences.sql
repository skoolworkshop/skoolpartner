-- =============================================================================
-- SkoolPartner - 038 - CRM: e-mailtemplates en sequences
-- =============================================================================
-- Het laatste stuk dat uit HubSpot moet worden nagebouwd. Deze migratie legt
-- alleen de tabellen aan; er wordt geen enkele template en geen enkele sequence
-- gevuld. Wat erin komt, komt uit de export uit HubSpot, en pas nadat is
-- vastgesteld wat er daar echt wordt gebruikt.
--
-- ============================================================================
-- DE REGEL DIE ALLES HIER BEPAALT: DIT SYSTEEM VERSTUURT NOOIT UIT ZICHZELF
-- ============================================================================
--
--   In HubSpot stuurt een sequence zelf mail. Dat is precies het onderdeel
--   waar het bij een klein bedrijf misgaat: iemand komt in een reeks terecht,
--   niemand kijkt er meer naar, en drie weken later krijgt een school die al
--   nee heeft gezegd nog een herinnering.
--
--   Hier gebeurt dat niet. Een sequence maakt klaar wat er verstuurd moet
--   worden en zet het op de lijst. Een mens drukt op verzenden. Daarom staat er
--   in deze tabellen ook nergens een kolom "verzenden op": er staat "klaarzetten
--   op". Dat verschil is met opzet zichtbaar in de naamgeving, zodat niemand
--   later per ongeluk een verzendknop aan een cron hangt.
--
-- ============================================================================
-- WAAROM TEMPLATES NAAST FRAGMENTEN BESTAAN
-- ============================================================================
--
--   Een fragment (crm_snippets) is een stuk tekst dat je in een bericht plakt:
--   de uitleg over de opzet van een workshopdag, de routebeschrijving.
--
--   Een template is een heel bericht: het heeft een onderwerpregel en het is op
--   zichzelf te versturen. Dat verschil is niet cosmetisch. Een fragment zonder
--   onderwerp kun je niet mailen, en een template halverwege een zin plakken
--   levert onzin op. Ze delen wel dezelfde personalisatie: precies dezelfde
--   tokens, dezelfde regel dat een ontbrekende waarde zichtbaar blijft staan.
--
-- Er verandert niets aan een bestaande tabel of kolom.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- crm_templates: een heel bericht
-- -----------------------------------------------------------------------------
create table if not exists public.crm_templates (
  id          uuid primary key default gen_random_uuid(),

  -- Leeg betekent: geldt voor beide merken. Net als bij de fragmenten.
  brand       public.crm_brand,

  name        text not null,
  subject     text not null,
  body        text not null,
  category    text,

  -- Archiveren in plaats van verwijderen. Een template dat ooit is gebruikt,
  -- staat in de historie van verstuurde berichten; hem weggooien zou die
  -- historie onleesbaar maken.
  is_archived boolean not null default false,

  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint crm_templates_naam_niet_leeg check (length(trim(name)) > 1),
  constraint crm_templates_onderwerp_niet_leeg check (length(trim(subject)) > 1),
  constraint crm_templates_tekst_niet_leeg check (length(trim(body)) > 1)
);

-- Dezelfde twee gedeeltelijke indexen als bij de fragmenten, en om dezelfde
-- reden: in een unieke index is null niet gelijk aan null, dus een template
-- voor beide merken zou anders zo vaak mogen bestaan als je hem aanmaakt.
create unique index if not exists crm_templates_naam_per_merk_idx
  on public.crm_templates (lower(name), brand) where brand is not null;
create unique index if not exists crm_templates_naam_beide_merken_idx
  on public.crm_templates (lower(name)) where brand is null;

create index if not exists crm_templates_actief_idx
  on public.crm_templates (brand) where is_archived = false;

comment on table public.crm_templates is
  'Hele berichten met onderwerp en tekst. Een fragment is een stuk tekst, een template is een bericht.';


-- -----------------------------------------------------------------------------
-- crm_sequences: een reeks stappen
-- -----------------------------------------------------------------------------
create table if not exists public.crm_sequences (
  id          uuid primary key default gen_random_uuid(),
  brand       public.crm_brand not null,
  name        text not null,
  description text,

  -- De afzender is per sequence in te stellen. Een opvolgreeks van Suri hoort
  -- niet vanaf het adres van Skool Workshop te vertrekken.
  sender_id   uuid references public.profiles (id) on delete set null,

  is_active   boolean not null default false,

  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint crm_sequences_naam_niet_leeg check (length(trim(name)) > 1)
);

create unique index if not exists crm_sequences_naam_per_merk_idx
  on public.crm_sequences (lower(name), brand);

comment on table public.crm_sequences is
  'Een reeks opvolgstappen. Zet klaar wat er moet gebeuren; verstuurt zelf nooit iets.';


-- -----------------------------------------------------------------------------
-- crm_sequence_steps: wat er per stap gebeurt
-- -----------------------------------------------------------------------------
create table if not exists public.crm_sequence_steps (
  id           uuid primary key default gen_random_uuid(),
  sequence_id  uuid not null references public.crm_sequences (id) on delete cascade,

  position     integer not null,

  -- Wachten vanaf de vorige stap, in dagen. Nul betekent dezelfde dag.
  wait_days    integer not null default 0,

  kind         text not null default 'email',

  -- Bij een e-mailstap: welk bericht. Bewust een verwijzing en geen kopie van
  -- de tekst, zodat een tekstwijziging op een plek gebeurt.
  template_id  uuid references public.crm_templates (id) on delete restrict,

  -- Bij een taak- of belstap: wat er moet gebeuren.
  title        text,
  note         text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint crm_sequence_steps_soort check (kind in ('email', 'taak', 'bellen')),
  constraint crm_sequence_steps_wachttijd check (wait_days between 0 and 365),

  -- Een e-mailstap zonder bericht is een lege stap, en een taakstap zonder
  -- omschrijving is een taak waarvan niemand weet wat hij inhoudt.
  constraint crm_sequence_steps_compleet check (
    (kind = 'email' and template_id is not null)
    or (kind in ('taak', 'bellen') and length(trim(coalesce(title, ''))) > 1)
  )
);

create unique index if not exists crm_sequence_steps_volgorde_idx
  on public.crm_sequence_steps (sequence_id, position);

comment on column public.crm_sequence_steps.wait_days is
  'Dagen wachten na de vorige stap. Bepaalt wanneer de stap wordt klaargezet, niet wanneer er iets vertrekt.';


-- -----------------------------------------------------------------------------
-- crm_sequence_enrollments: wie er in een reeks zit
-- -----------------------------------------------------------------------------
create table if not exists public.crm_sequence_enrollments (
  id             uuid primary key default gen_random_uuid(),
  sequence_id    uuid not null references public.crm_sequences (id) on delete cascade,
  contact_id     uuid not null references public.crm_contacts (id) on delete cascade,

  -- Waar het over gaat, als dat bekend is. Een opvolgreeks hangt bijna altijd
  -- aan een offerte.
  deal_id        uuid references public.crm_deals (id) on delete set null,

  status         text not null default 'actief',

  -- Welke stap als eerstvolgende klaarstaat, en wanneer.
  next_step      integer not null default 1,
  next_action_at timestamptz,

  -- Waarom hij is gestopt. Verplicht bij handmatig stoppen, want "waarom is
  -- deze school eruit gehaald" is precies de vraag die je een maand later stelt.
  stop_reason    text,

  started_by     uuid references public.profiles (id) on delete set null,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint crm_sequence_enrollments_stand check (
    status in ('actief', 'gepauzeerd', 'afgerond', 'gestopt')
  ),
  constraint crm_sequence_enrollments_stop_met_reden check (
    status <> 'gestopt' or length(trim(coalesce(stop_reason, ''))) > 1
  ),
  constraint crm_sequence_enrollments_afgerond_heeft_datum check (
    status not in ('afgerond', 'gestopt') or finished_at is not null
  )
);

/*
  Een contact zit maar een keer tegelijk in dezelfde reeks.

  Zonder deze index kan iemand die al drie stappen ver is er nog een keer bij
  worden gezet, en krijgt dezelfde school twee keer dezelfde herinnering. Dat is
  het soort fout dat je niet aan de ontvanger kunt uitleggen.

  Gedeeltelijk, want na afloop mag iemand later opnieuw in dezelfde reeks.
*/
create unique index if not exists crm_sequence_enrollments_een_keer_idx
  on public.crm_sequence_enrollments (sequence_id, contact_id)
  where status in ('actief', 'gepauzeerd');

create index if not exists crm_sequence_enrollments_werklijst_idx
  on public.crm_sequence_enrollments (next_action_at)
  where status = 'actief';

create index if not exists crm_sequence_enrollments_contact_idx
  on public.crm_sequence_enrollments (contact_id);

comment on table public.crm_sequence_enrollments is
  'Wie er in een reeks zit en welke stap klaarstaat. Er wordt nooit automatisch iets verstuurd.';


-- -----------------------------------------------------------------------------
-- updated_at bijhouden
-- -----------------------------------------------------------------------------

drop trigger if exists set_crm_templates_updated_at on public.crm_templates;
create trigger set_crm_templates_updated_at
  before update on public.crm_templates
  for each row execute function public.set_updated_at();

drop trigger if exists set_crm_sequences_updated_at on public.crm_sequences;
create trigger set_crm_sequences_updated_at
  before update on public.crm_sequences
  for each row execute function public.set_updated_at();

drop trigger if exists set_crm_sequence_steps_updated_at on public.crm_sequence_steps;
create trigger set_crm_sequence_steps_updated_at
  before update on public.crm_sequence_steps
  for each row execute function public.set_updated_at();

drop trigger if exists set_crm_sequence_enrollments_updated_at on public.crm_sequence_enrollments;
create trigger set_crm_sequence_enrollments_updated_at
  before update on public.crm_sequence_enrollments
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- Rechten: dicht, en dicht blijven
-- -----------------------------------------------------------------------------
-- Supabase geeft nieuwe tabellen in het schema public standaard rechten aan
-- anon en authenticated. Zonder deze regels zou een ingelogde klant de
-- opvolgreeksen kunnen lezen waarin hij zelf zit.

alter table public.crm_templates enable row level security;
alter table public.crm_templates force row level security;
alter table public.crm_sequences enable row level security;
alter table public.crm_sequences force row level security;
alter table public.crm_sequence_steps enable row level security;
alter table public.crm_sequence_steps force row level security;
alter table public.crm_sequence_enrollments enable row level security;
alter table public.crm_sequence_enrollments force row level security;

revoke all on public.crm_templates             from anon, authenticated;
revoke all on public.crm_sequences             from anon, authenticated;
revoke all on public.crm_sequence_steps        from anon, authenticated;
revoke all on public.crm_sequence_enrollments  from anon, authenticated;

grant select, insert, update, delete on public.crm_templates            to service_role;
grant select, insert, update, delete on public.crm_sequences            to service_role;
grant select, insert, update, delete on public.crm_sequence_steps       to service_role;
grant select, insert, update, delete on public.crm_sequence_enrollments to service_role;
