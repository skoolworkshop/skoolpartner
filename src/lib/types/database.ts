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
export type BookingOrigin = "email_parser" | "admin_manual" | "import" | "hubspot";
export type SourceMatchStatus = "pending" | "matched" | "needs_review" | "rejected" | "ignored";
export type InvoiceState =
  | "draft" | "open" | "pending_payment" | "late" | "paid"
  | "partially_paid" | "uncollectible" | "reminded" | "unknown";
export type LoyaltyTransactionType =
  | "earn_workshop" | "earn_review" | "manual_adjustment"
  | "redemption_reserve" | "expiry" | "reversal";
export type LoyaltyTransactionStatus =
  | "pending" | "available" | "reserved" | "redeemed" | "expired" | "reversed" | "cancelled";
export type RedemptionStatus = "requested" | "approved" | "rejected" | "applied" | "cancelled";
export type IntegrationSystem = "gmail" | "moneybird" | "hubspot" | "supabase";
export type ThreadVisibility = "needs_review" | "auto_allowed" | "manual_allowed" | "blocked";
export type MessageDirection = "inbound" | "outbound";
export type ReviewStatus = "submitted" | "verified" | "rejected";
export type WebhookStatus = "received" | "processed" | "failed" | "ignored";

export type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  job_title: string | null;
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
  postal_code: string | null;
  city: string | null;
  country: string;
  internal_notes: string | null;
  skoolpartner_enrolled_at: string | null;
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
  created_at: string;
  updated_at: string;
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
  hubspot_contact_id: string | null;
  moneybird_contact_id: string | null;
  created_at: string;
  updated_at: string;
};

export type BookingRow = {
  id: string;
  organization_id: string;
  reference: string | null;
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
  enrolled_at: string;
  enrolled_by: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type LoyaltyTransactionRow = {
  id: string;
  organization_id: string;
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
  booking_reference: string | null;
  note: string | null;
  status: RedemptionStatus;
  reserve_transaction_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  applied_at: string | null;
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
    };
    Views: {
      loyalty_balances: ViewDef<LoyaltyBalanceRow>;
    };
    Functions: {
      request_redemption: {
        Args: { p_org: string; p_points: number; p_booking_reference?: string | null; p_note?: string | null };
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
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
