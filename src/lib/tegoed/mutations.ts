import "server-only";

import { recordAudit } from "@/lib/audit";
import { getSettingsWithServiceRole } from "@/lib/settings";
import { createServiceSupabase } from "@/lib/supabase/server";
import { notifyNewParkingRequest } from "@/lib/tegoed/notify";
import type { ParkingSnapshot } from "@/lib/tegoed/regels";
import type { CjpParkingRequestRow } from "@/lib/types/database";

export interface CreateResult {
  ok: boolean;
  request?: CjpParkingRequestRow;
  message?: string;
  /** De melding is los van de aanvraag: die kan mislukken zonder gevolgen voor de klant. */
  notice?: string;
}

/**
 * Dient een parkeeraanvraag in.
 *
 * Wat hier bewust WEL gebeurt:
 *   - het lidmaatschap wordt opnieuw gecontroleerd op de server;
 *   - het CJP-schoolnummer wordt op de organisatie gezet als het daar nog
 *     ontbrak, want dat scheelt de school later een vraag;
 *   - er gaat een interne melding uit naar Skool Workshop.
 *
 * Wat hier bewust NIET gebeurt: er wordt geen tegoed bijgeschreven en er komen
 * geen bonuspunten bij. De aanvraag begint op Aangevraagd en meer niet. Dat
 * gebeurt pas als een beheerder hem bevestigt.
 */
export async function createParkingRequest(params: {
  organizationId: string;
  userId: string;
  userEmail: string;
  snapshot: ParkingSnapshot;
}): Promise<CreateResult> {
  const supabase = createServiceSupabase();

  const { data: membership } = await supabase
    .from("organization_members")
    .select("id")
    .eq("organization_id", params.organizationId)
    .eq("user_id", params.userId)
    .eq("status", "active")
    .maybeSingle();

  if (!membership) return { ok: false, message: "U heeft geen toegang tot deze organisatie." };

  const settings = await getSettingsWithServiceRole();
  if (!settings.cjp_parking_enabled) {
    return { ok: false, message: "CJP-tegoed parkeren is op dit moment niet beschikbaar." };
  }
  if (params.snapshot.amountCents < settings.cjp_minimum_amount_cents) {
    return { ok: false, message: "Dit bedrag is lager dan het minimum om te parkeren." };
  }

  // Eén open aanvraag tegelijk. Voorkomt dubbelklikken en voorkomt dat iemand
  // hetzelfde bedrag in stukjes indient om vaker de bonus te proberen.
  const { data: open } = await supabase
    .from("cjp_parking_requests")
    .select("id")
    .eq("organization_id", params.organizationId)
    .in("status", ["requested", "in_review"])
    .limit(1);

  if (open && open.length > 0) {
    return {
      ok: false,
      message:
        "Er staat al een aanvraag open. Wij nemen die eerst in behandeling. Wilt u het bedrag aanpassen? Mail ons even, dan passen wij het aan.",
    };
  }

  const { data: organization } = await supabase
    .from("organizations")
    .select("id, name, cjp_school_number, has_cjp")
    .eq("id", params.organizationId)
    .maybeSingle();

  if (!organization) return { ok: false, message: "Deze organisatie bestaat niet." };

  const { data: request, error } = await supabase
    .from("cjp_parking_requests")
    .insert({
      organization_id: params.organizationId,
      school_name: params.snapshot.schoolName,
      cjp_school_number: params.snapshot.cjpSchoolNumber,
      holder_name: params.snapshot.holderName,
      holder_email: params.snapshot.holderEmail,
      holder_phone: params.snapshot.holderPhone,
      amount_cents: params.snapshot.amountCents,
      school_year: schoolYear(),
      status: "requested",
      requested_by: params.userId,
      requested_by_email: params.userEmail,
    })
    .select("*")
    .single();

  if (error || !request) {
    console.error("[cjp] aanvraag kon niet worden opgeslagen", error?.message);
    return {
      ok: false,
      message: error?.message?.includes("permission denied")
        ? "De database mist schrijfrechten voor CJP-aanvragen. Voer de nieuwste Supabase-migratie uit en probeer opnieuw."
        : `Uw aanvraag kon niet worden opgeslagen${error?.message ? `: ${error.message}` : ". Probeer het opnieuw."}`,
    };
  }

  const row = request as CjpParkingRequestRow;

  // Het nummer bewaren op de organisatie als het daar nog niet stond. Wij
  // overschrijven een bestaand nummer nooit stilzwijgend.
  if (!organization.cjp_school_number) {
    await supabase
      .from("organizations")
      .update({ cjp_school_number: params.snapshot.cjpSchoolNumber, has_cjp: true })
      .eq("id", params.organizationId);

    await recordAudit({
      actorId: params.userId,
      actorEmail: params.userEmail,
      actorRole: "klant",
      action: "organization.cjp_number_set",
      entityType: "organization",
      entityId: params.organizationId,
      organizationId: params.organizationId,
      before: { cjp_school_number: null },
      after: { cjp_school_number: params.snapshot.cjpSchoolNumber },
      reason: "Ingevuld bij een aanvraag om CJP-tegoed te parkeren",
    });
  }

  await recordAudit({
    actorId: params.userId,
    actorEmail: params.userEmail,
    actorRole: "klant",
    action: "cjp_parking.requested",
    entityType: "cjp_parking_request",
    entityId: row.id,
    organizationId: params.organizationId,
    after: {
      amount_cents: row.amount_cents,
      cjp_school_number: row.cjp_school_number,
      holder_name: row.holder_name,
      holder_email: row.holder_email,
    },
  });

  const melding = await notifyNewParkingRequest(row, organization.name);

  return {
    ok: true,
    request: row,
    notice: melding.sent ? undefined : melding.reason,
  };
}

