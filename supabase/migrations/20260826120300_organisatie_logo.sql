-- =============================================================================
-- SkoolPartner - 019 - Het logo van de organisatie
-- =============================================================================
-- Het logo hoort bij de organisatie, niet bij een medewerker. Alle mensen van
-- dezelfde school zien dus hetzelfde logo.
--
-- logo_source houdt bij waar het vandaan komt. Een automatisch gevonden logo
-- overschrijft nooit een logo dat door beheer of door de school zelf is
-- ingesteld.
--
-- Het domein staat al in organization_domains. Daar komt bewust geen tweede
-- veld voor.
--
-- LET OP: een logo is uitsluitend visuele informatie. Het zegt niets over wie
-- toegang heeft tot welke gegevens. Dat blijft volledig bij de bestaande
-- lidmaatschappen en RLS liggen.
-- =============================================================================

alter table public.organizations
  add column if not exists logo_url        text,
  add column if not exists logo_source     text,
  add column if not exists logo_checked_at timestamptz;

comment on column public.organizations.logo_url is
  'Adres van het logo van deze organisatie. Alleen visueel; nooit gebruiken als bewijs van toegang.';
comment on column public.organizations.logo_source is
  'handmatig = door beheer of de school zelf ingesteld en dus leidend. automatisch = door ons gevonden op het eigen domein van de school.';

do $$ begin
  alter table public.organizations
    add constraint organizations_logo_source_check
    check (logo_source is null or logo_source in ('handmatig', 'automatisch'));
exception when duplicate_object then null; end $$;

-- Opslagbucket voor logo's.
--
-- Bewust wél openbaar, in tegenstelling tot workshop-resultaten. Een schoollogo
-- is publiek merkmateriaal dat op de eigen website van die school staat, en de
-- zijbalk wordt op elke pagina getoond. Met een afgeschermde bucket zou er bij
-- elke paginaweergave een ondertekende link aangemaakt moeten worden. Het pad
-- bevat alleen het interne organisatie-ID, dus er valt niets uit af te leiden.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('organisatie-logos', 'organisatie-logos', true)
    on conflict (id) do nothing;
  end if;
end $$;
