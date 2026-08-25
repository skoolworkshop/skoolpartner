-- =============================================================================
-- Mijn Skool - 010 - Startinstellingen SkoolPartner
-- =============================================================================
-- Deze waarden zijn de startsituatie. Ze zijn allemaal aanpasbaar via
-- Admin > Instellingen, zonder programmeerwerk.
-- =============================================================================

insert into public.app_settings (key, value, label, description, group_name, value_type, is_public, sort_order) values
  ('loyalty_enabled', 'true'::jsonb, 'SkoolPartner actief',
   'Zet het volledige loyaliteitsprogramma aan of uit. Uit betekent: geen nieuwe punten en geen inwisselverzoeken.',
   'programma', 'boolean', true, 10),

  ('program_name', '"SkoolPartner"'::jsonb, 'Naam programma',
   'Zoals getoond in het portaal.', 'programma', 'text', true, 20),

  ('points_name', '"SkoolPoints"'::jsonb, 'Naam punten',
   'Zoals getoond in het portaal.', 'programma', 'text', true, 30),

  ('points_per_workshop_hour', '100'::jsonb, 'Punten per workshopuur',
   'Basisregel voor het verdienen van punten. 90 minuten levert dus 150 punten op.',
   'verdienen', 'number', true, 40),

  ('minimum_booking_minutes', '90'::jsonb, 'Minimale workshopduur (minuten)',
   'De minimale afname per dag bij Skool Workshop. Wordt gebruikt als plausibiliteitscontrole bij het inlezen van bevestigingen.',
   'verdienen', 'number', true, 50),

  ('review_bonus_points', '50'::jsonb, 'Bonuspunten per geverifieerde review',
   'Maximaal één keer per boeking.', 'verdienen', 'number', true, 60),

  ('point_value_cents_per_100', '250'::jsonb, 'Waarde per 100 punten (in centen)',
   '250 betekent: 100 SkoolPoints = € 2,50 Skool Voordeel. Wijzigen geldt alleen voor nieuwe transacties; bestaande historie behoudt de waarde van dat moment.',
   'waarde', 'number', true, 70),

  ('redemption_minimum_points', '500'::jsonb, 'Minimum aantal punten per inwisselverzoek',
   'Onder deze grens kan een klant geen verzoek indienen.', 'inwisselen', 'number', true, 80),

  ('redemption_maximum_points_per_booking', '0'::jsonb, 'Maximum punten per boeking',
   '0 betekent geen maximum.', 'inwisselen', 'number', true, 90),

  ('points_expiry_enabled', 'true'::jsonb, 'Punten laten verlopen',
   'Uit betekent: punten blijven onbeperkt geldig.', 'geldigheid', 'boolean', true, 100),

  ('points_validity_months', '24'::jsonb, 'Geldigheidsduur (maanden)',
   'Geteld vanaf het moment dat de punten beschikbaar komen. Verlopen punten blijven zichtbaar in de historie.',
   'geldigheid', 'number', true, 110),

  ('milestone_step_points', '500'::jsonb, 'Mijlpaal per aantal punten',
   'Gebruikt voor de subtiele voortgangsmelding op het dashboard.', 'programma', 'number', true, 120),

  ('new_booking_cta_url', '"https://skoolworkshop.nl/offerte-aanvraag/"'::jsonb, 'URL nieuwe workshop aanvragen',
   'Mijn Skool bouwt geen eigen boekingssysteem. Deze knop verwijst naar de bestaande offerteaanvraag.',
   'programma', 'url', true, 130),

  ('new_booking_cta_label', '"Nieuwe workshop aanvragen"'::jsonb, 'Tekst op de knop',
   null, 'programma', 'text', true, 140),

  ('support_email', '"boekingen@skoolworkshop.nl"'::jsonb, 'Centrale mailbox',
   'Alle klantcommunicatie loopt via dit adres.', 'programma', 'text', true, 150),

  ('rules_text', '"SkoolPoints worden toegekend over de daadwerkelijk afgenomen workshopuren van een definitieve boeking. Reiskosten, starttarief, materiaalkosten, extra deelnemers en toeslagen tellen niet mee.\n\nPunten komen beschikbaar zodra de bijbehorende factuur volledig is voldaan. Tot die tijd staan ze als punten in behandeling in uw overzicht.\n\nSkoolPoints horen bij uw organisatie en niet bij een individuele medewerker. Ze zijn niet overdraagbaar naar een andere organisatie, niet uitbetaalbaar en niet inwisselbaar voor contant geld.\n\nPunten zijn te gebruiken als voordeel op een volgende boeking. U dient daarvoor een inwisselverzoek in via Mijn Skool. Zolang een verzoek loopt, zijn die punten gereserveerd.\n\nDeelname begint op het moment van registratie. Boekingen van voor uw registratie leveren geen punten op."'::jsonb,
   'Spelregels SkoolPartner', 'Getoond op de SkoolPartner-pagina.', 'teksten', 'longtext', true, 160),

  ('how_it_works_text', '"U boekt een workshop via de gebruikelijke offerteaanvraag. Zodra de boeking definitief is bevestigd, rekenen wij de workshopuren om naar SkoolPoints. Na betaling van de factuur komen die punten beschikbaar in Mijn Skool. Bij een volgende aanvraag geeft u aan hoeveel punten u wilt gebruiken."'::jsonb,
   'Zo werkt SkoolPartner', 'Korte uitleg bovenaan de SkoolPartner-pagina.', 'teksten', 'longtext', true, 170),

  ('parser_enabled', 'true'::jsonb, 'Automatisch bevestigingsmails inlezen',
   'Uit betekent: alle boekingen komen handmatig in de controlewachtrij.', 'boekingen', 'boolean', false, 180),

  ('parser_auto_approve_threshold', '95'::jsonb, 'Drempel automatisch goedkeuren (%)',
   'Bevestigingen met een lagere zekerheid komen altijd in Controle nodig. 100 betekent: altijd handmatig controleren.',
   'boekingen', 'number', false, 190),

  ('booking_confirmation_from_domains', '["skoolworkshop.nl"]'::jsonb, 'Toegestane afzenderdomeinen',
   'Alleen bevestigingen vanaf deze domeinen worden als betrouwbaar beschouwd.', 'boekingen', 'json', false, 200),

  ('booking_confirmation_label', '"Mijn Skool/Boekingsbevestiging"'::jsonb, 'Gmail-label definitieve bevestiging',
   'Het label dat Skool Workshop op een definitieve bevestigingsmail zet. Dit is het meest betrouwbare signaal.',
   'boekingen', 'text', false, 210),

  ('gmail_sync_query', '"newer_than:60d -in:spam -in:trash -in:drafts"'::jsonb, 'Gmail zoekopdracht voor synchronisatie',
   'Bepaalt welk deel van de mailbox wordt ingelezen. Alleen threads met een geverifieerde contactpersoon worden bewaard.',
   'berichten', 'text', false, 220)
on conflict (key) do nothing;
