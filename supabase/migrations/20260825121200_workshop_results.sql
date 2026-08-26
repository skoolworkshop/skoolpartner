-- =============================================================================
-- SkoolPartner - 013 - Resultaten van workshops
-- =============================================================================
-- Na een workshop zet Skool Workshop het opgeleverde werk klaar: een rapnummer,
-- een videoclip, een podcast, foto's. De klant downloadt het uit het portaal.
--
-- Levensloop van een set resultaten:
--   concept    -> alleen zichtbaar in de beheeromgeving, nog niets verstuurd
--   published  -> zichtbaar voor de klant, mail is verstuurd, bestanden staan
--                 klaar tot expires_at
--   expired    -> de bestanden zijn echt uit de opslag verwijderd. De klant
--                 ziet nog een melding dat het verlopen is, tot purge_at
--   (weg)      -> na purge_at wordt de hele set verwijderd, geen spoor meer
--
-- Grote bestanden worden nooit door de server heen gestuurd: de browser
-- uploadt rechtstreeks naar Supabase Storage met een tijdelijke, door de
-- server ondertekende link. Downloaden gaat net zo, met een link die maar een
-- paar minuten geldig is en pas wordt gemaakt nadat de toegang is gecontroleerd.
--
-- Past een bestand niet binnen de limiet van het Supabase-abonnement, dan kan
-- er een externe link bij, bijvoorbeeld WeTransfer. Die telt niet mee voor de
-- opslag, maar heeft ook een eigen vervaldatum bij die dienst.
-- =============================================================================

do $$ begin
  create type public.result_status as enum ('concept', 'published', 'expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.result_item_kind as enum ('file', 'link');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- workshop_results
-- -----------------------------------------------------------------------------
create table if not exists public.workshop_results (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  booking_id       uuid references public.bookings (id) on delete set null,
  title            text not null,
  description      text,
  status           public.result_status not null default 'concept',
  published_at     timestamptz,
  expires_at       timestamptz,
  purge_at         timestamptz,
  notified_at      timestamptz,
  notified_email   text,
  notify_error     text,
  files_removed_at timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint workshop_results_title_not_empty check (length(trim(title)) > 1)
);

create index if not exists workshop_results_org_idx
  on public.workshop_results (organization_id, published_at desc);
create index if not exists workshop_results_status_idx
  on public.workshop_results (status);
create index if not exists workshop_results_expiry_idx
  on public.workshop_results (expires_at) where status = 'published';
create index if not exists workshop_results_purge_idx
  on public.workshop_results (purge_at) where status = 'expired';

drop trigger if exists workshop_results_set_updated_at on public.workshop_results;
create trigger workshop_results_set_updated_at before update on public.workshop_results
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- workshop_result_files
-- -----------------------------------------------------------------------------
create table if not exists public.workshop_result_files (
  id            uuid primary key default gen_random_uuid(),
  result_id     uuid not null references public.workshop_results (id) on delete cascade,
  kind          public.result_item_kind not null default 'file',
  storage_path  text,
  external_url  text,
  file_name     text not null,
  mime_type     text,
  size_bytes    bigint,
  position      integer not null default 0,
  removed_at    timestamptz,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint workshop_result_files_target check (
    (kind = 'file' and storage_path is not null and external_url is null)
    or (kind = 'link' and external_url is not null and storage_path is null)
  )
);

create index if not exists workshop_result_files_result_idx
  on public.workshop_result_files (result_id, position);
create unique index if not exists workshop_result_files_path_key
  on public.workshop_result_files (storage_path) where storage_path is not null;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.workshop_results      enable row level security;
alter table public.workshop_result_files enable row level security;

-- De klant ziet alleen gepubliceerde of verlopen sets van de eigen organisatie.
-- Concepten blijven volledig binnen de beheeromgeving.
drop policy if exists workshop_results_select on public.workshop_results;
create policy workshop_results_select on public.workshop_results
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.has_organization_access(organization_id)
      and status in ('published', 'expired')
    )
  );
grant select on public.workshop_results to authenticated;

drop policy if exists workshop_result_files_select on public.workshop_result_files;
create policy workshop_result_files_select on public.workshop_result_files
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.workshop_results r
      where r.id = workshop_result_files.result_id
        and r.status = 'published'
        and public.has_organization_access(r.organization_id)
    )
  );
grant select on public.workshop_result_files to authenticated;

-- Schrijven gebeurt uitsluitend server-side met de service role, na een
-- expliciete controle op beheerdersrechten. Daarom geen insert- of
-- update-policies voor gewone gebruikers.

-- -----------------------------------------------------------------------------
-- Opslagbucket
-- -----------------------------------------------------------------------------
-- Bewust niet openbaar. Er komen ook geen policies op storage.objects: alleen
-- de service role komt erbij, en die maakt per download een korte link.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('workshop-resultaten', 'workshop-resultaten', false)
    on conflict (id) do nothing;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Instellingen
-- -----------------------------------------------------------------------------
insert into public.app_settings (key, value, label, description, group_name, value_type, is_public, sort_order) values
  ('results_enabled', 'true'::jsonb, 'Resultaten van workshops tonen',
   'Zet het onderdeel Resultaten in het klantportaal aan of uit.',
   'resultaten', 'boolean', true, 300),

  ('results_available_days', '7'::jsonb, 'Aantal dagen beschikbaar',
   'Zoveel dagen na publiceren kan de klant downloaden. Daarna worden de bestanden echt uit de opslag verwijderd.',
   'resultaten', 'number', true, 310),

  ('results_notice_days', '7'::jsonb, 'Aantal dagen melding na verlopen',
   'Zoveel dagen blijft er nog een melding staan dat de resultaten verlopen zijn. Daarna verdwijnt de set helemaal uit het portaal.',
   'resultaten', 'number', true, 320),

  ('results_max_upload_mb', '45'::jsonb, 'Maximale bestandsgrootte (MB)',
   'Let op: dit kan nooit hoger dan wat je Supabase-abonnement toestaat. Op het gratis plan is dat 50 MB per bestand. Voor grotere video''s heb je Supabase Pro nodig, of je voegt een externe link toe.',
   'resultaten', 'number', false, 330),

  ('results_email_subject', '"De resultaten van uw workshop staan klaar"'::jsonb,
   'Onderwerp van de mail', null, 'resultaten', 'text', false, 340)
on conflict (key) do nothing;
