-- Houd het zichtbare profieladres gelijk aan het bevestigde Supabase-inlogadres.
-- Een klant kan een nieuw adres aanvragen; pas na bevestiging wijzigt auth.users
-- en daarmee via deze trigger ook public.profiles.

create or replace function public.sync_profile_email_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles
    set email = new.email
    where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  execute function public.sync_profile_email_from_auth();
