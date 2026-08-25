import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { hasServiceRole } from "@/lib/env";
import { suggestOrganizationsForEmail } from "@/lib/organizations/service";
import { Alert } from "@/components/ui/feedback";
import { JoinForm } from "./join-form";

export const metadata: Metadata = { title: "Organisatie kiezen" };

export default async function JoinPage() {
  const session = await requireUser();

  if (session.memberships.length > 0) redirect("/dashboard");
  if (session.pendingMemberships.length > 0) redirect("/wachten");

  if (!hasServiceRole()) {
    return (
      <Alert tone="warning" title="Configuratie nog niet compleet">
        SUPABASE_SERVICE_ROLE_KEY ontbreekt, waardoor organisatieaanvragen nog niet verwerkt kunnen
        worden. Zie de README voor het instellen van de environment variables.
      </Alert>
    );
  }

  const suggestions = (await suggestOrganizationsForEmail(session.email)).map((s) => ({
    id: s.organization.id,
    name: s.organization.name,
    city: s.organization.city,
    reason: s.reason,
  }));

  return <JoinForm suggestions={suggestions} />;
}
