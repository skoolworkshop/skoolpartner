import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/audit";
import { isLifecycle, isPeriodeStatus, type BetalingSoort, type Lifecycle } from "@/lib/crm/regels";
import type { CrmContactType, CrmDealRow } from "@/lib/types/database";

/**
 * De schrijfkant van het CRM.
 *
 * Twee regels die overal gelden:
 *
 *   1. De aanroeper heeft al geautoriseerd. Deze module gaat daar niet over,
 *      maar controleert wel altijd of het onderwerp bestaat en klopt.
 *   2. Elke wijziging die er commercieel toe doet, gaat in het audit log. Dat
 *      is nu nog geen probleem met twee mensen, maar het is precies het soort
 *      ding dat je later niet met terugwerkende kracht kunt aanzetten.
 */

export interface Actor {
  userId: string;
  email: string;
}

/** Zet een databasefout om in iets wat een mens kan lezen. */
export function vertaalFout(error: { code?: string; message: string }): string {
  if (error.code === "23505") return "Dit bestaat al. Kijk of het er niet al tussen staat.";
  if (error.code === "23503") return "Een van de gekoppelde gegevens bestaat niet (meer).";
  if (error.code === "23514") {
    if (error.message.includes("teken")) {
      return "Het bedrag past niet bij de soort betaling. Een terugbetaling hoort negatief te zijn.";
    }
    if (error.message.includes("correctie_met_reden")) {
      return "Vul bij een correctie een reden in.";
    }
    if (error.message.includes("een_onderwerp")) {
      return "Een deal hoort bij minstens een organisatie of een persoon.";
    }
    if (error.message.includes("contacts_soort")) {
      return "Dit soort contact bestaat niet.";
    }
    if (error.message.includes("volgorde")) {
      return "De einddatum moet na de startdatum liggen.";
    }
    return "Deze waarde wordt door de database geweigerd.";
  }
  if (error.code === "42501") {
    return "Geen rechten op deze tabel. Controleer de SUPABASE_SERVICE_ROLE_KEY.";
  }
  return error.message.slice(0, 200);
}

// -----------------------------------------------------------------------------
// Relaties
// -----------------------------------------------------------------------------

/**
 * Levensfase en eigenaar van een organisatie vastleggen.
 *
 * Het profiel wordt aangemaakt als het er nog niet is. Zo hoeft niemand eerst
 * ergens op "profiel aanmaken" te klikken voordat hij iets kan invullen.
 */
export async function setRelatieProfiel(
  organizationId: string,
  waarden: {
    lifecycle?: Lifecycle;
    ownerId?: string | null;
    source?: string | null;
    nextActionAt?: string | null;
    note?: string | null;
  },
  actor: Actor
): Promise<void> {
  if (waarden.lifecycle && !isLifecycle(waarden.lifecycle)) {
    throw new Error("Onbekende levensfase.");
  }

  const supabase = createServiceSupabase();

  const { data: organisatie } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", organizationId)
    .maybeSingle();
  if (!organisatie) throw new Error("Deze organisatie bestaat niet.");

  const { data: bestaand } = await supabase
    .from("crm_organization_profiles")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const { error } = await supabase.from("crm_organization_profiles").upsert(
    {
      organization_id: organizationId,
      lifecycle: waarden.lifecycle ?? bestaand?.lifecycle ?? "klant",
      owner_id: waarden.ownerId !== undefined ? waarden.ownerId : (bestaand?.owner_id ?? null),
      source: waarden.source !== undefined ? waarden.source : (bestaand?.source ?? null),
      next_action_at:
        waarden.nextActionAt !== undefined ? waarden.nextActionAt : (bestaand?.next_action_at ?? null),
      note: waarden.note !== undefined ? waarden.note : (bestaand?.note ?? null),
    },
    { onConflict: "organization_id" }
  );

  if (error) throw new Error(vertaalFout(error));

  await recordAudit({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: "crm.relatie.bijgewerkt",
    entityType: "crm_organization_profile",
    entityId: organizationId,
    organizationId,
    before: bestaand ? { lifecycle: bestaand.lifecycle, owner_id: bestaand.owner_id } : null,
    after: { lifecycle: waarden.lifecycle ?? bestaand?.lifecycle ?? "klant" },
  });
}

