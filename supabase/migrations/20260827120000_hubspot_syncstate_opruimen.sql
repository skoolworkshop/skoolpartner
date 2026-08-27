-- =============================================================================
-- SkoolPartner - 022 - Restant van de HubSpot-koppeling opruimen
-- =============================================================================
-- De HubSpot-koppeling bestaat niet meer in de applicatie. Er stond nog één
-- rij in integration_sync_state die bij die koppeling hoorde. Dat is geen
-- klantgegeven maar een stukje inrichting van een synchronisatie die niet meer
-- draait, dus die kan weg.
--
-- WAT HIER BEWUST NIET GEBEURT
--
--   Er worden geen kolommen verwijderd en er verdwijnt geen enkele
--   enumwaarde. Reden: de waarde 'hubspot' in integration_system hangt aan
--   vijf kolommen, waaronder external_record_mappings.system. Daar staan de
--   koppelingen tussen HubSpot-bedrijven en organisaties in. Die waarde
--   verwijderen zou betekenen dat die koppelingen eerst weg moeten, en dat is
--   historische klantinformatie.
--
--   In supabase/voorstel-hubspot-kolommen-opruimen.sql staat wat er nodig zou
--   zijn om ook de kolommen en de enumwaarden op te ruimen, met alle
--   waarschuwingen erbij. Dat bestand staat bewust NIET in deze map en draait
--   dus niet mee.
--
-- Deze migratie is herhaalbaar en raakt niets anders.
-- =============================================================================

delete from public.integration_sync_state where integration = 'hubspot';

-- De credentials-tabel hoort hier niets van HubSpot te bevatten, maar als er
-- ooit iets is opgeslagen tijdens een test, dan is dat nu een dood token.
-- Weghalen is veiliger dan laten staan: een ongebruikt geheim is een risico
-- zonder nut.
delete from public.integration_credentials where integration = 'hubspot';
