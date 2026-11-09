import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/admin/action-form";
import { StatusBadge } from "@/components/admin/inschrijving-badges";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { requireAdmin } from "@/lib/auth/session";
import { listOrganizations } from "@/lib/admin/queries";
import { formatShortDate } from "@/lib/format";
import { getInschrijfdagen } from "@/lib/inschrijving/dagen";
import { aantalMet, woorden } from "@/lib/inschrijving/regels";
import { maakDagAction } from "@/app/admin/inschrijvingen/actions";

export const metadata: Metadata = { title: "Inschrijvingen" };

export default async function InschrijvingenPage() {
  await requireAdmin();
  const [dagen, organisaties] = await Promise.all([getInschrijfdagen(), listOrganizations()]);

  const lopend = dagen.filter((dag) => dag.status === "concept" || dag.status === "open");
  const rest = dagen.filter((dag) => dag.status !== "concept" && dag.status !== "open");

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[30px]">Inschrijvingen</h1>
        <span className="text-sm text-muted">
          {dagen.length} {dagen.length === 1 ? "dag" : "dagen"}
        </span>
      </div>

      <Card className="mb-6">
        <details>
          <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold hover:bg-surface-2">
            Nieuwe inschrijfdag
          </summary>
          <CardBody className="border-t border-line-soft">
            <ActionForm action={maakDagAction} submitLabel="Dag aanmaken">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Organisatie" htmlFor="organization_id" className="sm:col-span-2">
                  <Select id="organization_id" name="organization_id" required defaultValue="">
                    <option value="" disabled>
                      Kies een organisatie
                    </option>
                    {organisaties.map((organisatie) => (
                      <option key={organisatie.id} value={organisatie.id}>
                        {organisatie.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Naam van de dag" htmlFor="name">
                  <Input id="name" name="name" placeholder="Cultuurdag" required />
                </Field>
                <Field label="Datum" htmlFor="event_date">
                  <Input id="event_date" name="event_date" type="date" required />
                </Field>
                <Field label="Locatie" htmlFor="location">
                  <Input id="location" name="location" placeholder="Breda" />
                </Field>
                <Field label="Soort groepen" htmlFor="audience">
                  <Select id="audience" name="audience" defaultValue="school">
                    <option value="school">School, met klassen en leerlingen</option>
                    <option value="organisatie">Organisatie, met teams en deelnemers</option>
                  </Select>
                </Field>
              </div>
            </ActionForm>
          </CardBody>
        </details>
      </Card>

      {dagen.length === 0 ? (
        <EmptyState
          title="Nog geen inschrijfdagen"
          description="Maak een dag aan, zet de rondes en workshops klaar, en open daarna de inschrijving."
        />
      ) : null}

      {[
        { titel: "Lopend", rijen: lopend },
        { titel: "Afgelopen", rijen: rest },
      ].map((blok) =>
        blok.rijen.length === 0 ? null : (
          <section key={blok.titel} className="mb-8">
            <h2 className="mb-3 text-[22px]">
              {blok.titel} ({blok.rijen.length})
            </h2>
            <div className="space-y-3">
              {blok.rijen.map((dag) => {
                const taal = woorden(dag.audience);
                return (
                  <Link key={dag.id} href={`/admin/inschrijvingen/${dag.id}`} className="block">
                    <Card className="transition-colors hover:border-line">
                      <CardHeader
                        title={dag.naam}
                        description={`${dag.organisatieNaam} · ${formatShortDate(dag.datum)}${
                          dag.locatie ? ` · ${dag.locatie}` : ""
                        }`}
                        action={<StatusBadge status={dag.status} />}
                      />
                      <CardBody className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
                        <span>{aantalMet(dag.aantalRondes, "ronde", "rondes")}</span>
                        <span>{aantalMet(dag.aantalWorkshops, "workshop", "workshops")}</span>
                        <span>{aantalMet(dag.aantalGroepen, taal.groep, taal.groepen)}</span>
                        <span>{aantalMet(dag.aantalDeelnemers, taal.deelnemer, taal.deelnemers)}</span>
                      </CardBody>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </section>
        ),
      )}
    </>
  );
}