function schoolYear(date = new Date()): string {
  const year = date.getFullYear();
  return date.getMonth() >= 8 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
}

/* -------------------------------------------------------------------------- */
/* Beheerderskant                                                              */
/* -------------------------------------------------------------------------- */

export interface AdminResult {
  ok: boolean;
  message?: string;
}

/**
 * Bevestigt een aanvraag.
 *
 * Het echte werk gebeurt in de databasefunctie confirm_cjp_parking: die zet in
 * één transactie het tegoed bij, kent de bonuspunten toe en zet de status om.
 * Twee keer klikken kan daardoor nooit twee keer geld of twee keer punten
 * opleveren.
 */
export async function confirmParkingRequest(params: {
  requestId: string;
  actorId: string;
  actorEmail: string;
  note: string | null;
}): Promise<AdminResult> {
  const supabase = createServiceSupabase();

  const { data: voor } = await supabase
    .from("cjp_parking_requests")
    .select("*")
    .eq("id", params.requestId)
    .maybeSingle();

  if (!voor) return { ok: false, message: "Deze aanvraag bestaat niet." };
  if ((voor as CjpParkingRequestRow).status === "confirmed") {
    return { ok: true, message: "Deze aanvraag was al bevestigd. Er is niets dubbel geboekt." };
  }

  const { data, error } = await supabase.rpc("confirm_cjp_parking", {
    p_request: params.requestId,
    p_actor: params.actorId,
    p_note: params.note,
  });

  if (error) {
    console.error("[cjp] bevestigen mislukt", error.message);
    return { ok: false, message: vertaalFout(error.message) };
  }

  const na = data as unknown as CjpParkingRequestRow;

  await recordAudit({
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    action: "cjp_parking.confirmed",
    entityType: "cjp_parking_request",
    entityId: params.requestId,
    organizationId: na.organization_id,
    before: { status: (voor as CjpParkingRequestRow).status },
    after: {
      status: na.status,
      amount_cents: na.amount_cents,
      credit_transaction_id: na.credit_transaction_id,
      bonus_transaction_id: na.bonus_transaction_id,
    },
    reason: params.note,
  });

  const bonus = na.bonus_transaction_id
    ? " De bonuspunten zijn toegekend."
    : " Er zijn geen bonuspunten toegekend; kijk bij de instellingen als u dat wel verwachtte.";

  return { ok: true, message: `Het tegoed is bijgeschreven.${bonus}` };
}

