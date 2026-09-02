-- =============================================================================
-- SkoolPartner - 034 - CRM: afspraken
-- =============================================================================
-- Fase 9a: afspraken vastleggen. De boekingslink waarmee een school zelf een
-- moment kiest, komt in 9b; die vraagt een nieuwe Google-toestemming en een
-- publieke pagina, en dat hoort niet in dezelfde stap.
--
-- WAAROM EEN EIGEN TABEL EN GEEN ACTIVITEIT MET EEN VLAGGETJE
--
--   crm_activities beschrijft wat er is gebeurd: een feit uit het verleden met
--   een moment eraan. Een afspraak is iets anders. Die heeft een begin en een
--   eind, staat meestal in de toekomst, kan worden afgezegd, en iemand kan
--   niet komen opdagen. Dat in crm_activities proppen betekent vier kolommen
--   die bij bijna elke rij leeg zijn, en een tijdlijn waarin een voornemen
--   tussen de feiten staat.
--
--   Dezelfde afweging als eerder tussen crm_activities en crm_tasks: een
--   activiteit ligt achter je, een taak en een afspraak liggen voor je.
--
-- VIER STANDEN, EN WAAROM "NIET VERSCHENEN" APART STAAT
--
--   gepland, gehouden, geannuleerd, niet_verschenen.
--
--   Afzeggen is netjes en zegt weinig. Niet komen opdagen zegt wel iets over
--   de relatie, en dat wil je later kunnen terugzien zonder in notities te
--   hoeven graven. Ze op een hoop gooien gooit die informatie weg.
--
-- WAT DE DATABASE BEWAAKT EN WAT DE CODE BEWAAKT
--
--   Database: een afspraak eindigt na zijn begin, hoort ergens bij, en heeft
--   een geldige soort, vorm en stand.
--
--   Code: dat een afspraak die nog moet plaatsvinden niet als gehouden kan
--   worden afgevinkt. Dat hangt af van "nu", en een controleregel in Postgres
--   moet onveranderlijk zijn. Zie afspraken-regels.ts en de bijbehorende test.
--
--   Overlappende afspraken worden bewust NIET geweigerd, alleen gemeld. Twee
--   afspraken tegelijk kan een vergissing zijn, maar ook een bewuste keuze als
--   een collega naar de ene gaat. Een systeem dat dat weigert wordt omzeild.
--
-- Er verandert niets aan een bestaande tabel.
-- =============================================================================


create table if not exists public.crm_meetings (
  id              uuid primary key default gen_random_uuid(),

  title           text not null,
  kind            text not null default 'overig',
  form            text not null default 'op_locatie',

  starts_at       timestamptz not null,
  ends_at         timestamptz not null,

  -- Waar precies, of de link naar het gesprek. Vrije tekst, want een adres,
  -- een lokaalnummer en een videolink zijn alle drie geldige antwoorden.
  location        text,

  status          text not null default 'gepland',

  -- Wat eruit kwam. Alleen zinnig bij een afspraak die is gehouden, maar niet
  -- afgedwongen: bij een afzegging wil je soms ook kwijt waarom.
  outcome         text,
  note            text,

  -- Een afspraak hangt aan minstens een ding, net als een activiteit.
  -- Meerdere mag: een gesprek met een contactpersoon over een lopende deal
  -- hoort bij allebei.
  organization_id uuid references public.organizations (id) on delete cascade,
  contact_id      uuid references public.crm_contacts (id) on delete cascade,
  deal_id         uuid references public.crm_deals (id) on delete cascade,

  -- Wie van ons erbij is.
  owner_id        uuid references public.profiles (id) on delete set null,

  -- Handmatig ingevoerd, of straks binnengekomen via de boekingslink. Deze
  -- kolom staat er nu al zodat 9b geen tabelwijziging nodig heeft; hij houdt
  -- tot die tijd altijd de waarde 'handmatig'.
  source          text not null default 'handmatig',

  -- Gereserveerd voor 9b: het id van de gebeurtenis in Google Agenda. Blijft
  -- leeg zolang er geen agendakoppeling is.
  calendar_event_id text,

  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint crm_meetings_titel_niet_leeg check (length(trim(title)) > 1),

  constraint crm_meetings_soort check (
    kind in ('kennismaking', 'intake', 'advies', 'rondleiding', 'evaluatie', 'overig')
  ),
  constraint crm_meetings_vorm check (
    form in ('op_locatie', 'bij_ons', 'videobellen', 'telefoon')
  ),
  constraint crm_meetings_stand check (
    status in ('gepland', 'gehouden', 'geannuleerd', 'niet_verschenen')
  ),
  constraint crm_meetings_herkomst check (source in ('handmatig', 'boekingslink')),

  -- Een afspraak eindigt na zijn begin. Zonder deze regel kan een verkeerd
  -- ingevulde eindtijd een negatieve duur opleveren, en dan kloppen alle
  -- gemiddelden die daarna worden berekend niet meer.
  constraint crm_meetings_volgorde check (ends_at > starts_at),

  -- En hij duurt niet langer dan een etmaal. Dat is geen afspraak meer maar
  -- een typefout in het jaartal.
  constraint crm_meetings_redelijke_duur check (ends_at <= starts_at + interval '1 day'),

  constraint crm_meetings_hangt_ergens_aan
    check (num_nonnulls(organization_id, contact_id, deal_id) >= 1)
);

