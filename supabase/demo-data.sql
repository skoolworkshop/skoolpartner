-- =============================================================================
-- Mijn Skool - demodata en jezelf beheerder maken
-- =============================================================================
-- Draai dit NADAT je setup-alles.sql hebt gedraaid en NADAT je je een keer hebt
-- geregistreerd via /registreren. Anders bestaat je account nog niet en kan dit
-- script het niet koppelen.
--
-- Vul hieronder je eigen e-mailadres in. Dat account wordt beheerder en wordt
-- gekoppeld aan de demo-organisatie, zodat je meteen zowel het klantportaal als
-- de beheeromgeving kunt bekijken.
--
-- Plak dit in Supabase > SQL Editor en klik op Run. Opnieuw draaien is veilig.
-- =============================================================================

do $$
declare
  -- >>> PAS DIT AAN <<<
  v_email    text := 'info@skoolworkshop.nl';

  v_user     uuid;
  v_org      uuid;
  v_account  uuid;
  v_b1       uuid;
  v_b2       uuid;
  v_b3       uuid;
  v_inv1     uuid;
  v_inv2     uuid;
  v_thread   uuid;
begin
  ---------------------------------------------------------------------------
  -- 1. Account opzoeken
  ---------------------------------------------------------------------------
  select id into v_user from auth.users where lower(email) = lower(v_email);

  if v_user is null then
    raise exception
      'Geen account gevonden voor %. Registreer je eerst via /registreren en draai dit daarna opnieuw.',
      v_email;
  end if;

  -- Profiel aanmaken als de trigger dat nog niet deed, en beheerder maken.
  insert into public.profiles (id, email, full_name, is_admin, is_super_admin)
  values (v_user, v_email, 'Beheerder Skool Workshop', true, true)
  on conflict (id) do update
    set is_admin = true, is_super_admin = true, is_blocked = false;

  ---------------------------------------------------------------------------
  -- 2. Demo-organisatie
  ---------------------------------------------------------------------------
  select id into v_org from public.organizations where slug = 'de-goudse-waarden';

  if v_org is null then
    insert into public.organizations (name, slug, kind, status, city, contact_email)
    values ('De Goudse Waarden', 'de-goudse-waarden', 'school', 'active', 'Gouda', v_email)
    returning id into v_org;
  end if;

  -- De unieke index staat op lower(domain), daar werkt "on conflict" niet op.
  if not exists (select 1 from public.organization_domains where domain = 'goudsewaarden.nl') then
    insert into public.organization_domains (organization_id, domain, is_verified, verified_at, verified_by)
    values (v_org, 'goudsewaarden.nl', true, now(), v_user);
  end if;

  -- Jezelf als actief lid koppelen, zodat je het klantportaal ziet.
  insert into public.organization_members
    (organization_id, user_id, role, status, source, approved_by, approved_at)
  values (v_org, v_user, 'beheerder', 'active', 'admin_manual', v_user, now())
  on conflict (organization_id, user_id) do update
    set status = 'active', role = 'beheerder', approved_at = now();

  if exists (
    select 1 from public.organization_contacts
    where organization_id = v_org and lower(email) = lower(v_email)
  ) then
    update public.organization_contacts
    set is_verified = true, user_id = v_user, verified_at = now(), verified_by = v_user
    where organization_id = v_org and lower(email) = lower(v_email);
  else
    insert into public.organization_contacts
      (organization_id, email, full_name, user_id, is_verified, verified_at, verified_by)
    values (v_org, v_email, 'Beheerder Skool Workshop', v_user, true, now(), v_user);
  end if;

  ---------------------------------------------------------------------------
  -- 3. SkoolPartner-account
  ---------------------------------------------------------------------------
  v_account := public.ensure_loyalty_account(v_org, v_user);

  ---------------------------------------------------------------------------
  -- 4. Boekingen
  ---------------------------------------------------------------------------
  select id into v_b1 from public.bookings where reference = 'SW-2026-0123';
  if v_b1 is null then
    insert into public.bookings (
      organization_id, reference, workshop_name, workshop_count, minutes_per_workshop,
      qualifying_minutes, scheduled_date, start_time, end_time, location, participants,
      status, origin, contact_email, contact_name, created_by
    ) values (
      v_org, 'SW-2026-0123', 'Graffiti', 4, 90, 360,
      current_date - 45, '09:00', '15:00', 'Kanaalstraat 5, Gouda', 96,
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
      v_org, 'SW-2026-0187', 'Podcast', 2, 90, 180,
      current_date - 8, '10:00', '13:00', 'Kanaalstraat 5, Gouda', 48,
      'completed', 'admin_manual', v_email, 'Sanne de Vries', v_user
    ) returning id into v_b2;
  end if;

  select id into v_b3 from public.bookings where reference = 'SW-2026-0231';
  if v_b3 is null then
    insert into public.bookings (
      organization_id, reference, workshop_name, workshop_count, minutes_per_workshop,
      qualifying_minutes, scheduled_date, start_time, end_time, location, participants,
      status, origin, contact_email, contact_name, created_by
    ) values (
      v_org, 'SW-2026-0231', 'Breakdance', 3, 90, 270,
      current_date + 21, '09:30', '14:00', 'Sporthal De Mammoet, Gouda', 72,
      'confirmed', 'admin_manual', v_email, 'Sanne de Vries', v_user
    ) returning id into v_b3;
  end if;

  ---------------------------------------------------------------------------
  -- 5. Facturen, met koppeling aan de boekingen
  ---------------------------------------------------------------------------
  insert into public.invoices (
    organization_id, moneybird_invoice_id, invoice_number, reference,
    invoice_date, due_date, state, total_excl_cents, total_incl_cents,
    total_paid_cents, total_unpaid_cents, paid_at, fully_paid
  ) values (
    v_org, 'demo-mb-2026-00123', '2026-00123', 'Cultuurdag SW-2026-0123',
    current_date - 43, current_date - 15, 'paid', 103306, 125000,
    125000, 0, now() - interval '20 days', true
  )
  on conflict (moneybird_invoice_id) do update set organization_id = excluded.organization_id
  returning id into v_inv1;

  insert into public.invoices (
    organization_id, moneybird_invoice_id, invoice_number, reference,
    invoice_date, due_date, state, total_excl_cents, total_incl_cents,
    total_paid_cents, total_unpaid_cents, fully_paid
  ) values (
    v_org, 'demo-mb-2026-00187', '2026-00187', 'Projectdag SW-2026-0187',
    current_date - 6, current_date + 22, 'open', 53719, 65000,
    0, 65000, false
  )
  on conflict (moneybird_invoice_id) do update set organization_id = excluded.organization_id
  returning id into v_inv2;

  insert into public.booking_invoices (booking_id, invoice_id, link_method, confidence)
  values (v_b1, v_inv1, 'demo', 1), (v_b2, v_inv2, 'demo', 1)
  on conflict (booking_id, invoice_id) do nothing;

  ---------------------------------------------------------------------------
  -- 6. SkoolPoints
  --    600 beschikbaar (factuur betaald), 50 reviewbonus, 300 in behandeling
  ---------------------------------------------------------------------------
  insert into public.loyalty_transactions (
    organization_id, account_id, type, status, points, point_value_cents_per_100,
    points_per_hour_at_time, qualifying_minutes, description, source,
    external_reference, booking_id, available_at, expires_at, occurred_at
  ) values (
    v_org, v_account, 'earn_workshop', 'available', 600, 250, 100, 360,
    'Graffiti — 4 × 90 minuten', 'demo', 'booking:' || v_b1::text, v_b1,
    now(), now() + interval '24 months', now() - interval '45 days'
  ) on conflict (organization_id, type, external_reference)
    where external_reference is not null do nothing;

  insert into public.loyalty_transactions (
    organization_id, account_id, type, status, points, point_value_cents_per_100,
    description, source, external_reference, available_at, expires_at, occurred_at
  ) values (
    v_org, v_account, 'earn_review', 'available', 50, 250,
    'Review geplaatst', 'demo', 'review:demo-1',
    now(), now() + interval '24 months', now() - interval '30 days'
  ) on conflict (organization_id, type, external_reference)
    where external_reference is not null do nothing;

  insert into public.loyalty_transactions (
    organization_id, account_id, type, status, points, point_value_cents_per_100,
    points_per_hour_at_time, qualifying_minutes, description, source,
    external_reference, booking_id, occurred_at
  ) values (
    v_org, v_account, 'earn_workshop', 'pending', 300, 250, 100, 180,
    'Podcast — 2 × 90 minuten', 'demo', 'booking:' || v_b2::text, v_b2,
    now() - interval '8 days'
  ) on conflict (organization_id, type, external_reference)
    where external_reference is not null do nothing;

  update public.bookings set points_awarded = true where id in (v_b1, v_b2);

  ---------------------------------------------------------------------------
  -- 7. Berichtencentrum
  ---------------------------------------------------------------------------
  insert into public.message_threads (
    organization_id, gmail_thread_id, subject, participant_emails,
    visibility, visibility_reason
  ) values (
    v_org, 'demo-thread-1', 'Boekingsbevestiging Cultuurdag',
    array[v_email, 'boekingen@skoolworkshop.nl'], 'auto_allowed', 'Demodata'
  )
  on conflict (gmail_thread_id) do update set organization_id = excluded.organization_id
  returning id into v_thread;

  insert into public.messages (
    thread_id, gmail_message_id, direction, from_email, from_name, to_emails,
    subject, sent_at, snippet, body_text
  ) values (
    v_thread, 'demo-msg-1', 'outbound', 'boekingen@skoolworkshop.nl', 'Skool Workshop',
    array[v_email], 'Boekingsbevestiging Cultuurdag', now() - interval '50 days',
    'Hierbij bevestigen wij uw boeking.',
    E'Beste Sanne,\n\nHierbij bevestigen wij uw boeking. De boeking is definitief.\n\nWorkshop: Graffiti\nAantal workshops: 4\nDuur: 90 minuten per workshop\nDatum: ' ||
    to_char(current_date - 45, 'DD-MM-YYYY') ||
    E'\nLocatie: Kanaalstraat 5, Gouda\nBoekingsnummer: SW-2026-0123\n\nMet vriendelijke groet,\nTeam Skool Workshop'
  ) on conflict (gmail_message_id) do nothing;

  insert into public.messages (
    thread_id, gmail_message_id, direction, from_email, from_name, to_emails,
    subject, sent_at, snippet, body_text
  ) values (
    v_thread, 'demo-msg-2', 'inbound', v_email, 'Sanne de Vries',
    array['boekingen@skoolworkshop.nl'], 'Re: Boekingsbevestiging Cultuurdag',
    now() - interval '49 days',
    'Dank voor de bevestiging.',
    'Dank voor de bevestiging. Nemen de leerlingen zelf oude kleding mee, of regelen jullie schorten?'
  ) on conflict (gmail_message_id) do nothing;

  raise notice 'Klaar. % is nu beheerder en lid van De Goudse Waarden.', v_email;
end $$;

-- Controle: dit hoort 650 beschikbaar en 300 in behandeling te tonen.
select
  o.name                as organisatie,
  b.available_points    as beschikbaar,
  b.pending_points      as in_behandeling,
  b.lifetime_earned_points as totaal_gespaard
from public.loyalty_balances b
join public.organizations o on o.id = b.organization_id
where o.slug = 'de-goudse-waarden';
