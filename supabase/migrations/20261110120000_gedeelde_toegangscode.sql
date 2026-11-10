-- =============================================================================
-- SkoolPartner - 043 - Gedeelde toegangscode en verificatie
-- =============================================================================
-- WAT DIT TOEVOEGT
--
--   1. Een gedeelde toegangscode per inschrijfdag. De school deelt hem samen
--      met de link. Hij is de deur, niet het paspoort.
--   2. Een geverifieerd e-mailadres bij een deelnemer, voor scholen die hun
--      adressen meeleveren.
--   3. Eenmalige verificatiecodes, met een vervaltijd en een eigen teller.
--   4. Een pogingenteller in de database, zodat raden ook wordt geremd als de
--      applicatie op meerdere servers tegelijk draait.
--
-- TWEE LAGEN, BEWUST GESCHEIDEN
--
--   De gedeelde code zegt alleen: jij hoort bij deze dag. Wie je bent wordt
--   daarna apart vastgesteld, met de persoonlijke code die al bestaat of met
--   een verificatiecode naar het adres dat de school van die leerling kent.
--   Zonder die tweede laag kan iedereen die de gedeelde code heeft de naam
--   van een klasgenoot aanklikken, en dat is precies wat we niet willen.
--
-- WAT ER NIET GEBEURT
--
--   Niets wordt verwijderd, hernoemd of omgezet. De persoonlijke codes in
--   enrollment_participants.access_code blijven ongemoeid: die zijn nu juist
--   de voorkeursmanier als een school geen adressen heeft. Bestaande dagen,
--   klassen, rondes, workshops, uitvoeringen en keuzes blijven precies zoals
--   ze zijn. Elke nieuwe kolom mag leeg zijn.
--
-- ALLES OF NIETS
--
--   Deze migratie staat in één transactie. Gaat er iets mis, dan draait alles
--   terug en staat de database precies zoals ervoor.

begin;


-- -----------------------------------------------------------------------------
-- 1. De gedeelde toegangscode van een dag
-- -----------------------------------------------------------------------------

alter table public.enrollment_events
  add column if not exists shared_code text,
  add column if not exists shared_code_active boolean not null default true,
  add column if not exists shared_code_changed_at timestamptz;

comment on column public.enrollment_events.shared_code is
  'De gedeelde code die de school met alle leerlingen deelt. Geeft toegang tot de dag, bewijst niet wie iemand is.';

-- Dezelfde tekens als de persoonlijke code: zonder I, L, O en U, zodat er aan
-- de telefoon geen misverstand ontstaat over wat iemand moet intypen.
alter table public.enrollment_events
  drop constraint if exists enrollment_events_shared_code_check;

alter table public.enrollment_events
  add constraint enrollment_events_shared_code_check
  check (shared_code is null or shared_code ~ '^[0-9A-HJKMNP-TV-Z]{6,12}$');

/*
  Bestaande dagen krijgen meteen een code.

  Zonder dit zou elke dag die nu open staat ineens dicht zitten: er is dan geen
  code, dus er komt geen leerling meer binnen. Daarom krijgt elke dag die er al
  is er een, ook de dagen die al afgerond zijn. Dat kan geen kwaad en het
  scheelt handwerk.

  De code komt uit gen_random_uuid(), want die gebruikt de sterke
  toevalsgenerator van de database. Acht tekens uit de hexadecimale cijfers
  zijn ruim vier miljard mogelijkheden, en in A tot en met F zitten geen I, L,
  O en U, dus er valt aan de telefoon niets verkeerd over te schrijven.
*/
update public.enrollment_events
   set shared_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
       shared_code_changed_at = now()
 where shared_code is null;


/*
  Hoe een deelnemer zich bekendmaakt.

  'code'        de persoonlijke inschrijfcode van de leerling. De mentor deelt
                hem uit op de klassenlijst. Werkt zonder e-mailadres en is de
                voorkeur als de school geen adressen aanlevert.

  'schoolmail'  de school heeft e-mailadressen meegeleverd. De leerling kiest
                klas en naam, en de verificatiecode gaat naar het adres dat de
                school van hem kent. Nooit naar een zelf ingetypt adres.

  'naam'        alleen de naam aanklikken. Staat standaard uit: een klasgenoot
                die jouw naam kent, kan dan jouw inschrijving doen.
*/
alter table public.enrollment_events
  drop constraint if exists enrollment_events_access_mode_check;

alter table public.enrollment_events
  add constraint enrollment_events_access_mode_check
  check (access_mode in ('code', 'schoolmail', 'naam'));


-- -----------------------------------------------------------------------------
-- 2. Het geverifieerde adres bij een deelnemer
-- -----------------------------------------------------------------------------

alter table public.enrollment_participants
  add column if not exists claim_email text,
  add column if not exists claimed_at timestamptz;

comment on column public.enrollment_participants.claim_email is
  'Het adres waarmee deze inschrijving is bevestigd. Wijzigen kan alleen via dit adres, nooit via een nieuw ingetypt adres.';

alter table public.enrollment_participants
  drop constraint if exists enrollment_participants_claim_email_check;

