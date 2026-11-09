-- =============================================================================
-- SkoolPartner - 041 - Inschrijvingen: dagen, rondes, workshops, deelnemers
-- =============================================================================
-- Het online inschrijfsysteem voor cultuurdagen, CKV-dagen, workshopdagen en
-- zakelijke groepen.
--
-- DE KERN: WORKSHOP, RONDE EN UITVOERING ZIJN DRIE DINGEN
--
--   Een workshop hoort bij de dag, niet bij een ronde. Graffiti is één
--   workshop, ook als hij drie keer draait. Wat er in een ronde gebeurt heet
--   een uitvoering, en dat is wat een leerling kiest.
--
--     Workshop      Graffiti, hoort bij de dag
--       Uitvoering  ronde 1, lokaal 1.04, 25 plekken, alleen 2 HAVO en 2 VWO
--       Uitvoering  ronde 2, lokaal 1.04, 25 plekken, alle klassen
--       Uitvoering  ronde 2, buiten,      20 plekken, alle klassen
--
--   Die derde regel is het punt: dezelfde workshop kan binnen één ronde twee
--   keer draaien, met twee docenten, twee ruimtes en een eigen maximum. Zonder
--   die tussenlaag zou je daar twee workshops met dezelfde naam voor nodig
--   hebben, en dan klopt geen enkele telling meer.
--
-- TOEGANG PER KLAS: LEEG IS ALLES
--
--   Bij een uitvoering kun je klassen aanvinken. Staat er niets aangevinkt,
--   dan mag iedereen erin. Dat is bewust andersom dan je zou verwachten: je
--   moet niets instellen om het te laten werken, en alleen wie beperkt wil
--   beperken, vinkt iets aan. Een vergeten vinkje levert dus nooit een
--   workshop op waar niemand in kan.
--
-- NIETS KAN BIJ ELKAAR WAT NIET BIJ ELKAAR HOORT
--
--   Een uitvoering bewaart ook het dag-id, en verwijst daarmee naar de
--   workshop én de ronde van diezelfde dag. De database maakt het daarmee
--   onmogelijk om een workshop van de ene school in een ronde van de andere te
--   zetten. Hetzelfde geldt voor de klassen bij een uitvoering en voor de
--   keuzes van een deelnemer.
--
-- BEZETTING WORDT BEREKEND, NOOIT BIJGEHOUDEN
--
--   Hoeveel plekken er vrij zijn komt altijd uit de keuzes zelf, via de view
--   enrollment_session_occupancy. Precies zoals het puntensaldo en het
--   CJP-tegoed uit hun grootboek komen. Een teller in een kolom loopt vroeg of
--   laat uit de pas, en dan zet je iemand in een volle workshop.
--
-- VOL IS VOL, OOK BIJ TWEE TEGELIJK
--
--   Kiezen gaat altijd via enrollment_choose(). Die functie zet een slot op de
--   uitvoering, controleert daarna pas, en weigert als het maximum bereikt is.
--   Een controle in de applicatie alleen is niet genoeg: twee leerlingen die
--   op hetzelfde moment de laatste plek pakken zouden dan allebei slagen.
--
-- ZO WEINIG GEGEVENS ALS MOGELIJK
--
--   Van een deelnemer staat er een naam, de groep waarin hij zit en eventueel
--   een e-mailadres voor de bevestiging. Geen geboortedatum, geen
--   leerlingnummer, geen adres. purge_after op de dag zegt wanneer de
--   deelnemers weg mogen; de dag zelf blijft bestaan zodat de boeking en de
--   aantallen kloppen.
--
-- TWEE SOORTEN DAGEN
--
--   audience 'school'       groepen zijn klassen, bijvoorbeeld Groep 3/4 of 1 HAVO
--   audience 'organisatie'  groepen zijn teams of locaties, voor zakelijke
--                           klanten die nu hun deelnemerslijst per mail sturen
--
--   Technisch is het hetzelfde. Het verschil zit alleen in de woorden op het
--   scherm, zodat een bedrijf niet naar het woord klas hoeft te kijken.
--
-- WAT ERBIJ KOMT
--
--   1. enrollment_events             de dag
--   2. enrollment_groups             de klassen of teams
--   3. enrollment_rounds             de rondes met hun tijden
--   4. enrollment_workshops          de workshops van de dag, met app en spullen
--   5. enrollment_sessions           de uitvoeringen: workshop in een ronde
--   6. enrollment_session_groups     welke klassen erin mogen, leeg is alles
--   7. enrollment_participants       de leerlingen of deelnemers
--   8. enrollment_choices            wie kiest wat, een keuze per ronde
--   9. enrollment_access             tijdelijke toegang voor de school
--  10. enrollment_deliveries         logboek van verstuurde lijsten
--  11. enrollment_session_occupancy  een view met bezet en vrij
--  12. enrollment_choose()           kiezen of wijzigen, met alle controles
--  13. twee instellingen in app_settings
--
-- WELKE BESTAANDE DATA WORDT GERAAKT
--
--   Geen. Alleen nieuwe tabellen, een view, een functie en twee instellingen.
--   Er verwijst niets van het portaal of het loyaliteitsprogramma naar deze
--   tabellen, en er wordt niets omgezet of verwijderd.
-- =============================================================================


