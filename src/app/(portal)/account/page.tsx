import type { Metadata } from "next";

import { PageHeader } from "@/components/portal/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/feedback";
import { requireMember } from "@/lib/auth/session";
import { checkProfile, missingLabel } from "@/lib/account";
import { formatPhone } from "@/lib/phone";
import { formatDate } from "@/lib/format";
import { getEnrolledAt } from "@/lib/portal/queries";
import { getSettings } from "@/lib/settings";
import { LeaveOrganizationForm, ProfileForm } from "./account-forms";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const session = await requireMember();
  const settings = await getSettings();

  const enrolledAt = await getEnrolledAt(session.activeOrganizationId);

  // Het inlogadres uit Supabase Auth is leidend, niet het veld in profiles.
  const status = checkProfile({
    full_name: session.profile?.full_name ?? null,
    phone: session.profile?.phone ?? null,
    email: session.email,
  });

  return (
    <>
      <PageHeader
        backHref="/dashboard"
        backLabel="Terug naar dashboard"
        eyebrow="Uw gegevens"
        title="Account"
        description="Uw gegevens en uw koppeling met de organisatie."
      />

      {!status.complete ? (
        <Alert tone="warning" title="Maak uw account compleet" className="mb-5">
          Wij missen nog {missingLabel(status.missing)}. Uw naam en telefoonnummer vult u hieronder
          zelf aan. Klopt uw e-mailadres niet? Mail ons op {settings.support_email}, want dat adres
          is ook uw inlogadres.
        </Alert>
      ) : null}

      {enrolledAt ? (
        <Card className="mb-5">
          <CardBody className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge tone="success">SkoolPartner actief</Badge>
            <p className="text-[15px]">
              Actief sinds <strong>{formatDate(enrolledAt)}</strong>
            </p>
            <p className="w-full text-sm text-muted">
              U spaart SkoolPoints op kwalificerende nieuwe workshopboekingen vanaf het moment dat
              uw SkoolPartner-account is geactiveerd. Boekingen en facturen van vóór uw deelname
              tellen niet mee.
            </p>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Uw gegevens" />
          <CardBody>
            <ProfileForm
              fullName={session.profile?.full_name ?? ""}
              phone={formatPhone(session.profile?.phone)}
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
              description="SkoolPartner bewaart alleen wat nodig is voor uw boekingen, facturen en communicatie."
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
