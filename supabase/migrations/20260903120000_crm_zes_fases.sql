-- =============================================================================
-- SkoolPartner - 039 - CRM: de pijplijn terug naar zes fases
-- =============================================================================
-- Elf kolommen naast elkaar is geen overzicht meer. Deze migratie brengt de
-- verkooppijplijn van Skool Workshop terug naar zes fases, zonder ook maar een
-- deal kwijt te raken.
--
-- ============================================================================
-- ER WORDT NIETS VERWIJDERD
-- ============================================================================
--
--   Geen deal wordt verwijderd, geen fase wordt verwijderd, geen historie gaat
--   weg. Wat er gebeurt:
--
--     1. de deals uit de fases die verdwijnen, verhuizen naar de fase waar ze
--        volgens de afgesproken indeling horen;
--     2. elke verhuizing wordt vastgelegd in crm_deal_events, precies zoals bij
--        een fasewissel met de hand, met een notitie erbij waarom;
--     3. de fases zelf blijven staan, maar krijgen is_archived = true. Ze zijn
--        daarmee geen kolom meer en niet meer te kiezen, en tegelijk blijft de
--        historie leesbaar: een gebeurtenis die zegt "van Facturatie naar Klant
--        bevestigd" kan zijn oude fase blijven noemen.
--
--   Een fase weggooien zou die historie stukmaken, want crm_deal_events wijst
--   ernaar. Archiveren is hier dus geen halve maatregel maar de juiste.
--
-- ============================================================================
-- DE INDELING
-- ============================================================================
--
--   Nieuwe aanvraag        blijft                       nieuwe_aanvraag
--   In behandeling         blijft                       contact_gelegd
--   Offerte verstuurd      blijft                       offerte_verstuurd
--   Opvolging              blijft                       opvolging
--   Klant bevestigd        wordt Klant bevestigd /      akkoord
--                          Planning
--     Facturatie           gaat daar naartoe
--     Agenda en planning   gaat daar naartoe
--   Afgerond               blijft, telt als gewonnen    afgerond
--     Uitgevoerd           gaat daar naartoe
--     Evaluatie            gaat daar naartoe als de opdracht voorbij is
--   Niet doorgegaan        blijft bestaan als verloren, maar is geen kolom meer
--                          op het actieve bord
--
--   UITGEVOERD IS NIET APART BENOEMD MAAR MOET WEL ERGENS HEEN. Een workshop
--   die is gegeven, is voorbij; die fase gaat dus naar Afgerond. Er staat op dit
--   moment geen enkele deal in, dus het gaat hier om de regel en niet om rijen.
--
--   EVALUATIE IS HET ENIGE GEVAL MET EEN VOORWAARDE. Een deal in Evaluatie is
--   afgerond als de opdracht echt geweest is: er staat een afsluitdatum, of de
--   verwachte datum ligt in het verleden. Staat de datum nog in de toekomst,
--   dan is de workshop nog niet gegeven en hoort hij bij Klant bevestigd /
--   Planning. Zo blijft een lopende opdracht lopend.
--
-- Suri Impact wordt niet aangeraakt. Dat merk heeft een eigen proces met eigen
-- fases, en daar was geen vraag over.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Een fase kan voortaan gearchiveerd zijn
-- -----------------------------------------------------------------------------

alter table public.crm_pipeline_stages
  add column if not exists is_archived boolean not null default false;

comment on column public.crm_pipeline_stages.is_archived is
  'Gearchiveerd: geen kolom meer op het bord en niet te kiezen, maar blijft bestaan zodat de historie ernaar kan blijven verwijzen.';


-- -----------------------------------------------------------------------------
-- 2. De deals verhuizen, met een spoor in de tijdlijn
-- -----------------------------------------------------------------------------
-- Eerst de gebeurtenissen wegschrijven, daarna pas verplaatsen. Andersom zou de
-- oude fase al weg zijn op het moment dat je hem wilt vastleggen.

do $$
declare
  v_akkoord   uuid;
  v_afgerond  uuid;
  v_verhuisd  integer := 0;
