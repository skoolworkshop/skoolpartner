/**
 * Handgeschreven databasetypes.
 *
 * Zodra het Supabase-project draait kun je deze laten hergenereren met:
 *   npx supabase gen types typescript --project-id <ref> > src/lib/types/database.ts
 * De domeintypes in src/lib/types/domain.ts blijven dan gewoon werken.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type OrganizationKind = "school" | "bedrijf" | "vereniging" | "gemeente" | "overig";
export type OrganizationStatus = "active" | "blocked" | "archived";
export type MembershipRole = "beheerder" | "lid";
export type MembershipStatus = "pending" | "active" | "rejected" | "removed";
export type MembershipSource = "invite" | "domain_match" | "self_request" | "admin_manual" | "import";
export type BookingStatus = "concept" | "confirmed" | "completed" | "cancelled";
/**
 * Spiegelt de enum booking_origin in de database.
 *
 * De waarde "hubspot" staat er nog in omdat een enumwaarde in Postgres niet
 * zonder meer te verwijderen is en er historische rijen aan kunnen hangen.
 * SkoolPartner maakt er zelf geen boekingen meer mee aan; zie de smallere
 * union in src/lib/bookings/ingest.ts.
 */
export type BookingOrigin = "email_parser" | "admin_manual" | "import" | "hubspot";
export type SourceMatchStatus = "pending" | "matched" | "needs_review" | "rejected" | "ignored";
export type InvoiceState =
  | "draft" | "open" | "pending_payment" | "late" | "paid"
  | "partially_paid" | "uncollectible" | "reminded" | "unknown";
export type LoyaltyTransactionType =
  | "earn_workshop" | "earn_review" | "welcome_bonus" | "manual_adjustment"
  | "redemption_reserve" | "expiry" | "reversal" | "cjp_bonus";
export type CjpParkingStatus = "requested" | "in_review" | "confirmed" | "rejected";
export type CjpCreditType = "parking" | "spend" | "correction" | "refund";
export type LoyaltyTransactionStatus =
  | "pending" | "available" | "reserved" | "redeemed" | "expired" | "reversed" | "cancelled";
export type RedemptionStatus = "requested" | "approved" | "rejected" | "applied" | "cancelled";
/**
 * Spiegelt de enum integration_system in de database.
 *
 * "hubspot" blijft hier staan zolang de enumwaarde in Postgres bestaat en er
 * nog een rij in integration_sync_state aan hangt. De koppelingen die de
 * applicatie daadwerkelijk gebruikt staan in IntegrationName (src/lib/env.ts).
 */
export type IntegrationSystem = "gmail" | "moneybird" | "hubspot" | "supabase";
export type ThreadVisibility = "needs_review" | "auto_allowed" | "manual_allowed" | "blocked";
export type MessageDirection = "inbound" | "outbound";
export type ReviewStatus = "submitted" | "verified" | "rejected";
export type WebhookStatus = "received" | "processed" | "failed" | "ignored";
export type ResultStatus = "concept" | "published" | "expired";
export type ResultItemKind = "file" | "link";

/**
 * De twee merken. Zie src/lib/crm/merk.ts voor wat ze betekenen en waarom het
 * merk aan de deal hangt en niet aan de organisatie.
 */
export type CrmBrand = "skool_workshop" | "suri_impact";
/**
 * De commerciele relatie met een organisatie.
 *
 * Bewust iets anders dan OrganizationStatus. Die stuurt toegang aan
 * (actief, geblokkeerd, gearchiveerd) en mag hier nooit voor gebruikt worden.
 */
export type CrmLifecycle = "prospect" | "lead" | "klant" | "oud_klant";

