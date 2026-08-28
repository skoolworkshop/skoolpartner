import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { requireAdmin } from "@/lib/auth/session";
import { listOrganizations, listUnverifiedOrganizations } from "@/lib/admin/queries";
import { formatShortDate } from "@/lib/format";
import { verifyOrganizationAction } from "../actions";

export const metadata: Metadata = { title: "Organisaties" };

export default async function AdminOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const { q } = await searchParams;
  const [organizations, unverified] = await Promise.all([
    listOrganizations(q),
    listUnverifiedOrganizations(),
  ]);

  return (
    <>
      <h1 className="mb-6 text-[30px]">Organisaties</h1>

      {unverified.length > 0 ? (
        <Card className="mb-5 border-accent/40">
          <CardHeader
            title={`${unverified.length} nieuw aangemeld`}
            description="Deze scholen hebben zich zelf aangemeld. Koppel ze aan uw dossier en zet ze daarna op gecontroleerd. Zolang dat niet is gebeurd, zien zij een lege omgeving met de melding dat u nog bezig bent."
          />
          <ul className="divide-y divide-line-soft">
            {unverified.map((organization) => (
              <li
                key={organization.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
              >
                <span className="min-w-0">
                  <Link
                    href={`/admin/organisaties/${organization.id}`}
                    className="block truncate font-semibold underline underline-offset-4"
                  >
                    {organization.name}
                  </Link>
                  <span className="block text-sm text-muted">
                    {organization.city ?? "geen plaats opgegeven"} ·{" "}
                    {organization.contact_email ?? "geen contactadres"} · aangemeld{" "}
                    {formatShortDate(organization.created_at)}
                  </span>
                </span>
                <ActionForm
                  action={verifyOrganizationAction}
                  submitLabel="Gecontroleerd"
                  variant="secondary"
                  inline
                >
                  <input type="hidden" name="organization_id" value={organization.id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title={`${organizations.length} organisaties`}
          description="Nieuwe organisaties verschijnen hier nadat een klant zichzelf heeft geregistreerd."
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
                  <span className="block truncate font-semibold">
                    {organization.name}
                    {organization.verified_at === null ? (
                      <Badge tone="warning" className="ml-2">
                        Nieuw
                      </Badge>
                    ) : null}
                  </span>
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
    </>
  );
}
