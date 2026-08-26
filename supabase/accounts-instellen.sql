-- =============================================================================
-- SkoolPartner - rollen toekennen aan bestaande accounts
-- =============================================================================
-- Met dit script bepaal je wie beheerder is en wie gewone klant.
--
-- VOLGORDE, anders werkt het niet:
--   1. Registreer beide adressen eerst via /registreren op de website.
--      Pas daarna bestaan de accounts en kan dit script ze koppelen.
--   2. Draai setup-alles.sql en demo-data.sql, zodat de demo-organisaties er zijn.
--   3. Draai dit script in Supabase > SQL Editor.
--
-- Wat er gebeurt:
--   * het beheerdersadres krijgt volledige beheerrechten en wordt lid van alle
--     drie de demo-organisaties
--   * het klantadres wordt gewoon lid van De Goudse Waarden, uitdrukkelijk
--     zonder beheerrechten
--   * het oude testaccount raakt zijn beheerrechten kwijt, maar blijft bestaan
--
-- Opnieuw draaien is veilig.
-- =============================================================================

do $$
declare
  -- >>> PAS DIT AAN <<<
  v_beheerder text := 'contact@skoolworkshop.nl';
  v_klant     text := 'planning@skoolworkshop.nl';

  -- Laat leeg ('') als je niemand beheerrechten wilt afnemen.
  v_ontnemen  text := 'skoolworkshop@gmail.com';

  v_bekend    text;
  v_admin_id  uuid;
  v_klant_id  uuid;
  v_oud_id    uuid;
  v_org       uuid;
  v_orgs      uuid[];
begin
  select coalesce(array_agg(id), '{}'::uuid[]) into v_orgs
  from public.organizations
  where slug in ('de-goudse-waarden', 'het-vrije-college', 'buurtcentrum-de-zuidhoek');

  if array_length(v_orgs, 1) is null then
    raise exception 'Geen demo-organisaties gevonden. Draai eerst demo-data.sql.';
  end if;

  select id into v_org from public.organizations where slug = 'de-goudse-waarden';

  ---------------------------------------------------------------------------
  -- 1. Beheerder
  ---------------------------------------------------------------------------
  select id into v_admin_id from auth.users where lower(email) = lower(v_beheerder);

  if v_admin_id is null then
    select string_agg(email, ', ' order by created_at) into v_bekend from auth.users;
    raise exception
      'Geen account gevonden voor %. Bekende accounts: %. Registreer dit adres eerst via /registreren.',
      v_beheerder, coalesce(v_bekend, 'nog geen enkel account');
  end if;

  insert into public.profiles (id, email, full_name, is_admin, is_super_admin)
  values (v_admin_id, v_beheerder, 'Beheer Skool Workshop', true, true)
  on conflict (id) do update
    set is_admin = true, is_super_admin = true, is_blocked = false;

  -- Lid maken van alle demo-organisaties, zodat je ook de klantkant ziet.
  insert into public.organization_members
    (organization_id, user_id, role, status, source, approved_by, approved_at)
  select unnest(v_orgs), v_admin_id, 'beheerder', 'active', 'admin_manual', v_admin_id, now()
  on conflict (organization_id, user_id) do update
    set status = 'active', role = 'beheerder', approved_at = now();

  if exists (
    select 1 from public.organization_contacts
    where organization_id = v_org and lower(email) = lower(v_beheerder)
  ) then
    update public.organization_contacts
    set is_verified = true, user_id = v_admin_id, verified_at = now()
    where organization_id = v_org and lower(email) = lower(v_beheerder);
  else
    insert into public.organization_contacts
      (organization_id, email, full_name, user_id, is_verified, verified_at)
    values (v_org, v_beheerder, 'Beheer Skool Workshop', v_admin_id, true, now());
  end if;

  ---------------------------------------------------------------------------
  -- 2. Klant, uitdrukkelijk zonder beheerrechten
  ---------------------------------------------------------------------------
  select id into v_klant_id from auth.users where lower(email) = lower(v_klant);

  if v_klant_id is null then
    select string_agg(email, ', ' order by created_at) into v_bekend from auth.users;
    raise exception
      'Geen account gevonden voor %. Bekende accounts: %. Registreer dit adres eerst via /registreren.',
      v_klant, coalesce(v_bekend, 'nog geen enkel account');
  end if;

  insert into public.profiles (id, email, full_name, is_admin, is_super_admin)
  values (v_klant_id, v_klant, 'Sanne de Vries', false, false)
  on conflict (id) do update
    set is_admin = false, is_super_admin = false, is_blocked = false;

  -- Alleen lid van De Goudse Waarden. Zo zie je ook dat de organisatiewisselaar
  -- verdwijnt bij een klant met maar één organisatie.
  insert into public.organization_members
    (organization_id, user_id, role, status, source, approved_at)
  values (v_org, v_klant_id, 'lid', 'active', 'admin_manual', now())
  on conflict (organization_id, user_id) do update
    set status = 'active', role = 'lid', approved_at = now();

  if exists (
    select 1 from public.organization_contacts
    where organization_id = v_org and lower(email) = lower(v_klant)
  ) then
    update public.organization_contacts
    set is_verified = true, user_id = v_klant_id, verified_at = now()
    where organization_id = v_org and lower(email) = lower(v_klant);
  else
    insert into public.organization_contacts
      (organization_id, email, full_name, user_id, is_verified, verified_at)
    values (v_org, v_klant, 'Sanne de Vries', v_klant_id, true, now());
  end if;

  -- De demoboekingen op naam van de klant zetten, zodat de mail met resultaten
  -- straks naar het klantadres gaat en niet naar de beheerder.
  update public.bookings
  set contact_email = v_klant, contact_name = 'Sanne de Vries'
  where organization_id = v_org;

  ---------------------------------------------------------------------------
  -- 3. Oude testaccount zijn beheerrechten afnemen
  ---------------------------------------------------------------------------
  if v_ontnemen <> '' and lower(v_ontnemen) <> lower(v_beheerder) then
    select id into v_oud_id from auth.users where lower(email) = lower(v_ontnemen);
    if v_oud_id is not null then
      update public.profiles
      set is_admin = false, is_super_admin = false
      where id = v_oud_id;
    end if;
  end if;

  raise notice 'Klaar. % is beheerder, % is klant.', v_beheerder, v_klant;
end $$;

-- Controle. Bij de beheerder hoort is_admin op true te staan, bij de klant op false.
select
  p.email,
  p.is_admin      as beheerder,
  p.is_super_admin as super_admin,
  count(m.id)     as organisaties
from public.profiles p
left join public.organization_members m on m.user_id = p.id and m.status = 'active'
group by p.email, p.is_admin, p.is_super_admin
order by p.is_admin desc, p.email;
