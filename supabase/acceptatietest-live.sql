-- =============================================================================
-- SkoolPartner - acceptatietest op de live database, zonder sporen
-- =============================================================================
-- WAT DIT IS
--
--   Eén blok dat de puntenregels, de rechten en de inschrijfregels toetst op de
--   echte database, met de echte functies en de echte Row Level Security. Het
--   maakt fictieve locaties, contactpersonen, boekingen, een factuur en een
--   cultuurdag aan, voert de controles uit, en draait aan het eind ALLES terug.
--
--   Het blok eindigt altijd met een foutmelding. Dat is de bedoeling: een fout
--   aan het eind van een blok maakt alles ongedaan wat erin gebeurde. In die
--   melding staat de uitkomst: hoeveel controles goed gingen en welke niet.
--
-- WAT HET NIET DOET
--
--   Er gaat geen mail uit, er komt niets in Moneybird, en na afloop staat er
--   niets meer in de database. De gebruikers die het aanmaakt bestaan alleen
--   binnen dit blok; Supabase stuurt hun geen mail, want ze worden niet via de
--   inlogpagina aangemaakt.
--
-- GEBRUIK
--
--   Supabase > SQL Editor, alles plakken, Run. Lees de melding onderaan.
-- =============================================================================

do $$
declare
  v_noord uuid; v_zuid uuid;
  v_anna uuid; v_bram uuid; v_carla uuid; v_dirk uuid; v_frank uuid; v_beheer uuid;
  v_b1 uuid; v_b2 uuid; v_b3 uuid; v_factuur uuid; v_verzoek uuid; v_verzoek2 uuid;
  v_account uuid; v_n integer; v_tekst text; v_json jsonb;
  v_dag uuid; v_klas uuid; v_ronde uuid; v_workshop uuid; v_sessie uuid; v_p1 uuid; v_p2 uuid;
  v_goed integer := 0;
  v_fout jsonb := '{}'::jsonb;
  v_cijfers jsonb := '{}'::jsonb;
