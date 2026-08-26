import "server-only";

import { recordAudit } from "@/lib/audit";
import { RESULTS_BUCKET } from "@/lib/results/constants";
import { createServiceSupabase } from "@/lib/supabase/server";

/**
 * Definitief verwijderen van een gebruiker of een organisatie.
 *
 * Dit is onomkeerbaar en bedoeld voor het recht op vergetelheid uit de AVG.
 * Uitgangspunten:
 *
 *  * Alleen een super admin mag dit. De controle daarop staat in de server
 *    action, niet hier, maar deze functies weigeren ook zelf een paar dingen
 *    die nooit mogen gebeuren.
 *  * Voordat er iets weggaat, gaat er een regel in het auditlogboek. Dat is de
 *    enige plek waar achteraf nog staat dát er iets is verwijderd, en door wie.
 *    Er blijft daarbij bewust geen persoonsgegeven over, alleen het adres, want
 *    zonder dat is de logregel waardeloos bij een controle.
 *  * Bestanden in de opslag worden echt verwijderd, niet alleen de verwijzing.
 */

export interface DeleteResult {
  ok: boolean;
  message: string;
}

/* -------------------------------------------------------------------------- */
/* Gebruiker                                                                   */
/* -------------------------------------------------------------------------- */

export async function deleteUserPermanently(params: {
  userId: string;
  actorId: string;
  actorEmail: string;
}): Promise<DeleteResult> {
  const supabase = createServiceSupabase();

  if (params.userId === params.actorId) {
    return { ok: false, message: "U kunt uw eigen account niet verwijderen." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, is_super_admin")
    .eq("id", params.userId)
    .maybeSingle();

  if (!profile) {
    return { ok: false, message: "Deze gebruiker bestaat niet (meer)." };
  }

  if (profile.is_super_admin) {
    return {
      ok: false,
      message:
        "Een super admin kan niet zomaar worden verwijderd. Neem eerst die rechten af en probeer het daarna opnieuw.",
    };
  }

  await recordAudit({
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    action: "user.deleted_permanently",
    entityType: "profiles",
    entityId: profile.id,
    before: { email: profile.email },
    reason: "Definitief verwijderd door een beheerder",
  });

  // Het profiel hangt met on delete cascade aan auth.users, en lidmaatschappen
  // hangen weer aan het profiel. Eén verwijdering ruimt dus de hele keten op.
  // Boekingen, facturen en punten blijven staan: die horen bij de organisatie
  // en niet bij deze persoon. De verwijzing naar de persoon wordt leeggemaakt.
  const { error } = await supabase.auth.admin.deleteUser(profile.id);

  if (error) {
    return { ok: false, message: `Verwijderen is niet gelukt: ${error.message}` };
  }

  return { ok: true, message: `${profile.email} is definitief verwijderd.` };
}

/* -------------------------------------------------------------------------- */
/* Organisatie                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Verwijdert een organisatie met alles wat eraan hangt: boekingen, facturen,
 * SkoolPoints, berichten en resultaten. De accounts van de medewerkers blijven
 * bestaan; alleen hun lidmaatschap van deze organisatie verdwijnt.
 */
export async function deleteOrganizationPermanently(params: {
  organizationId: string;
  actorId: string;
  actorEmail: string;
}): Promise<DeleteResult> {
  const supabase = createServiceSupabase();
  const orgId = params.organizationId;

  const { data: organization } = await supabase
    .from("organizations")
    .select("id, name, slug")
    .eq("id", orgId)
    .maybeSingle();

  if (!organization) {
    return { ok: false, message: "Deze organisatie bestaat niet (meer)." };
  }

  // Tellingen vooraf, zodat het auditlogboek laat zien hoeveel er weg is.
  const [{ count: bookings }, { count: invoices }, { count: members }] = await Promise.all([
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    supabase
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
  ]);

  await recordAudit({
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    action: "organization.deleted_permanently",
    entityType: "organizations",
    entityId: orgId,
    before: {
      naam: organization.name,
      boekingen: bookings ?? 0,
      facturen: invoices ?? 0,
      leden: members ?? 0,
    },
    reason: "Definitief verwijderd door een beheerder",
  });

  /* --- Bestanden uit de opslag halen ------------------------------------- */
  const { data: results } = await supabase
    .from("workshop_results")
    .select("id")
    .eq("organization_id", orgId);

  const resultIds = (results ?? []).map((r) => r.id);

  if (resultIds.length > 0) {
    const { data: files } = await supabase
      .from("workshop_result_files")
      .select("storage_path")
      .in("result_id", resultIds);

    const paths = (files ?? [])
      .map((f) => f.storage_path)
      .filter((p): p is string => Boolean(p));

    if (paths.length > 0) {
      await supabase.storage.from(RESULTS_BUCKET).remove(paths);
    }

    await supabase.from("workshop_result_files").delete().in("result_id", resultIds);
    await supabase.from("workshop_results").delete().eq("organization_id", orgId);
  }

  /* --- Berichten ---------------------------------------------------------- */
  const { data: threads } = await supabase
    .from("message_threads")
    .select("id")
    .eq("organization_id", orgId);

  const threadIds = (threads ?? []).map((t) => t.id);
  if (threadIds.length > 0) {
    await supabase.from("messages").delete().in("thread_id", threadIds);
  }
  await supabase.from("message_threads").delete().eq("organization_id", orgId);
  await supabase.from("outbound_messages").delete().eq("organization_id", orgId);

  /* --- SkoolPoints -------------------------------------------------------- */
  const { data: transactions } = await supabase
    .from("loyalty_transactions")
    .select("id")
    .eq("organization_id", orgId);

  const transactionIds = (transactions ?? []).map((t) => t.id);
  if (transactionIds.length > 0) {
    await supabase.from("loyalty_transaction_events").delete().in("transaction_id", transactionIds);
  }
  await supabase.from("redemption_requests").delete().eq("organization_id", orgId);
  await supabase.from("loyalty_transactions").delete().eq("organization_id", orgId);
  await supabase.from("loyalty_accounts").delete().eq("organization_id", orgId);

  /* --- Boekingen en facturen ---------------------------------------------- */
  const { data: bookingRows } = await supabase
    .from("bookings")
    .select("id")
    .eq("organization_id", orgId);
  const bookingIds = (bookingRows ?? []).map((b) => b.id);

  const { data: invoiceRows } = await supabase
    .from("invoices")
    .select("id")
    .eq("organization_id", orgId);
  const invoiceIds = (invoiceRows ?? []).map((i) => i.id);

  if (bookingIds.length > 0) {
    await supabase.from("booking_invoices").delete().in("booking_id", bookingIds);
    await supabase.from("booking_sources").delete().in("booking_id", bookingIds);
  }
  if (invoiceIds.length > 0) {
    await supabase.from("invoice_lines").delete().in("invoice_id", invoiceIds);
  }

  await supabase.from("invoices").delete().eq("organization_id", orgId);
  await supabase.from("reviews").delete().eq("organization_id", orgId);
  await supabase.from("bookings").delete().eq("organization_id", orgId);

  /* --- Organisatie zelf ---------------------------------------------------- */
  await supabase.from("organization_contacts").delete().eq("organization_id", orgId);
  await supabase.from("organization_invites").delete().eq("organization_id", orgId);
  await supabase.from("organization_members").delete().eq("organization_id", orgId);
  await supabase.from("organization_domains").delete().eq("organization_id", orgId);
  await supabase
    .from("external_record_mappings")
    .delete()
    .eq("internal_table", "organizations")
    .eq("internal_id", orgId);

  const { error } = await supabase.from("organizations").delete().eq("id", orgId);

  if (error) {
    return {
      ok: false,
      message: `Er is een deel verwijderd, maar de organisatie zelf niet: ${error.message}`,
    };
  }

  return {
    ok: true,
    message: `${organization.name} is definitief verwijderd, inclusief ${bookings ?? 0} boekingen en ${invoices ?? 0} facturen.`,
  };
}
