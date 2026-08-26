-- =============================================================================
-- SkoolPartner - 011 - Chatknop en naamgeving
-- =============================================================================
-- 1. Nieuwe instellingen voor de WhatsApp-chatknop. Zolang er geen nummer is
--    ingevuld blijft de knop verborgen, zodat er nooit een dood adres in het
--    portaal staat.
-- 2. De portaalnaam in bestaande teksten bijwerken naar SkoolPartner. Dit raakt
--    alleen tekst die de klant ziet, niet de Gmail-labels of andere technische
--    waarden.
-- =============================================================================

insert into public.app_settings (key, value, label, description, group_name, value_type, is_public, sort_order) values
  ('chat_enabled', 'true'::jsonb, 'Chatknop tonen',
   'Zet de knop "Liever even chatten?" in het klantportaal aan of uit.',
   'contact', 'boolean', true, 230),

  ('chat_whatsapp_url', '"https://wa.me/31850653923"'::jsonb, 'WhatsApp-adres',
   'Bijvoorbeeld https://wa.me/31612345678. Laat leeg om de knop verborgen te houden. Vul hier het zakelijke nummer in, zonder plusteken en zonder spaties.',
   'contact', 'url', true, 240),

  ('chat_label', '"Liever even chatten?"'::jsonb, 'Tekst op de chatknop',
   null, 'contact', 'text', true, 250),

  ('chat_help_text',
   '"Stel uw vraag via WhatsApp. Op werkdagen reageren wij meestal binnen een paar uur."'::jsonb,
   'Toelichting bij de chatknop',
   'Korte zin onder de knop op de berichtenpagina.', 'contact', 'text', true, 260)
on conflict (key) do nothing;

-- Als het adres nog leeg is, zetten we het nummer van Skool Workshop erin.
update public.app_settings
set value = '"https://wa.me/31850653923"'::jsonb
where key = 'chat_whatsapp_url'
  and coalesce(nullif(trim(value #>> '{}'), ''), '') = '';

-- Naamgeving bijwerken in teksten die al in de database staan.
update public.app_settings
set value = to_jsonb(replace(value #>> '{}', 'Mijn Skool', 'SkoolPartner'))
where key in ('rules_text', 'how_it_works_text', 'program_name')
  and value #>> '{}' like '%Mijn Skool%';

update public.app_settings
set description = replace(description, 'Mijn Skool', 'SkoolPartner')
where description like '%Mijn Skool%'
  and key <> 'booking_confirmation_label';