/** Vastleggen dat er contact is geweest. Zet de teller op nul. */
export async function markeerContact(organizationId: string, actor: Actor): Promise<void> {
  const supabase = createServiceSupabase();
  const nu = new Date().toISOString();

  const { data: bestaand } = await supabase
    .from("crm_organization_profiles")
    .select("lifecycle, owner_id, source, next_action_at, note")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const { error } = await supabase.from("crm_organization_profiles").upsert(
    {
      organization_id: organizationId,
      lifecycle: bestaand?.lifecycle ?? "klant",
      owner_id: bestaand?.owner_id ?? null,
      source: bestaand?.source ?? null,
      next_action_at: bestaand?.next_action_at ?? null,
      note: bestaand?.note ?? null,
      last_contact_at: nu,
    },
    { onConflict: "organization_id" }
  );

  if (error) throw new Error(vertaalFout(error));

  await recordAudit({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: "crm.contact.vastgelegd",
    entityType: "crm_organization_profile",
    entityId: organizationId,
    organizationId,
  });
}

// -----------------------------------------------------------------------------
// Personen
// -----------------------------------------------------------------------------

/**
 * Een contactpersoon vastleggen in het CRM.
 *
 * BELANGRIJK: dit maakt nooit een rij in organization_contacts aan en
 * verifieert nooit iets. Die tabel bepaalt welke e-mailthreads een klant te
 * zien krijgt, en dat mag nooit een bijwerking zijn van "iemand toevoegen aan
 * het CRM".
 */
export async function bewaarContact(
  waarden: {
    id?: string;
    organizationId: string | null;
    fullName: string;
    email?: string | null;
    phone?: string | null;
    jobTitle?: string | null;
    note?: string | null;
    contactType?: CrmContactType | null;
    lifecycle?: Lifecycle | null;
    city?: string | null;
  },
  actor: Actor
): Promise<string> {
  const naam = waarden.fullName.trim();
  if (naam.length < 2) throw new Error("Vul een naam in.");

  const email = waarden.email?.trim().toLowerCase() || null;
  if (email && !email.includes("@")) throw new Error("Dit is geen geldig e-mailadres.");
  if (waarden.lifecycle && !isLifecycle(waarden.lifecycle)) {
    throw new Error("Onbekende levensfase.");
  }

  const supabase = createServiceSupabase();
  const rij = {
    organization_id: waarden.organizationId,
    full_name: naam,
    email,
    phone: waarden.phone?.trim() || null,
    job_title: waarden.jobTitle?.trim() || null,
    note: waarden.note?.trim() || null,
    contact_type: waarden.contactType ?? null,
    lifecycle: waarden.lifecycle ?? null,
    city: waarden.city?.trim() || null,
  };

  if (waarden.id) {
    const { error } = await supabase.from("crm_contacts").update(rij).eq("id", waarden.id);
    if (error) throw new Error(vertaalFout(error));
    await recordAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: "crm.contact.bijgewerkt",
      entityType: "crm_contact",
      entityId: waarden.id,
      organizationId: waarden.organizationId,
    });
    return waarden.id;
  }

  const { data, error } = await supabase
    .from("crm_contacts")
    .insert({ ...rij, created_by: actor.userId })
    .select("id")
    .single();

  if (error) throw new Error(vertaalFout(error));

  await recordAudit({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: "crm.contact.aangemaakt",
    entityType: "crm_contact",
    entityId: data.id,
    organizationId: waarden.organizationId,
  });

  return data.id;
}

// -----------------------------------------------------------------------------
// Reisperiodes
// -----------------------------------------------------------------------------

export async function bewaarPeriode(
  waarden: {
    id?: string;
    name: string;
    startsOn: string;
    endsOn: string;
    capacity: number;
    priceCents: number;
    status: string;
    note?: string | null;
  },
  actor: Actor
): Promise<string> {
  if (!isPeriodeStatus(waarden.status)) throw new Error("Onbekende status.");
  if (waarden.name.trim().length < 2) throw new Error("Vul een naam in, bijvoorbeeld Oktober 2026.");
  if (!waarden.startsOn || !waarden.endsOn) throw new Error("Vul een begin- en einddatum in.");
  if (waarden.capacity < 1 || waarden.capacity > 200) {
    throw new Error("Het aantal plaatsen ligt tussen 1 en 200.");
  }

  const supabase = createServiceSupabase();
  const rij = {
    name: waarden.name.trim(),
    starts_on: waarden.startsOn,
    ends_on: waarden.endsOn,
    capacity: waarden.capacity,
    price_cents: waarden.priceCents,
    status: waarden.status,
    note: waarden.note?.trim() || null,
  };

  if (waarden.id) {
    const { error } = await supabase.from("crm_suri_editions").update(rij).eq("id", waarden.id);
    if (error) throw new Error(vertaalFout(error));
    await recordAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: "crm.reisperiode.bijgewerkt",
      entityType: "crm_suri_edition",
      entityId: waarden.id,
      after: rij,
    });
    return waarden.id;
  }

  const { data, error } = await supabase.from("crm_suri_editions").insert(rij).select("id").single();
  if (error) throw new Error(vertaalFout(error));

  await recordAudit({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: "crm.reisperiode.aangemaakt",
    entityType: "crm_suri_edition",
    entityId: data.id,
    after: rij,
  });

  return data.id;
}