begin
  select id into v_akkoord
    from public.crm_pipeline_stages where brand = 'skool_workshop' and key = 'akkoord';
  select id into v_afgerond
    from public.crm_pipeline_stages where brand = 'skool_workshop' and key = 'afgerond';

  if v_akkoord is null or v_afgerond is null then
    raise exception 'De fases akkoord en afgerond moeten bestaan voordat deze migratie kan draaien.';
  end if;

  -- ---------------------------------------------------------------------------
  -- Naar Klant bevestigd / Planning: facturatie en agenda en planning, plus de
  -- evaluaties waarvan de opdracht nog moet komen.
  -- ---------------------------------------------------------------------------
  insert into public.crm_deal_events (deal_id, from_stage_id, to_stage_id, note)
  select d.id, d.stage_id, v_akkoord,
         'Fase samengevoegd bij het vereenvoudigen van de pijplijn naar zes fases.'
  from public.crm_deals d
  join public.crm_pipeline_stages s on s.id = d.stage_id
  where s.brand = 'skool_workshop'
    and (
      s.key in ('facturatie', 'ingepland')
      or (s.key = 'evaluatie' and d.closed_at is null
          and (d.expected_date is null or d.expected_date >= current_date))
    );

  update public.crm_deals d
  set stage_id = v_akkoord
  from public.crm_pipeline_stages s
  where s.id = d.stage_id
    and s.brand = 'skool_workshop'
    and (
      s.key in ('facturatie', 'ingepland')
      or (s.key = 'evaluatie' and d.closed_at is null
          and (d.expected_date is null or d.expected_date >= current_date))
    );

  get diagnostics v_verhuisd = row_count;
  raise notice 'Naar Klant bevestigd / Planning verhuisd: % deal(s).', v_verhuisd;

  -- ---------------------------------------------------------------------------
  -- Naar Afgerond: uitgevoerd, en de evaluaties waarvan de opdracht geweest is.
  -- ---------------------------------------------------------------------------
  insert into public.crm_deal_events (deal_id, from_stage_id, to_stage_id, note)
  select d.id, d.stage_id, v_afgerond,
         'Fase samengevoegd bij het vereenvoudigen van de pijplijn naar zes fases.'
  from public.crm_deals d
  join public.crm_pipeline_stages s on s.id = d.stage_id
  where s.brand = 'skool_workshop'
    and s.key in ('uitgevoerd', 'evaluatie');

  update public.crm_deals d
  set stage_id = v_afgerond,
      -- Afgerond telt als gewonnen, en een gewonnen deal hoort een afsluitdatum
      -- te hebben. Staat er al een, dan blijft die staan: die is preciezer dan
      -- vandaag.
      closed_at = coalesce(d.closed_at, now())
  from public.crm_pipeline_stages s
  where s.id = d.stage_id
    and s.brand = 'skool_workshop'
    and s.key in ('uitgevoerd', 'evaluatie');

  get diagnostics v_verhuisd = row_count;
  raise notice 'Naar Afgerond verhuisd: % deal(s).', v_verhuisd;
end $$;


-- -----------------------------------------------------------------------------
-- 3. De zes fases hun naam en plaats geven
-- -----------------------------------------------------------------------------

update public.crm_pipeline_stages set position = 10
  where brand = 'skool_workshop' and key = 'nieuwe_aanvraag';
update public.crm_pipeline_stages set position = 20
  where brand = 'skool_workshop' and key = 'contact_gelegd';
update public.crm_pipeline_stages set position = 30
  where brand = 'skool_workshop' and key = 'offerte_verstuurd';
update public.crm_pipeline_stages set position = 40
  where brand = 'skool_workshop' and key = 'opvolging';

update public.crm_pipeline_stages set
  label = 'Klant bevestigd / Planning',
  description = 'De school gaat akkoord. Inplannen, uitvoeren en factureren horen hierbij.',
  position = 50
where brand = 'skool_workshop' and key = 'akkoord';

update public.crm_pipeline_stages set
  description = 'Gegeven, gefactureerd en afgehandeld. Hiermee is de deal gewonnen.',
  position = 60
where brand = 'skool_workshop' and key = 'afgerond';

-- Niet doorgegaan blijft precies wat hij was: een verloren uitkomst. Hij staat
-- alleen niet meer als kolom op het actieve bord, en dat is een keuze van het
-- scherm en niet van de database.
update public.crm_pipeline_stages set position = 200
  where brand = 'skool_workshop' and key = 'verloren';


-- -----------------------------------------------------------------------------
-- 4. De vier fases die verdwijnen, archiveren
-- -----------------------------------------------------------------------------
-- Pas hier, nadat alles is verhuisd. Een gearchiveerde fase waar nog een deal in
-- staat zou een deal onzichtbaar maken, en dat is precies wat niet mag.

do $$
declare
  v_achterblijvers integer;
begin
  select count(*) into v_achterblijvers
  from public.crm_deals d
  join public.crm_pipeline_stages s on s.id = d.stage_id
  where s.brand = 'skool_workshop'
    and s.key in ('facturatie', 'ingepland', 'uitgevoerd', 'evaluatie');

  if v_achterblijvers > 0 then
    raise exception 'Er staan nog % deal(s) in een fase die zou worden gearchiveerd. Er wordt niets gearchiveerd.', v_achterblijvers;
  end if;
end $$;

update public.crm_pipeline_stages
set is_archived = true
where brand = 'skool_workshop'
  and key in ('facturatie', 'ingepland', 'uitgevoerd', 'evaluatie');


-- -----------------------------------------------------------------------------
-- Rechten blijven zoals ze waren
-- -----------------------------------------------------------------------------

revoke all on public.crm_pipeline_stages from anon, authenticated;
