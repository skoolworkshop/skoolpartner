import type { Metadata } from "next";

import { Alert } from "@/components/ui/feedback";
import { requireAdmin } from "@/lib/auth/session";
import { hasServiceRole } from "@/lib/env";
import { categorieenUit, filterFragmenten, getFragmenten } from "@/lib/crm/fragmenten";
import { FragmentenScherm } from "@/app/admin/crm/fragmenten/fragmenten-scherm";

export const metadata: Metadata = { title: "Fragmenten" };

export default async function FragmentenPagina({
  searchParams,
}: {
  searchParams: Promise<{ zoek?: string; groep?: string; archief?: string }>;
}) {
  await requireAdmin();

  if (!hasServiceRole()) {
    return (
      <Alert tone="warning" title="SUPABASE_SERVICE_ROLE_KEY ontbreekt">
        Zonder deze sleutel kan het CRM geen gegevens lezen.
      </Alert>
    );
  }

  const { zoek, groep, archief } = await searchParams;
  const toonArchief = archief === "ja";

  // Een keer ophalen, twee keer filteren. De groepen komen uit alles en niet
  // uit wat er na het filter overblijft, want anders verdwijnt de groep waar je
  // net op klikte uit het rijtje.
  const alles = await getFragmenten();
  const fragmenten = filterFragmenten(alles, {
    zoek,
    categorie: groep || undefined,
    metGearchiveerde: toonArchief,
  });

  return (
    <FragmentenScherm
      fragmenten={fragmenten}
      categorieen={categorieenUit(alles)}
      filter={{ zoek, groep }}
      toonArchief={toonArchief}
    />
  );
}