// -----------------------------------------------------------------------------
// Aanmeldingen
// -----------------------------------------------------------------------------

/**
 * Een deelnemer aanmelden voor een reisperiode.
 *
 * Maakt de persoon aan als die er nog niet is, en zet er een deal bij in de
 * eerste fase van Suri. De prijs komt van de reisperiode, zodat een latere
 * prijswijziging bestaande aanmeldingen niet stiekem verandert.
 *
 * Er wordt bewust NIET geweigerd als de periode vol is. Een wachtlijst of een
 * uitzondering is een menselijke afweging; het scherm laat de overboeking wel
 * duidelijk zien.
 */
export async function meldDeelnemerAan(
  waarden: {
    editionId: string;
    fullName: string;
    email?: string | null;
    phone?: string | null;
    birthDate?: string | null;
    guardianName?: string | null;
    guardianEmail?: string | null;
    guardianPhone?: string | null;
    interest?: string | null;
    note?: string | null;
  },
  actor: Actor
): Promise<string> {
  const supabase = createServiceSupabase();

  const { data: periode } = await supabase
    .from("crm_suri_editions")
    .select("id, name, price_cents")
    .eq("id", waarden.editionId)
    .maybeSingle();
  if (!periode) throw new Error("Deze reisperiode bestaat niet.");

  const { data: eersteFase } = await supabase
    .from("crm_pipeline_stages")
    .select("id")
    .eq("brand", "suri_impact")
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!eersteFase) throw new Error("Er zijn geen pijplijnfases voor Suri Impact ingesteld.");

  const contactId = await bewaarContact(
    {
      organizationId: null,
      fullName: waarden.fullName,
      email: waarden.email,
      phone: waarden.phone,
    },
    actor
  );

  if (
    waarden.birthDate ||
    waarden.guardianName ||
    waarden.guardianEmail ||
    waarden.guardianPhone ||
    waarden.interest ||
    waarden.note
  ) {
    const { error } = await supabase.from("crm_suri_profiles").upsert(
      {
        contact_id: contactId,
        birth_date: waarden.birthDate || null,
        guardian_name: waarden.guardianName?.trim() || null,
        guardian_email: waarden.guardianEmail?.trim().toLowerCase() || null,
        guardian_phone: waarden.guardianPhone?.trim() || null,
        interest: waarden.interest?.trim() || null,
        note: waarden.note?.trim() || null,
      },
      { onConflict: "contact_id" }
    );
    if (error) throw new Error(vertaalFout(error));
  }

  const { data: deal, error } = await supabase
    .from("crm_deals")
    .insert({
      brand: "suri_impact",
      title: waarden.fullName.trim(),
      stage_id: eersteFase.id,
      contact_id: contactId,
      edition_id: periode.id,
      value_cents: periode.price_cents,
      owner_id: actor.userId,
      created_by: actor.userId,
    })
    .select("id")
    .single();

  if (error) throw new Error(vertaalFout(error));

  await recordAudit({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: "crm.aanmelding.aangemaakt",
    entityType: "crm_deal",
    entityId: deal.id,
    after: { periode: periode.name, naam: waarden.fullName.trim() },
  });

  return deal.id;
}

/**
 * Een deal naar een andere fase zetten.
 *
 * De wisseling wordt vastgelegd in plaats van overschreven, zodat je later kunt
 * zien hoe lang iets ergens heeft gestaan. De database bewaakt zelf dat de
 * nieuwe fase bij hetzelfde merk hoort.
 */
