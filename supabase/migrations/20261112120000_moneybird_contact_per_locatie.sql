-- =============================================================================
-- SkoolPartner - 044 - Eén Moneybird-contact hoort bij één schoollocatie
-- =============================================================================
-- WAAROM
--
--   SkoolPoints worden opgebouwd per schoollocatie. Twee locaties van hetzelfde
--   bestuur zijn in SkoolPartner twee aparte organisaties, met een eigen saldo
--   en een eigen deelname. Dat werkt alleen als een factuur altijd bij precies
--   één locatie terechtkomt.
--
--   De koppeling loopt via het Moneybird-contact-ID. Hoort datzelfde ID aan
--   twee locaties, dan kan het systeem niet weten waar een factuur heen moet.
--   Deze index zorgt ervoor dat die situatie niet per ongeluk kan ontstaan.
--
-- WAT DIT DOET
--
--   Eén unieke index op organization_contacts.moneybird_contact_id, voor de
--   rijen waar dat veld gevuld is. Contactpersonen zonder Moneybird-koppeling
--   raakt hij niet: daar mogen er zoveel van zijn als nodig.
--
-- WAT DIT NIET DOET
--
--   Er wordt niets verwijderd, hernoemd of omgezet. Geen enkele bestaande rij
--   verandert van inhoud.
--
-- ALS DEZE MIGRATIE WEIGERT
--
--   Dan staat hetzelfde Moneybird-contact al bij twee locaties. Dat is geen
--   fout van de migratie maar een echte vraag: bij welke locatie hoort dit
--   contact? Zoek ze op met de query onderaan dit bestand, haal de koppeling
--   bij de verkeerde locatie weg, en draai de migratie opnieuw.

begin;

create unique index if not exists organization_contacts_moneybird_uniek
  on public.organization_contacts (moneybird_contact_id)
  where moneybird_contact_id is not null;

comment on index public.organization_contacts_moneybird_uniek is
  'Een Moneybird-contact hoort bij precies één schoollocatie. Zonder dit zou een factuur bij de verkeerde locatie kunnen belanden.';

commit;

-- Dubbele koppelingen opsporen (alleen lezen):
--
--   select moneybird_contact_id, count(*) as aantal,
--          string_agg(organization_id::text, ', ') as locaties
--     from public.organization_contacts
--    where moneybird_contact_id is not null
--    group by moneybird_contact_id
--   having count(*) > 1;
