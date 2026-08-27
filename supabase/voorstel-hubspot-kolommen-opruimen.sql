-- =============================================================================
-- VOORSTEL, NOG NIET UITVOEREN
-- =============================================================================
-- Wat er nodig zou zijn om ook de laatste HubSpot-sporen uit de database te
-- halen. Dit bestand staat bewust NIET in supabase/migrations en zit dus ook
-- niet in setup-alles.sql.
--
-- Lees eerst deel 0. Daar staat waarom mijn advies is om deel C niet te doen.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Waar het om gaat
-- -----------------------------------------------------------------------------
-- Er zijn drie losse dingen, en ze hangen ongelukkig samen:
--
--   A. De kolommen bookings.hubspot_deal_id en
--      organization_contacts.hubspot_contact_id.
--
--   B. De waarde 'hubspot' in de enum booking_origin.
--      Die hangt aan één kolom: bookings.origin.
--
--   C. De waarde 'hubspot' in de enum integration_system.
--      Die hangt aan VIJF kolommen:
--        booking_sources.channel
--        external_record_mappings.system
--        integration_sync_state.integration
--        integration_credentials.integration
--        webhook_events.provider
--
-- A EN C SLUITEN ELKAAR UIT.
--
--   Deel A bewaart de HubSpot-ID's door ze te verplaatsen naar
--   external_record_mappings. Dat is de tabel die precies daarvoor bedoeld is.
--   Maar die tabel gebruikt de enum uit deel C. Wil je die enumwaarde kwijt,
--   dan moeten die regels eerst weg, en gooi je dus weg wat deel A juist
--   bewaarde.
--
--   Kies dus: OF de herkomst bewaren (A, en C niet), OF alles wegpoetsen
--   (C, en dan is A zinloos).
--
-- Mijn advies: doe alleen deel A als je een schone tabelstructuur wilt, en
-- laat B en C staan. Een ongebruikte enumwaarde kost niets, doet niets, en het
-- verwijderen ervan herschrijft vijf tabellen voor uitsluitend cosmetica.


-- -----------------------------------------------------------------------------
-- A. De twee kolommen, met de gegevens veiliggesteld
-- -----------------------------------------------------------------------------
-- Eerst kopiëren, dan pas verwijderen. Nooit andersom.
begin;

insert into public.external_record_mappings
  (system, entity_type, internal_table, internal_id, external_id, external_label, confidence, extra)
select
  'hubspot',
  'contact',
  'organization_contacts',
  c.id,
  c.hubspot_contact_id,
  c.email,
  1,
  jsonb_build_object('overgezet_op', now(), 'reden', 'kolom hubspot_contact_id opgeruimd')
from public.organization_contacts c
where c.hubspot_contact_id is not null
on conflict (system, entity_type, external_id) do nothing;

insert into public.external_record_mappings
  (system, entity_type, internal_table, internal_id, external_id, external_label, confidence, extra)
select
  'hubspot',
  'deal',
  'bookings',
  b.id,
  b.hubspot_deal_id,
  b.reference,
  1,
  jsonb_build_object('overgezet_op', now(), 'reden', 'kolom hubspot_deal_id opgeruimd')
from public.bookings b
where b.hubspot_deal_id is not null
on conflict (system, entity_type, external_id) do nothing;

-- Controle: staat alles wat een waarde had ook echt in het archief?
do $$
declare
  v_contacten integer;
  v_deals     integer;
  v_bewaard   integer;
begin
  select count(*) into v_contacten
    from public.organization_contacts where hubspot_contact_id is not null;
  select count(*) into v_deals
    from public.bookings where hubspot_deal_id is not null;
  select count(*) into v_bewaard
    from public.external_record_mappings where system = 'hubspot'
      and entity_type in ('contact', 'deal');

  if v_bewaard < v_contacten + v_deals then
    raise exception
      'Niet alles is veiliggesteld: % contacten en % deals gevonden, maar slechts % archiefregels. Er wordt niets verwijderd.',
      v_contacten, v_deals, v_bewaard;
  end if;

  raise notice 'Veiliggesteld: % contacten en % deals.', v_contacten, v_deals;
end $$;

alter table public.organization_contacts drop column if exists hubspot_contact_id;
alter table public.bookings drop column if exists hubspot_deal_id;

commit;

-- Vergeet daarna niet: haal hubspot_contact_id en hubspot_deal_id ook uit
-- src/lib/types/database.ts, anders belooft het type een kolom die er niet is.


-- -----------------------------------------------------------------------------
-- B. De enumwaarde uit booking_origin
-- -----------------------------------------------------------------------------
-- Raakt één kolom. Let op: bestaande boekingen met origin = 'hubspot' krijgen
-- 'import'. Dat is een wijziging aan klantgegevens, hoe klein ook.
/*
begin;

update public.bookings set origin = 'import' where origin = 'hubspot';

create type public.booking_origin_nieuw as enum ('email_parser', 'admin_manual', 'import');

alter table public.bookings
  alter column origin drop default,
  alter column origin type public.booking_origin_nieuw
    using origin::text::public.booking_origin_nieuw,
  alter column origin set default 'email_parser';

drop type public.booking_origin;
alter type public.booking_origin_nieuw rename to booking_origin;

commit;
*/


-- -----------------------------------------------------------------------------
-- C. De enumwaarde uit integration_system
-- -----------------------------------------------------------------------------
-- AFGERADEN. Dit gooit de HubSpot-koppelingen weg die deel A juist bewaarde,
-- en herschrijft vijf tabellen. De winst is nul: een ongebruikte enumwaarde
-- doet niets.
--
-- Doe je het toch, doe het dan buiten kantooruren: het zet een lock op alle
-- vijf de tabellen, waaronder bookings en invoices.
/*
begin;

delete from public.external_record_mappings where system = 'hubspot';
delete from public.integration_sync_state    where integration = 'hubspot';
delete from public.integration_credentials   where integration = 'hubspot';
delete from public.webhook_events            where provider = 'hubspot';
update public.booking_sources set channel = 'gmail' where channel = 'hubspot';

create type public.integration_system_nieuw as enum ('gmail', 'moneybird', 'supabase');

alter table public.booking_sources
  alter column channel drop default,
  alter column channel type public.integration_system_nieuw
    using channel::text::public.integration_system_nieuw,
  alter column channel set default 'gmail';

alter table public.external_record_mappings
  alter column system type public.integration_system_nieuw
    using system::text::public.integration_system_nieuw;

alter table public.integration_sync_state
  alter column integration type public.integration_system_nieuw
    using integration::text::public.integration_system_nieuw;

alter table public.integration_credentials
  alter column integration type public.integration_system_nieuw
    using integration::text::public.integration_system_nieuw;

alter table public.webhook_events
  alter column provider type public.integration_system_nieuw
    using provider::text::public.integration_system_nieuw;

drop type public.integration_system;
alter type public.integration_system_nieuw rename to integration_system;

commit;
*/