export async function zetFase(
  dealId: string,
  stageId: string,
  actor: Actor,
  notitie?: string | null
): Promise<CrmDealRow> {
  const supabase = createServiceSupabase();

  const { data: deal } = await supabase.from("crm_deals").select("*").eq("id", dealId).maybeSingle();
  if (!deal) throw new Error("Deze deal bestaat niet.");
  if (deal.stage_id === stageId) return deal;

  const { data: fase } = await supabase
    .from("crm_pipeline_stages")
    .select("id, brand, is_won, is_lost, label")
    .eq("id", stageId)
    .maybeSingle();
  if (!fase) throw new Error("Deze fase bestaat niet.");
  if (fase.brand !== deal.brand) throw new Error("Deze fase hoort bij het andere merk.");

  const afgesloten = fase.is_won || fase.is_lost;

  const { data: bijgewerkt, error } = await supabase
    .from("crm_deals")
    .update({
      stage_id: stageId,
      // Sinds wanneer staat hij in deze fase? Dat is iets anders dan wanneer
      // hij voor het laatst is aangeraakt.
      stage_since: new Date().toISOString(),
      closed_at: afgesloten ? new Date().toISOString() : null,
    })
    .eq("id", dealId)
    .select("*")
    .single();

  if (error) throw new Error(vertaalFout(error));

  await supabase.from("crm_deal_events").insert({
    deal_id: dealId,
    from_stage_id: deal.stage_id,
    to_stage_id: stageId,
    actor_id: actor.userId,
    note: notitie?.trim() || null,
  });

  await recordAudit({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: "crm.deal.fase",
    entityType: "crm_deal",
    entityId: dealId,
    organizationId: deal.organization_id,
    before: { stage_id: deal.stage_id },
    after: { stage_id: stageId, fase: fase.label },
  });

  return bijgewerkt;
}

/** Een betaling van een deelnemer vastleggen. */
export async function bewaarBetaling(
  waarden: {
    dealId: string;
    kind: BetalingSoort;
    amountCents: number;
    receivedOn: string;
    note?: string | null;
    externalReference?: string | null;
  },
  actor: Actor
): Promise<void> {
  if (waarden.amountCents === 0) throw new Error("Vul een bedrag in.");

  const supabase = createServiceSupabase();
  const { data: deal } = await supabase
    .from("crm_deals")
    .select("id, brand, title")
    .eq("id", waarden.dealId)
    .maybeSingle();
  if (!deal) throw new Error("Deze aanmelding bestaat niet.");
  if (deal.brand !== "suri_impact") throw new Error("Betalingen horen bij een Suri-aanmelding.");

  const bedrag =
    waarden.kind === "terugbetaling"
      ? -Math.abs(waarden.amountCents)
      : waarden.kind === "correctie"
        ? waarden.amountCents
        : Math.abs(waarden.amountCents);

  const { error } = await supabase.from("crm_suri_payments").insert({
    deal_id: waarden.dealId,
    kind: waarden.kind,
    amount_cents: bedrag,
    received_on: waarden.receivedOn,
    note: waarden.note?.trim() || null,
    external_reference: waarden.externalReference?.trim() || null,
    created_by: actor.userId,
  });

  if (error) throw new Error(vertaalFout(error));

  await recordAudit({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: "crm.betaling.vastgelegd",
    entityType: "crm_suri_payment",
    entityId: waarden.dealId,
    after: { soort: waarden.kind, bedrag_centen: bedrag },
  });
}

/** Een deelnemer naar een andere reisperiode verplaatsen. */
export async function verplaatsNaarPeriode(
  dealId: string,
  editionId: string,
  actor: Actor
): Promise<void> {
  const supabase = createServiceSupabase();

  const { data: deal } = await supabase
    .from("crm_deals")
    .select("id, brand, edition_id")
    .eq("id", dealId)
    .maybeSingle();
  if (!deal) throw new Error("Deze aanmelding bestaat niet.");
  if (deal.brand !== "suri_impact") throw new Error("Alleen een Suri-aanmelding hoort bij een reisperiode.");

  const { error } = await supabase
    .from("crm_deals")
    .update({ edition_id: editionId })
    .eq("id", dealId);

  if (error) throw new Error(vertaalFout(error));

  await recordAudit({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: "crm.aanmelding.verplaatst",
    entityType: "crm_deal",
    entityId: dealId,
    before: { edition_id: deal.edition_id },
    after: { edition_id: editionId },
  });
}