begin
  -- ---------------------------------------------------------------------------
  -- Hulpmiddel: één controle vastleggen.
  -- ---------------------------------------------------------------------------
  create temp table uitkomst (naam text, goed boolean, detail text) on commit drop;

  -- ---------------------------------------------------------------------------
  -- 1. Locaties en contactpersonen
  -- ---------------------------------------------------------------------------
  insert into public.organizations (name, slug, kind, verified_at)
  values ('ACCEPTATIETEST Bestuur, locatie Noord', 'acceptatietest-noord', 'school', now())
  returning id into v_noord;
  insert into public.organizations (name, slug, kind, verified_at)
  values ('ACCEPTATIETEST Bestuur, locatie Zuid', 'acceptatietest-zuid', 'school', now())
  returning id into v_zuid;

  insert into auth.users (id, email, raw_user_meta_data)
  values (gen_random_uuid(), 'anna@acceptatie.test', '{"full_name":"Anna Test"}') returning id into v_anna;
  insert into auth.users (id, email, raw_user_meta_data)
  values (gen_random_uuid(), 'bram@acceptatie.test', '{"full_name":"Bram Test"}') returning id into v_bram;
  insert into auth.users (id, email, raw_user_meta_data)
  values (gen_random_uuid(), 'carla@acceptatie.test', '{"full_name":"Carla Test"}') returning id into v_carla;
  insert into auth.users (id, email, raw_user_meta_data)
  values (gen_random_uuid(), 'dirk@acceptatie.test', '{"full_name":"Dirk Test"}') returning id into v_dirk;
  insert into auth.users (id, email, raw_user_meta_data)
  values (gen_random_uuid(), 'frank@acceptatie.test', '{"full_name":"Frank Test"}') returning id into v_frank;

  insert into public.organization_members (organization_id, user_id, role, status, source)
  values (v_noord, v_anna, 'beheerder', 'active', 'admin_manual'),
         (v_noord, v_bram, 'beheerder', 'active', 'admin_manual'),
         (v_zuid, v_carla, 'beheerder', 'active', 'admin_manual');
  insert into public.organization_contacts (organization_id, email, full_name, user_id, is_verified, verified_at)
  values (v_noord, 'anna@acceptatie.test', 'Anna Test', v_anna, true, now()),
         (v_noord, 'bram@acceptatie.test', 'Bram Test', v_bram, true, now()),
         (v_zuid, 'carla@acceptatie.test', 'Carla Test', v_carla, true, now());
  perform public.ensure_loyalty_account(v_noord, v_anna);
  perform public.ensure_loyalty_account(v_noord, v_bram);
  perform public.ensure_loyalty_account(v_zuid, v_carla);

  select id into v_beheer from public.profiles where is_admin and not is_blocked order by created_at limit 1;

  select count(*) into v_n from public.profiles where id in (v_anna, v_bram, v_carla, v_dirk, v_frank);
  insert into uitkomst values ('profielen aangemaakt bij nieuwe gebruiker', v_n = 5, v_n::text);
  select count(*) into v_n from public.loyalty_accounts where organization_id = v_noord;
  insert into uitkomst values ('twee contactpersonen op Noord, elk een eigen regel', v_n = 2, v_n::text);

  -- ---------------------------------------------------------------------------
  -- 2. Moneybird: één contact hoort bij één locatie
  -- ---------------------------------------------------------------------------
  update public.organization_contacts set moneybird_contact_id = 'ACCEPTATIE-MB-NOORD'
   where organization_id = v_noord and email = 'anna@acceptatie.test';
  begin
    update public.organization_contacts set moneybird_contact_id = 'ACCEPTATIE-MB-NOORD'
     where organization_id = v_zuid and email = 'carla@acceptatie.test';
    insert into uitkomst values ('zelfde Moneybird-contact bij tweede locatie geweigerd', false, 'werd toegestaan');
  exception when unique_violation then
    insert into uitkomst values ('zelfde Moneybird-contact bij tweede locatie geweigerd', true, sqlerrm);
  end;

  -- ---------------------------------------------------------------------------
  -- 3. Punten opbouwen, zoals de applicatie het doet
  -- ---------------------------------------------------------------------------
  select id into v_account from public.loyalty_accounts where organization_id = v_noord and user_id = v_anna;
  insert into public.loyalty_transactions
    (organization_id, user_id, account_id, type, status, points, point_value_cents_per_100,
     description, source, external_reference, available_at)
  values (v_noord, v_anna, v_account, 'welcome_bonus', 'available', 100, 250,
          'Welkomstbonus SkoolPartner', 'portal', 'welcome', now())
  on conflict (organization_id, type, external_reference) do nothing;
  get diagnostics v_n = row_count;
  insert into uitkomst values ('welkomstbonus voor Noord vastgelegd', v_n = 1, v_n::text);

  select id into v_account from public.loyalty_accounts where organization_id = v_noord and user_id = v_bram;
  insert into public.loyalty_transactions
    (organization_id, user_id, account_id, type, status, points, point_value_cents_per_100,
     description, source, external_reference, available_at)
  values (v_noord, v_bram, v_account, 'welcome_bonus', 'available', 100, 250,
          'Welkomstbonus SkoolPartner', 'portal', 'welcome', now())
  on conflict (organization_id, type, external_reference) do nothing;
  get diagnostics v_n = row_count;
  insert into uitkomst values ('tweede collega krijgt geen tweede welkomstbonus', v_n = 0, v_n::text);

  select id into v_account from public.loyalty_accounts where organization_id = v_zuid and user_id = v_carla;
  insert into public.loyalty_transactions
    (organization_id, user_id, account_id, type, status, points, point_value_cents_per_100,
     description, source, external_reference, available_at)
  values (v_zuid, v_carla, v_account, 'welcome_bonus', 'available', 100, 250,
          'Welkomstbonus SkoolPartner', 'portal', 'welcome', now())
  on conflict (organization_id, type, external_reference) do nothing;
  get diagnostics v_n = row_count;
  insert into uitkomst values ('zusterlocatie Zuid krijgt eigen welkomstbonus', v_n = 1, v_n::text);

  insert into public.bookings (organization_id, workshop_name, workshop_count, minutes_per_workshop,
                               scheduled_date, status, origin, contact_email, contact_name)
  values (v_noord, 'ACCEPTATIE Workshop Hiphop', 2, 90, current_date - 7, 'completed', 'admin_manual',
          'anna@acceptatie.test', 'Anna Test') returning id into v_b1;
  insert into public.bookings (organization_id, workshop_name, workshop_count, minutes_per_workshop,
                               scheduled_date, status, origin, contact_email, contact_name)
  values (v_noord, 'ACCEPTATIE Workshop Graffiti', 2, 60, current_date - 5, 'completed', 'admin_manual',
          'bram@acceptatie.test', 'Bram Test') returning id into v_b2;
  insert into public.bookings (organization_id, workshop_name, workshop_count, minutes_per_workshop,
                               scheduled_date, status, origin, contact_email, contact_name)
  values (v_noord, 'ACCEPTATIE Workshop Percussie', 1, 60, current_date + 21, 'confirmed', 'admin_manual',
          'bram@acceptatie.test', 'Bram Test') returning id into v_b3;

  select id into v_account from public.loyalty_accounts where organization_id = v_noord and user_id = v_anna;
  insert into public.loyalty_transactions
    (organization_id, user_id, account_id, type, status, points, point_value_cents_per_100,
     description, source, external_reference, booking_id)
  values (v_noord, v_anna, v_account, 'earn_workshop', 'pending', 600, 250,
          'ACCEPTATIE Workshop Hiphop', 'admin_manual', 'booking:' || v_b1, v_b1)
  on conflict (organization_id, type, external_reference) do nothing;
  select id into v_account from public.loyalty_accounts where organization_id = v_noord and user_id = v_bram;
  insert into public.loyalty_transactions
    (organization_id, user_id, account_id, type, status, points, point_value_cents_per_100,
     description, source, external_reference, booking_id)
  values (v_noord, v_bram, v_account, 'earn_workshop', 'pending', 400, 250,
          'ACCEPTATIE Workshop Graffiti', 'admin_manual', 'booking:' || v_b2, v_b2)
  on conflict (organization_id, type, external_reference) do nothing;

  -- Dezelfde boeking nog een keer, nu via de collega.
  insert into public.loyalty_transactions
    (organization_id, user_id, account_id, type, status, points, point_value_cents_per_100,
     description, source, external_reference, booking_id)
  values (v_noord, v_bram, v_account, 'earn_workshop', 'pending', 600, 250,
          'ACCEPTATIE Workshop Hiphop', 'admin_manual', 'booking:' || v_b1, v_b1)
  on conflict (organization_id, type, external_reference) do nothing;
  get diagnostics v_n = row_count;
  insert into uitkomst values ('dezelfde boeking levert geen tweede keer punten op', v_n = 0, v_n::text);

  -- De factuur komt binnen en is betaald: punten komen vrij.
  insert into public.invoices (organization_id, moneybird_invoice_id, moneybird_contact_id, invoice_number,
                               invoice_date, state, total_incl_cents, total_unpaid_cents, fully_paid)
  values (v_noord, 'ACCEPTATIE-F-1', 'ACCEPTATIE-MB-NOORD', 'ACC-2026-001', current_date, 'paid', 121000, 0, true)
  returning id into v_factuur;
  insert into public.booking_invoices (booking_id, invoice_id) values (v_b1, v_factuur), (v_b2, v_factuur);
  select public.release_points_for_invoice(v_factuur) into v_n;
  insert into uitkomst values ('betaalde factuur maakt de punten van beide boekingen vrij', v_n = 2, v_n::text);

  select coalesce(sum(points), 0) into v_n from public.loyalty_transactions
   where organization_id = v_noord and status in ('available', 'reserved', 'redeemed', 'expired');
  insert into uitkomst values ('Noord: één saldo van 1100 voor beide collega''s', v_n = 1100, v_n::text);
  select coalesce(sum(points), 0) into v_n from public.loyalty_transactions
   where organization_id = v_zuid and status in ('available', 'reserved', 'redeemed', 'expired');
  insert into uitkomst values ('Zuid: eigen saldo van 100', v_n = 100, v_n::text);

  select count(*) into v_n from public.loyalty_balances where organization_id = v_noord;
  insert into uitkomst values ('saldoweergave: één regel per locatie', v_n = 1, v_n::text);

  -- ---------------------------------------------------------------------------
  -- 4. Wie ziet wat (als ingelogde klant, met Row Level Security aan)
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_anna::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_anna, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select jsonb_build_object(
    'saldo', (select jsonb_agg(jsonb_build_object('org', organization_id, 'punten', available_points)) from public.loyalty_balances),
    'regels', (select count(*) from public.loyalty_transactions),
    'noord', public.loyalty_available_points(v_noord),
    'zuid', public.loyalty_available_points(v_zuid)
  ) into v_json;
  reset role;
  insert into uitkomst values ('Anna ziet alleen Noord, met het totaal van 1100',
    jsonb_array_length(v_json -> 'saldo') = 1 and (v_json -> 'saldo' -> 0 ->> 'punten')::int = 1100
      and (v_json -> 'saldo' -> 0 ->> 'org')::uuid = v_noord, v_json::text);
  insert into uitkomst values ('Anna ziet ook de regels van Bram', (v_json ->> 'regels')::int = 3, v_json ->> 'regels');
  insert into uitkomst values ('Anna krijgt het saldo van Zuid niet', (v_json ->> 'zuid')::int = 0 and (v_json ->> 'noord')::int = 1100, v_json::text);

  perform set_config('request.jwt.claim.sub', v_carla::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_carla, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select jsonb_build_object(
    'saldo', (select jsonb_agg(jsonb_build_object('org', organization_id, 'punten', available_points)) from public.loyalty_balances),
    'noord_regels', (select count(*) from public.loyalty_transactions where organization_id = v_noord),
    'noord_factuur', (select count(*) from public.invoices where organization_id = v_noord)
  ) into v_json;
  reset role;
  insert into uitkomst values ('Carla van Zuid ziet niets van Noord',
    jsonb_array_length(v_json -> 'saldo') = 1 and (v_json -> 'saldo' -> 0 ->> 'org')::uuid = v_zuid
      and (v_json ->> 'noord_regels')::int = 0 and (v_json ->> 'noord_factuur')::int = 0, v_json::text);

  perform set_config('request.jwt.claim.sub', v_dirk::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_dirk, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select jsonb_build_object(
    'saldo', (select count(*) from public.loyalty_balances),
    'regels', (select count(*) from public.loyalty_transactions),
    'facturen', (select count(*) from public.invoices),
    'boekingen', (select count(*) from public.bookings),
    'organisaties', (select count(*) from public.organizations where id in (v_noord, v_zuid)),
    'noord', public.loyalty_available_points(v_noord)
  ) into v_json;
  reset role;
  insert into uitkomst values ('Dirk zonder locatie ziet helemaal niets',
    (v_json ->> 'saldo')::int = 0 and (v_json ->> 'regels')::int = 0 and (v_json ->> 'facturen')::int = 0
      and (v_json ->> 'boekingen')::int = 0 and (v_json ->> 'organisaties')::int = 0
      and (v_json ->> 'noord')::int = 0, v_json::text);

  if v_beheer is not null then
    perform set_config('request.jwt.claim.sub', v_beheer::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_beheer, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into v_n from public.loyalty_balances where organization_id in (v_noord, v_zuid);
    reset role;
    insert into uitkomst values ('beheerder van Skool Workshop ziet beide locaties', v_n = 2, v_n::text);
  end if;

  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
    set local role anon;
    select count(*) into v_n from public.loyalty_balances;
    reset role;
    insert into uitkomst values ('bezoeker zonder account kan het saldo niet lezen', false, v_n::text);
  exception when insufficient_privilege then
    insert into uitkomst values ('bezoeker zonder account kan het saldo niet lezen', true, sqlerrm);
  end;
  begin
    set local role anon;
    select public.loyalty_available_points(v_noord) into v_n;
    reset role;
    insert into uitkomst values ('bezoeker zonder account kan het saldo niet opvragen', false, v_n::text);
  exception when insufficient_privilege then
    insert into uitkomst values ('bezoeker zonder account kan het saldo niet opvragen', true, sqlerrm);
  end;
  begin
    set local role anon;
    select count(*) into v_n from public.enrollment_participants;
    reset role;
    insert into uitkomst values ('bezoeker kan geen leerlingen lezen', false, v_n::text);
  exception when insufficient_privilege then
    insert into uitkomst values ('bezoeker kan geen leerlingen lezen', true, sqlerrm);
  end;
  begin
    perform set_config('request.jwt.claim.sub', v_anna::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_anna, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into v_n from public.enrollment_participants;
    reset role;
    insert into uitkomst values ('klant kan geen leerlingen lezen', false, v_n::text);
  exception when insufficient_privilege then
    insert into uitkomst values ('klant kan geen leerlingen lezen', true, sqlerrm);
  end;
  begin
    perform set_config('request.jwt.claim.sub', v_anna::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_anna, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into v_n from public.integration_credentials;
    reset role;
    insert into uitkomst values ('klant kan geen integratietokens lezen', v_n = 0, v_n::text);
  exception when insufficient_privilege then
    insert into uitkomst values ('klant kan geen integratietokens lezen', true, sqlerrm);
  end;

  -- ---------------------------------------------------------------------------
  -- 5. Inwisselen op het saldo van de locatie
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_anna::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_anna, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select id into v_verzoek from public.request_redemption(v_noord, 800, v_b3, null, 'ACCEPTATIETEST');
  reset role;
  select coalesce(sum(points), 0) into v_n from public.loyalty_transactions
   where organization_id = v_noord and status in ('available', 'reserved', 'redeemed', 'expired');
  insert into uitkomst values ('Anna vraagt 800 aan, meer dan zij zelf spaarde; 300 blijft over',
    v_verzoek is not null and v_n = 300, v_n::text);

  begin
    perform set_config('request.jwt.claim.sub', v_bram::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_bram, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.request_redemption(v_noord, 500, v_b3, null, null);
    reset role;
    insert into uitkomst values ('Bram kan daarna niet nog eens 500 aanvragen', false, 'toegestaan');
  exception when others then
    insert into uitkomst values ('Bram kan daarna niet nog eens 500 aanvragen', sqlerrm like 'Onvoldoende saldo%', sqlerrm);
  end;

  begin
    perform set_config('request.jwt.claim.sub', v_carla::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_carla, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.request_redemption(v_noord, 500, null, null, null);
    reset role;
    insert into uitkomst values ('Carla van Zuid kan niet op het saldo van Noord inwisselen', false, 'toegestaan');
  exception when others then
    insert into uitkomst values ('Carla van Zuid kan niet op het saldo van Noord inwisselen', sqlerrm like '%Geen toegang%', sqlerrm);
  end;

  begin
    perform set_config('request.jwt.claim.sub', v_anna::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_anna, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.redemption_requests (organization_id, requested_by, points, value_cents, point_value_cents_per_100, status)
    values (v_noord, v_anna, 5000, 12500, 250, 'requested');
    reset role;
    insert into uitkomst values ('klant kan geen verzoek buiten de reservering om aanmaken', false, 'toegestaan');
  exception when insufficient_privilege then
    insert into uitkomst values ('klant kan geen verzoek buiten de reservering om aanmaken', true, sqlerrm);
  end;

  begin
    perform set_config('request.jwt.claim.sub', v_anna::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_anna, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.redemption_requests set status = 'applied' where id = v_verzoek;
    reset role;
    insert into uitkomst values ('klant kan zijn verzoek niet zelf goedkeuren', false, 'toegestaan');
  exception when insufficient_privilege then
    insert into uitkomst values ('klant kan zijn verzoek niet zelf goedkeuren', true, sqlerrm);
  end;

  -- Bram trekt het verzoek van Anna in: het is een verzoek van de locatie.
  perform set_config('request.jwt.claim.sub', v_bram::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_bram, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.cancel_redemption(v_verzoek, 'ACCEPTATIETEST ingetrokken');
  select id into v_verzoek2 from public.request_redemption(v_noord, 500, v_b3, null, 'ACCEPTATIETEST');
  reset role;
  insert into uitkomst values ('collega kan een verzoek intrekken en een nieuw indienen', v_verzoek2 is not null, coalesce(v_verzoek2::text, 'geen'));

  -- Skool Workshop verwerkt het verzoek, zoals decideRedemptionAction dat doet.
  update public.redemption_requests
     set status = 'applied', applied_at = now(), applied_by = v_beheer, decided_by = v_beheer,
         decided_at = now(), invoice_number = 'ACC-2026-002'
   where id = v_verzoek2;
  update public.loyalty_transactions set status = 'redeemed', reason = 'Voordeel verwerkt op factuur ACC-2026-002'
   where id = (select reserve_transaction_id from public.redemption_requests where id = v_verzoek2);
  select jsonb_build_object('beschikbaar', available_points, 'gereserveerd', reserved_points, 'ingewisseld', redeemed_points)
    into v_json from public.loyalty_balances where organization_id = v_noord;
  insert into uitkomst values ('na verwerking: 600 beschikbaar, 500 ingewisseld, niets gereserveerd',
    (v_json ->> 'beschikbaar')::int = 600 and (v_json ->> 'ingewisseld')::int = 500 and (v_json ->> 'gereserveerd')::int = 0,
    v_json::text);

  -- ---------------------------------------------------------------------------
  -- 6. Correctie en verval
  -- ---------------------------------------------------------------------------
  select id into v_account from public.loyalty_accounts where organization_id = v_noord order by enrolled_at, id limit 1;
  insert into public.loyalty_transactions
    (organization_id, user_id, account_id, type, status, points, point_value_cents_per_100,
     description, source, reason, created_by, available_at)
  values (v_noord, null, v_account, 'manual_adjustment', 'available', 150, 250,
          'Handmatige correctie', 'admin', 'ACCEPTATIETEST correctie', v_beheer, now());
  select available_points into v_n from public.loyalty_balances where organization_id = v_noord;
  insert into uitkomst values ('correctie zonder contactpersoon telt op het locatiesaldo', v_n = 750, v_n::text);

  select id into v_account from public.loyalty_accounts where organization_id = v_zuid and user_id = v_carla;
  insert into public.loyalty_transactions
    (organization_id, user_id, account_id, type, status, points, point_value_cents_per_100,
     description, source, external_reference, available_at, expires_at)
  values (v_zuid, v_carla, v_account, 'earn_workshop', 'available', 300, 250,
          'ACCEPTATIE verlopen punten', 'admin_manual', 'acceptatie-verval', now() - interval '25 months',
          now() - interval '1 day');
  select public.expire_loyalty_points() into v_n;
  select jsonb_build_object('beschikbaar', available_points, 'verlopen', expired_points)
    into v_json from public.loyalty_balances where organization_id = v_zuid;
  insert into uitkomst values ('verlopen punten gaan van het saldo van Zuid af',
    (v_json ->> 'beschikbaar')::int = 100 and (v_json ->> 'verlopen')::int = 300, v_json::text);
  select available_points into v_n from public.loyalty_balances where organization_id = v_noord;
  insert into uitkomst values ('verval op Zuid raakt Noord niet', v_n = 750, v_n::text);

  -- ---------------------------------------------------------------------------
  -- 7. Een contactpersoon vertrekt
  -- ---------------------------------------------------------------------------
  update public.organization_members set status = 'removed' where organization_id = v_noord and user_id = v_bram;
  perform set_config('request.jwt.claim.sub', v_bram::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_bram, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select jsonb_build_object(
    'saldo', (select count(*) from public.loyalty_balances),
    'regels', (select count(*) from public.loyalty_transactions),
    'verzoeken', (select count(*) from public.redemption_requests),
    'noord', public.loyalty_available_points(v_noord)
  ) into v_json;
  reset role;
  insert into uitkomst values ('Bram ziet na vertrek niets meer',
    (v_json ->> 'saldo')::int = 0 and (v_json ->> 'regels')::int = 0 and (v_json ->> 'verzoeken')::int = 0
      and (v_json ->> 'noord')::int = 0, v_json::text);
  begin
    set local role authenticated;
    perform public.request_redemption(v_noord, 500, null, null, null);
    reset role;
    insert into uitkomst values ('Bram kan na vertrek niets meer aanvragen', false, 'toegestaan');
  exception when others then
    insert into uitkomst values ('Bram kan na vertrek niets meer aanvragen', sqlerrm like '%Geen toegang%', sqlerrm);
  end;
  select available_points into v_n from public.loyalty_balances where organization_id = v_noord;
  insert into uitkomst values ('de punten van Bram blijven bij Noord', v_n = 750, v_n::text);

  -- ---------------------------------------------------------------------------
  -- 8. CJP-bonus met twee contactpersonen op één locatie
  -- ---------------------------------------------------------------------------
  insert into public.organization_members (organization_id, user_id, role, status, source)
  values (v_zuid, v_frank, 'beheerder', 'active', 'admin_manual');
  perform public.ensure_loyalty_account(v_zuid, v_frank);
  begin
    insert into public.cjp_parking_requests
      (organization_id, school_name, cjp_school_number, holder_name, holder_email, amount_cents, requested_by)
    values (v_zuid, 'ACCEPTATIETEST Zuid', '123456', 'Carla Test', 'carla@acceptatie.test', 150000, v_carla)
    returning id into v_verzoek;
    perform public.confirm_cjp_parking(v_verzoek, v_beheer, 'ACCEPTATIETEST');
    select count(*) into v_n from public.loyalty_transactions where organization_id = v_zuid and type = 'cjp_bonus';
    insert into uitkomst values ('CJP-bonus één keer, ook met twee contactpersonen', v_n = 1, v_n::text);
  exception when others then
    insert into uitkomst values ('CJP-bonus één keer, ook met twee contactpersonen', false, sqlerrm);
  end;

  -- ---------------------------------------------------------------------------
  -- 9. Inschrijven: vol is vol, en de dag hoort bij de locatie
  -- ---------------------------------------------------------------------------
  begin
    insert into public.enrollment_events (organization_id, name, event_date, status, slug, shared_code)
    values (v_noord, 'ACCEPTATIETEST Cultuurdag', current_date + 30, 'open', 'acceptatietest-cultuurdag', 'KM7P4X2B')
    returning id into v_dag;
    insert into public.enrollment_groups (event_id, name, position) values (v_dag, '1A', 1) returning id into v_klas;
    insert into public.enrollment_rounds (event_id, position, label, starts_at, ends_at)
    values (v_dag, 1, 'Ronde 1', '09:15', '10:15') returning id into v_ronde;
    insert into public.enrollment_workshops (event_id, name, position) values (v_dag, 'Workshop Dans', 1)
    returning id into v_workshop;
    insert into public.enrollment_sessions (event_id, workshop_id, round_id, capacity, position)
    values (v_dag, v_workshop, v_ronde, 1, 1) returning id into v_sessie;
    insert into public.enrollment_participants (event_id, group_id, display_name, search_key, flat_key, claim_token, access_code)
    values (v_dag, v_klas, 'Leerling Een', 'leerling een', 'leerlingeen', 'acceptatietoken-een-0001', 'KM7P4X2C')
    returning id into v_p1;
    insert into public.enrollment_participants (event_id, group_id, display_name, search_key, flat_key, claim_token, access_code)
    values (v_dag, v_klas, 'Leerling Twee', 'leerling twee', 'leerlingtwee', 'acceptatietoken-twee-0002', 'KM7P4X2D')
    returning id into v_p2;

    perform public.enrollment_choose(v_p1, v_sessie, 'deelnemer');
    insert into uitkomst values ('leerling kan zich inschrijven', true, 'ok');
    begin
      perform public.enrollment_choose(v_p2, v_sessie, 'deelnemer');
      insert into uitkomst values ('een volle workshop weigert de volgende leerling', false, 'toegestaan');
    exception when others then
      insert into uitkomst values ('een volle workshop weigert de volgende leerling', true, sqlerrm);
    end;
  exception when others then
    insert into uitkomst values ('inschrijfregels op de live database', false, sqlerrm);
  end;

  begin
    perform set_config('request.jwt.claim.sub', v_anna::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_anna, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.enrollment_choose(v_p2, v_sessie, 'deelnemer');
    reset role;
    insert into uitkomst values ('klant kan de inschrijffunctie niet zelf aanroepen', false, 'toegestaan');
  exception when insufficient_privilege then
    insert into uitkomst values ('klant kan de inschrijffunctie niet zelf aanroepen', true, sqlerrm);
  end;

  -- ---------------------------------------------------------------------------
  -- Uitkomst. Daarna alles terugdraaien.
  -- ---------------------------------------------------------------------------
  reset role;
  select count(*) filter (where goed),
         coalesce(jsonb_object_agg(naam, detail) filter (where not goed), '{}'::jsonb)
    into v_goed, v_fout
    from uitkomst;
  select count(*) into v_n from uitkomst;

  raise exception 'ACCEPTATIETEST % van % goed. Niet goed: %. (Alles is teruggedraaid; er staat niets meer in de database.)',
    v_goed, v_n, v_fout::text;
end $$;
