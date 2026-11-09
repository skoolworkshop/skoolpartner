-- =============================================================================
-- SkoolPartner - 042 - Leerjaar bij de deelnemer
-- =============================================================================
-- WAT DIT DOET
--
--   Eén kolom erbij: het leerjaar van een deelnemer. Verder niets.
--
-- WAAROM
--
--   Scholen leveren hun lijst aan met zowel een kolom Leerjaar als een kolom
--   Klas. Die twee werden door elkaar gehaald, waardoor 353 leerlingen in
--   negentien klassen binnenkwamen als twee klassen van 173 en 180. Dat is nu
--   in de code opgelost: leerjaar is een eigen gegeven geworden. Daar hoort
--   een eigen kolom bij, zodat het bewaard blijft en nooit meer per ongeluk
--   als klas wordt gebruikt.
--
--   Het leerjaar is bewust tekst en geen getal. Een school schrijft "1", maar
--   ook "brugklas", "4 havo" of "leerjaar 2". Daar hoeft niets van te kloppen
--   met een getal; het is een kenmerk om op te kunnen sorteren en filteren.
--
-- WAT ER NIET GEBEURT
--
--   Er wordt niets verwijderd, niets hernoemd en niets omgezet. Bestaande
--   deelnemers krijgen null en blijven verder precies zoals ze waren. Alle
--   inschrijvingen, keuzes en codes blijven ongemoeid. De kolom mag leeg zijn,
--   dus lijsten zonder leerjaar werken gewoon door.
--
-- ALLES OF NIETS
--
--   Deze migratie staat in één transactie.

begin;

alter table public.enrollment_participants
  add column if not exists year_level text;

comment on column public.enrollment_participants.year_level is
  'Het leerjaar zoals de school het aanlevert. Nooit gebruiken als klas: daarvoor is group_id.';

-- Een leerjaar is kort. Dit houdt een verdwaalde kolom met halve adressen erin
-- tegen, zonder iets voor te schrijven over de inhoud.
alter table public.enrollment_participants
  drop constraint if exists enrollment_participants_year_level_check;

alter table public.enrollment_participants
  add constraint enrollment_participants_year_level_check
  check (year_level is null or char_length(year_level) between 1 and 40);

commit;
