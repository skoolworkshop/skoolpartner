import type { Metadata } from "next";

import { Alert } from "@/components/ui/feedback";
import { requireAdmin } from "@/lib/auth/session";
import { hasServiceRole } from "@/lib/env";
import { getDashboard } from "@/lib/crm/dashboard";
import { isPeriodeKey, maakPeriode, parseMerkFilter } from "@/lib/crm/dashboard-berekening";
import { DashboardScherm } from "@/app/admin/crm/dashboard-scherm";

export const metadata: Metadata = { title: "CRM" };

/**
 * Het commerciele dashboard van het CRM.
 *
 * Het merkfilter staat hier bewust in de adresbalk en niet in de merkcookie
 * die de rest van het CRM gebruikt. Twee redenen: op dit scherm wil je ook
 * "Alles" kunnen kiezen, wat op de andere schermen geen zinnige stand is, en
 * een filter dat je hier zet hoort de pijplijn en de contactenlijst niet stil
 * om te gooien. De schermen die de cookie gebruiken blijven dus precies doen
 * wat ze deden.
 */
export default async function CrmPagina({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string; merk?: string; vanaf?: string; tot?: string }>;
}) {
  await requireAdmin();

  if (!hasServiceRole()) {
    return (
      <Alert tone="warning" title="SUPABASE_SERVICE_ROLE_KEY ontbreekt">
        Het CRM leest uitsluitend met de serviceclient, omdat de CRM-tabellen bewust voor geen
        enkele ingelogde gebruiker toegankelijk zijn. Zonder deze sleutel is er dus niets te tonen.
      </Alert>
    );
  }

  const params = await searchParams;
  const vandaag = new Date().toISOString().slice(0, 10);
  const merk = parseMerkFilter(params.merk);
  const periode = maakPeriode(isPeriodeKey(params.periode) ? params.periode : "deze-maand", vandaag, {
    vanaf: params.vanaf ?? null,
    tot: params.tot ?? null,
  });

  const cijfers = await getDashboard(periode, merk, vandaag);

  return (
    <DashboardScherm
      cijfers={cijfers}
      periode={periode}
      merk={merk}
      vandaag={vandaag}
      aangepast={{ vanaf: params.vanaf ?? null, tot: params.tot ?? null }}
    />
  );
}
