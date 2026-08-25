-- =============================================================================
-- Mijn Skool - 008 - Row Level Security
-- =============================================================================
-- Uitgangspunten:
--  * RLS staat op ALLE tabellen aan. Uitzetten is nooit de oplossing.
--  * Een gewone gebruiker ziet uitsluitend data van organisaties waar hij een
--    ACTIEF lidmaatschap heeft.
--  * Schrijfacties lopen via server-side code (service role) met expliciete
--    autorisatiecontrole. De paar klantacties die wel direct mogen, staan
--    hieronder expliciet.
--  * Rauwe bronmail, credentials, audit en sync-state zijn admin-only.
-- =============================================================================

-- Standaardrechten dichtzetten: alles expliciet toekennen.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon;

grant usage on schema public to anon, authenticated;

-- -----------------------------------------------------------------------------
-- RLS inschakelen
-- -----------------------------------------------------------------------------
alter table public.profiles                   enable row level security;
alter table public.organizations              enable row level security;
alter table public.organization_domains       enable row level security;
alter table public.organization_members       enable row level security;
alter table public.organization_invites       enable row level security;
alter table public.organization_contacts      enable row level security;
alter table public.public_email_domains       enable row level security;
alter table public.bookings                   enable row level security;
alter table public.booking_sources            enable row level security;
alter table public.reviews                    enable row level security;
alter table public.invoices                   enable row level security;
alter table public.invoice_lines              enable row level security;
alter table public.booking_invoices           enable row level security;
alter table public.external_record_mappings   enable row level security;
alter table public.loyalty_accounts           enable row level security;
alter table public.loyalty_transactions       enable row level security;
alter table public.loyalty_transaction_events enable row level security;
alter table public.redemption_requests        enable row level security;
alter table public.message_threads            enable row level security;
alter table public.messages                   enable row level security;
alter table public.outbound_messages          enable row level security;
alter table public.integration_sync_state     enable row level security;
alter table public.integration_credentials    enable row level security;
alter table public.app_settings               enable row level security;
alter table public.audit_logs                 enable row level security;
alter table public.webhook_events             enable row level security;

-- Forceer RLS ook voor tabel-eigenaren (service_role blijft bypassen).
alter table public.integration_credentials force row level security;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

grant select, update on public.profiles to authenticated;

-- Voorkom rechtenescalatie: alleen een super admin mag adminvlaggen zetten.
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('role', true) = 'service_role' then
    return new;
  end if;
  if (new.is_admin is distinct from old.is_admin
      or new.is_super_admin is distinct from old.is_super_admin
      or new.is_blocked is distinct from old.is_blocked)
     and not public.is_super_admin(auth.uid()) then
    raise exception 'Onvoldoende rechten om accountrechten te wijzigen';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileges on public.profiles;
create trigger profiles_guard_privileges before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- -----------------------------------------------------------------------------
-- organizations en organisatiestructuur
-- -----------------------------------------------------------------------------
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated
  using (public.has_organization_access(id) or public.is_admin());
grant select on public.organizations to authenticated;

drop policy if exists organization_domains_select on public.organization_domains;
create policy organization_domains_select on public.organization_domains
  for select to authenticated
  using (public.has_organization_access(organization_id) or public.is_admin());
grant select on public.organization_domains to authenticated;

drop policy if exists organization_members_select on public.organization_members;
create policy organization_members_select on public.organization_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_organization_access(organization_id)
    or public.is_admin()
  );
grant select on public.organization_members to authenticated;

drop policy if exists organization_invites_select on public.organization_invites;
create policy organization_invites_select on public.organization_invites
  for select to authenticated
  using (
    public.is_admin()
    or public.is_organization_beheerder(organization_id)
  );
grant select on public.organization_invites to authenticated;

drop policy if exists organization_contacts_select on public.organization_contacts;
create policy organization_contacts_select on public.organization_contacts
  for select to authenticated
  using (public.has_organization_access(organization_id) or public.is_admin());
grant select on public.organization_contacts to authenticated;

drop policy if exists public_email_domains_select on public.public_email_domains;
create policy public_email_domains_select on public.public_email_domains
  for select to authenticated using (true);
grant select on public.public_email_domains to authenticated;

-- -----------------------------------------------------------------------------
-- Boekingen
-- -----------------------------------------------------------------------------
drop policy if exists bookings_select on public.bookings;
create policy bookings_select on public.bookings
  for select to authenticated
  using (public.has_organization_access(organization_id) or public.is_admin());
grant select on public.bookings to authenticated;

-- booking_sources bevat rauwe e-mailinhoud: uitsluitend admin.
drop policy if exists booking_sources_select on public.booking_sources;
create policy booking_sources_select on public.booking_sources
  for select to authenticated
  using (public.is_admin());
grant select on public.booking_sources to authenticated;

drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews
  for select to authenticated
  using (public.has_organization_access(organization_id) or public.is_admin());

drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews
  for insert to authenticated
  with check (
    public.has_organization_access(organization_id)
    and submitted_by = auth.uid()
    and status = 'submitted'
  );
grant select, insert on public.reviews to authenticated;

-- -----------------------------------------------------------------------------
-- Facturen
-- -----------------------------------------------------------------------------
drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select to authenticated
  using (public.has_organization_access(organization_id) or public.is_admin());
grant select on public.invoices to authenticated;

drop policy if exists invoice_lines_select on public.invoice_lines;
create policy invoice_lines_select on public.invoice_lines
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.invoices i
      where i.id = invoice_lines.invoice_id
        and public.has_organization_access(i.organization_id)
    )
  );
grant select on public.invoice_lines to authenticated;

drop policy if exists booking_invoices_select on public.booking_invoices;
create policy booking_invoices_select on public.booking_invoices
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id = booking_invoices.booking_id
        and public.has_organization_access(b.organization_id)
    )
  );
grant select on public.booking_invoices to authenticated;

drop policy if exists external_record_mappings_select on public.external_record_mappings;
create policy external_record_mappings_select on public.external_record_mappings
  for select to authenticated
  using (public.is_admin());
grant select on public.external_record_mappings to authenticated;

-- -----------------------------------------------------------------------------
-- SkoolPartner
-- -----------------------------------------------------------------------------
drop policy if exists loyalty_accounts_select on public.loyalty_accounts;
create policy loyalty_accounts_select on public.loyalty_accounts
  for select to authenticated
  using (public.has_organization_access(organization_id) or public.is_admin());
grant select on public.loyalty_accounts to authenticated;

drop policy if exists loyalty_transactions_select on public.loyalty_transactions;
create policy loyalty_transactions_select on public.loyalty_transactions
  for select to authenticated
  using (public.has_organization_access(organization_id) or public.is_admin());
grant select on public.loyalty_transactions to authenticated;

drop policy if exists loyalty_transaction_events_select on public.loyalty_transaction_events;
create policy loyalty_transaction_events_select on public.loyalty_transaction_events
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.loyalty_transactions t
      where t.id = loyalty_transaction_events.transaction_id
        and public.has_organization_access(t.organization_id)
    )
  );
grant select on public.loyalty_transaction_events to authenticated;

grant select on public.loyalty_balances to authenticated;

drop policy if exists redemption_requests_select on public.redemption_requests;
create policy redemption_requests_select on public.redemption_requests
  for select to authenticated
  using (public.has_organization_access(organization_id) or public.is_admin());

drop policy if exists redemption_requests_insert on public.redemption_requests;
create policy redemption_requests_insert on public.redemption_requests
  for insert to authenticated
  with check (
    public.has_organization_access(organization_id)
    and requested_by = auth.uid()
    and status = 'requested'
  );
grant select, insert on public.redemption_requests to authenticated;

-- -----------------------------------------------------------------------------
-- Berichten: dubbele beveiliging (organisatie EN expliciete allowlist)
-- -----------------------------------------------------------------------------
drop policy if exists message_threads_select on public.message_threads;
create policy message_threads_select on public.message_threads
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.has_organization_access(organization_id)
      and visibility in ('auto_allowed', 'manual_allowed')
    )
  );
grant select on public.message_threads to authenticated;

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.message_threads t
      where t.id = messages.thread_id
        and t.visibility in ('auto_allowed', 'manual_allowed')
        and public.has_organization_access(t.organization_id)
    )
  );
grant select on public.messages to authenticated;

drop policy if exists outbound_messages_select on public.outbound_messages;
create policy outbound_messages_select on public.outbound_messages
  for select to authenticated
  using (public.has_organization_access(organization_id) or public.is_admin());
grant select on public.outbound_messages to authenticated;

-- -----------------------------------------------------------------------------
-- Instellingen: alleen publieke sleutels zijn leesbaar voor klanten
-- -----------------------------------------------------------------------------
drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings
  for select to authenticated
  using (is_public or public.is_admin());
grant select on public.app_settings to authenticated;

-- -----------------------------------------------------------------------------
-- Admin-only tabellen
-- -----------------------------------------------------------------------------
drop policy if exists integration_sync_state_select on public.integration_sync_state;
create policy integration_sync_state_select on public.integration_sync_state
  for select to authenticated using (public.is_admin());
grant select on public.integration_sync_state to authenticated;

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated using (public.is_admin());
grant select on public.audit_logs to authenticated;

drop policy if exists webhook_events_select on public.webhook_events;
create policy webhook_events_select on public.webhook_events
  for select to authenticated using (public.is_admin());
grant select on public.webhook_events to authenticated;

-- integration_credentials krijgt met opzet GEEN policy en GEEN grant:
-- alleen de service role (die RLS bypast) komt erbij.
