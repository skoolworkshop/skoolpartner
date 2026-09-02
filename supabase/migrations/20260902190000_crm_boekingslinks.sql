-- =============================================================================
-- SkoolPartner - 035 - CRM: boekingslinks
-- =============================================================================
-- Fase 9b: een school kiest zelf een moment uit de vrije tijd in de agenda,
-- via een openbare pagina.
--
-- WAT HIER HET GEVOELIGST IS, EN HOE HET IS OPGELOST
--
--   Dit is het eerste onderdeel van het CRM waar iemand van buiten iets kan
--   veroorzaken. Een openbare pagina die in de agenda schrijft is precies het
--   soort ding waar misbruik op loert.
--
--   1. GEEN ENKEL RECHT VOOR ANON. De openbare pagina leest en schrijft via de
--      serviceclient in een serveractie, met alle controles ervoor. Er komt
--      dus geen policy voor anon op deze tabellen, net zomin als op de andere
--      crm_-tabellen. Een bezoeker praat nooit rechtstreeks met de database.
--
--   2. HET GEKOZEN MOMENT WORDT OPNIEUW GEREKEND. Wat er op het scherm van de
--      bezoeker stond, kan achterhaald zijn. Bij het boeken bepaalt de server
--      opnieuw of dat moment vrij is; alleen dan gaat het door. Zie
--      beschikbaarheid.ts en de bijbehorende test.
--
--      De database bewaakt daarnaast dat er niet twee keer op hetzelfde moment
--      via dezelfde link geboekt kan worden. Twee bezoekers die tegelijk op
--      dezelfde knop drukken, zijn met een controle in de code alleen niet
--      tegen te houden.
--
--   3. EEN LINK IS NIET TE RADEN. De sleutel in het adres is een lange
--      willekeurige tekst, geen oplopend nummer en geen naam van de school.
--
--   4. EEN LINK IS UIT TE ZETTEN zonder dat de gemaakte afspraken verdwijnen.
--
-- WAT HIER NIET IN ZIT
--
--   Geen verplichte agendakoppeling. De vrije momenten volgen uit de
--   werktijden minus de afspraken die het CRM al kent; komt de agenda van
--   Google erbij, dan zijn dat gewoon extra bezette blokken. Zo werkt de
--   boekingslink ook op de dag dat de Google-toestemming nog niet rond is,
--   en verandert er niets aan de rekenwijze zodra dat wel zo is.
--
-- Er verandert niets aan een bestaande tabel, behalve dat crm_meetings er nu
-- echt rijen met source = 'boekingslink' bij kan krijgen. Die kolom bestaat al
-- sinds migratie 034 en hoeft dus niet te worden toegevoegd.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- crm_booking_links: het soort afspraak dat te boeken is
-- -----------------------------------------------------------------------------
create table if not exists public.crm_booking_links (
  id                uuid primary key default gen_random_uuid(),

  -- De sleutel in het adres: /afspraak/<slug>. Lang en willekeurig.
  slug              text not null,

  name              text not null,
  -- Wat de school op de pagina te lezen krijgt. Vrije tekst.
  intro             text,

  brand             public.crm_brand not null default 'skool_workshop',
  -- Welke soort afspraak eruit rolt. Zelfde lijst als crm_meetings.
  meeting_kind      text not null default 'kennismaking',
  meeting_form      text not null default 'videobellen',
  -- Adres of gesprekslink, komt in de bevestiging te staan.
  location          text,

  -- Wie de afspraak krijgt. Bepaalt ook wiens agenda wordt geraadpleegd.
  owner_id          uuid references public.profiles (id) on delete set null,

  duration_minutes  integer not null default 30,
  buffer_before_minutes integer not null default 0,
  buffer_after_minutes  integer not null default 15,
  -- Hoeveel uur van tevoren er minstens geboekt moet worden.
  notice_hours      integer not null default 24,
  -- Hoeveel dagen vooruit er geboekt mag worden.
  horizon_days      integer not null default 60,
  -- Om de hoeveel minuten een moment mag beginnen.
  slot_step_minutes integer not null default 15,

  timezone          text not null default 'Europe/Amsterdam',

  is_active         boolean not null default true,

  -- Hoeveel boekingen deze link per dag aanneemt. Een openbare pagina zonder
  -- bovengrens is een uitnodiging om de agenda vol te zetten.
  max_per_day       integer not null default 10,

  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint crm_booking_links_naam check (length(trim(name)) > 1),
  constraint crm_booking_links_slug_vorm check (slug ~ '^[a-z0-9][a-z0-9-]{9,63}$'),
  constraint crm_booking_links_soort check (
    meeting_kind in ('kennismaking', 'intake', 'advies', 'rondleiding', 'evaluatie', 'overig')
  ),
  constraint crm_booking_links_vorm check (
    meeting_form in ('op_locatie', 'bij_ons', 'videobellen', 'telefoon')
  ),
  constraint crm_booking_links_duur check (duration_minutes between 5 and 480),
  constraint crm_booking_links_buffers check (
    buffer_before_minutes between 0 and 240 and buffer_after_minutes between 0 and 240
  ),
  constraint crm_booking_links_opzegtermijn check (notice_hours between 0 and 720),
  constraint crm_booking_links_horizon check (horizon_days between 1 and 365),
  constraint crm_booking_links_raster check (slot_step_minutes between 5 and 120),
  constraint crm_booking_links_maximum check (max_per_day between 1 and 100)
);

