import type { Metadata } from "next";

import { PageHeader } from "@/components/portal/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireMember } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { LeaveOrganizationForm, ProfileForm } from "./account-forms";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const session = await requireMember();
  const settings = await getSettings();

  return (
    <>
      <PageHeader
        title="Account"
        description="Uw gegevens en uw koppeling met de organisatie."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Uw gegevens" />
          <CardBody>
            <ProfileForm
              fullName={session.profile?.full_name ?? ""}
              phone={session.profile?.phone ?? ""}
              jobTitle={session.profile?.job_title ?? ""}
              email={session.email}
            />
          </CardBody>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Uw organisaties" />
            <ul className="divide-y divide-line-soft">
              {session.memberships.map((membership) => (
                <li
                  key={membership.organization.id}
                  className="flex items-center justify-between gap-3 px-5 py-3.5"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {membership.organization.name}
                    </span>
                    <span className="text-sm text-muted">
                      {membership.role === "beheerder" ? "Beheerder" : "Lid"}
                    </span>
                  </span>
                  {membership.organization.id === session.activeOrganizationId ? (
                    <Badge tone="accent">Actief</Badge>
                  ) : null}
                </li>
              ))}
              {session.pendingMemberships.map((pending) => (
                <li
                  key={pending.organizationId}
                  className="flex items-center justify-between gap-3 px-5 py-3.5"
                >
                  <span className="truncate">{pending.organizationName}</span>
                  <Badge tone="warning">In behandeling</Badge>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader
              title="Privacy en gegevens"
              description="Mijn Skool bewaart alleen wat nodig is voor uw boekingen, facturen en communicatie."
            />
            <CardBody className="space-y-5 text-sm text-muted">
              <p>
                Wilt u weten welke gegevens wij van u vastleggen, of wilt u gegevens laten
                verwijderen? Mail dan naar{" "}
                <a
                  className="font-semibold text-ink underline underline-offset-4"
                  href={`mailto:${settings.support_email}`}
                >
                  {settings.support_email}
                </a>
                . Uw SkoolPoints en facturen horen bij uw organisatie en blijven daar bewaard,
                ook als uw persoonlijke account wordt verwijderd.
              </p>

              <div className="border-t border-line-soft pt-5">
                <LeaveOrganizationForm
                  organizationId={session.activeOrganizationId}
                  organizationName={session.activeMembership.organization.name}
                />
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
