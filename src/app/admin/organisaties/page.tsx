import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/admin/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { requireAdmin } from "@/lib/auth/session";
import { listOrganizations } from "@/lib/admin/queries";
import { formatShortDate } from "@/lib/format";
import { createOrganizationAction } from "../actions";

export const metadata: Metadata = { title: "Organisaties" };

export default async function AdminOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const { q } = await searchParams;
  const organizations = await listOrganizations(q);

  return (
    <>
      <h1 className="mb-6 text-[30px]">Organisaties</h1>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title={`${organizations.length} organisaties`}
            action={
              <form className="flex gap-2">
                <label htmlFor="q" className="sr-only">
                  Zoeken
                </label>
                <Input id="q" name="q" defaultValue={q ?? ""} placeholder="Zoek op naam" />
              </form>
            }
          />
          <ul className="divide-y divide-line-soft">
            {organizations.map((organization) => (
              <li key={organization.id}>
                <Link
                  href={`/admin/organisaties/${organization.id}`}
                  className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-surface-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{organization.name}</span>
                    <span className="block text-sm text-muted">
                      {organization.city ?? "—"} · {organization.kind}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm text-muted">
                    {organization.skoolpartner_enrolled_at
                      ? `SkoolPartner sinds ${formatShortDate(organization.skoolpartner_enrolled_at)}`
                      : "Geen SkoolPartner"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="h-fit">
          <CardHeader title="Organisatie toevoegen" />
          <CardBody>
            <ActionForm action={createOrganizationAction} submitLabel="Aanmaken">
              <Field label="Naam" htmlFor="name" required>
                <Input id="name" name="name" required placeholder="De Goudse Waarden" />
              </Field>
              <Field label="Plaats" htmlFor="city">
                <Input id="city" name="city" placeholder="Gouda" />
              </Field>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