export type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  job_title: string | null;
  cjp_school_number: string | null;
  has_cjp: boolean | null;
  is_admin: boolean;
  is_super_admin: boolean;
  is_blocked: boolean;
  marketing_opt_in: boolean;
  last_seen_at: string | null;
  deactivated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  kind: OrganizationKind;
  status: OrganizationStatus;
  contact_email: string | null;
  phone: string | null;
  website: string | null;
  address_line: string | null;
  street: string | null;
  house_number: string | null;
  house_number_addition: string | null;
  postal_code: string | null;
  city: string | null;
  country: string;
  internal_notes: string | null;
  /** Alleen visueel. Zegt niets over toegang. */
  logo_url: string | null;
  logo_source: "handmatig" | "automatisch" | null;
  logo_checked_at: string | null;
  cjp_school_number: string | null;
  /** true = heeft een CJP-schoolnummer, false = heeft er geen, null = onbekend. */
  has_cjp: boolean | null;
  skoolpartner_enrolled_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
};

export type OrganizationDomainRow = {
  id: string;
  organization_id: string;
  domain: string;
  is_verified: boolean;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
};

export type OrganizationMemberRow = {
  id: string;
  organization_id: string;
  user_id: string;
  role: MembershipRole;
  status: MembershipStatus;
  source: MembershipSource;
  invited_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  /** Wat de aanvrager invulde over de organisatie. Pas overnemen na goedkeuring. */
  requested_details: RegistrationDetails | null;
  created_at: string;
  updated_at: string;
};

/** De organisatiegegevens zoals iemand ze bij registratie invulde. */
export type RegistrationDetails = {
  organization_name?: string;
  street?: string;
  house_number?: string;
  house_number_addition?: string;
  postal_code?: string;
  city?: string;
  phone?: string;
  job_title?: string;
  has_cjp?: boolean | null;
  cjp_school_number?: string;
};

