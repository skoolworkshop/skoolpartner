-- =============================================================================
-- SkoolPartner - 032 - CRM: indexen voor het commerciele dashboard
-- =============================================================================
-- Fase 7 uit het plan: het dashboard en het managementoverzicht.
--
-- WAT HIER NIET IN ZIT
--
--   Geen nieuwe tabel, geen nieuwe kolom, geen gewijzigde kolom en geen
--   aangepaste regel. Het dashboard rekent met wat er al staat: deals, fases,
--   fasehistorie, facturen, deelnemersbetalingen en taken. Er is dus ook geen
--   tweede plek waar omzet wordt bijgehouden en die uit de pas kan gaan lopen.
--
--   Deze migratie doet precies een ding: de selecties die het dashboard doet
--   sneller maken. Een index toevoegen verandert geen enkele rij en kan geen
--   bestaande gegevens beschadigen.
--
-- WAAROM DEZE INDEXEN
--
--   Het dashboard stelt zes vragen. Vier daarvan filteren of sorteren op een
--   datum die tot nu toe niet geindexeerd was:
--
--     1. Welke deals zijn in deze periode afgesloten?   -> closed_at
--     2. Welke deals zijn in deze periode aangemaakt?   -> brand, created_at
--     3. Welke facturen zijn wanneer betaald?           -> paid_at
--     4. Welke deelnemersbetalingen zijn binnengekomen? -> received_on
--
--   Bij de huidige omvang merkt niemand het verschil. Bij een paar duizend
--   deals en facturen wel, en een index erbij zetten is dan een stuk
--   vervelender dan hem er nu meteen bij zetten.
--
-- Er verandert niets aan een tabel buiten het CRM, op een index op invoices na.
-- Een index is geen wijziging van de gegevens en raakt de bestaande
-- Moneybird-synchronisatie niet.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Deals: afgesloten in een periode
-- -----------------------------------------------------------------------------
-- Alleen de afgesloten deals staan erin. Lopende deals hebben geen closed_at
-- en horen dus niet in deze index thuis: dat scheelt ruimte en maakt hem
-- sneller.
create index if not exists crm_deals_closed_idx
  on public.crm_deals (brand, closed_at)
  where closed_at is not null;

-- Deals die in een periode zijn aangemaakt, per merk.
create index if not exists crm_deals_brand_created_idx
  on public.crm_deals (brand, created_at);

-- Hoe lang staat een deal al in zijn fase? Alleen zinnig voor lopende deals.
create index if not exists crm_deals_stage_since_idx
  on public.crm_deals (stage_since)
  where closed_at is null;


-- -----------------------------------------------------------------------------
-- Fasehistorie: de doorlooptijd per fase
-- -----------------------------------------------------------------------------
-- Er is al een index op (deal_id, created_at desc). Die helpt bij het opzoeken
-- van de historie van een deal, maar niet bij "alle wisselingen van de laatste
-- twee jaar", en dat is precies wat het dashboard vraagt.
create index if not exists crm_deal_events_created_idx
  on public.crm_deal_events (created_at);


-- -----------------------------------------------------------------------------
-- Facturen: wanneer is er betaald
-- -----------------------------------------------------------------------------
-- Alleen facturen waar echt iets op is betaald. Een openstaande factuur is
-- geen omzet en hoort niet in deze index.
create index if not exists invoices_paid_at_idx
  on public.invoices (paid_at)
  where total_paid_cents > 0;


-- -----------------------------------------------------------------------------
-- Deelnemersbetalingen: wanneer is er ontvangen
-- -----------------------------------------------------------------------------
-- Er is al een index op (deal_id, received_on desc), voor de betalingen van
-- een deelnemer. Het dashboard vraagt het omgekeerde: alles wat er in een
-- maand is binnengekomen, over alle deelnemers heen.
create index if not exists crm_suri_payments_ontvangen_idx
  on public.crm_suri_payments (received_on);


-- -----------------------------------------------------------------------------
-- Rechten: onveranderd, en voor de zekerheid nog een keer
-- -----------------------------------------------------------------------------
-- Een index verandert niets aan rechten. Dit staat er omdat de CRM-tabellen
-- dicht horen te zijn en dat na elke migratie opnieuw controleerbaar moet zijn.
-- Zie ook scripts/verify-crm-dashboard.mjs, dat dit tegen een echte Postgres
-- narekent.

revoke all on public.crm_deals        from anon, authenticated;
revoke all on public.crm_deal_events  from anon, authenticated;
revoke all on public.crm_suri_payments from anon, authenticated;
revoke all on public.crm_tasks        from anon, authenticated;
