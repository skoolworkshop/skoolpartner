import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/admin/action-form";
import { Card, CardBody } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { MerkSchakelaar } from "@/components/admin/merk-schakelaar";
import { requireAdmin } from "@/lib/auth/session";
import { hasServiceRole } from "@/lib/env";
import { getActiefMerk } from "@/lib/crm/actief-merk";
import { getSequences } from "@/lib/crm/sequences";
import { createServiceSupabase } from "@/lib/supabase/server";
import { bewaarSequenceAction } from "@/app/admin/crm/actions";

export const metadata: Metadata = { title: "Sequences" };

export default async function SequencesPagina() {
  await requireAdmin();
  const merk = await getActiefMerk();

  if (!hasServiceRole()) {
    return (
      <Alert tone="warning" title="SUPABASE_SERVICE_ROLE_KEY ontbreekt">
        Zonder deze sleutel kan het CRM geen gegevens lezen.
      </Alert>
    );
  }

  const supabase = createServiceSupabase();
  const [reeksen, { data: beheerders }] = await Promise.all([
    getSequences(merk),
    supabase.from("profiles").select("id, full_name, email").eq("is_admin", true).order("full_name"),
  ]);

  const actief = reeksen.filter((r) => r.isActive);
  const uit = reeksen.filter((r) => !r.isActive);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[30px]">Sequences</h1>
        <MerkSchakelaar actief={merk} />
      </div>

      {/*
        Deze ene zin blijft staan. Hij gaat niet over hoe het scherm werkt maar
        over wat het systeem wel en niet doet, en dat is precies het soort ding
        dat iemand moet weten voordat hij mensen in een reeks zet.
      */}
      <Alert tone="info" className="mb-5">
        Een reeks zet klaar wat er moet gebeuren en verstuurt zelf niets. Jij drukt op verzenden.
      </Alert>

      {reeksen.length === 0 ? (
        <Card>
          <EmptyState
            title="Nog geen reeksen"
            description="Een reeks is een rij stappen: een mail, een paar dagen wachten, nog een mail, een belafspraak."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {[
            { titel: "Actief", lijst: actief },
            { titel: "Uit", lijst: uit },
          ]
            .filter((groep) => groep.lijst.length > 0)
            .map((groep) => (
              <Card key={groep.titel}>
                <p className="border-b border-line-soft bg-surface-2 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  {groep.titel} ({groep.lijst.length})
                </p>
                <ul>
                  {groep.lijst.map((reeks) => (
                    <li key={reeks.id} className="border-b border-line-soft last:border-b-0">
                      <Link
                        href={`/admin/crm/sequences/${reeks.id}`}
                        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3.5 hover:bg-surface-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-ink">{reeks.name}</span>
                          <span className="block truncate text-sm text-muted">
                            {reeks.stappen.length} {reeks.stappen.length === 1 ? "stap" : "stappen"}
                            {reeks.senderNaam ? ` · afzender ${reeks.senderNaam}` : " · geen afzender"}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm tabular-nums text-muted">
                          {reeks.aantalActief} lopend · {reeks.aantalAfgerond} afgerond
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
        </div>
      )}

      <details className="mt-5 rounded-card border border-line-soft bg-white shadow-card">
        <summary className="cursor-pointer px-5 py-4 font-display text-base font-semibold">
          Nieuwe reeks
        </summary>
        <CardBody className="pt-0">
          <ActionForm action={bewaarSequenceAction} submitLabel="Reeks aanmaken">
            <input type="hidden" name="brand" value={merk} />
            <Field label="Naam" htmlFor="reeks-naam" required showOptional={false}>
              <Input id="reeks-naam" name="name" required autoComplete="off" placeholder="Offerte opvolgen" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Afzender" htmlFor="reeks-afzender" hint="Vanaf wie de berichten gaan.">
                <Select id="reeks-afzender" name="senderId" defaultValue="">
                  <option value="">Nog niet gekozen</option>
                  {(beheerders ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.full_name ?? b.email}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Meteen aanzetten" htmlFor="reeks-actief">
                <Select id="reeks-actief" name="isActive" defaultValue="nee">
                  <option value="nee">Nee, eerst stappen toevoegen</option>
                  <option value="ja">Ja</option>
                </Select>
              </Field>
            </div>
            <Field label="Waar is deze reeks voor" htmlFor="reeks-omschrijving">
              <Textarea id="reeks-omschrijving" name="description" rows={2} />
            </Field>
          </ActionForm>
        </CardBody>
      </details>
    </>
  );
}
