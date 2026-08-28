import type { Metadata } from "next";

import { OrgLogo } from "@/components/portal/org-logo";
import { PageHeader } from "@/components/portal/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { requireMember } from "@/lib/auth/session";
import { checkProfile, missingLabel } from "@/lib/account";
import { formatPhone } from "@/lib/phone";
import { formatDate, formatEuroCents } from "@/lib/format";
import { getEnrolledAt, getOrganizationDetails } from "@/lib/portal/queries";
import { getSettings } from "@/lib/settings";
import { getCreditBalance } from "@/lib/tegoed/queries";
import { LeaveOrganizationForm, ProfileForm } from "./account-forms";
import { OrganisatieGegevens } from "./organisatie-form";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const session = await requireMember();
  const settings = await getSettings();

  const [enrolledAt, organisatie, tegoed] = await Promise.all([
    getEnrolledAt(session.activeOrganizationId),
    getOrganizationDetails(session.activeOrganizationId),
    getCreditBalance(session.activeOrganizationId),
  ]);

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
          zelf aan. Ook uw inlogadres kunt u veilig hieronder wijzigen; het nieuwe adres moet eerst
          via e-mail worden bevestigd.
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

      {/*
        Het CJP-tegoed hoort bij het account, want het is geld van de school
        dat bij ons staat. Wij tonen hier het saldo en de laatste beweging; de
        volledige historie staat op de tegoedpagina zelf.
      */}
      {tegoed.available_cents > 0 || tegoed.added_cents > 0 ? (
        <Card className="mb-5">
          <CardBody className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div>
              <p className="text-sm text-muted">CJP-tegoed bij Skool Workshop</p>
              <p className="mt-0.5 font-display text-2xl">
                {formatEuroCents(tegoed.available_cents)}
              </p>
              <p className="text-sm text-muted">
                Van {formatEuroCents(tegoed.added_cents)} geparkeerd is{" "}
                {formatEuroCents(tegoed.spent_cents)} gebruikt. Dit is een bedrag in euro&apos;s en
                staat los van uw {settings.points_name}.
              </p>
            </div>
            <ButtonLink href="/skoolpartner/cjp-tegoed" variant="secondary">
              Tegoed en historie bekijken
            </ButtonLink>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Uw gegevens" />
          <CardBody>
            <ProfileForm
              firstName={session.profile?.first_name ?? (session.profile?.full_name?.split(" ")[0] ?? "")}
              lastName={session.profile?.last_name ?? (session.profile?.full_name?.split(" ").slice(1).join(" ") ?? "")}
              phone={formatPhone(session.profile?.phone)}
              jobTitle={session.profile?.job_title ?? ""}
              email={session.email}
            />
          </CardBody>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Organisatiegegevens"
              description="De schoolgegevens zijn gedeeld. Uw CJP-nummer hieronder is persoonlijk en wordt niet met collega's samengevoegd."
            />
            <CardBody>
              <OrganisatieGegevens
                organizationName={organisatie.name}
                logoUrl={organisatie.logo_url}
                logoSource={organisatie.logo_source}
                website={organisatie.website}
                cjpNumber={session.profile?.cjp_school_number ?? organisatie.cjp_school_number}
                hasCjp={session.profile?.has_cjp ?? organisatie.has_cjp}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Uw organisaties" />
            <ul className="divide-y divide-line-soft">
              {session.memberships.map((membership) => (
                <li
                  key={membership.organization.id}
                  className="flex items-center justify-between gap-3 px-5 py-3.5"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <OrgLogo
                      name={membership.organization.name}
                      logoUrl={membership.organization.logo_url}
                      size={22}
                    />
                    <span className="truncate font-semibold">{membership.organization.name}</span>
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
