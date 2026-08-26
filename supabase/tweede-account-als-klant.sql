-- =============================================================================
-- SkoolPartner - een tweede account toevoegen als gewone klant
-- =============================================================================
-- Handig om te zien wat een klant ziet, zonder beheerdersrechten.
--
-- Volgorde:
--   1. Registreer dit adres eerst via https://skoolpartner.vercel.app/registreren
--   2. Vul het hieronder in bij v_email
--   3. Draai dit script in Supabase > SQL Editor
--
-- Tip: met Gmail kun je een variant van je eigen adres gebruiken, bijvoorbeeld
-- skoolworkshop+klant@gmail.com. Die mail komt in dezelfde inbox binnen, maar
-- Supabase ziet het als een apart account.
--
-- Dit script geeft uitdrukkelijk GEEN beheerdersrechten.
-- =============================================================================

do $$
declare
  -- >>> PAS DIT AAN <<<
  v_email  text := 'skoolworkshop+klant@gmail.com';

  v_bekend text;
  v_user   uuid;
  v_org    uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(v_email);

  if v_user is null then
    select string_agg(email, ', ' order by created_at) into v_bekend from auth.users;
    raise exception
      'Geen account gevonden voor %. Bekende accounts: %. Registreer dit adres eerst via /registreren.',
      v_email, coalesce(v_bekend, 'nog geen enkel account');
  end if;

  select id into v_org from public.organizations where slug = 'de-goudse-waarden';

  if v_org is null then
    raise exception 'De demo-organisatie bestaat nog niet. Draai eerst demo-data.sql.';
  end if;

  insert into public.profiles (id, email, full_name)
  values (v_user, v_email, 'Sanne de Vries')
  on conflict (id) do nothing;

  -- Gewoon lid, geen beheerder van de organisatie en geen beheerder van de app.
  insert into public.organization_members
    (organization_id, user_id, role, status, source, approved_at)
  values (v_org, v_user, 'lid', 'active', 'admin_manual', now())
  on conflict (organization_id, user_id) do update
    set status = 'active', role = 'lid', approved_at = now();

  if exists (
    select 1 from public.organization_contacts
    where organization_id = v_org and lower(email) = lower(v_email)
  ) then
    update public.organization_contacts
    set is_verified = true, user_id = v_user, verified_at = now()
    where organization_id = v_org and lower(email) = lower(v_email);
  else
    insert into public.organization_contacts
      (organization_id, email, full_name, user_id, is_verified, verified_at)
    values (v_org, v_email, 'Sanne de Vries', v_user, true, now());
  end if;

  raise notice '% is nu gewoon lid van De Goudse Waarden, zonder beheerrechten.', v_email;
end $$;

-- Controle: dit hoort false te tonen bij is_admin.
select p.email, p.is_admin, m.role, m.status
from public.profiles p
join public.organization_members m on m.user_id = p.id
join public.organizations o on o.id = m.organization_id
where o.slug = 'de-goudse-waarden'
order by p.is_admin desc;
