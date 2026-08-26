-- =============================================================================
-- SkoolPartner - 020 - Welkomsttegoed
-- =============================================================================
-- Een organisatie die voor het eerst SkoolPartner activeert krijgt eenmalig een
-- welkomsttegoed. Dit is de enige puntenboeking die bij de start mag ontstaan;
-- voor gewone boekingen blijft gelden dat alleen kwalificerende nieuwe
-- boekingen na het startmoment punten opleveren.
--
-- Er komt geen tweede puntensysteem bij. De bonus is een gewone transactie in
-- het bestaande grootboek. Dubbel toekennen wordt voorkomen door de unieke
-- index op (organization_id, type, external_reference), die er al staat: met
-- external_reference 'welcome' kan er per organisatie maar één bestaan, ook bij
-- twee gelijktijdige registraties.
--
-- LET OP: een waarde die je aan een enum toevoegt, kun je niet gebruiken in
-- dezelfde transactie waarin je hem toevoegt. Het toekennen gebeurt daarom
-- vanuit de applicatie, in een latere transactie. Hier wordt de nieuwe waarde
-- nergens gebruikt.
-- =============================================================================

alter type public.loyalty_transaction_type add value if not exists 'welcome_bonus';

-- Hoeveel punten, en staat het aan? Centraal instelbaar, net als de rest.
insert into public.app_settings (key, value, label, description, group_name, value_type, is_public, sort_order)
values
  ('welcome_bonus_enabled', 'true'::jsonb, 'Welkomstbonus toekennen',
   'Nieuwe organisaties krijgen bij een afgeronde registratie eenmalig een welkomsttegoed.',
   'skoolpartner', 'boolean', true, 145),
  ('welcome_bonus_points', '100'::jsonb, 'Welkomstbonus in punten',
   'Aantal SkoolPoints dat een organisatie eenmalig krijgt bij de eerste activatie.',
   'skoolpartner', 'number', true, 146)
on conflict (key) do nothing;
