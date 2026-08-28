-- Betrouwbaarheid registratie en CJP-tegoed.
-- De server schrijft na eigen autorisatie met de service_role. Deze grants zijn
-- idempotent en herstellen projecten waarop oudere grants niet zijn toegepast.

grant usage on schema public to service_role;

do $$
begin
  if to_regclass('public.cjp_parking_requests') is not null then
    execute 'grant select, insert, update, delete on table public.cjp_parking_requests to service_role';
  end if;
  if to_regclass('public.cjp_credit_transactions') is not null then
    execute 'grant select, insert, update, delete on table public.cjp_credit_transactions to service_role';
  end if;
  if to_regclass('public.profiles') is not null then
    execute 'grant select, insert, update on table public.profiles to service_role';
  end if;
  if to_regclass('public.organizations') is not null then
    execute 'grant select, insert, update on table public.organizations to service_role';
  end if;
  if to_regclass('public.organization_members') is not null then
    execute 'grant select, insert, update on table public.organization_members to service_role';
  end if;
end
$$;

notify pgrst, 'reload schema';
