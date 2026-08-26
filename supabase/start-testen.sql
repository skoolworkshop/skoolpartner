-- =============================================================================
-- SkoolPartner - alles klaarzetten om te testen
-- =============================================================================
-- Eén keer plakken en op Run klikken. Daarna kun je alles vanuit de
-- beheeromgeving doen en heb je de SQL Editor niet meer nodig.
--
-- Wat dit doet:
--   * elk adres in de lijst hieronder wordt beheerder, als het account bestaat
--   * elke beheerder wordt ook lid van De Goudse Waarden, zodat je meteen het
--     klantportaal met alle demodata kunt bekijken
--   * het klantadres wordt gewoon lid, zonder beheerrechten
--   * adressen die nog geen account hebben worden overgeslagen, zonder fout
--
-- Onderaan verschijnt een tabel met wie wat is. Opnieuw draaien is veilig.
-- =============================================================================

do $$
declare
  -- Iedereen in deze lijst wordt beheerder. Adressen die nog niet bestaan
  -- worden gewoon overgeslagen.
  v_beheerders text[] := array[
    'info@skoolworkshop.nl',
    'contact@skoolworkshop.nl',
    'skoolworkshop@gmail.com'
  ];

  -- Dit adres wordt gewone klant, zonder beheerrechten. Laat leeg ('') als je
  -- dat niet wilt.
  v_klant text := 'planning@skoolworkshop.nl';

  v_org      uuid;
  v_email    text;
  v_user     uuid;
  v_gevonden int := 0;
  v_gemist   text := '';
begin
  select id into v_org from public.organizations where slug = 'de-goudse-waarden';

  if v_org is null then
    raise exception 'De demo-organisatie bestaat nog niet. Draai eerst demo-data.sql.';
  end if;

  ---------------------------------------------------------------------------
  -- Beheerders
  ---------------------------------------------------------------------------
  foreach v_email in array v_beheerders loop
    select id into v_user from auth.users where lower(email) = lower(v_email);

    if v_user is null then
      v_gemist := v_gemist || v_email || ' ';
      continue;
    end if;

    v_gevonden := v_gevonden + 1;

    insert into public.profiles (id, email, full_name, is_admin, is_super_admin)
    values (v_user, v_email, 'Skool Workshop', true, true)
    on conflict (id) do update
      set is_admin = true, is_super_admin = true, is_blocked = false;

    insert into public.organization_members
      (organization_id, user_id, role, status, source, approved_by, approved_at)
    values (v_org, v_user, 'beheerder', 'active', 'admin_manual', v_user, now())
    on conflict (organization_id, user_id) do update
      set status = 'active', role = 'beheerder', approved_at = now();
  end loop;

  ---------------------------------------------------------------------------
  -- Klant
  ---------------------------------------------------------------------------
  if v_klant <> '' then
    select id into v_user from auth.users where lower(email) = lower(v_klant);

    if v_user is null then
      v_gemist := v_gemist || v_klant || ' ';
    else
      insert into public.profiles (id, email, full_name, is_admin, is_super_admin)
      values (v_user, v_klant, 'Sanne de Vries', false, false)
      on conflict (id) do update
        set is_admin = false, is_super_admin = false, is_blocked = false;

      insert into public.organization_members
        (organization_id, user_id, role, status, source, approved_at)
      values (v_org, v_user, 'lid', 'active', 'admin_manual', now())
      on conflict (organization_id, user_id) do update
        set status = 'active', role = 'lid', approved_at = now();
    end if;
  end if;

  if v_gevonden = 0 then
    raise exception
      'Geen enkel beheerdersadres gevonden. Registreer er eerst een via /registreren.';
  end if;

  if v_gemist <> '' then
    raise notice 'Overgeslagen omdat er nog geen account is: %', v_gemist;
  end if;

  raise notice 'Klaar. % beheerder(s) ingesteld.', v_gevonden;
end $$;

-- Overzicht: wie is wat, en bij hoeveel organisaties hoort hij.
select
  p.email,
  case
    when p.is_super_admin then 'Hoofdbeheerder'
    when p.is_admin       then 'Beheerder'
    else                       'Klant'
  end                                            as rol,
  count(m.id) filter (where m.status = 'active') as organisaties
from public.profiles p
left join public.organization_members m on m.user_id = p.id
group by p.email, p.is_admin, p.is_super_admin
order by p.is_admin desc, p.email;
