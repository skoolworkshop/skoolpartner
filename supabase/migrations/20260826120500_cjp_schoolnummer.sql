-- =============================================================================
-- SkoolPartner - 021 - CJP-schoolnummer
-- =============================================================================
-- Hoort bij de organisatie, zodat alle medewerkers van dezelfde school hetzelfde
-- nummer zien. Niet iedere school heeft er een, dus het is nergens verplicht.
--
-- has_cjp: true = de school heeft een nummer, false = heeft er geen,
-- leeg = weet ik niet of nog niet gevraagd. Zo blijft "nee" te onderscheiden
-- van "onbekend" zonder aparte tabel of enum.
--
-- Bewust geen streng formaat. Wij hebben geen betrouwbare bron voor de opbouw
-- van een CJP-schoolnummer, en een verkeerde aanname houdt scholen tegen.
--
-- Het invullen van een nummer veroorzaakt uit zichzelf nooit korting of een
-- factuurwijziging. Dat is een aparte beslissing.
-- =============================================================================

alter table public.organizations
  add column if not exists cjp_school_number text,
  add column if not exists has_cjp           boolean;

comment on column public.organizations.cjp_school_number is
  'Het CJP-schoolnummer van deze organisatie. Puur registratie; veroorzaakt uit zichzelf nooit korting of een factuurwijziging.';
comment on column public.organizations.has_cjp is
  'true = school heeft een CJP-schoolnummer, false = heeft er geen, leeg = onbekend.';

do $$ begin
  alter table public.organizations
    add constraint organizations_cjp_length_check
    check (cjp_school_number is null or length(trim(cjp_school_number)) between 3 and 40);
exception when duplicate_object then null; end $$;