alter table public.enrollment_participants
  add constraint enrollment_participants_claim_email_check
  check (claim_email is null or claim_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');


-- -----------------------------------------------------------------------------
-- 3. Eenmalige verificatiecodes
-- -----------------------------------------------------------------------------
-- De code zelf staat er nooit in, alleen de versleutelde vorm. Wie de tabel
-- leest kan er dus niets mee. Een code vervalt na tien minuten of na vijf
-- misgekleunde pogingen, en kan maar één keer gebruikt worden.

create table if not exists public.enrollment_verifications (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.enrollment_participants (id) on delete cascade,
  code_hash      text not null,
  /* Waar de code heen is gestuurd. Voor het logboek en voor op het scherm. */
  sent_to        text not null,
  expires_at     timestamptz not null,
  attempts       integer not null default 0,
  used_at        timestamptz,
  created_at     timestamptz not null default now(),

  constraint enrollment_verifications_attempts_check check (attempts between 0 and 10),
  constraint enrollment_verifications_email_check
    check (sent_to ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create index if not exists enrollment_verifications_deelnemer_idx
  on public.enrollment_verifications (participant_id, created_at desc);


-- -----------------------------------------------------------------------------
-- 4. De pogingenteller
-- -----------------------------------------------------------------------------
-- WAAROM IN DE DATABASE
--
--   Een teller in het geheugen van de server telt alleen wat die ene server
--   ziet. Op Vercel draaien er meerdere naast elkaar, en dan heeft iemand die
--   codes zit te raden in de praktijk tien keer zoveel pogingen. Deze teller
--   staat op één plek en geldt dus voor iedereen tegelijk.
--
--   De sleutel is een versleuteld kenmerk van de bezoeker, nooit het
--   IP-adres zelf. Daarmee kunnen we tellen zonder te bewaren wie waar zit.

create table if not exists public.enrollment_attempts (
  event_id     uuid not null references public.enrollment_events (id) on delete cascade,
  /* Bijvoorbeeld 'gedeeld:<hash>' of 'code:<hash>'. Nooit een leesbaar adres. */
  bucket       text not null,
  window_start timestamptz not null,
  aantal       integer not null default 0,
  updated_at   timestamptz not null default now(),

  primary key (event_id, bucket, window_start)
);

create index if not exists enrollment_attempts_opruimen_idx
  on public.enrollment_attempts (window_start);

/*
  Eén poging tellen, en zeggen of het er nog een mag zijn.

  Geeft true als deze poging binnen de grens valt, en false als het er te veel
  worden. De teller gaat ook bij een geweigerde poging omhoog, anders kan
  iemand eindeloos blijven proberen zodra hij de grens heeft geraakt.

  Het venster schuift per blok: binnen hetzelfde blok wordt opgehoogd, bij een
  nieuw blok begint de telling opnieuw. Simpel en nauwkeurig genoeg om raden
  tegen te houden, zonder per poging een rij te bewaren.
*/
create or replace function public.enrollment_poging(
  p_event    uuid,
  p_bucket   text,
  p_max      integer,
  p_seconden integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_begin timestamptz;
  v_aantal integer;
begin
  if p_max < 1 or p_seconden < 1 then
    raise exception 'enrollment_poging: onzinnige grenzen';
  end if;

  -- Het begin van het blok waar dit moment in valt.
  v_begin := to_timestamp(floor(extract(epoch from now()) / p_seconden) * p_seconden);

  insert into public.enrollment_attempts (event_id, bucket, window_start, aantal, updated_at)
  values (p_event, p_bucket, v_begin, 1, now())
  on conflict (event_id, bucket, window_start) do update
    set aantal = public.enrollment_attempts.aantal + 1,
        updated_at = now()
  returning aantal into v_aantal;

  -- Oude blokken opruimen. Gebeurt alleen af en toe, zodat dit geen werk
  -- toevoegt aan elke poging.
  if v_aantal = 1 and random() < 0.02 then
    delete from public.enrollment_attempts
    where window_start < now() - interval '1 day';
  end if;

  return v_aantal <= p_max;
end;
$$;


-- -----------------------------------------------------------------------------
-- 5. Toegang tot de nieuwe tabellen
-- -----------------------------------------------------------------------------
-- Dezelfde aanpak als de rest van het inschrijfsysteem: deze tabellen zijn
-- door niemand rechtstreeks te lezen of te schrijven. Alles loopt via
-- serveracties met de serviceclient, die zelf controleren wie wat mag.

alter table public.enrollment_verifications enable row level security;
alter table public.enrollment_verifications force row level security;
alter table public.enrollment_attempts enable row level security;
alter table public.enrollment_attempts force row level security;

revoke all on public.enrollment_verifications from anon, authenticated;
revoke all on public.enrollment_attempts from anon, authenticated;
revoke all on function public.enrollment_poging(uuid, text, integer, integer) from anon, authenticated;

grant select, insert, update, delete on public.enrollment_verifications to service_role;
grant select, insert, update, delete on public.enrollment_attempts to service_role;
grant execute on function public.enrollment_poging(uuid, text, integer, integer) to service_role;


-- -----------------------------------------------------------------------------
-- 6. Instellingen
-- -----------------------------------------------------------------------------

insert into public.app_settings
  (key, value, label, description, group_name, value_type, is_public, sort_order)
values
  ('enrollment_shared_attempts', '10'::jsonb, 'Pogingen per tien minuten',
   'Hoe vaak een bezoeker de gedeelde toegangscode of een persoonlijke code mag proberen binnen tien minuten.',
   'inschrijvingen', 'number', false, 30),
  ('enrollment_verify_minutes', '10'::jsonb, 'Geldigheid verificatiecode',
   'Na hoeveel minuten een verificatiecode uit de mail vervalt.',
   'inschrijvingen', 'number', false, 40)
on conflict (key) do nothing;

commit;
