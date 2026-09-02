-- =============================================================================
-- SkoolPartner - 031 - Contacten los van gebruikers, en de volledige funnel
-- =============================================================================
-- Drie dingen, met een gemeenschappelijke gedachte: een CRM kent mensen,
-- organisaties en verkoopkansen als drie losse dingen die naar elkaar wijzen.
--
-- 1. EEN CONTACT IS GEEN GEBRUIKER
--
--    Dit stond technisch al goed (crm_contacts kent geen enkele verwijzing
--    naar auth.users en organization_id mag leeg zijn), maar er was geen
--    manier om vast te leggen WAT voor contact iemand is, en er was geen
--    expliciete koppeling naar een klantportaalaccount voor de gevallen waar
--    die er wel is.
--
--    Belangrijk: portal_user_id wordt NOOIT automatisch gevuld. Iemand koppelen
--    aan een account is een bewuste handeling. Een e-mailadres dat toevallig
--    overeenkomt is een aanwijzing, geen bewijs.
--
-- 2. EEN DEAL HANGT AAN EEN ORGANISATIE EN AAN EEN PERSOON
--
--    De oude regel eiste precies een van beide. Dat was te streng: bij een
--    school wil je juist weten met wie je praat. De nieuwe regel is minstens
--    een van beide, en bij Suri nog steeds een persoon.
--
-- 3. DE FUNNEL VAN SKOOL WORKSHOP KRIJGT DE ECHTE FASES
--
--    De zes fases uit het fundament waren een startsituatie. Hier komen de
--    fases te staan zoals er in de praktijk gewerkt wordt.
--
-- Er verandert opnieuw niets aan een tabel buiten het CRM.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Contacten: wat voor iemand is dit, en heeft hij een account?
-- -----------------------------------------------------------------------------

alter table public.crm_contacts
  add column if not exists contact_type   text,
  add column if not exists lifecycle      public.crm_lifecycle,
  add column if not exists city           text,
  add column if not exists portal_user_id uuid references public.profiles (id) on delete set null,
  add column if not exists last_contact_at timestamptz;

do $$ begin
  alter table public.crm_contacts
    add constraint crm_contacts_soort check (
      contact_type is null or contact_type in (
        'docent', 'cultuurcoordinator', 'decaan', 'administratie', 'directie',
        'ouder', 'deelnemer', 'opdrachtgever', 'leverancier', 'overig'
      )
    );
exception when duplicate_object then null; end $$;

create index if not exists crm_contacts_type_idx on public.crm_contacts (contact_type);
create index if not exists crm_contacts_lifecycle_idx on public.crm_contacts (lifecycle);
create index if not exists crm_contacts_email_idx on public.crm_contacts (lower(email));

comment on column public.crm_contacts.portal_user_id is
  'Alleen gevuld als deze persoon aantoonbaar een SkoolPartner-account heeft. Wordt nooit automatisch gezet: een gelijk e-mailadres is een aanwijzing, geen bewijs.';
comment on column public.crm_contacts.contact_type is
  'Wat voor rol iemand heeft. Zegt niets over toegang tot het klantportaal.';
comment on column public.crm_contacts.lifecycle is
  'De commerciele fase van deze persoon. Staat los van de levensfase van zijn organisatie.';


-- -----------------------------------------------------------------------------
-- 2. Deals: organisatie EN contactpersoon
-- -----------------------------------------------------------------------------
-- Een versoepeling, geen verscherping: alles wat vandaag is toegestaan blijft
-- toegestaan. Er kan dus geen bestaande rij door deze wijziging ongeldig
-- worden.

alter table public.crm_deals
  drop constraint if exists crm_deals_precies_een_onderwerp;

do $$ begin
  alter table public.crm_deals
    add constraint crm_deals_heeft_een_onderwerp
      check (num_nonnulls(organization_id, contact_id) >= 1);
exception when duplicate_object then null; end $$;

-- Hoe lang staat een deal al in deze fase? Dat is de vraag die je bij het
-- doorlopen van een pijplijn als eerste stelt, en die je niet kunt
-- beantwoorden met alleen updated_at: dat verandert ook als je een bedrag
-- aanpast.
alter table public.crm_deals
  add column if not exists stage_since timestamptz;

update public.crm_deals set stage_since = coalesce(stage_since, created_at)
where stage_since is null;

alter table public.crm_deals
  alter column stage_since set default now();

comment on column public.crm_deals.stage_since is
  'Sinds wanneer deze deal in de huidige fase staat. Wordt gezet bij elke fasewisseling.';


