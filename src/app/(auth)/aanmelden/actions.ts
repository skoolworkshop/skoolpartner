"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import {
  createOrganization,
  joinAsFirstMember,
  requestMembership,
  searchOrganizations,
} from "@/lib/organizations/service";

export interface JoinState {
  status: "idle" | "ok" | "error";
  message?: string;
  results?: { id: string; name: string; city: string | null; kind: string }[];
}

export async function searchOrganizationsAction(
  _prev: JoinState,
  formData: FormData
): Promise<JoinState> {
  await requireUser();
  const query = String(formData.get("query") ?? "");
  if (query.trim().length < 2) {
    return { status: "error", message: "Vul minstens twee letters in." };
  }
  const results = await searchOrganizations(query);
  if (results.length === 0) {
    return {
      status: "ok",
      message: "Geen organisatie gevonden. Vraag hieronder een nieuwe organisatie aan.",
      results: [],
    };
  }
  return { status: "ok", results };
}

export async function joinOrganizationAction(
  _prev: JoinState,
  formData: FormData
): Promise<JoinState> {
  const session = await requireUser();
  const organizationId = String(formData.get("organization_id") ?? "");
  const source = String(formData.get("source") ?? "self_request");

  if (!organizationId) {
    return { status: "error", message: "Kies een organisatie." };
  }

  const result = await requestMembership({
    userId: session.userId,
    userEmail: session.email,
    organizationId,
    source: source === "domain_match" ? "domain_match" : "self_request",
  });

  if (!result.ok) {
    return { status: "error", message: result.message ?? "Aanvraag is niet gelukt." };
  }

  redirect("/wachten");
}

export async function requestNewOrganizationAction(
  _prev: JoinState,
  formData: FormData
): Promise<JoinState> {
  const session = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim() || null;

  if (name.length < 2) {
    return { status: "error", message: "Vul de naam van uw organisatie in." };
  }

  const created = await createOrganization({
    name,
    city,
    contactEmail: session.email,
    actorId: session.userId,
    actorEmail: session.email,
  });

  if (!created.ok || !created.organizationId) {
    // Een beheerder mag de technische reden zien, een klant niet. Zo kunnen
    // jullie zelf achterhalen wat er speelt zonder in de logs te duiken.
    const extra =
      session.isAdmin && created.technicalReason
        ? ` (technische melding: ${created.technicalReason})`
        : "";
    return {
      status: "error",
      message: `${created.message ?? "Aanmaken is niet gelukt."}${extra}`,
    };
  }

  // Bestond de organisatie al? Dan is dit iemand die zich bij een bestaande
  // school aansluit. Dat blijft langs de goedkeuring, want daar hangen wél
  // gegevens aan.
  if (created.alreadyExisted) {
    await requestMembership({
      userId: session.userId,
      userEmail: session.email,
      organizationId: created.organizationId,
      source: "self_request",
    });
    redirect("/wachten");
  }

  // Een gloednieuwe organisatie: deze persoon is de eerste en er valt nog
  // niets te beschermen. Dus meteen naar binnen, geen wachtpagina.
  await joinAsFirstMember({
    userId: session.userId,
    userEmail: session.email,
    organizationId: created.organizationId,
  });

  redirect("/dashboard");
}
