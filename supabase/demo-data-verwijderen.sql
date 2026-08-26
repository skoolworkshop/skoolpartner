-- =============================================================================
-- SkoolPartner - demodata weer opruimen
-- =============================================================================
-- Draai dit voordat SkoolPartner naar echte klanten gaat. Het verwijdert
-- uitsluitend de drie demo-organisaties en alles wat daaraan hangt, plus de
-- twee demoberichten in de controlewachtrij. Echte klantgegevens blijven
-- ongemoeid, want er wordt alleen op die organisaties gefilterd.
--
-- Je eigen account blijft bestaan en blijft beheerder.
-- =============================================================================

do $$
declare
  v_slugs text[] := array[
    'de-goudse-waarden',
    'het-vrije-college',
    'buurtcentrum-de-zuidhoek'
  ];
  v_orgs uuid[];
begin
  select coalesce(array_agg(id), '{}'::uuid[]) into v_orgs
  from public.organizations where slug = any(v_slugs);

  if array_length(v_orgs, 1) is null then
    raise notice 'Geen demo-organisaties gevonden, er valt niets op te ruimen.';
  else
    delete from public.workshop_result_files
    where result_id in (select id from public.workshop_results where organization_id = any(v_orgs));
    delete from public.workshop_results       where organization_id = any(v_orgs);

    delete from public.messages
    where thread_id in (select id from public.message_threads where organization_id = any(v_orgs));
    delete from public.message_threads where organization_id = any(v_orgs);
    delete from public.outbound_messages where organization_id = any(v_orgs);

    delete from public.loyalty_transaction_events
    where transaction_id in (select id from public.loyalty_transactions where organization_id = any(v_orgs));
    delete from public.redemption_requests    where organization_id = any(v_orgs);
    delete from public.loyalty_transactions   where organization_id = any(v_orgs);
    delete from public.loyalty_accounts       where organization_id = any(v_orgs);

    delete from public.booking_invoices
    where booking_id in (select id from public.bookings where organization_id = any(v_orgs));
    delete from public.invoice_lines
    where invoice_id in (select id from public.invoices where organization_id = any(v_orgs));
    delete from public.invoices               where organization_id = any(v_orgs);

    delete from public.reviews                where organization_id = any(v_orgs);
    delete from public.bookings               where organization_id = any(v_orgs);

    delete from public.organization_contacts  where organization_id = any(v_orgs);
    delete from public.organization_invites   where organization_id = any(v_orgs);
    delete from public.organization_members   where organization_id = any(v_orgs);
    delete from public.organization_domains   where organization_id = any(v_orgs);
    delete from public.external_record_mappings
    where internal_table = 'organizations' and internal_id = any(v_orgs);
    delete from public.organizations          where id = any(v_orgs);
  end if;

  -- De demoberichten in de controlewachtrij hangen niet aan een organisatie.
  delete from public.booking_sources where external_message_id like 'demo-source-%';

  raise notice 'Demodata verwijderd. Je eigen account is blijven bestaan.';
end $$;
