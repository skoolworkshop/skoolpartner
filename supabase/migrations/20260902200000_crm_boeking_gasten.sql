-- =============================================================================
-- SkoolPartner - 036 - CRM: extra genodigden bij een boeking
-- =============================================================================
-- Uit de HubSpot-schermafbeeldingen van de meetingplanner: onder het formulier
-- staat "Gasten toevoegen", waarmee de school maximaal tien collega's kan
-- uitnodigen. Dat is in de praktijk een nuttige stap, want bij een school
-- schuift vaak de cultuurcoordinator samen met een teamleider aan.
--
-- WAAROM DIT EEN EIGEN KOLOM IS EN GEEN CONTACTEN
--
--   Een genodigde is nog geen relatie. Wie in dit veld een adres invult, heeft
--   zelf niets ingevuld en niets gevraagd; hij wordt door iemand anders
--   meegenomen. Van elke genodigde meteen een contact maken zou betekenen dat
--   het CRM volloopt met mensen die er nooit om hebben gevraagd, en dat is
--   onder de AVG precies de verkeerde kant op.
--
--   Ze staan daarom als adres bij de afspraak, zodat ze de uitnodiging krijgen
--   en je op de afspraak ziet wie erbij waren. Wil je er later een echt
--   contact van maken, dan is dat een bewuste handeling.
--
-- Er verandert niets aan een bestaande kolom.
-- =============================================================================

alter table public.crm_meetings
  add column if not exists guest_extra_emails text[] not null default '{}'::text[];

/*
  Hooguit tien, net als bij HubSpot.

  Niet omdat dat getal heilig is, maar omdat een openbaar formulier zonder
  bovengrens een manier is om vanaf jouw mailbox post naar willekeurige
  adressen te sturen. Tien is ruim genoeg voor een schoolteam.
*/
do $$ begin
  alter table public.crm_meetings
    add constraint crm_meetings_genodigden_maximum
      check (array_length(guest_extra_emails, 1) is null or array_length(guest_extra_emails, 1) <= 10);
exception when duplicate_object then null; end $$;

comment on column public.crm_meetings.guest_extra_emails is
  'Extra adressen die de boeker heeft meegegeven. Bewust geen contacten: iemand die door een ander wordt meegenomen, heeft zelf nergens om gevraagd.';

-- Rechten blijven zoals ze waren. Voor de zekerheid nog een keer expliciet.
revoke all on public.crm_meetings from anon, authenticated;
