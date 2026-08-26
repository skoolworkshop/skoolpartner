-- =============================================================================
-- VOORSTEL, NOG NIET UITVOEREN
-- =============================================================================
-- Klein en op zichzelf staand. Los te draaien van het inwisselvoorstel.
--
-- WAAROM
-- Een klant mag zijn eigen profiel bijwerken. Dat regelt de policy
-- profiles_update_self. Die policy kijkt alleen naar wélke rij je aanpast, niet
-- naar welke kolom. Daardoor kan iemand die rechtstreeks met de API praat, dus
-- buiten het portaal om, het veld profiles.email op een willekeurig adres
-- zetten, bijvoorbeeld iets @eenanderschool.nl.
--
-- Toegang tot gegevens loopt niet via dat veld, dus er lekt vandaag niets: een
-- aanmelding bij een bestaande school gaat altijd langs jullie goedkeuring. Maar
-- het adres bepaalt wel wat er in de aanmeldpagina als suggestie verschijnt en
-- met welke bron de aanvraag bij jullie binnenkomt. Een aanvraag met de
-- vermelding "past bij het domein van deze school" oogt betrouwbaarder dan hij
-- is, en die schijn wil je niet.
--
-- In de app is dit al dichtgezet: overal waar het e-mailadres iets bepaalt,
-- wordt nu het inlogadres uit Supabase Auth gebruikt en niet het adres uit
-- profiles. Dit script sluit dezelfde deur in de database zelf, zodat het ook
-- klopt als er later iets nieuws bijkomt.
--
-- WAT ER VERANDERT
--   Eén trigger. Werkt iemand zijn eigen profiel bij en verandert daarbij de
--   kolom email, dan zet de trigger die kolom terug op de oude waarde. De rest
--   van de wijziging, dus naam, telefoonnummer en functie, gaat gewoon door.
--   Er komt geen foutmelding, want die zou een gewone gebruiker alleen maar
--   verwarren.
--
--   Supabase Auth zelf blijft leidend: wisselt iemand netjes van inlogadres via
--   de officiële flow, dan werkt de bestaande trigger handle_new_user het
--   profiel bij. Die loopt als service_role en wordt hier niet geraakt.
--
-- WELKE BESTAANDE DATA WORDT GERAAKT
--   Geen. Er wordt niets gewijzigd of verwijderd. Vanaf het moment van draaien
--   worden alleen nieuwe pogingen om het adres zelf te wijzigen genegeerd.
--
-- TERUGDRAAIEN
--   drop trigger if exists profiles_pin_email on public.profiles;
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
