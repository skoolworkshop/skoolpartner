import type { Metadata } from "next";

import { ActionForm } from "@/components/admin/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { TaakRegel } from "@/components/admin/tijdlijn-blok";
import { requireAdmin } from "@/lib/auth/session";
import { hasServiceRole } from "@/lib/env";
import { getOpenTaken, type Taak } from "@/lib/crm/tijdlijn";
import { createServiceSupabase } from "@/lib/supabase/server";
import { maakTaakAction } from "@/app/admin/crm/actions";

export const metadata: Metadata = { title: "Taken" };

function Groep({ titel, taken, toon }: { titel: string; taken: Taak[]; toon?: string }) {
  if (taken.length === 0) return null;
  return (
    <Card className="mb-5">
      <CardHeader title={titel} description={toon} />
      <ul>
        {taken.map((taak) => (
          <TaakRegel key={taak.id} taak={taak} toonRelatie />
        ))}
      </ul>
    </Card>
  );
}

export default async function TakenPagina() {
  await requireAdmin();

  if (!hasServiceRole()) {
    return (
      <Alert tone="warning" title="SUPABASE_SERVICE_ROLE_KEY ontbreekt">
        Zonder deze sleutel kan het CRM geen gegevens lezen.
      </Alert>
    );
  }

  const supabase = createServiceSupabase();
  const [taken, { data: beheerders }] = await Promise.all([
    getOpenTaken(),
    supabase.from("profiles").select("id, full_name, email").eq("is_admin", true).order("full_name"),
  ]);

  const beheerderLijst = (beheerders ?? []).map((b) => ({ id: b.id, naam: b.full_name ?? b.email }));

  const teLaat = taken.filter((t) => t.dagenTotVervaldatum !== null && t.dagenTotVervaldatum < 0);
  const vandaag = taken.filter((t) => t.dagenTotVervaldatum === 0);
  const binnenkort = taken.filter(
    (t) => t.dagenTotVervaldatum !== null && t.dagenTotVervaldatum > 0 && t.dagenTotVervaldatum <= 7
  );
  const later = taken.filter((t) => t.dagenTotVervaldatum !== null && t.dagenTotVervaldatum > 7);
  const zonderDatum = taken.filter((t) => t.dagenTotVervaldatum === null);

  return (
    <>
      <h1 className="mb-6 text-[30px]">Taken</h1>

      {taken.length === 0 ? (
        <Card className="mb-5">
          <EmptyState title="Niets open" description="Er staat op dit moment geen enkele taak open." />
        </Card>
      ) : (
        <>
          <Groep titel="Te laat" taken={teLaat} toon="De vervaldatum is voorbij." />
          <Groep titel="Vandaag" taken={vandaag} />
          <Groep titel="Deze week" taken={binnenkort} />
          <Groep titel="Later" taken={later} />
          <Groep titel="Zonder datum" taken={zonderDatum} toon="Geen vervaldatum ingevuld." />
        </>
      )}

      <Card>
        <CardHeader title="Nieuwe taak" description="Zonder relatie mag ook." />
        <CardBody>
          <ActionForm action={maakTaakAction} submitLabel="Taak toevoegen">
            <Field label="Wat moet er gebeuren" htmlFor="taken-title" required showOptional={false}>
              <Input id="taken-title" name="title" required autoComplete="off" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Vervaldatum" htmlFor="taken-dueOn">
                <Input id="taken-dueOn" name="dueOn" type="date" />
              </Field>
              <Field label="Wie pakt het op" htmlFor="taken-ownerId" hint="Leeg laten betekent jijzelf.">
                <Select id="taken-ownerId" name="ownerId" defaultValue="">
                  <option value="">Ikzelf</option>
                  {beheerderLijst.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.naam}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