create unique index if not exists crm_booking_links_slug_idx
  on public.crm_booking_links (slug);

comment on table public.crm_booking_links is
  'Een openbaar te boeken soort afspraak. De slug in het adres is lang en willekeurig; een link uitzetten laat de gemaakte afspraken staan.';
comment on column public.crm_booking_links.max_per_day is
  'Bovengrens op het aantal boekingen per dag. Een openbare pagina zonder grens is een uitnodiging om de agenda vol te zetten.';


-- -----------------------------------------------------------------------------
-- crm_booking_availability: de werktijden per link
-- -----------------------------------------------------------------------------
-- Een eigen tabel en geen jsonb-kolom: zo kan de database de vorm bewaken en
-- kun je erop zoeken. Meerdere vensters per dag mag, voor wie 's ochtends en
-- 's middags beschikbaar is met een pauze ertussen.
create table if not exists public.crm_booking_availability (
  id           uuid primary key default gen_random_uuid(),
  link_id      uuid not null references public.crm_booking_links (id) on delete cascade,

  -- 0 is zondag, net als in JavaScript.
  weekday      smallint not null,
  -- Minuten na middernacht, in de tijdzone van de link.
  start_minute integer not null,
  end_minute   integer not null,

  created_at   timestamptz not null default now(),

  constraint crm_booking_availability_weekdag check (weekday between 0 and 6),
  constraint crm_booking_availability_grenzen check (
    start_minute >= 0 and end_minute <= 1440 and end_minute > start_minute
  )
);

create index if not exists crm_booking_availability_link_idx
  on public.crm_booking_availability (link_id, weekday, start_minute);

comment on table public.crm_booking_availability is
  'Werktijden per weekdag voor een boekingslink, in minuten na middernacht in de tijdzone van de link.';


-- -----------------------------------------------------------------------------
-- De koppeling met de afspraak zelf
-- -----------------------------------------------------------------------------
-- crm_meetings heeft sinds migratie 034 al een kolom source. Nu komt erbij van
-- welke link een afspraak kwam, en wat de bezoeker heeft ingevuld.
--
-- LET OP: de gegevens van de bezoeker komen ook gewoon in crm_contacts terecht,
-- want dat is waar een persoon hoort. Wat hier staat is wat er op het formulier
-- is ingevuld, en dat is iets anders: een contact kan later worden bijgewerkt
-- of samengevoegd, en dan wil je nog steeds kunnen zien wat er destijds is
-- opgegeven.

alter table public.crm_meetings
  add column if not exists booking_link_id uuid references public.crm_booking_links (id) on delete set null,
  add column if not exists guest_name  text,
  add column if not exists guest_email text,
  add column if not exists guest_phone text,
  add column if not exists guest_company text;

create index if not exists crm_meetings_booking_link_idx
  on public.crm_meetings (booking_link_id, starts_at desc)
  where booking_link_id is not null;

/*
  Twee keer hetzelfde moment via dezelfde link kan niet.

  Dit is de enige bescherming die werkt als twee bezoekers tegelijk op de knop
  drukken. Een controle in de code kijkt naar de stand van een fractie eerder;
  een unieke index kijkt naar de stand op het moment zelf.

  Alleen voor afspraken die nog gepland staan: een afgezegd moment mag opnieuw
  geboekt worden, en dat is precies de bedoeling.
*/
create unique index if not exists crm_meetings_boeking_uniek_idx
  on public.crm_meetings (booking_link_id, starts_at)
  where booking_link_id is not null and status = 'gepland';

comment on column public.crm_meetings.booking_link_id is
  'Van welke boekingslink deze afspraak kwam. Leeg bij een afspraak die met de hand is ingepland.';
comment on column public.crm_meetings.guest_email is
  'Wat de bezoeker op het formulier heeft ingevuld. De persoon zelf staat in crm_contacts; dit blijft staan zoals het destijds is opgegeven.';


-- -----------------------------------------------------------------------------
-- updated_at bijhouden
-- -----------------------------------------------------------------------------

drop trigger if exists set_crm_booking_links_updated_at on public.crm_booking_links;
create trigger set_crm_booking_links_updated_at
  before update on public.crm_booking_links
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- Rechten: dicht, ook voor de openbare pagina
-- -----------------------------------------------------------------------------
-- Dit is de belangrijkste alinea van deze migratie.
--
-- De boekingspagina is openbaar, maar de database is dat niet. De pagina leest
-- en schrijft via de serviceclient in een serveractie, na alle controles. Er
-- komt dus GEEN policy voor anon, hoe verleidelijk dat ook is als het straks
-- ergens niet werkt. Een openbare pagina met schrijfrechten op crm_meetings is
-- een openbare pagina met schrijfrechten op je hele agenda.

alter table public.crm_booking_links        enable row level security;
alter table public.crm_booking_availability enable row level security;

alter table public.crm_booking_links        force row level security;
alter table public.crm_booking_availability force row level security;

revoke all on public.crm_booking_links        from anon, authenticated;
revoke all on public.crm_booking_availability from anon, authenticated;
revoke all on public.crm_meetings             from anon, authenticated;

grant select, insert, update, delete on public.crm_booking_links        to service_role;
grant select, insert, update, delete on public.crm_booking_availability to service_role;