export type OrganizationInviteRow = {
  id: string;
  organization_id: string;
  email: string;
  role: MembershipRole;
  token_hash: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  revoked_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type OrganizationContactRow = {
  id: string;
  organization_id: string;
  email: string;
  full_name: string | null;
  user_id: string | null;
  is_verified: boolean;
  verified_at: string | null;
  verified_by: string | null;
  /** Historisch veld. Wordt niet meer gevuld; blijft staan voor bestaande data. */
  hubspot_contact_id: string | null;
  moneybird_contact_id: string | null;
  created_at: string;
  updated_at: string;
};

export type BookingRow = {
  id: string;
  organization_id: string;
  reference: string | null;
  /** Wanneer de boeking bij Skool Workshop tot stand kwam. Bepaalt of hij binnen de SkoolPartner-periode valt. */
  booked_at: string | null;
  workshop_name: string;
  workshop_count: number;
  minutes_per_workshop: number;
  qualifying_minutes: number;
  scheduled_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  participants: number | null;
  status: BookingStatus;
  origin: BookingOrigin;
  booking_source_id: string | null;
  contact_email: string | null;
  contact_name: string | null;
  /** Historisch veld. Wordt niet meer gevuld; blijft staan voor bestaande data. */
  hubspot_deal_id: string | null;
  notes: string | null;
  needs_review: boolean;
  review_reasons: string[];
  approved_by: string | null;
  approved_at: string | null;
  points_awarded: boolean;
  imported_from: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type BookingSourceRow = {
  id: string;
  channel: IntegrationSystem;
  external_message_id: string;
  external_thread_id: string | null;
  from_email: string | null;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  received_at: string | null;
  snippet: string | null;
  body_text: string | null;
  parser_version: string;
  parsed: Json;
  confidence: number;
  match_status: SourceMatchStatus;
  review_reasons: string[];
  suggested_organization_id: string | null;
  booking_id: string | null;
  processed_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ReviewRow = {
  id: string;
  organization_id: string;
  booking_id: string | null;
  submitted_by: string | null;
  platform: string;
  external_review_id: string | null;
  review_url: string | null;
  rating: number | null;
  body: string | null;
  status: ReviewStatus;
  verified_at: string | null;
  verified_by: string | null;
  rejected_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type InvoiceRow = {
  id: string;
  organization_id: string | null;
  moneybird_invoice_id: string;
  moneybird_contact_id: string | null;
  invoice_number: string | null;
  reference: string | null;
  invoice_date: string | null;
  due_date: string | null;
  state: InvoiceState;
  currency: string;
  total_excl_cents: number;
  total_incl_cents: number;
  total_paid_cents: number;
  total_unpaid_cents: number;
  paid_at: string | null;
  fully_paid: boolean;
  public_view_expires_at: string | null;
  needs_review: boolean;
  review_reasons: string[];
  raw: Json;
  synced_at: string;
  created_at: string;
  updated_at: string;
};

export type InvoiceLineRow = {
  id: string;
  invoice_id: string;
  moneybird_line_id: string | null;
  position: number;
  description: string | null;
  amount: number | null;
  price_cents: number | null;
  total_cents: number | null;
  is_workshop_line: boolean;
  created_at: string;
};

export type BookingInvoiceRow = {
  id: string;
  booking_id: string;
  invoice_id: string;
  link_method: string;
  confidence: number;
  linked_by: string | null;
  created_at: string;
};

export type ExternalRecordMappingRow = {
  id: string;
  system: IntegrationSystem;
  entity_type: string;
  internal_table: string;
  internal_id: string;
  external_id: string;
  external_label: string | null;
  confidence: number;
  extra: Json;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type LoyaltyAccountRow = {
  id: string;
  organization_id: string;
  user_id: string | null;
  enrolled_at: string;
  enrolled_by: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type LoyaltyTransactionRow = {
  id: string;
  organization_id: string;
  user_id: string | null;
  account_id: string;
  type: LoyaltyTransactionType;
  status: LoyaltyTransactionStatus;
  points: number;
  point_value_cents_per_100: number;
  points_per_hour_at_time: number | null;
  qualifying_minutes: number | null;
  description: string;
  source: string;
  external_reference: string | null;
  booking_id: string | null;
  invoice_id: string | null;
  review_id: string | null;
  redemption_id: string | null;
  reverses_transaction_id: string | null;
  expires_at: string | null;
  available_at: string | null;
  created_by: string | null;
  reason: string | null;
  occurred_at: string;
  created_at: string;
  updated_at: string;
};

export type LoyaltyTransactionEventRow = {
  id: string;
  transaction_id: string;
  from_status: LoyaltyTransactionStatus | null;
  to_status: LoyaltyTransactionStatus;
  reason: string | null;
  actor_id: string | null;
  created_at: string;
};

export type LoyaltyBalanceRow = {
  organization_id: string;
  user_id: string | null;
  account_id: string;
  enrolled_at: string;
  is_active: boolean;
  available_points: number;
  pending_points: number;
  reserved_points: number;
  redeemed_points: number;
  expired_points: number;
  lifetime_earned_points: number;
  last_earned_at: string | null;
};

export type RedemptionRequestRow = {
  id: string;
  organization_id: string;
  requested_by: string | null;
  points: number;
  value_cents: number;
  point_value_cents_per_100: number;
  booking_id: string | null;
  booking_reference: string | null;
  invoice_number: string | null;
  moneybird_invoice_id: string | null;
  note: string | null;
  status: RedemptionStatus;
  reserve_transaction_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  applied_at: string | null;
  applied_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MessageThreadRow = {
  id: string;
  organization_id: string | null;
  gmail_thread_id: string;
  subject: string | null;
  participant_emails: string[];
  visibility: ThreadVisibility;
  visibility_reason: string | null;
  matched_contact_id: string | null;
  allowlisted_by: string | null;
  allowlisted_at: string | null;
  last_message_at: string | null;
  message_count: number;
  booking_id: string | null;
  created_at: string;
  updated_at: string;
};

export type MessageRow = {
  id: string;
  thread_id: string;
  gmail_message_id: string;
  direction: MessageDirection;
  from_email: string | null;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  sent_at: string;
  snippet: string | null;
  body_text: string | null;
  body_html: string | null;
  has_attachments: boolean;
  attachment_meta: Json;
  sent_from_portal: boolean;
  sent_by: string | null;
  created_at: string;
};

export type OutboundMessageRow = {
  id: string;
  thread_id: string;
  organization_id: string;
  author_id: string | null;
  body_text: string;
  in_reply_to: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  gmail_message_id: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
};

export type IntegrationSyncStateRow = {
  id: string;
  integration: IntegrationSystem;
  key: string;
  status: string;
  cursor: string | null;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  retry_count: number;
  items_processed: number;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

export type IntegrationCredentialRow = {
  id: string;
  integration: IntegrationSystem;
  label: string;
  account_email: string | null;
  encrypted_payload: string;
  scopes: string[];
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AppSettingRow = {
  key: string;
  value: Json;
  label: string;
  description: string | null;
  group_name: string;
  value_type: string;
  is_public: boolean;
  sort_order: number;
  updated_by: string | null;
  updated_at: string;
};

/* -------------------------------------------------------------------------- */
/* CJP-tegoed                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Een aanvraag om CJP-budget te parkeren.
 *
 * De velden school_name tot en met holder_phone zijn een momentopname van het
 * moment van aanvragen. Verandert de contactpersoon later, dan blijft hier
 * staan wie het destijds was.
 */
export type CjpParkingRequestRow = {
  id: string;
  organization_id: string;
  school_name: string;
  cjp_school_number: string;
  holder_name: string;
  holder_email: string;
  holder_phone: string | null;
  amount_cents: number;
  school_year: string;
  status: CjpParkingStatus;
  requested_by: string | null;
  requested_by_email: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  credit_transaction_id: string | null;
  bonus_transaction_id: string | null;
  notified_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Het geldgrootboek. Positief is erbij, negatief is eraf. Nooit nul. */
export type CjpCreditTransactionRow = {
  id: string;
  organization_id: string;
  amount_cents: number;
  school_year: string;
  type: CjpCreditType;
  description: string;
  request_id: string | null;
  booking_id: string | null;
  invoice_number: string | null;
  external_reference: string | null;
  created_by: string | null;
  note: string | null;
  occurred_at: string;
  created_at: string;
  updated_at: string;
};

export type CrmPipelineStageRow = {
  id: string;
  brand: CrmBrand;
  key: string;
  label: string;
  description: string | null;
  position: number;
  is_won: boolean;
  is_lost: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * Een persoon die je kent.
 *
 * organization_id mag leeg zijn: een deelnemer aan het Suri Impact Breekjaar
 * hoort bij geen enkele school. Deze tabel staat bewust naast
 * organization_contacts en verandert nooit iets aan wat een klant mag zien.
 */
export type CrmContactType =
  | "docent"
  | "cultuurcoordinator"
  | "decaan"
  | "administratie"
  | "directie"
  | "ouder"
  | "deelnemer"
  | "opdrachtgever"
  | "leverancier"
  | "overig";

export type CrmContactRow = {
  id: string;
  organization_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  note: string | null;
  is_unsubscribed: boolean;
  owner_id: string | null;
  linked_contact_id: string | null;
  contact_type: CrmContactType | null;
  lifecycle: CrmLifecycle | null;
  city: string | null;
  /**
   * Alleen gevuld als deze persoon aantoonbaar een klantportaalaccount heeft.
   * Wordt nooit automatisch gezet: een gelijk e-mailadres is een aanwijzing,
   * geen bewijs.
   */
  portal_user_id: string | null;
  last_contact_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmDealRow = {
  id: string;
  brand: CrmBrand;
  title: string;
  stage_id: string;
  /** Precies een van deze twee is gevuld; de database bewaakt dat. */
  organization_id: string | null;
  contact_id: string | null;
  value_cents: number;
  expected_date: string | null;
  owner_id: string | null;
  source: string | null;
  note: string | null;
  /** Alleen bij Suri. */
  edition_id: string | null;
  /** Alleen bij Skool Workshop. */
  booking_id: string | null;
  closed_at: string | null;
  /** Sinds wanneer deze deal in de huidige fase staat. */
  stage_since: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmDealEventRow = {
  id: string;
  deal_id: string;
  from_stage_id: string | null;
  to_stage_id: string | null;
  actor_id: string | null;
  note: string | null;
  created_at: string;
};

export type CrmSuriEditionStatus = "concept" | "open" | "gesloten" | "afgerond";

export type CrmSuriEditionRow = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  capacity: number;
  price_cents: number;
  status: CrmSuriEditionStatus;
  note: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Aanvullende gegevens van een deelnemer.
 *
 * Bewust alleen verkoop- en planningsgegevens. Medische gegevens, dieetwensen
 * en paspoortgegevens horen hier niet in; zie de migratie voor de reden.
 */
export type CrmSuriProfileRow = {
  contact_id: string;
  birth_date: string | null;
  education_level: string | null;
  interest: string | null;
  guardian_name: string | null;
  guardian_email: string | null;
  guardian_phone: string | null;
  together_with: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmSuriPaymentKind = "aanbetaling" | "restant" | "correctie" | "terugbetaling";

export type CrmSuriPaymentRow = {
  id: string;
  deal_id: string;
  kind: CrmSuriPaymentKind;
  amount_cents: number;
  received_on: string;
  note: string | null;
  external_reference: string | null;
  created_by: string | null;
  created_at: string;
};

export type CrmActivityKind = "notitie" | "gesprek" | "telefoon" | "email" | "afspraak" | "systeem";

/**
 * Een gebeurtenis op de tijdlijn.
 *
 * Mag aan meerdere dingen tegelijk hangen: een gesprek met een contactpersoon
 * over een lopende deal hoort bij de relatie, de persoon en de deal.
 */
export type CrmActivityRow = {
  id: string;
  kind: CrmActivityKind;
  summary: string;
  body: string | null;
  occurred_at: string;
  organization_id: string | null;
  contact_id: string | null;
  deal_id: string | null;
  actor_id: string | null;
  is_system: boolean;
  created_at: string;
  updated_at: string;
};

/** Een opvolgactie. Mag los staan van een relatie. */
export type CrmTaskRow = {
  id: string;
  title: string;
  note: string | null;
  due_on: string | null;
  owner_id: string | null;
  organization_id: string | null;
  contact_id: string | null;
  deal_id: string | null;
  done_at: string | null;
  done_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Een openbaar te boeken soort afspraak. */
export type CrmBookingLinkRow = {
  id: string;
  slug: string;
  name: string;
  intro: string | null;
  brand: CrmBrand;
  meeting_kind: string;
  meeting_form: string;
  location: string | null;
  owner_id: string | null;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  notice_hours: number;
  horizon_days: number;
  slot_step_minutes: number;
  timezone: string;
  is_active: boolean;
  max_per_day: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Werktijden per weekdag, in minuten na middernacht in de tijdzone van de link. */
export type CrmBookingAvailabilityRow = {
  id: string;
  link_id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
  created_at: string;
};

/** Een afspraak. Ligt voor je en heeft een begin en een eind; een activiteit ligt achter je. */
export type CrmMeetingRow = {
  id: string;
  title: string;
  kind: string;
  form: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  status: string;
  outcome: string | null;
  note: string | null;
  organization_id: string | null;
  contact_id: string | null;
  deal_id: string | null;
  owner_id: string | null;
  source: string;
  calendar_event_id: string | null;
  booking_link_id: string | null;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  guest_company: string | null;
  guest_extra_emails: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Een herbruikbaar tekstblok met personalisatie. brand leeg betekent: beide merken. */
/**
 * Templates en sequences (migratie 038).
 *
 * Met de hand bijgehouden tot `npm run db:types` weer wordt gedraaid tegen een
 * database waar migratie 038 in staat. Dat is bewust: zonder deze regels kan de
 * code die de schermen bouwt niet typecheckt worden voordat de migratie is
 * toegepast, en dan zou je hem pas na het pushen kunnen controleren.
 */
export type CrmTemplateRow = {
  id: string;
  brand: CrmBrand | null;
  name: string;
  subject: string;
  body: string;
  category: string | null;
  is_archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmSequenceRow = {
  id: string;
  brand: CrmBrand;
  name: string;
  description: string | null;
  sender_id: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmSequenceStepRow = {
  id: string;
  sequence_id: string;
  position: number;
  wait_days: number;
  kind: string;
  template_id: string | null;
  title: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmSequenceEnrollmentRow = {
  id: string;
  sequence_id: string;
  contact_id: string;
  deal_id: string | null;
  status: string;
  next_step: number;
  next_action_at: string | null;
  stop_reason: string | null;
  started_by: string | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmSnippetRow = {
  id: string;
  brand: CrmBrand | null;
  shortcut: string;
  name: string;
  body: string;
  category: string | null;
  is_archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Een regel per keer dat een fragment is gebruikt. Het aantal wordt hieruit geteld. */
export type CrmSnippetUseRow = {
  id: string;
  snippet_id: string;
  organization_id: string | null;
  contact_id: string | null;
  deal_id: string | null;
  actor_id: string | null;
  used_at: string;
};

/** Altijd berekend uit de deals en de betalingen, nooit uit een losse kolom. */
export type CrmSuriEditionCapacityRow = {
  edition_id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: CrmSuriEditionStatus;
  capacity: number;
  price_cents: number;
  aangemeld: number;
  volledig_betaald: number;
  afgehaakt: number;
  vrij: number;
  ontvangen_cents: number;
};

/** Interne gegevens over een organisatie. Nooit zichtbaar voor de klant zelf. */
export type CrmOrganizationProfileRow = {
  organization_id: string;
  lifecycle: CrmLifecycle;
  owner_id: string | null;
  source: string | null;
  last_contact_at: string | null;
  next_action_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

/** Altijd berekend uit het grootboek, nooit uit een losse kolom. */
export type CjpCreditBalanceRow = {
  organization_id: string;
  available_cents: number;
  added_cents: number;
  spent_cents: number;
  last_movement_at: string | null;
};

export type AuditLogRow = {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  organization_id: string | null;
  before_state: Json;
  after_state: Json;
  reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

export type WebhookEventRow = {
  id: string;
  provider: IntegrationSystem;
  external_event_id: string;
  event_type: string | null;
  payload: Json;
  status: WebhookStatus;
  error: string | null;
  attempts: number;
  received_at: string;
  processed_at: string | null;
};

export type WorkshopResultRow = {
  id: string;
  organization_id: string;
  booking_id: string | null;
  title: string;
  description: string | null;
  status: ResultStatus;
  published_at: string | null;
  expires_at: string | null;
  purge_at: string | null;
  notified_at: string | null;
  notified_email: string | null;
  notify_error: string | null;
  files_removed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkshopResultFileRow = {
  id: string;
  result_id: string;
  kind: ResultItemKind;
  storage_path: string | null;
  external_url: string | null;
  file_name: string;
  description: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  position: number;
  removed_at: string | null;
  created_by: string | null;
  created_at: string;
};

type TableDef<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

type ViewDef<Row> = {
  Row: Row;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: TableDef<ProfileRow>;
      organizations: TableDef<OrganizationRow>;
      organization_domains: TableDef<OrganizationDomainRow>;
      organization_members: TableDef<OrganizationMemberRow>;
      organization_invites: TableDef<OrganizationInviteRow>;
      organization_contacts: TableDef<OrganizationContactRow>;
      public_email_domains: TableDef<{ domain: string }>;
      bookings: TableDef<BookingRow>;
      booking_sources: TableDef<BookingSourceRow>;
      reviews: TableDef<ReviewRow>;
      invoices: TableDef<InvoiceRow>;
      invoice_lines: TableDef<InvoiceLineRow>;
      booking_invoices: TableDef<BookingInvoiceRow>;
      external_record_mappings: TableDef<ExternalRecordMappingRow>;
      loyalty_accounts: TableDef<LoyaltyAccountRow>;
      loyalty_transactions: TableDef<LoyaltyTransactionRow>;
      loyalty_transaction_events: TableDef<LoyaltyTransactionEventRow>;
      redemption_requests: TableDef<RedemptionRequestRow>;
      message_threads: TableDef<MessageThreadRow>;
      messages: TableDef<MessageRow>;
      outbound_messages: TableDef<OutboundMessageRow>;
      integration_sync_state: TableDef<IntegrationSyncStateRow>;
      integration_credentials: TableDef<IntegrationCredentialRow>;
      app_settings: TableDef<AppSettingRow>;
      audit_logs: TableDef<AuditLogRow>;
      webhook_events: TableDef<WebhookEventRow>;
      workshop_results: TableDef<WorkshopResultRow>;
      workshop_result_files: TableDef<WorkshopResultFileRow>;
      cjp_parking_requests: TableDef<CjpParkingRequestRow>;
      cjp_credit_transactions: TableDef<CjpCreditTransactionRow>;
      crm_pipeline_stages: TableDef<CrmPipelineStageRow>;
      crm_contacts: TableDef<CrmContactRow>;
      crm_organization_profiles: TableDef<CrmOrganizationProfileRow>;
      crm_deals: TableDef<CrmDealRow>;
      crm_deal_events: TableDef<CrmDealEventRow>;
      crm_suri_editions: TableDef<CrmSuriEditionRow>;
      crm_suri_profiles: TableDef<CrmSuriProfileRow>;
      crm_suri_payments: TableDef<CrmSuriPaymentRow>;
      crm_activities: TableDef<CrmActivityRow>;
      crm_tasks: TableDef<CrmTaskRow>;
      crm_snippets: TableDef<CrmSnippetRow>;
      crm_snippet_uses: TableDef<CrmSnippetUseRow>;
      crm_meetings: TableDef<CrmMeetingRow>;
      crm_booking_links: TableDef<CrmBookingLinkRow>;
      crm_booking_availability: TableDef<CrmBookingAvailabilityRow>;
      crm_templates: TableDef<CrmTemplateRow>;
      crm_sequences: TableDef<CrmSequenceRow>;
      crm_sequence_steps: TableDef<CrmSequenceStepRow>;
      crm_sequence_enrollments: TableDef<CrmSequenceEnrollmentRow>;
    };
    Views: {
      loyalty_balances: ViewDef<LoyaltyBalanceRow>;
      cjp_credit_balances: ViewDef<CjpCreditBalanceRow>;
      crm_suri_edition_capacity: ViewDef<CrmSuriEditionCapacityRow>;
    };
    Functions: {
      request_redemption: {
        Args: {
          p_org: string;
          p_points: number;
          p_booking_id?: string | null;
          p_booking_reference?: string | null;
          p_note?: string | null;
        };
        Returns: RedemptionRequestRow;
      };
      cancel_redemption: {
        Args: { p_request: string; p_reason?: string | null };
        Returns: RedemptionRequestRow;
      };
      release_points_for_invoice: { Args: { p_invoice: string }; Returns: number };
      expire_loyalty_points: { Args: Record<string, never>; Returns: number };
      ensure_loyalty_account: { Args: { p_org: string; p_actor?: string | null }; Returns: string };
      loyalty_available_points: { Args: { p_org: string }; Returns: number };
      is_admin: { Args: { p_user?: string }; Returns: boolean };
      confirm_cjp_parking: {
        Args: { p_request: string; p_actor?: string | null; p_note?: string | null };
        Returns: CjpParkingRequestRow;
      };
      spend_cjp_credit: {
        Args: {
          p_org: string;
          p_amount_cents: number;
          p_booking?: string | null;
          p_invoice_number?: string | null;
          p_actor?: string | null;
          p_note?: string | null;
        };
        Returns: CjpCreditTransactionRow;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
