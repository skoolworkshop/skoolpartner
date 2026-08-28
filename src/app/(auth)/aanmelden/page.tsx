import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { hasServiceRole } from "@/lib/env";
import { suggestOrganizationsForEmail } from "@/lib/organizations/service";
import { Alert } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { RegistrationForm } from "./registration-form";

export const metadata: Metadata = { title: "Registratie afronden" };

export default async function JoinPage() {
  const session = await requireUser();

  if (session.memberships.length > 0) redirect("/dashboard");
  if (session.isAdmin) redirect("/admin");
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
    kind: s.organization.kind,
    street: s.organization.street,
    houseNumber: s.organization.house_number,
    houseNumberAddition: s.organization.house_number_addition,
    postalCode: s.organization.postal_code,
  }));

  // Wat wij al weten vullen wij vast in. Meestal is dat alleen de naam die
  // iemand bij het aanmaken van het account heeft opgegeven.
  const profiel = session.profile;
  const naam = (profiel?.full_name ?? "").trim();
  const spatie = naam.indexOf(" ");

  return (
    <div className="space-y-6">
      <RegistrationForm
        email={session.email}
        suggestions={suggestions}
        prefill={{
          firstName: profiel?.first_name ?? (spatie > 0 ? naam.slice(0, spatie) : naam),
          lastName: profiel?.last_name ?? (spatie > 0 ? naam.slice(spatie + 1) : ""),
          jobTitle: profiel?.job_title ?? "",
          phone: profiel?.phone ?? "",
        }}
      />

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