/** Zet een aanvraag op In behandeling of Afgewezen. Raakt geen geld en geen punten. */
export async function setParkingStatus(params: {
  requestId: string;
  status: "in_review" | "rejected";
  actorId: string;
  actorEmail: string;
  note: string | null;
}): Promise<AdminResult> {
  const supabase = createServiceSupabase();

  const { data: voor } = await supabase
    .from("cjp_parking_requests")
    .select("*")
    .eq("id", params.requestId)
    .maybeSingle();

  if (!voor) return { ok: false, message: "Deze aanvraag bestaat niet." };

  const huidig = voor as CjpParkingRequestRow;
  if (huidig.status === "confirmed") {
    return {
      ok: false,
      message:
        "Deze aanvraag is al bevestigd en het tegoed staat er. Terugdraaien doet u met een correctie op het tegoed, zodat de historie klopt.",
    };
  }

  const { error } = await supabase
    .from("cjp_parking_requests")
    .update({
      status: params.status,
      decided_by: params.actorId,
      decided_at: params.status === "rejected" ? new Date().toISOString() : null,
      decision_note: params.note ?? huidig.decision_note,
    })
    .eq("id", params.requestId);

  if (error) return { ok: false, message: "De status kon niet worden aangepast." };

  await recordAudit({
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    action: params.status === "rejected" ? "cjp_parking.rejected" : "cjp_parking.in_review",
    entityType: "cjp_parking_request",
    entityId: params.requestId,
    organizationId: huidig.organization_id,
    before: { status: huidig.status },
    after: { status: params.status },
    reason: params.note,
  });

  return {
    ok: true,
    message:
      params.status === "rejected"
        ? "De aanvraag is afgewezen. Er is geen tegoed bijgeschreven."
        : "De aanvraag staat nu op In behandeling.",
  };
}

/**
 * Boekt tegoed af op een boeking.
 *
 * De databasefunctie spend_cjp_credit zet een slot op de organisatie voordat
 * zij het saldo leest, dus twee beheerders kunnen samen nooit meer afboeken
 * dan er staat. Richting Moneybird gaat er niets: het factuurnummer is
 * uitsluitend een verwijzing voor de administratie.
 */
export async function spendCredit(params: {
  organizationId: string;
  amountCents: number;
  bookingId: string | null;
  invoiceNumber: string | null;
  actorId: string;
  actorEmail: string;
  note: string | null;
}): Promise<AdminResult> {
  const supabase = createServiceSupabase();

  const { data, error } = await supabase.rpc("spend_cjp_credit", {
    p_org: params.organizationId,
    p_amount_cents: params.amountCents,
    p_booking: params.bookingId,
    p_invoice_number: params.invoiceNumber,
    p_actor: params.actorId,
    p_note: params.note,
  });

  if (error) return { ok: false, message: vertaalFout(error.message) };

  await recordAudit({
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    action: "cjp_credit.spent",
    entityType: "cjp_credit_transaction",
    entityId: (data as { id?: string } | null)?.id ?? null,
    organizationId: params.organizationId,
    after: {
      amount_cents: -params.amountCents,
      booking_id: params.bookingId,
      invoice_number: params.invoiceNumber,
    },
    reason: params.note,
  });

  return { ok: true, message: "Het bedrag is van het tegoed afgeboekt." };
}

/** Databasefouten omzetten naar begrijpelijke taal, zonder technische details. */
function vertaalFout(message: string): string {
  if (message.includes("Onvoldoende tegoed")) {
    return message.slice(message.indexOf("Onvoldoende tegoed"));
  }
  if (message.includes("afgewezen")) {
    return "Deze aanvraag is afgewezen en kan niet meer worden bevestigd.";
  }
  if (message.includes("bestaat niet")) return "Dit item bestaat niet meer.";
  if (message.includes("hoort niet bij deze organisatie")) {
    return "Deze boeking staat niet op naam van deze organisatie.";
  }
  if (message.includes("groter dan nul")) return "Vul een bedrag groter dan nul in.";
  return "Dit kon niet worden verwerkt. Probeer het later opnieuw.";
}
