-- =============================================================================
-- SkoolPartner - demodata en jezelf beheerder maken
-- =============================================================================
-- Draai dit NADAT je setup-alles.sql hebt gedraaid en NADAT je je een keer hebt
-- geregistreerd of ingelogd. Anders bestaat je account nog niet.
--
-- Wat dit script neerzet:
--   * jouw account als beheerder en super admin
--   * drie demo-organisaties, zodat de organisatiewisselaar te testen is
--   * negen boekingen in alle statussen, verleden en toekomst
--   * vijf facturen: betaald, open, te laat en deels betaald, met factuurregels
--   * SkoolPoints in elke status: beschikbaar, in behandeling, gereserveerd,
--     ingewisseld, verlopen en een handmatige correctie
--   * twee inwisselverzoeken, een open en een goedgekeurde
--   * twee reviews, een ingediend en een geverifieerde met bonuspunten
--   * drie e-mailgesprekken met meerdere berichten
--   * twee bevestigingsmails in de controlewachtrij van de beheeromgeving
--   * een openstaande uitnodiging
--
-- Alles is duidelijk herkenbaar als demo: verzonnen scholen, verzonnen
-- boekingsnummers en factuurnummers die met demo- beginnen. Ruim het op met
-- demo-data-verwijderen.sql voordat er echte klanten in komen.
--
-- Plak dit in Supabase > SQL Editor en klik op Run. Opnieuw draaien is veilig.
-- =============================================================================

do $$
declare
  -- >>> PAS DIT AAN <<<
  -- Vul hier het e-mailadres in waarmee je in SkoolPartner inlogt. Dat is het
  -- adres dat in Supabase bij Authentication > Users staat.
  v_email    text := 'skoolworkshop@gmail.com';

  v_bekend   text;
  v_user     uuid;

  v_org1     uuid;  -- De Goudse Waarden, de rijkgevulde demo-organisatie
  v_org2     uuid;  -- Het Vrije College, een kleinere organisatie
  v_org3     uuid;  -- Buurtcentrum De Zuidhoek, net gestart, nog leeg

  v_acc1     uuid;
  v_acc2     uuid;
  v_acc3     uuid;

  v_b        uuid;
  v_b1       uuid;
  v_b2       uuid;
  v_b3       uuid;
  v_b4       uuid;
  v_b5       uuid;
  v_b6       uuid;
  v_b7       uuid;

  v_inv      uuid;
  v_inv1     uuid;
  v_inv2     uuid;
  v_inv3     uuid;

  v_rev      uuid;
  v_thread   uuid;
  v_res      uuid;
