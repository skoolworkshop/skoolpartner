import type { Metadata } from "next";

import { Alert } from "@/components/ui/feedback";
import { requireAdmin } from "@/lib/auth/session";
import { hasServiceRole } from "@/lib/env";
import { agendaStand, getBoekingsLinks } from "@/lib/crm/boekingslinks";
import { AGENDA_UITLEG } from "@/lib/integrations/google/calendar";
import { createServiceSupabase } from "@/lib/supabase/server";
import { resolveSiteUrl } from "@/lib/site-url";
import { BoekingsLinksScherm } from "@/app/admin/crm/boekingslinks/boekingslinks-scherm";

export const metadata: Metadata = { title: "Boekingslinks" };

export default async function BoekingsLinksPagina() {
  await requireAdmin();

  if (!hasServiceRole()) {
    return (
      <Alert tone="warning" title="SUPABASE_SERVICE_ROLE_KEY ontbreekt">
        Zonder deze sleutel kan het CRM geen gegevens lezen.
      </Alert>
    );
  }

  const supabase = createServiceSupabase();
  const [links, { data: beheerders }, siteUrl, stand] = await Promise.all([
    getBoekingsLinks(),
    supabase.from("profiles").select("id, full_name, email").eq("is_admin", true).order("full_name"),
    resolveSiteUrl(),
    agendaStand(),
  ]);

  return (
    <BoekingsLinksScherm
      links={links}
      beheerders={(beheerders ?? []).map((b) => ({ id: b.id, naam: b.full_name ?? b.email }))}
      siteUrl={siteUrl}
      agendaWaarschuwing={stand.beschikbaar ? null : AGENDA_UITLEG[stand.reden]}
    />
  );
}
