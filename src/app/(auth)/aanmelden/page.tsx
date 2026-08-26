import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { hasServiceRole } from "@/lib/env";
import { suggestOrganizationsForEmail } from "@/lib/organizations/service";
import { Alert } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
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

  return (
    <div className="space-y-6">
      <JoinForm suggestions={suggestions} />

      {/* Wie ben ik nu? Handig bij meerdere accounts, en de enige uitweg op
          deze pagina als je met het verkeerde adres bent ingelogd. */}
      <div className="flex flex-wrap items-center gap-3 border-t border-line-soft pt-5 text-sm text-muted">
        <span>
          Ingelogd als <strong className="text-ink">{session.email}</strong>
        </span>
        <form action="/auth/uitloggen" method="post">
          <Button type="submit" variant="ghost" size="sm">
            Uitloggen
          </Button>
        </form>
      </div>
    </div>
  );
}