-- -----------------------------------------------------------------------------
-- 3. De funnel van Skool Workshop
-- -----------------------------------------------------------------------------
-- De bestaande sleutels blijven bestaan, zodat deals die er al in staan niet
-- zwevend raken. Wat verandert is het label, de volgorde, en welke fase telt
-- als gewonnen.
--
-- LET OP, DIT IS DE ENIGE ECHTE GEDRAGSWIJZIGING IN DEZE MIGRATIE
--
--   'Ingepland' telde tot nu toe als gewonnen. Dat schuift naar 'Afgerond',
--   want tussen inplannen en afronden zit nog uitvoering, facturatie en
--   evaluatie. Deals die nu in 'Ingepland' staan blijven daar gewoon staan;
--   ze tellen alleen niet langer als gewonnen. Hieronder wordt geteld hoeveel
--   dat er zijn, zodat het zichtbaar is in de uitvoer.

do $$
declare
  v_aantal integer;
begin
  select count(*) into v_aantal
  from public.crm_deals d
  join public.crm_pipeline_stages s on s.id = d.stage_id
  where s.brand = 'skool_workshop' and s.key = 'ingepland';

  if v_aantal > 0 then
    raise notice 'Let op: % deal(s) staan in Ingepland en tellen na deze migratie niet meer als gewonnen. Zet ze zelf door naar Afgerond als dat wel de bedoeling is.', v_aantal;
  end if;
end $$;

-- Eerst alle vlaggen uit, anders botst de tussenstand met de controle die
-- zegt dat een fase niet tegelijk gewonnen en verloren kan zijn.
update public.crm_pipeline_stages
set is_won = false, is_lost = false
where brand = 'skool_workshop';

-- De bestaande vier fases krijgen hun echte naam en plaats.
update public.crm_pipeline_stages set
  label = 'Nieuwe aanvraag',
  description = 'Binnengekomen via het formulier, de mail of de telefoon. Nog geen contact gehad.',
  position = 10
where brand = 'skool_workshop' and key = 'nieuwe_aanvraag';

update public.crm_pipeline_stages set
  label = 'In behandeling',
  description = 'Contact gelegd, wensen bekend. Er wordt aan een voorstel gewerkt.',
  position = 20
where brand = 'skool_workshop' and key = 'contact_gelegd';

update public.crm_pipeline_stages set
  label = 'Offerte verstuurd',
  description = 'Prijs en datum liggen bij de school.',
  position = 30
where brand = 'skool_workshop' and key = 'offerte_verstuurd';

update public.crm_pipeline_stages set
  label = 'Klant bevestigd',
  description = 'De school gaat akkoord. Nog niet ingepland.',
  position = 50
where brand = 'skool_workshop' and key = 'akkoord';

update public.crm_pipeline_stages set
  label = 'Agenda en planning',
  description = 'Ingepland: datum, docent en locatie staan vast.',
  position = 70
where brand = 'skool_workshop' and key = 'ingepland';

update public.crm_pipeline_stages set
  label = 'Niet doorgegaan',
  description = 'Afgehaakt, te duur, geen datum gevonden of naar een ander gegaan.',
  position = 200,
  is_lost = true
where brand = 'skool_workshop' and key = 'verloren';

-- En de fases die er nog niet waren.
insert into public.crm_pipeline_stages (brand, key, label, description, position, is_won, is_lost) values
  ('skool_workshop', 'opvolging', 'Opvolging',
   'Offerte staat uit en is nagebeld of herinnerd. Wachten op antwoord.', 40, false, false),
  ('skool_workshop', 'facturatie', 'Facturatie',
   'Bevestigd en klaar om te factureren, of de factuur staat uit.', 60, false, false),
  ('skool_workshop', 'uitgevoerd', 'Uitgevoerd',
   'De workshop is gegeven. Nog geen evaluatie.', 80, false, false),
  ('skool_workshop', 'evaluatie', 'Evaluatie',
   'Evaluatie uitgezet of ontvangen.', 90, false, false),
  ('skool_workshop', 'afgerond', 'Afgerond',
   'Alles rond: gegeven, gefactureerd, betaald en geevalueerd. Hiermee is de deal gewonnen.', 100, true, false)
on conflict (brand, key) do update set
  label = excluded.label,
  description = excluded.description,
  position = excluded.position,
  is_won = excluded.is_won,
  is_lost = excluded.is_lost;


-- -----------------------------------------------------------------------------
-- Rechten op de nieuwe kolommen
-- -----------------------------------------------------------------------------
-- Nieuwe kolommen erven de rechten van de tabel, en die staat dicht. Voor de
-- zekerheid nog een keer expliciet, want dit is precies het soort ding dat je
-- niet wilt aannemen.

revoke all on public.crm_contacts from anon, authenticated;
revoke all on public.crm_deals    from anon, authenticated;
