import type { Metadata } from "next";

import { Alert } from "@/components/ui/feedback";
import { requireAdmin } from "@/lib/auth/session";
import { hasServiceRole } from "@/lib/env";
import { deelIn, getAlleAfspraken } from "@/lib/crm/afspraken";
import { AfsprakenScherm } from "@/app/admin/crm/afspraken/afspraken-scherm";

export const metadata: Metadata = { title: "Afspraken" };

export default async function AfsprakenPagina() {
  await requireAdmin();

  if (!hasServiceRole()) {
    return (
      <Alert tone="warning" title="SUPABASE_SERVICE_ROLE_KEY ontbreekt">
        Zonder deze sleutel kan het CRM geen gegevens lezen.
      </Alert>
    );
  }

  const afspraken = await getAlleAfspraken();
  const indeling = deelIn(afspraken, new Date().toISOString());

  return (
    <AfsprakenScherm
      achterstallig={indeling.achterstallig}
      komend={indeling.komend}
      geweest={indeling.geweest}
      zonderUitkomst={indeling.zonderUitkomst}
    />
  );
}