-- ALLES OF NIETS
--
--   Deze migratie staat in één transactie. Gaat er halverwege iets mis, dan
--   draait alles terug en staat de database precies zoals ervoor. Er blijft
--   dus nooit een halve set tabellen achter.

begin;


-- -----------------------------------------------------------------------------
-- 1. De inschrijfdag
-- -----------------------------------------------------------------------------

create table if not exists public.enrollment_events (
  id            uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  booking_id    uuid references public.bookings (id) on delete set null,
  name          text not null,
  event_date    date not null,
  location      text,
  audience      text not null default 'school',
  status        text not null default 'concept',
  -- De openbare link. Een korte sleutel, geen oplopend nummer, zodat je niet
  -- bij de dag van een andere school komt door een cijfer te veranderen.
  slug          text not null,
  opens_at      timestamptz,
  closes_at     timestamptz,
  -- Mag dezelfde workshop in een latere ronde nog eens gekozen worden? Normaal
  -- niet: anders doet iemand drie rondes graffiti terwijl een ander niets kan.
  allow_repeat  boolean not null default false,
  -- De contactpersoon van de school, voor het versturen van de lijsten.
  contact_name  text,
  contact_email text,
  /*
    Hoe een deelnemer zich bekendmaakt.

    'code'  iedereen krijgt een eigen inschrijfcode. Die staat op de
            klassenlijst die de school krijgt, en de mentor deelt hem uit.
            Niemand kan dan de keuze van een ander wijzigen, en er komt geen
            enkele naam van een ander in beeld.

    'naam'  klas kiezen en je eigen naam typen. Makkelijker als een school
            geen codes wil uitdelen, maar een klasgenoot die jouw naam kent
            kan dan jouw keuze wijzigen.

    Code is de standaard. Wie het anders wil, zet het bewust om.
  */
  access_mode   text not null default 'code',
  -- Vanaf deze datum mogen de deelnemers worden opgeruimd.
  purge_after   date,
  note          text,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint enrollment_events_audience_check
    check (audience in ('school', 'organisatie')),
  constraint enrollment_events_status_check
    check (status in ('concept', 'open', 'gesloten', 'afgerond')),
  constraint enrollment_events_access_mode_check
    check (access_mode in ('code', 'naam')),
  constraint enrollment_events_name_check
    check (length(btrim(name)) between 2 and 120),
  constraint enrollment_events_slug_check
    check (slug ~ '^[a-z0-9-]{8,64}$'),
  constraint enrollment_events_venster_check
    check (opens_at is null or closes_at is null or closes_at > opens_at),
  constraint enrollment_events_contact_check
    check (contact_email is null or contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create unique index if not exists enrollment_events_slug_key
  on public.enrollment_events (slug);
create index if not exists enrollment_events_org_idx
  on public.enrollment_events (organization_id, event_date desc);
create index if not exists enrollment_events_datum_idx
  on public.enrollment_events (event_date desc);
create index if not exists enrollment_events_opruimen_idx
  on public.enrollment_events (purge_after)
  where purge_after is not null;

drop trigger if exists enrollment_events_set_updated_at on public.enrollment_events;
create trigger enrollment_events_set_updated_at before update on public.enrollment_events
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 2. De klassen of teams
-- -----------------------------------------------------------------------------

create table if not exists public.enrollment_groups (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.enrollment_events (id) on delete cascade,
  name       text not null,
  position   integer not null default 0,
  created_at timestamptz not null default now(),

  constraint enrollment_groups_name_check
    check (length(btrim(name)) between 1 and 60)
);

create unique index if not exists enrollment_groups_naam_key
  on public.enrollment_groups (event_id, lower(btrim(name)));
create index if not exists enrollment_groups_event_idx
  on public.enrollment_groups (event_id, position);
-- Nodig voor de samengestelde verwijzingen hieronder: een klas hoort altijd
-- bij dezelfde dag als de uitvoering waar hij aan hangt.
create unique index if not exists enrollment_groups_id_event_key
  on public.enrollment_groups (id, event_id);


-- -----------------------------------------------------------------------------
-- 3. De rondes
-- -----------------------------------------------------------------------------

create table if not exists public.enrollment_rounds (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.enrollment_events (id) on delete cascade,
  position   integer not null,
  label      text not null,
  starts_at  time not null,
  ends_at    time not null,
  -- Een pauze is ook een ronde op het rooster, maar er valt niets te kiezen.
  -- Daardoor telt hij niet mee bij "iedereen moet elke ronde iets hebben".
  kind       text not null default 'workshop',
  created_at timestamptz not null default now(),

  constraint enrollment_rounds_kind_check check (kind in ('workshop', 'pauze')),
  constraint enrollment_rounds_position_check check (position between 1 and 12),
  constraint enrollment_rounds_label_check check (length(btrim(label)) between 2 and 60),
  constraint enrollment_rounds_tijd_check check (ends_at > starts_at)
);

create unique index if not exists enrollment_rounds_positie_key
  on public.enrollment_rounds (event_id, position);
create unique index if not exists enrollment_rounds_id_event_key
  on public.enrollment_rounds (id, event_id);


-- -----------------------------------------------------------------------------
-- 4. De workshops van de dag
-- -----------------------------------------------------------------------------

create table if not exists public.enrollment_workshops (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.enrollment_events (id) on delete cascade,
  name             text not null,
  -- Het maximum dat een nieuwe uitvoering van deze workshop meekrijgt. Per
  -- uitvoering kun je daar altijd van afwijken.
  default_capacity integer not null default 25,
  position         integer not null default 0,

  -- Sommige workshops vragen om een app: vloggen, podcast, fotografie. Wat
  -- hier staat komt automatisch in de bevestiging van de leerling terecht.
  --
  -- De links worden door de beheerder ingevuld en moeten naar de officiele
  -- winkels wijzen. Dat staat als regel in de database en niet alleen in het
  -- scherm: een verkeerde of verzonnen link gaat anders in een mail naar
  -- honderden leerlingen, en dat is precies wat je nooit wilt.
  app_required     boolean not null default false,
  app_name         text,
  app_android_url  text,
  app_ios_url      text,
  app_web_url      text,
  app_instructions text,
  -- Wat leerlingen zelf meenemen: oude kleren, gymschoenen, een koptelefoon.
  materials        text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint enrollment_workshops_name_check
    check (length(btrim(name)) between 2 and 120),
  constraint enrollment_workshops_capacity_check
    check (default_capacity between 1 and 500),
  constraint enrollment_workshops_android_check
    check (app_android_url is null or app_android_url ~ '^https://play\.google\.com/'),
  constraint enrollment_workshops_ios_check
    check (app_ios_url is null or app_ios_url ~ '^https://apps\.apple\.com/'),
  constraint enrollment_workshops_web_check
    check (app_web_url is null or app_web_url ~ '^https://'),
  -- Een app aankondigen zonder te zeggen welke, daar heeft niemand iets aan.
  constraint enrollment_workshops_app_check
    check (not app_required or length(btrim(coalesce(app_name, ''))) > 0)
);

create unique index if not exists enrollment_workshops_naam_key
  on public.enrollment_workshops (event_id, lower(btrim(name)));
create unique index if not exists enrollment_workshops_id_event_key
  on public.enrollment_workshops (id, event_id);
create index if not exists enrollment_workshops_event_idx
  on public.enrollment_workshops (event_id, position);

drop trigger if exists enrollment_workshops_set_updated_at on public.enrollment_workshops;
create trigger enrollment_workshops_set_updated_at before update on public.enrollment_workshops
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 5. De uitvoeringen: een workshop in een ronde
-- -----------------------------------------------------------------------------
-- Dit is wat een leerling kiest, en waar de capaciteit aan hangt.
--
-- Het label onderscheidt twee uitvoeringen van dezelfde workshop in dezelfde
-- ronde. Meestal is het leeg; staan er twee docenten, dan heet de ene Groep A
-- en de andere Groep B. De unieke sleutel staat op workshop, ronde en label,
-- zodat je niet per ongeluk twee keer hetzelfde aanmaakt.

create table if not exists public.enrollment_sessions (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null,
  workshop_id uuid not null,
  round_id    uuid not null,
  label       text,
  capacity    integer not null default 25,
  room        text,
  teacher     text,
  -- Uit betekent: draait niet in deze ronde. De uitvoering blijft bestaan,
  -- inclusief de klassen die eraan hingen, zodat aanzetten niets kost.
  is_active   boolean not null default true,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint enrollment_sessions_capacity_check check (capacity between 1 and 500),
  constraint enrollment_sessions_label_check
    check (label is null or length(btrim(label)) between 1 and 40),

  constraint enrollment_sessions_workshop_fk
    foreign key (workshop_id, event_id)
    references public.enrollment_workshops (id, event_id) on delete cascade,
  constraint enrollment_sessions_round_fk
    foreign key (round_id, event_id)
    references public.enrollment_rounds (id, event_id) on delete cascade
);

create unique index if not exists enrollment_sessions_uniek
  on public.enrollment_sessions (workshop_id, round_id, lower(coalesce(btrim(label), '')));
create unique index if not exists enrollment_sessions_id_ronde_key
  on public.enrollment_sessions (id, round_id);
create unique index if not exists enrollment_sessions_id_event_key
  on public.enrollment_sessions (id, event_id);
create index if not exists enrollment_sessions_ronde_idx
  on public.enrollment_sessions (round_id, position);
create index if not exists enrollment_sessions_event_idx
  on public.enrollment_sessions (event_id);

drop trigger if exists enrollment_sessions_set_updated_at on public.enrollment_sessions;
create trigger enrollment_sessions_set_updated_at before update on public.enrollment_sessions
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 6. Welke klassen mogen in een uitvoering
-- -----------------------------------------------------------------------------
-- Geen enkele regel voor een uitvoering betekent: alle klassen mogen erin.
-- Staat er wel iets, dan mogen uitsluitend die klassen.

create table if not exists public.enrollment_session_groups (
  session_id uuid not null,
  group_id   uuid not null,
  event_id   uuid not null,
  created_at timestamptz not null default now(),

  primary key (session_id, group_id),

  constraint enrollment_session_groups_session_fk
    foreign key (session_id, event_id)
    references public.enrollment_sessions (id, event_id) on delete cascade,
  constraint enrollment_session_groups_group_fk
    foreign key (group_id, event_id)
    references public.enrollment_groups (id, event_id) on delete cascade
);

create index if not exists enrollment_session_groups_groep_idx
  on public.enrollment_session_groups (group_id);


-- -----------------------------------------------------------------------------
-- 7. De deelnemers
-- -----------------------------------------------------------------------------
-- search_key en flat_key worden door de applicatie gevuld, met de regels uit
-- src/lib/inschrijving/naam.ts. Daar staat ook waarom: "Lissa v/d Velde" en
-- "Lissa van der Velde" moeten dezelfde persoon zijn. Die logica staat op één
-- plek, in code die te testen is, en niet half in SQL.
--
-- Er staat bewust geen unieke sleutel op de naam. Twee leerlingen met dezelfde
-- naam in een klas komt echt voor; de applicatie vraagt in dat geval door in
-- plaats van te gokken.

create table if not exists public.enrollment_participants (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.enrollment_events (id) on delete cascade,
  group_id     uuid not null,
  display_name text not null,
  search_key   text not null,
  flat_key     text not null,
  email        text,
  -- Vrijgesteld: doet niet mee, bijvoorbeeld wegens een blessure of omdat de
  -- school het zo wil. Telt niet mee in de controles en wordt niet ingedeeld.
  exempt       boolean not null default false,
  /*
    Het bewijs dat deze leerling zelf achter het scherm zit.

    De leerling kiest zijn klas en typt zijn naam. Pas als die naam gevonden
    is, krijgt de browser dit token. Elke keuze daarna moet het token
    meesturen. Zonder zoiets zou je met een gewijzigd formulier de keuzes van
    een klasgenoot kunnen omgooien, want het id van een deelnemer is geen
    geheim zodra er lijsten rondgaan.

    Het staat nergens in een lijst, een mail of een export. De applicatie vult
    hem; daar staat de rest van de sleutelcode ook, en dan is er maar één plek
    waar bedacht wordt hoe een geheim eruitziet.
  */
  claim_token  text not null,
  /*
    De persoonlijke inschrijfcode.

    Acht tekens uit een alfabet zonder I, L, O en U. Wie een O of een l
    overtypt, krijgt toch de goede code: bij het invoeren wordt O een 0 en
    worden I en L een 1. Opgeslagen in hoofdletters, zodat er maar één
    schrijfwijze bestaat.

    De code staat op de klassenlijst die de school krijgt. Hij is geen
    wachtwoord voor een account, maar hij is wel het verschil tussen "iedereen
    die je naam kent" en "degene die het briefje heeft".
  */
  access_code  text not null,
  -- Wanneer de bevestiging voor het laatst is gemaild. Voorkomt dubbele post.
  confirmation_sent_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint enrollment_participants_name_check
    check (length(btrim(display_name)) between 2 and 120),
  constraint enrollment_participants_key_check
    check (length(btrim(search_key)) > 0 and length(btrim(flat_key)) > 0),
  constraint enrollment_participants_email_check
    check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint enrollment_participants_claim_check check (length(claim_token) >= 16),
  constraint enrollment_participants_code_check check (access_code ~ '^[0-9A-HJKMNP-TV-Z]{6,12}$'),

  constraint enrollment_participants_group_fk
    foreign key (group_id, event_id)
    references public.enrollment_groups (id, event_id) on delete cascade
);

create index if not exists enrollment_participants_groep_idx
  on public.enrollment_participants (group_id);
create index if not exists enrollment_participants_zoek_idx
  on public.enrollment_participants (group_id, search_key);
create index if not exists enrollment_participants_event_idx
  on public.enrollment_participants (event_id);
-- De code is de sleutel waarmee een deelnemer binnenkomt: binnen een dag
-- hoort hij bij precies één persoon.
create unique index if not exists enrollment_participants_code_key
  on public.enrollment_participants (event_id, access_code);

drop trigger if exists enrollment_participants_set_updated_at on public.enrollment_participants;
create trigger enrollment_participants_set_updated_at before update on public.enrollment_participants
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 8. De keuzes
-- -----------------------------------------------------------------------------

create table if not exists public.enrollment_choices (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.enrollment_participants (id) on delete cascade,
  round_id       uuid not null,
  session_id     uuid not null,
  -- Waar deze keuze vandaan komt. Belangrijk bij het terugsturen van de
  -- definitieve planning: wie automatisch is ingedeeld weet dat zelf nog niet.
  source         text not null default 'deelnemer',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint enrollment_choices_source_check
    check (source in ('deelnemer', 'automatisch', 'beheer')),

  -- Eén keuze per ronde. Wie opnieuw kiest, wijzigt dus; er komt geen tweede
  -- inschrijving bij. Dat was precies het probleem met het oude systeem.
  constraint enrollment_choices_ronde_key unique (participant_id, round_id),

  -- De uitvoering moet in dezelfde ronde zitten. De database dwingt dat af,
  -- niet de applicatie.
  constraint enrollment_choices_session_fk
    foreign key (session_id, round_id)
    references public.enrollment_sessions (id, round_id) on delete cascade
);

create index if not exists enrollment_choices_session_idx
  on public.enrollment_choices (session_id);
create index if not exists enrollment_choices_deelnemer_idx
  on public.enrollment_choices (participant_id);

drop trigger if exists enrollment_choices_set_updated_at on public.enrollment_choices;
create trigger enrollment_choices_set_updated_at before update on public.enrollment_choices
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 9. Tijdelijke toegang voor de school
-- -----------------------------------------------------------------------------
-- De school wil de indeling kunnen bekijken zonder dat wij elke keer nieuwe
-- bestanden sturen. Dat mag geen openbare link worden: er staan namen van
-- minderjarigen in.
--
-- Daarom twee sloten en een houdbaarheidsdatum. In de link zit een lang
-- token, en daarnaast is er een korte code die je apart doorgeeft. Een
-- doorgestuurde mail is daarmee nog geen toegang.
--
-- Van allebei staat alleen de versleutelde vorm in de database. Wie de tabel
-- zou lezen, kan er niet mee inloggen. De beheerder ziet de link en de code
-- precies één keer: op het moment dat hij ze aanmaakt.
--
-- Toegang verloopt vanzelf. Na de dag heeft niemand die lijsten nog nodig, en
-- een toegang die blijft bestaan is een toegang die ooit ergens opduikt.

create table if not exists public.enrollment_access (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.enrollment_events (id) on delete cascade,
  label       text not null,
  token_hash  text not null,
  code_hash   text not null,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  last_seen_at timestamptz,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),

  constraint enrollment_access_label_check check (length(btrim(label)) between 2 and 120)
);

create unique index if not exists enrollment_access_token_key
  on public.enrollment_access (token_hash);
create index if not exists enrollment_access_event_idx
  on public.enrollment_access (event_id);


-- -----------------------------------------------------------------------------
-- 10. Logboek van verstuurde lijsten
-- -----------------------------------------------------------------------------
-- Wat is er wanneer naar wie gestuurd, en wat zat erin. Puur om terug te
-- kunnen kijken als een school zegt dat ze niets hebben ontvangen.

create table if not exists public.enrollment_deliveries (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.enrollment_events (id) on delete cascade,
  to_email   text not null,
  to_name    text,
  -- Welke bijlagen meegingen, bijvoorbeeld klassen-xlsx en workshops-pdf.
  formats    text[] not null default '{}',
  note       text,
  message_id text,
  sent_by    uuid references public.profiles (id) on delete set null,
  sent_at    timestamptz not null default now(),

  constraint enrollment_deliveries_email_check
    check (to_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create index if not exists enrollment_deliveries_event_idx
  on public.enrollment_deliveries (event_id, sent_at desc);


-- -----------------------------------------------------------------------------
-- 11. Bezetting, altijd berekend
-- -----------------------------------------------------------------------------

create or replace view public.enrollment_session_occupancy as
select
  s.id             as session_id,
  s.event_id,
  s.round_id,
  s.workshop_id,
  w.name           as workshop_name,
  s.label,
  s.capacity,
  s.is_active,
  count(c.id)::int as bezet,
  greatest(s.capacity - count(c.id), 0)::int as vrij
from public.enrollment_sessions s
join public.enrollment_workshops w on w.id = s.workshop_id
left join public.enrollment_choices c on c.session_id = s.id
group by s.id, s.event_id, s.round_id, s.workshop_id, w.name, s.label, s.capacity, s.is_active;


-- -----------------------------------------------------------------------------
-- 12. Kiezen of wijzigen
-- -----------------------------------------------------------------------------
-- Alles in één transactie: de dag moet open zijn, de uitvoering moet draaien,
-- de klas van de deelnemer moet erin mogen, dezelfde workshop mag niet nog een
-- keer, en het maximum mag niet overschreden worden. De regel van de
-- uitvoering wordt eerst op slot gezet, zodat twee gelijktijdige keuzes niet
-- beide door dezelfde lege plek heen glippen.
--
-- Bij een weigering komt er een foutmelding uit met een vaste tekst, zodat de
-- applicatie er een nette melding van kan maken:
--
--   enrollment_closed       de inschrijving staat niet open
--   enrollment_unknown      onbekende uitvoering of deelnemer
--   enrollment_unavailable  deze uitvoering draait niet
--   enrollment_not_allowed  deze klas mag niet in deze workshop
--   enrollment_repeat       deze workshop is al eerder gekozen
--   enrollment_exempt       deze deelnemer doet niet mee
--   enrollment_full         de uitvoering zit vol
--
-- p_source zegt wie de keuze maakte: de deelnemer zelf, de automatische
-- indeling, of een beheerder. Bij automatisch indelen mag de dag ook gesloten
-- zijn; juist dan wordt die knop gebruikt.

create or replace function public.enrollment_choose(
  p_participant uuid,
  p_session uuid,
  p_source text default 'deelnemer'
)
returns public.enrollment_choices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round     uuid;
  v_capacity  integer;
  v_event     uuid;
  v_workshop  uuid;
  v_actief    boolean;
  v_status    text;
  v_opens     timestamptz;
  v_closes    timestamptz;
  v_repeat    boolean;
  v_groep     uuid;
  v_vrijgesteld boolean;
  v_bezet     integer;
  v_rij       public.enrollment_choices;
begin
  if p_source not in ('deelnemer', 'automatisch', 'beheer') then
    raise exception 'enrollment_unknown';
  end if;

  select s.round_id, s.capacity, s.event_id, s.workshop_id, s.is_active
    into v_round, v_capacity, v_event, v_workshop, v_actief
  from public.enrollment_sessions s
  where s.id = p_session
  for update of s;

  if v_round is null then
    raise exception 'enrollment_unknown';
  end if;

  if not v_actief then
    raise exception 'enrollment_unavailable';
  end if;

  select e.status, e.opens_at, e.closes_at, e.allow_repeat
    into v_status, v_opens, v_closes, v_repeat
  from public.enrollment_events e
  where e.id = v_event;

  -- Alleen de deelnemer zelf is gebonden aan het venster. Wij delen juist in
  -- nadat de inschrijving gesloten is.
  if p_source = 'deelnemer'
     and (v_status is distinct from 'open'
          or (v_opens is not null and now() < v_opens)
          or (v_closes is not null and now() > v_closes)) then
    raise exception 'enrollment_closed';
  end if;

  if p_source <> 'deelnemer' and v_status in ('concept', 'afgerond') then
    raise exception 'enrollment_closed';
  end if;

  select p.group_id, p.exempt
    into v_groep, v_vrijgesteld
  from public.enrollment_participants p
  where p.id = p_participant and p.event_id = v_event;

  if v_groep is null then
    raise exception 'enrollment_unknown';
  end if;

  if v_vrijgesteld then
    raise exception 'enrollment_exempt';
  end if;

  -- Geen enkele klas aangevinkt betekent: iedereen mag erin.
  if exists (select 1 from public.enrollment_session_groups g where g.session_id = p_session)
     and not exists (
       select 1 from public.enrollment_session_groups g
       where g.session_id = p_session and g.group_id = v_groep
     ) then
    raise exception 'enrollment_not_allowed';
  end if;

  if not v_repeat and exists (
    select 1
    from public.enrollment_choices c
    join public.enrollment_sessions s2 on s2.id = c.session_id
    where c.participant_id = p_participant
      and s2.workshop_id = v_workshop
      and c.round_id <> v_round
  ) then
    raise exception 'enrollment_repeat';
  end if;

  -- De eigen eerdere keuze telt niet mee: wie al op deze uitvoering staat en
  -- nog eens klikt, mag niet op vol stuiten.
  select count(*)
    into v_bezet
  from public.enrollment_choices c
  where c.session_id = p_session
    and c.participant_id <> p_participant;

  if v_bezet >= v_capacity then
    raise exception 'enrollment_full';
  end if;

  insert into public.enrollment_choices (participant_id, round_id, session_id, source)
  values (p_participant, v_round, p_session, p_source)
  on conflict (participant_id, round_id)
    do update set session_id = excluded.session_id, source = excluded.source, updated_at = now()
  returning * into v_rij;

  return v_rij;
end;
$$;

revoke all on function public.enrollment_choose(uuid, uuid, text) from public;
revoke all on function public.enrollment_choose(uuid, uuid, text) from anon, authenticated;
grant execute on function public.enrollment_choose(uuid, uuid, text) to service_role;


-- -----------------------------------------------------------------------------
-- 13. Instellingen
-- -----------------------------------------------------------------------------

insert into public.app_settings
  (key, value, label, description, group_name, value_type, is_public, sort_order)
values
  ('enrollment_default_capacity', '25'::jsonb, 'Maximum per workshop',
   'Standaard maximum aantal deelnemers per uitvoering van een workshop. Op de website staat 25.',
   'inschrijvingen', 'number', false, 10),
  ('enrollment_retention_weeks', '8'::jsonb, 'Bewaartermijn deelnemers',
   'Na hoeveel weken de deelnemers van een afgelopen inschrijfdag worden opgeruimd. De dag zelf blijft bestaan.',
   'inschrijvingen', 'number', false, 20)
on conflict (key) do nothing;


-- -----------------------------------------------------------------------------
-- 14. Toegang tot de tabellen
-- -----------------------------------------------------------------------------
-- Dezelfde aanpak als bij de rest van het beheer: deze tabellen zijn niet
-- rechtstreeks te lezen of te schrijven, door niemand. Alles loopt via
-- serveracties met de serviceclient, die zelf controleren wie wat mag. De
-- openbare keuzepagina heeft geen account nodig en krijgt ook geen rechten;
-- die praat alleen met een serveractie.
--
-- Geen policies dus. Row level security staat aan, wordt geforceerd, en er is
-- geen enkele policy die iets toestaat. Dat is strakker dan een policy die
-- toevallig te ruim staat.

alter table public.enrollment_events         enable row level security;
alter table public.enrollment_groups         enable row level security;
alter table public.enrollment_rounds         enable row level security;
alter table public.enrollment_workshops      enable row level security;
alter table public.enrollment_sessions       enable row level security;
alter table public.enrollment_session_groups enable row level security;
alter table public.enrollment_participants   enable row level security;
alter table public.enrollment_choices        enable row level security;
alter table public.enrollment_access         enable row level security;
alter table public.enrollment_deliveries     enable row level security;

alter table public.enrollment_events         force row level security;
alter table public.enrollment_groups         force row level security;
alter table public.enrollment_rounds         force row level security;
alter table public.enrollment_workshops      force row level security;
alter table public.enrollment_sessions       force row level security;
alter table public.enrollment_session_groups force row level security;
alter table public.enrollment_participants   force row level security;
alter table public.enrollment_choices        force row level security;
alter table public.enrollment_access         force row level security;
alter table public.enrollment_deliveries     force row level security;

revoke all on public.enrollment_events         from anon, authenticated;
revoke all on public.enrollment_groups         from anon, authenticated;
revoke all on public.enrollment_rounds         from anon, authenticated;
revoke all on public.enrollment_workshops      from anon, authenticated;
revoke all on public.enrollment_sessions       from anon, authenticated;
revoke all on public.enrollment_session_groups from anon, authenticated;
revoke all on public.enrollment_participants   from anon, authenticated;
revoke all on public.enrollment_choices        from anon, authenticated;
revoke all on public.enrollment_access         from anon, authenticated;
revoke all on public.enrollment_deliveries     from anon, authenticated;
revoke all on public.enrollment_session_occupancy from anon, authenticated;

grant select, insert, update, delete on public.enrollment_events         to service_role;
grant select, insert, update, delete on public.enrollment_groups         to service_role;
grant select, insert, update, delete on public.enrollment_rounds         to service_role;
grant select, insert, update, delete on public.enrollment_workshops      to service_role;
grant select, insert, update, delete on public.enrollment_sessions       to service_role;
grant select, insert, update, delete on public.enrollment_session_groups to service_role;
grant select, insert, update, delete on public.enrollment_participants   to service_role;
grant select, insert, update, delete on public.enrollment_choices        to service_role;
grant select, insert, update, delete on public.enrollment_access         to service_role;
grant select, insert, update, delete on public.enrollment_deliveries     to service_role;
grant select on public.enrollment_session_occupancy to service_role;

commit;
