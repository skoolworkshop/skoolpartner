-- ============================================================================
-- SkoolPartner - 040 - De CRM verwijderen
-- ============================================================================
-- DEZE MIGRATIE VERWIJDERT DATA. DIT IS NIET TERUG TE DRAAIEN.
-- ============================================================================
--
-- Hiermee gaat de hele CRM uit de database: contacten, deals, afspraken,
-- notities, taken, fragmenten, templates, sequences, boekingslinks en de
-- Suri-reisperiodes met hun deelnemers en betalingen.
--
-- Draai dit alleen nadat `npm run backup:data` geslaagd is en je in
-- _backup/data-JJJJ-MM-DD/ hebt gezien dat de crm_-bestanden gevuld zijn.
-- Na deze migratie is die JSON-map de enige plek waar die gegevens nog staan.
--
-- WAT BLIJFT STAAN
--
--   Alles van het klantportaal en het loyaliteitsprogramma: organizations,
--   organization_members, organization_contacts, organization_domains,
--   organization_invites, profiles, bookings, invoices, invoice_lines,
--   booking_invoices, loyalty_accounts, loyalty_transactions,
--   redemption_requests, cjp_parking_requests, cjp_credit_transactions,
--   message_threads, messages, outbound_messages, workshop_results,
--   app_settings, audit_logs, integration_credentials en integration_sync_state.
--
--   Het auditlogboek blijft ook staan. Daarin kunnen regels zitten die naar een
--   verwijderd CRM-record verwijzen. Dat is bewust: een logboek dat zichzelf
--   herschrijft is geen logboek. Die regels bewaren alleen een tekst-id, geen
--   verwijzing, dus ze blokkeren niets.
--
-- WAAROM CASCADE
--
--   De crm-tabellen verwijzen naar elkaar met foreign keys. Met cascade hoeft
--   de volgorde hieronder niet te kloppen en vallen ook de indexen, triggers,
--   policies en de capaciteitsview mee. Buiten de crm-tabellen verwijst niets
--   naar de CRM, dus cascade kan hier niets anders meesleuren. Dat is
--   nagekeken: geen enkele andere tabel heeft een crm-kolom of een crm-type.

begin;

drop view if exists public.crm_suri_edition_capacity;

-- Afhankelijke tabellen eerst, puur voor de leesbaarheid.
drop table if exists public.crm_sequence_enrollments cascade;
drop table if exists public.crm_sequence_steps cascade;
drop table if exists public.crm_sequences cascade;
drop table if exists public.crm_templates cascade;
drop table if exists public.crm_snippet_uses cascade;
drop table if exists public.crm_snippets cascade;
drop table if exists public.crm_booking_availability cascade;
drop table if exists public.crm_booking_links cascade;
drop table if exists public.crm_meetings cascade;
drop table if exists public.crm_tasks cascade;
drop table if exists public.crm_activities cascade;
drop table if exists public.crm_suri_payments cascade;
drop table if exists public.crm_suri_profiles cascade;
drop table if exists public.crm_deal_events cascade;
drop table if exists public.crm_deals cascade;
drop table if exists public.crm_suri_editions cascade;
drop table if exists public.crm_organization_profiles cascade;
drop table if exists public.crm_contacts cascade;
drop table if exists public.crm_pipeline_stages cascade;

-- De twee enums waren alleen voor de CRM.
drop type if exists public.crm_lifecycle;
drop type if exists public.crm_brand;

-- De instelling voor het startmerk in de CRM heeft geen betekenis meer.
delete from public.app_settings where key = 'crm_default_brand';

-- Controle: staat er nog iets van de CRM in het schema, dan draait alles terug.
do $$
declare
  resten text;
begin
  select string_agg(tablename, ', ' order by tablename)
    into resten
  from pg_tables
  where schemaname = 'public' and tablename like 'crm_%';

  if resten is not null then
    raise exception 'Er staan nog crm-tabellen: %', resten;
  end if;

  if exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
             where n.nspname = 'public' and t.typname in ('crm_brand', 'crm_lifecycle')) then
    raise exception 'De crm-enums staan er nog';
  end if;
end $$;

commit;