begin
  ---------------------------------------------------------------------------
  -- 1. Account opzoeken en beheerder maken
  ---------------------------------------------------------------------------
  select id into v_user from auth.users where lower(email) = lower(v_email);

  if v_user is null then
    select string_agg(email, ', ' order by created_at) into v_bekend from auth.users;
    raise exception
      'Geen account gevonden voor %. Bekende accounts: %. Pas v_email hierboven aan of log eerst een keer in.',
      v_email, coalesce(v_bekend, 'nog geen enkel account');
  end if;

  insert into public.profiles (id, email, full_name, job_title, is_admin, is_super_admin)
  values (v_user, v_email, 'Beheerder Skool Workshop', 'Beheer', true, true)
  on conflict (id) do update
    set is_admin = true, is_super_admin = true, is_blocked = false;

  ---------------------------------------------------------------------------
  -- 2. Drie demo-organisaties
  ---------------------------------------------------------------------------
  select id into v_org1 from public.organizations where slug = 'de-goudse-waarden';
  if v_org1 is null then
    insert into public.organizations (name, slug, kind, status, city, contact_email)
    values ('De Goudse Waarden', 'de-goudse-waarden', 'school', 'active', 'Gouda', v_email)
    returning id into v_org1;
  end if;

  select id into v_org2 from public.organizations where slug = 'het-vrije-college';
  if v_org2 is null then
    insert into public.organizations (name, slug, kind, status, city, contact_email)
    values ('Het Vrije College', 'het-vrije-college', 'school', 'active', 'Utrecht', v_email)
    returning id into v_org2;
  end if;

  select id into v_org3 from public.organizations where slug = 'buurtcentrum-de-zuidhoek';
  if v_org3 is null then
    insert into public.organizations (name, slug, kind, status, city, contact_email)
    values ('Buurtcentrum De Zuidhoek', 'buurtcentrum-de-zuidhoek', 'vereniging', 'active',
            'Rotterdam', v_email)
    returning id into v_org3;
  end if;

  -- Domeinen. De unieke index staat op lower(domain), daar werkt on conflict niet.
  if not exists (select 1 from public.organization_domains where domain = 'goudsewaarden.nl') then
    insert into public.organization_domains (organization_id, domain, is_verified, verified_at, verified_by)
    values (v_org1, 'goudsewaarden.nl', true, now(), v_user);
  end if;
  if not exists (select 1 from public.organization_domains where domain = 'hetvrijecollege.nl') then
    insert into public.organization_domains (organization_id, domain, is_verified, verified_at, verified_by)
    values (v_org2, 'hetvrijecollege.nl', true, now(), v_user);
  end if;

  -- Jezelf actief lid maken van alle drie, zodat de organisatiewisselaar werkt.
  insert into public.organization_members
    (organization_id, user_id, role, status, source, approved_by, approved_at)
  values
    (v_org1, v_user, 'beheerder', 'active', 'admin_manual', v_user, now()),
    (v_org2, v_user, 'beheerder', 'active', 'admin_manual', v_user, now()),
    (v_org3, v_user, 'lid',       'active', 'admin_manual', v_user, now())
  on conflict (organization_id, user_id) do update
    set status = 'active', approved_at = now();

  if exists (
    select 1 from public.organization_contacts
    where organization_id = v_org1 and lower(email) = lower(v_email)
  ) then
    update public.organization_contacts
    set is_verified = true, user_id = v_user, verified_at = now(), verified_by = v_user
    where organization_id = v_org1 and lower(email) = lower(v_email);
  else
    insert into public.organization_contacts
      (organization_id, email, full_name, user_id, is_verified, verified_at, verified_by)
    values (v_org1, v_email, 'Beheerder Skool Workshop', v_user, true, now(), v_user);
  end if;

  -- Een openstaande uitnodiging, zodat die lijst in de beheeromgeving niet leeg is.
  if not exists (select 1 from public.organization_invites where token_hash = 'demo-invite-hash-1') then
    insert into public.organization_invites
      (organization_id, email, role, token_hash, expires_at, created_by)
    values (v_org1, 'j.bakker@goudsewaarden.nl', 'lid', 'demo-invite-hash-1',
            now() + interval '10 days', v_user);
  end if;

  ---------------------------------------------------------------------------
  -- 3. SkoolPartner-accounts
  ---------------------------------------------------------------------------
  v_acc1 := public.ensure_loyalty_account(v_org1, v_user);
  v_acc2 := public.ensure_loyalty_account(v_org2, v_user);
  v_acc3 := public.ensure_loyalty_account(v_org3, v_user);

  ---------------------------------------------------------------------------
  -- 4. Boekingen
  ---------------------------------------------------------------------------
  -- De Goudse Waarden
  select id into v_b1 from public.bookings where reference = 'SW-2026-0123';
  if v_b1 is null then
    insert into public.bookings (
      organization_id, reference, workshop_name, workshop_count, minutes_per_workshop,
      qualifying_minutes, scheduled_date, start_time, end_time, location, participants,
      status, origin, contact_email, contact_name, created_by
    ) values (
      v_org1, 'SW-2026-0123', 'Graffiti', 4, 90, 360,
      current_date - 120, '09:00', '15:00', 'Kanaalstraat 5, Gouda', 96,
      'completed', 'admin_manual', v_email, 'Sanne de Vries', v_user
    ) returning id into v_b1;
  end if;

  select id into v_b2 from public.bookings where reference = 'SW-2026-0187';
  if v_b2 is null then
    insert into public.bookings (
      organization_id, reference, workshop_name, workshop_count, minutes_per_workshop,
      qualifying_minutes, scheduled_date, start_time, end_time, location, participants,
      status, origin, contact_email, contact_name, created_by
    ) values (
      v_org1, 'SW-2026-0187', 'Podcast maken', 2, 90, 180,
      current_date - 8, '10:00', '13:00', 'Kanaalstraat 5, Gouda', 48,
      'completed', 'email_parser', v_email, 'Sanne de Vries', v_user
    ) returning id into v_b2;
  end if;

  select id into v_b3 from public.bookings where reference = 'SW-2026-0231';
  if v_b3 is null then
    insert into public.bookings (
      organization_id, reference, workshop_name, workshop_count, minutes_per_workshop,
      qualifying_minutes, scheduled_date, start_time, end_time, location, participants,
      status, origin, contact_email, contact_name, created_by
    ) values (
      v_org1, 'SW-2026-0231', 'Breakdance', 3, 90, 270,
      current_date + 21, '09:30', '14:00', 'Sporthal De Mammoet, Gouda', 72,
      'confirmed', 'email_parser', v_email, 'Sanne de Vries', v_user
    ) returning id into v_b3;
  end if;

  select id into v_b4 from public.bookings where reference = 'SW-2026-0244';
  if v_b4 is null then
    insert into public.bookings (
      organization_id, reference, workshop_name, workshop_count, minutes_per_workshop,
      qualifying_minutes, scheduled_date, start_time, end_time, location, participants,
      status, origin, contact_email, contact_name, created_by
    ) values (
      v_org1, 'SW-2026-0244', 'Dans', 3, 90, 270,
      current_date - 60, '09:00', '14:00', 'Kanaalstraat 5, Gouda', 84,
      'completed', 'admin_manual', v_email, 'Sanne de Vries', v_user
    ) returning id into v_b4;
  end if;

  select id into v_b5 from public.bookings where reference = 'SW-2026-0252';
  if v_b5 is null then
    insert into public.bookings (
      organization_id, reference, workshop_name, workshop_count, minutes_per_workshop,
      qualifying_minutes, scheduled_date, start_time, end_time, location, participants,
      status, origin, contact_email, contact_name, notes, created_by
    ) values (
      v_org1, 'SW-2026-0252', 'DJ workshop', 2, 90, 180,
      current_date + 40, '10:00', '13:00', 'Kanaalstraat 5, Gouda', 40,
      'cancelled', 'admin_manual', v_email, 'Sanne de Vries',
      'Geannuleerd door de school wegens een roosterwijziging', v_user
    ) returning id into v_b5;
  end if;

  select id into v_b6 from public.bookings where reference = 'SW-2026-0260';
  if v_b6 is null then
    insert into public.bookings (
      organization_id, reference, workshop_name, workshop_count, minutes_per_workshop,
      qualifying_minutes, scheduled_date, start_time, end_time, location, participants,
      status, origin, contact_email, contact_name, created_by
    ) values (
      v_org1, 'SW-2026-0260', 'Spoken word', 2, 90, 180,
      current_date + 75, '11:00', '14:00', 'Kanaalstraat 5, Gouda', 52,
      'concept', 'admin_manual', v_email, 'Sanne de Vries', v_user
    ) returning id into v_b6;
  end if;

  -- Het Vrije College
  select id into v_b7 from public.bookings where reference = 'SW-2026-0301';
  if v_b7 is null then
    insert into public.bookings (
      organization_id, reference, workshop_name, workshop_count, minutes_per_workshop,
      qualifying_minutes, scheduled_date, start_time, end_time, location, participants,
      status, origin, contact_email, contact_name, created_by
    ) values (
      v_org2, 'SW-2026-0301', 'Graffiti', 2, 90, 180,
      current_date - 25, '09:00', '12:00', 'Weerdsingel 12, Utrecht', 44,
      'completed', 'admin_manual', v_email, 'Ramon Wolters', v_user
    ) returning id into v_b7;
  end if;

  select id into v_b from public.bookings where reference = 'SW-2026-0312';
  if v_b is null then
    insert into public.bookings (
      organization_id, reference, workshop_name, workshop_count, minutes_per_workshop,
      qualifying_minutes, scheduled_date, start_time, end_time, location, participants,
      status, origin, contact_email, contact_name, created_by
    ) values (
      v_org2, 'SW-2026-0312', 'Rap en songwriting', 1, 90, 90,
      current_date + 12, '13:00', '14:30', 'Weerdsingel 12, Utrecht', 26,
      'confirmed', 'admin_manual', v_email, 'Ramon Wolters', v_user
    ) returning id into v_b;
  end if;

  -- Buurtcentrum De Zuidhoek krijgt bewust nog geen boekingen: zo zie je hoe
  -- het portaal eruitziet voor een organisatie die net begint.

  ---------------------------------------------------------------------------
  -- 5. Facturen, factuurregels en koppelingen
  ---------------------------------------------------------------------------
  insert into public.invoices (
    organization_id, moneybird_invoice_id, invoice_number, reference,
    invoice_date, due_date, state, total_excl_cents, total_incl_cents,
    total_paid_cents, total_unpaid_cents, paid_at, fully_paid
  ) values (
    v_org1, 'demo-mb-2026-00123', 'demo-2026-00123', 'Cultuurdag SW-2026-0123',
    current_date - 118, current_date - 90, 'paid', 103306, 125000,
    125000, 0, now() - interval '95 days', true
  )
  on conflict (moneybird_invoice_id) do update set organization_id = excluded.organization_id
  returning id into v_inv1;

  insert into public.invoices (
    organization_id, moneybird_invoice_id, invoice_number, reference,
    invoice_date, due_date, state, total_excl_cents, total_incl_cents,
    total_paid_cents, total_unpaid_cents, paid_at, fully_paid
  ) values (
    v_org1, 'demo-mb-2026-00244', 'demo-2026-00244', 'Dansdag SW-2026-0244',
    current_date - 58, current_date - 30, 'paid', 74380, 90000,
    90000, 0, now() - interval '35 days', true
  )
  on conflict (moneybird_invoice_id) do update set organization_id = excluded.organization_id
  returning id into v_inv;

  insert into public.invoices (
    organization_id, moneybird_invoice_id, invoice_number, reference,
    invoice_date, due_date, state, total_excl_cents, total_incl_cents,
    total_paid_cents, total_unpaid_cents, fully_paid
  ) values (
    v_org1, 'demo-mb-2026-00187', 'demo-2026-00187', 'Projectdag SW-2026-0187',
    current_date - 6, current_date + 22, 'open', 53719, 65000,
    0, 65000, false
  )
  on conflict (moneybird_invoice_id) do update set organization_id = excluded.organization_id
  returning id into v_inv2;

  -- Een factuur die te laat is, om die weergave te kunnen controleren.
  insert into public.invoices (
    organization_id, moneybird_invoice_id, invoice_number, reference,
    invoice_date, due_date, state, total_excl_cents, total_incl_cents,
    total_paid_cents, total_unpaid_cents, fully_paid
  ) values (
    v_org1, 'demo-mb-2026-00201', 'demo-2026-00201', 'Materiaalkosten najaar',
    current_date - 70, current_date - 40, 'late', 24793, 30000,
    0, 30000, false
  )
  on conflict (moneybird_invoice_id) do update set organization_id = excluded.organization_id
  returning id into v_inv3;

  -- Deels betaald bij de tweede organisatie.
  insert into public.invoices (
    organization_id, moneybird_invoice_id, invoice_number, reference,
    invoice_date, due_date, state, total_excl_cents, total_incl_cents,
    total_paid_cents, total_unpaid_cents, fully_paid
  ) values (
    v_org2, 'demo-mb-2026-00301', 'demo-2026-00301', 'Workshopdag SW-2026-0301',
    current_date - 23, current_date + 5, 'partially_paid', 49587, 60000,
    30000, 30000, false
  )
  on conflict (moneybird_invoice_id) do update set organization_id = excluded.organization_id;

  insert into public.invoice_lines
    (invoice_id, moneybird_line_id, position, description, amount, price_cents, total_cents, is_workshop_line)
  values
    (v_inv1, 'demo-line-1', 1, 'Workshop Graffiti, 4 x 90 minuten', 4, 25000, 100000, true),
    (v_inv1, 'demo-line-2', 2, 'Materiaalkosten', 1, 15000, 15000, false),
    (v_inv1, 'demo-line-3', 3, 'Reiskosten', 1, 5000, 5000, false),
    (v_inv2, 'demo-line-4', 1, 'Workshop Podcast maken, 2 x 90 minuten', 2, 25000, 50000, true),
    (v_inv2, 'demo-line-5', 2, 'Starttarief', 1, 5000, 5000, false),
    (v_inv3, 'demo-line-6', 1, 'Materiaalpakket najaar', 1, 30000, 30000, false)
  on conflict (invoice_id, moneybird_line_id) where moneybird_line_id is not null do nothing;

  insert into public.booking_invoices (booking_id, invoice_id, link_method, confidence)
  values (v_b1, v_inv1, 'demo', 1), (v_b2, v_inv2, 'demo', 1), (v_b4, v_inv, 'demo', 1)
  on conflict (booking_id, invoice_id) do nothing;

  ---------------------------------------------------------------------------
  -- 6. Reviews
  ---------------------------------------------------------------------------
  select id into v_rev from public.reviews where external_review_id = 'demo-review-1';
  if v_rev is null then
    insert into public.reviews (
      organization_id, booking_id, submitted_by, platform, external_review_id,
      review_url, rating, body, status, verified_at, verified_by
    ) values (
      v_org1, v_b1, v_user, 'google', 'demo-review-1',
      'https://example.com/demo-review-1', 5,
      'Demotekst. Dit is geen echte review, maar testinhoud voor de demo-omgeving.',
      'verified', now() - interval '100 days', v_user
    ) returning id into v_rev;
  end if;

  if not exists (select 1 from public.reviews where external_review_id = 'demo-review-2') then
    insert into public.reviews (
      organization_id, booking_id, submitted_by, platform, external_review_id,
      review_url, rating, body, status
    ) values (
      v_org1, v_b4, v_user, 'google', 'demo-review-2',
      'https://example.com/demo-review-2', 4,
      'Demotekst. Nog niet geverifieerd, dus nog geen bonuspunten.',
      'submitted'
    );
  end if;

  ---------------------------------------------------------------------------
  -- 7. SkoolPoints in elke status
  --    De Goudse Waarden komt uit op 350 beschikbaar en 300 in behandeling.
  ---------------------------------------------------------------------------
  insert into public.loyalty_transactions (
    organization_id, account_id, type, status, points, point_value_cents_per_100,
    points_per_hour_at_time, qualifying_minutes, description, source,
    external_reference, booking_id, invoice_id, available_at, expires_at, occurred_at
  ) values (
    v_org1, v_acc1, 'earn_workshop', 'available', 600, 250, 100, 360,
    'Graffiti, 4 x 90 minuten', 'demo', 'booking:' || v_b1::text, v_b1, v_inv1,
    now() - interval '95 days', now() + interval '15 months', now() - interval '120 days'
  ) on conflict (organization_id, type, external_reference)
    where external_reference is not null do nothing;

  insert into public.loyalty_transactions (
    organization_id, account_id, type, status, points, point_value_cents_per_100,
    points_per_hour_at_time, qualifying_minutes, description, source,
    external_reference, booking_id, invoice_id, available_at, expires_at, occurred_at
  ) values (
    v_org1, v_acc1, 'earn_workshop', 'available', 450, 250, 100, 270,
    'Dans, 3 x 90 minuten', 'demo', 'booking:' || v_b4::text, v_b4, v_inv,
    now() - interval '35 days', now() + interval '22 months', now() - interval '60 days'
  ) on conflict (organization_id, type, external_reference)
    where external_reference is not null do nothing;

  insert into public.loyalty_transactions (
    organization_id, account_id, type, status, points, point_value_cents_per_100,
    description, source, external_reference, review_id, available_at, expires_at, occurred_at
  ) values (
    v_org1, v_acc1, 'earn_review', 'available', 50, 250,
    'Bonus voor een geverifieerde review', 'demo', 'review:demo-review-1', v_rev,
    now() - interval '100 days', now() + interval '14 months', now() - interval '100 days'
  ) on conflict (organization_id, type, external_reference)
    where external_reference is not null do nothing;

  -- Nog niet beschikbaar: de bijbehorende factuur staat nog open.
  insert into public.loyalty_transactions (
    organization_id, account_id, type, status, points, point_value_cents_per_100,
    points_per_hour_at_time, qualifying_minutes, description, source,
    external_reference, booking_id, invoice_id, occurred_at
  ) values (
    v_org1, v_acc1, 'earn_workshop', 'pending', 300, 250, 100, 180,
    'Podcast maken, 2 x 90 minuten', 'demo', 'booking:' || v_b2::text, v_b2, v_inv2,
    now() - interval '8 days'
  ) on conflict (organization_id, type, external_reference)
    where external_reference is not null do nothing;

  -- Gereserveerd voor een openstaand inwisselverzoek.
  insert into public.loyalty_transactions (
    organization_id, account_id, type, status, points, point_value_cents_per_100,
    description, source, external_reference, occurred_at
  ) values (
    v_org1, v_acc1, 'redemption_reserve', 'reserved', -500, 250,
    'Gereserveerd voor inwisselverzoek', 'demo', 'redemption:demo-1',
    now() - interval '4 days'
  ) on conflict (organization_id, type, external_reference)
    where external_reference is not null do nothing;

  -- Al toegepast op een eerdere boeking.
  insert into public.loyalty_transactions (
    organization_id, account_id, type, status, points, point_value_cents_per_100,
    description, source, external_reference, occurred_at
  ) values (
    v_org1, v_acc1, 'redemption_reserve', 'redeemed', -250, 250,
    'Ingewisseld als voordeel op boeking SW-2026-0244', 'demo', 'redemption:demo-2',
    now() - interval '50 days'
  ) on conflict (organization_id, type, external_reference)
    where external_reference is not null do nothing;

  -- Verlopen punten uit een oud saldo.
  insert into public.loyalty_transactions (
    organization_id, account_id, type, status, points, point_value_cents_per_100,
    description, source, external_reference, occurred_at
  ) values (
    v_org1, v_acc1, 'expiry', 'expired', -100, 250,
    'Verlopen na 24 maanden', 'demo', 'expiry:demo-1',
    now() - interval '15 days'
  ) on conflict (organization_id, type, external_reference)
    where external_reference is not null do nothing;

  -- Handmatige correctie door de beheerder, met verplichte reden.
  insert into public.loyalty_transactions (
    organization_id, account_id, type, status, points, point_value_cents_per_100,
    description, source, external_reference, reason, created_by, available_at,
    expires_at, occurred_at
  ) values (
    v_org1, v_acc1, 'manual_adjustment', 'available', 100, 250,
    'Correctie na verkeerd geregistreerde workshopduur', 'demo', 'manual:demo-1',
    'Bij boeking SW-2026-0123 stond 90 minuten te weinig geregistreerd.',
    v_user, now() - interval '10 days', now() + interval '23 months',
    now() - interval '10 days'
  ) on conflict (organization_id, type, external_reference)
    where external_reference is not null do nothing;

  -- Het Vrije College: 300 beschikbaar, 150 in behandeling.
  insert into public.loyalty_transactions (
    organization_id, account_id, type, status, points, point_value_cents_per_100,
    points_per_hour_at_time, qualifying_minutes, description, source,
    external_reference, booking_id, available_at, expires_at, occurred_at
  ) values (
    v_org2, v_acc2, 'earn_workshop', 'available', 300, 250, 100, 180,
    'Graffiti, 2 x 90 minuten', 'demo', 'booking:' || v_b7::text, v_b7,
    now() - interval '20 days', now() + interval '23 months', now() - interval '25 days'
  ) on conflict (organization_id, type, external_reference)
    where external_reference is not null do nothing;

  insert into public.loyalty_transactions (
    organization_id, account_id, type, status, points, point_value_cents_per_100,
    points_per_hour_at_time, qualifying_minutes, description, source,
    external_reference, occurred_at
  ) values (
    v_org2, v_acc2, 'earn_workshop', 'pending', 150, 250, 100, 90,
    'Rap en songwriting, 1 x 90 minuten', 'demo', 'booking-toekomst:demo-1',
    now() - interval '2 days'
  ) on conflict (organization_id, type, external_reference)
    where external_reference is not null do nothing;

  update public.bookings set points_awarded = true
  where id in (v_b1, v_b2, v_b4, v_b7);

  ---------------------------------------------------------------------------
  -- 8. Inwisselverzoeken
  ---------------------------------------------------------------------------
  if not exists (
    select 1 from public.redemption_requests
    where organization_id = v_org1 and note = 'demo-verzoek-open'
  ) then
    insert into public.redemption_requests (
      organization_id, requested_by, points, value_cents, point_value_cents_per_100,
      booking_reference, note, status
    ) values (
      v_org1, v_user, 500, 1250, 250, 'SW-2026-0231', 'demo-verzoek-open', 'requested'
    );
  end if;

  if not exists (
    select 1 from public.redemption_requests
    where organization_id = v_org1 and note = 'demo-verzoek-toegepast'
  ) then
    insert into public.redemption_requests (
      organization_id, requested_by, points, value_cents, point_value_cents_per_100,
      booking_reference, note, status, decided_by, decided_at, decision_note, applied_at
    ) values (
      v_org1, v_user, 250, 625, 250, 'SW-2026-0244', 'demo-verzoek-toegepast', 'applied',
      v_user, now() - interval '50 days', 'Verwerkt op de factuur.', now() - interval '50 days'
    );
  end if;

  ---------------------------------------------------------------------------
  -- 9. Berichtencentrum
  ---------------------------------------------------------------------------
  insert into public.message_threads (
    organization_id, gmail_thread_id, subject, participant_emails,
    visibility, visibility_reason
  ) values (
    v_org1, 'demo-thread-1', 'Boekingsbevestiging Cultuurdag',
    array[v_email, 'boekingen@skoolworkshop.nl'], 'auto_allowed', 'Demodata'
  )
  on conflict (gmail_thread_id) do update set organization_id = excluded.organization_id
  returning id into v_thread;

  insert into public.messages (
    thread_id, gmail_message_id, direction, from_email, from_name, to_emails,
    subject, sent_at, snippet, body_text
  ) values
  (
    v_thread, 'demo-msg-1', 'outbound', 'boekingen@skoolworkshop.nl', 'Skool Workshop',
    array[v_email], 'Boekingsbevestiging Cultuurdag', now() - interval '125 days',
    'Hierbij bevestigen wij uw boeking.',
    E'Beste Sanne,\n\nHierbij bevestigen wij uw boeking. De boeking is definitief.\n\nWorkshop: Graffiti\nAantal workshops: 4\nDuur: 90 minuten per workshop\nLocatie: Kanaalstraat 5, Gouda\nBoekingsnummer: SW-2026-0123\n\nMet vriendelijke groet,\nTeam Skool Workshop'
  ),
  (
    v_thread, 'demo-msg-2', 'inbound', v_email, 'Sanne de Vries',
    array['boekingen@skoolworkshop.nl'], 'Re: Boekingsbevestiging Cultuurdag',
    now() - interval '124 days', 'Dank voor de bevestiging.',
    'Dank voor de bevestiging. Nemen de leerlingen zelf oude kleding mee, of regelen jullie schorten?'
  ),
  (
    v_thread, 'demo-msg-3', 'outbound', 'boekingen@skoolworkshop.nl', 'Skool Workshop',
    array[v_email], 'Re: Boekingsbevestiging Cultuurdag', now() - interval '124 days',
    'Wij nemen schorten mee.',
    E'Wij nemen schorten mee voor alle deelnemers. Oude kleding is dus niet nodig.\n\nMet vriendelijke groet,\nTeam Skool Workshop'
  )
  on conflict (gmail_message_id) do nothing;

  insert into public.message_threads (
    organization_id, gmail_thread_id, subject, participant_emails,
    visibility, visibility_reason
  ) values (
    v_org1, 'demo-thread-2', 'Planning Breakdance in maart',
    array[v_email, 'boekingen@skoolworkshop.nl'], 'auto_allowed', 'Demodata'
  )
  on conflict (gmail_thread_id) do update set organization_id = excluded.organization_id
  returning id into v_thread;

  insert into public.messages (
    thread_id, gmail_message_id, direction, from_email, from_name, to_emails,
    subject, sent_at, snippet, body_text
  ) values
  (
    v_thread, 'demo-msg-4', 'inbound', v_email, 'Sanne de Vries',
    array['boekingen@skoolworkshop.nl'], 'Planning Breakdance in maart',
    now() - interval '9 days', 'Kunnen we een half uur later beginnen?',
    'Kunnen we een half uur later beginnen? De eerste les loopt bij ons door tot half tien.'
  ),
  (
    v_thread, 'demo-msg-5', 'outbound', 'boekingen@skoolworkshop.nl', 'Skool Workshop',
    array[v_email], 'Re: Planning Breakdance in maart', now() - interval '8 days',
    'Dat kan, wij passen het aan.',
    E'Dat kan. Wij zetten de starttijd op 09.30 uur en passen de bevestiging aan.\n\nMet vriendelijke groet,\nTeam Skool Workshop'
  )
  on conflict (gmail_message_id) do nothing;

  insert into public.message_threads (
    organization_id, gmail_thread_id, subject, participant_emails,
    visibility, visibility_reason
  ) values (
    v_org2, 'demo-thread-3', 'Offerte workshopdag Utrecht',
    array[v_email, 'boekingen@skoolworkshop.nl'], 'auto_allowed', 'Demodata'
  )
  on conflict (gmail_thread_id) do update set organization_id = excluded.organization_id
  returning id into v_thread;

  insert into public.messages (
    thread_id, gmail_message_id, direction, from_email, from_name, to_emails,
    subject, sent_at, snippet, body_text
  ) values (
    v_thread, 'demo-msg-6', 'outbound', 'boekingen@skoolworkshop.nl', 'Skool Workshop',
    array[v_email], 'Offerte workshopdag Utrecht', now() - interval '30 days',
    'In de bijlage vindt u de offerte.',
    E'Beste Ramon,\n\nIn de bijlage vindt u de offerte voor de workshopdag.\n\nMet vriendelijke groet,\nTeam Skool Workshop'
  )
  on conflict (gmail_message_id) do nothing;

  ---------------------------------------------------------------------------
  -- 10. Controlewachtrij in de beheeromgeving
  ---------------------------------------------------------------------------
  if not exists (select 1 from public.booking_sources where external_message_id = 'demo-source-1') then
  insert into public.booking_sources (
    channel, external_message_id, external_thread_id, from_email, from_name,
    to_emails, subject, received_at, snippet, body_text, confidence,
    match_status, review_reasons, suggested_organization_id
  ) values (
    'gmail', 'demo-source-1', 'demo-thread-4', 'boekingen@skoolworkshop.nl', 'Skool Workshop',
    array['t.mulder@onbekendeschool.nl'], 'Bevestiging workshop 14 april',
    now() - interval '3 days', 'Hierbij bevestigen wij uw boeking.',
    E'Beste Tessa,\n\nHierbij bevestigen wij uw boeking.\n\nWorkshop: Graffiti\nAantal workshops: 3\nDuur: 90 minuten per workshop\nLocatie: Schoolstraat 1, Alphen aan den Rijn\n\nMet vriendelijke groet,\nTeam Skool Workshop',
    0.62, 'needs_review',
    array['Organisatie niet herkend', 'Boekingsnummer ontbreekt'], null
  );
  end if;

  if not exists (select 1 from public.booking_sources where external_message_id = 'demo-source-2') then
  insert into public.booking_sources (
    channel, external_message_id, external_thread_id, from_email, from_name,
    to_emails, subject, received_at, snippet, body_text, confidence,
    match_status, review_reasons, suggested_organization_id
  ) values (
    'gmail', 'demo-source-2', 'demo-thread-5', 'boekingen@skoolworkshop.nl', 'Skool Workshop',
    array[v_email], 'Bevestiging workshop 3 mei',
    now() - interval '1 day', 'Hierbij bevestigen wij uw boeking.',
    E'Beste Sanne,\n\nHierbij bevestigen wij uw boeking.\n\nWorkshop: Graffiti\nDuur: 60 minuten\nLocatie: Kanaalstraat 5, Gouda\nBoekingsnummer: SW-2026-0288\n\nMet vriendelijke groet,\nTeam Skool Workshop',
    0.81, 'needs_review',
    array['Workshopduur onder het minimum van 90 minuten'], v_org1
  );
  end if;

  ---------------------------------------------------------------------------
  -- 11. Resultaten van workshops
  ---------------------------------------------------------------------------
  -- Eén set die klaarstaat en één die net verlopen is, zodat je beide kanten
  -- ziet. De bestanden zijn alleen links, want in demodata zetten we niets in
  -- de opslag.
  select id into v_res from public.workshop_results
  where organization_id = v_org1 and title = 'Cultuurdag Graffiti';

  if v_res is null then
    insert into public.workshop_results (
      organization_id, booking_id, title, description, status,
      published_at, expires_at, purge_at, notified_at, notified_email, created_by
    ) values (
      v_org1, v_b2, 'Cultuurdag Graffiti',
      'De foto''s en de aftermovie van de workshopdag. Demodata, dus de links wijzen naar voorbeeldadressen.',
      'published', now() - interval '2 days', now() + interval '5 days',
      now() + interval '12 days', now() - interval '2 days', v_email, v_user
    ) returning id into v_res;

    insert into public.workshop_result_files
      (result_id, kind, external_url, file_name, position, created_by)
    values
      (v_res, 'link', 'https://example.com/demo-fotos', 'Foto''s van de dag', 0, v_user),
      (v_res, 'link', 'https://example.com/demo-aftermovie', 'Aftermovie via WeTransfer', 1, v_user);
  end if;

  select id into v_res from public.workshop_results
  where organization_id = v_org1 and title = 'Podcastdag maart';

  if v_res is null then
    insert into public.workshop_results (
      organization_id, booking_id, title, description, status,
      published_at, expires_at, purge_at, notified_at, notified_email,
      files_removed_at, created_by
    ) values (
      v_org1, v_b1, 'Podcastdag maart',
      'De opnames van de podcastworkshop. Demodata.',
      'expired', now() - interval '12 days', now() - interval '5 days',
      now() + interval '2 days', now() - interval '12 days', v_email,
      now() - interval '5 days', v_user
    ) returning id into v_res;
  end if;

  raise notice 'Klaar. % is beheerder en lid van drie demo-organisaties.', v_email;
end $$;

-- Controle. Verwacht: De Goudse Waarden 350 beschikbaar en 300 in behandeling,
-- Het Vrije College 300 en 150, Buurtcentrum De Zuidhoek 0 en 0.
select
  o.name                   as organisatie,
  b.available_points       as beschikbaar,
  b.pending_points         as in_behandeling,
  b.reserved_points        as gereserveerd,
  b.redeemed_points        as ingewisseld,
  b.expired_points         as verlopen,
  b.lifetime_earned_points as totaal_gespaard
from public.loyalty_balances b
join public.organizations o on o.id = b.organization_id
order by o.name;
