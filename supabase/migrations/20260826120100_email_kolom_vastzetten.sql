-- =============================================================================
-- SkoolPartner - 017 - Het e-mailadres in profiles vastzetten
-- =============================================================================
-- De policy profiles_update_self kijkt naar welke rij je bijwerkt, niet naar
-- welke kolom. Zonder deze trigger kan iemand die rechtstreeks met de API praat
-- zijn eigen profiles.email op een willekeurig adres zetten. Toegang hangt daar
-- niet aan, maar het bepaalt wel welke school als suggestie verschijnt en met
-- welke bron een aanvraag binnenkomt. Die schijn van betrouwbaarheid willen wij
-- niet.
--
-- Wisselen van inlogadres loopt via Supabase Auth. Die draait als service_role
-- en heeft geen auth.uid(), dus die mag het adres wel bijwerken.
-- =============================================================================

create or replace function public.guard_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Alleen ingrijpen als een gewone gebruiker zichzelf bijwerkt.
  -- service_role heeft geen auth.uid() en mag het adres wél zetten.
  if auth.uid() is not null and auth.uid() = new.id then
    if new.email is distinct from old.email then
      new.email := old.email;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_pin_email on public.profiles;
create trigger profiles_pin_email
  before update on public.profiles
  for each row execute function public.guard_profile_email();
