import type { Metadata } from "next";

import { Alert } from "@/components/ui/feedback";
import { requireAdmin } from "@/lib/auth/session";
import { hasServiceRole } from "@/lib/env";
import { getActiefMerk } from "@/lib/crm/actief-merk";
import { getCijfers, getFases } from "@/lib/crm/queries";
import { CrmOverzicht } from "@/app/admin/crm/crm-overzicht";

export const metadata: Metadata = { title: "CRM" };

export default async function CrmPagina() {
  await requireAdmin();

  if (!hasServiceRole()) {
    return (
      <Alert tone="warning" title="SUPABASE_SERVICE_ROLE_KEY ontbreekt">
        Het CRM leest uitsluitend met de serviceclient, omdat de CRM-tabellen bewust voor geen
        enkele ingelogde gebruiker toegankelijk zijn. Zonder deze sleutel is er dus niets te tonen.
      </Alert>
    );
  }

  const merk = await getActiefMerk();
  const [fases, cijfers] = await Promise.all([getFases(merk), getCijfers(merk)]);

  return <CrmOverzicht merk={merk} fases={fases} cijfers={cijfers} />;
}
