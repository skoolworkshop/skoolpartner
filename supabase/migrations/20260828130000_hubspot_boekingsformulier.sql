-- De aanvraagknoppen blijven voortaan binnen SkoolPartner en openen daar het
-- beveiligde HubSpot-formulier. De instelling blijft bestaan voor compatibiliteit.
update public.app_settings
set value = '"/nieuwe-boeking"'::jsonb,
    label = 'Interne route nieuwe workshop aanvragen',
    description = 'Opent het HubSpot-aanvraagformulier binnen het klantportaal.',
    value_type = 'text'
where key = 'new_booking_cta_url';