-- De agenda-vraag: wat staat er de komende tijd te gebeuren.
create index if not exists crm_meetings_start_idx
  on public.crm_meetings (starts_at);

-- De opvolgvraag: wat staat er nog open. Alleen geplande afspraken, want naar
-- de afgeronde kijk je niet als je wilt weten wat er nog moet.
create index if not exists crm_meetings_gepland_idx
  on public.crm_meetings (starts_at)
  where status = 'gepland';

create index if not exists crm_meetings_org_idx
  on public.crm_meetings (organization_id, starts_at desc);
create index if not exists crm_meetings_contact_idx
  on public.crm_meetings (contact_id, starts_at desc);
create index if not exists crm_meetings_deal_idx
  on public.crm_meetings (deal_id, starts_at desc);
create index if not exists crm_meetings_owner_idx
  on public.crm_meetings (owner_id, starts_at desc);

comment on table public.crm_meetings is
  'Afspraken met een school of een deelnemer. Een afspraak ligt voor je en heeft een begin en een eind; een activiteit ligt achter je. Daarom een eigen tabel.';
comment on column public.crm_meetings.status is
  'gepland, gehouden, geannuleerd of niet_verschenen. Niet verschenen staat bewust los van geannuleerd, want dat zegt iets anders over de relatie.';
comment on column public.crm_meetings.source is
  'handmatig, of boekingslink zodra fase 9b bestaat. Staat er nu al zodat die stap geen tabelwijziging nodig heeft.';
comment on column public.crm_meetings.calendar_event_id is
  'Gereserveerd voor de koppeling met Google Agenda in fase 9b. Blijft leeg zolang die er niet is.';


-- -----------------------------------------------------------------------------
-- updated_at bijhouden
-- -----------------------------------------------------------------------------

drop trigger if exists set_crm_meetings_updated_at on public.crm_meetings;
create trigger set_crm_meetings_updated_at
  before update on public.crm_meetings
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- Rechten: dicht, zoals elke CRM-tabel
-- -----------------------------------------------------------------------------
-- Wat er in een gesprek met een school is gezegd, is niets voor het
-- klantportaal. Zelfde patroon als alle andere crm_-tabellen.
--
-- LET OP voor fase 9b: als een school straks via een boekingslink zelf een
-- moment kiest, dan gebeurt dat schrijven met de serviceclient in een
-- serveractie, en NIET door hier een policy voor anon open te zetten. Een
-- openbare pagina hoort geen schrijfrechten op deze tabel te krijgen.

alter table public.crm_meetings enable row level security;
alter table public.crm_meetings force row level security;

revoke all on public.crm_meetings from anon, authenticated;

grant select, insert, update, delete on public.crm_meetings to service_role;
