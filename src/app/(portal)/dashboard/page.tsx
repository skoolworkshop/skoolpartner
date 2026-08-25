import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarDays, FileText, MessageSquare } from "lucide-react";

import { PageHeader } from "@/components/portal/page-header";
import { BookingStatusBadge, InvoiceStatusBadge } from "@/components/portal/status-badges";
import { PartnerCard } from "@/components/skoolpartner/partner-card";
import { ExternalButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { requireMember } from "@/lib/auth/session";
import {
  formatDate,
  formatDuration,
  formatEuroCents,
  formatPoints,
  formatShortDate,
  firstName,
  relativeDay,
} from "@/lib/format";
import { nextMilestone } from "@/lib/loyalty/calc";
import { getDashboardData } from "@/lib/portal/queries";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await requireMember();
  const settings = await getSettings();
  const { balance, upcoming, invoices, threads } = await getDashboardData(
    session.activeOrganizationId
  );

  const organizationName = session.activeMembership.organization.name;
  const milestone = settings.loyalty_enabled
    ? nextMilestone(balance.available_points, settings.milestone_step_points)
    : null;
  const nextBooking = upcoming[0];
  const latestInvoice = invoices[0];
  const latestThread = threads[0];

  return (
    <>
      <PageHeader
        eyebrow="Mijn Skool"
        title={`Welkom ${firstName(session.profile?.full_name, session.email)}`}
        description={organizationName}
        action={
          <ExternalButtonLink href={settings.new_booking_cta_url} target="_blank">
            {settings.new_booking_cta_label}
          </ExternalButtonLink>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {settings.loyalty_enabled ? (
          <div className="lg:col-span-2">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <PartnerCard
                organizationName={organizationName}
                memberSince={
                  balance.account_id
                    ? balance.enrolled_at
                    : session.activeMembership.organization.skoolpartner_enrolled_at
                }
                availablePoints={balance.available_points}
                pendingPoints={balance.pending_points}
                pointValueCentsPer100={settings.point_value_cents_per_100}
                programName={settings.program_name}
                pointsName={settings.points_name}
              />

              <Card>
                <CardHeader
                  title="Uw voordeel"
                  action={
                    <Link
                      href="/skoolpartner"
                      className="inline-flex items-center gap-1 text-sm font-semibold text-ink underline underline-offset-4"
                    >
                      Bekijken
                      <ArrowRight aria-hidden className="size-3.5" />
                    </Link>
                  }
                />
                <CardBody className="space-y-4">
                  <dl className="grid grid-cols-2 gap-4">
                    <div>
                      <dt className="text-sm text-muted">Beschikbaar</dt>
                      <dd className="mt-0.5 font-display text-2xl">
                        {formatPoints(balance.available_points)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted">In behandeling</dt>
                      <dd className="mt-0.5 font-display text-2xl text-muted">
                        {formatPoints(balance.pending_points)}
                      </dd>
                    </div>
                  </dl>

                  {balance.reserved_points > 0 ? (
                    <p className="text-sm text-muted">
                      {formatPoints(balance.reserved_points)} {settings.points_name} zijn
                      gereserveerd voor een lopend inwisselverzoek.
                    </p>
                  ) : null}

                  {milestone && milestone.remaining > 0 && balance.available_points > 0 ? (
                    <div>
                      <p className="text-sm text-muted">
                        Nog {formatPoints(milestone.remaining)} {settings.points_name} tot{" "}
                        {formatPoints(milestone.target)}.
                      </p>
                      <div
                        className="mt-2 h-1.5 w-full overflow-hidden rounded-pill bg-surface-3"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={milestone.target}
                        aria-valuenow={balance.available_points}
                        aria-label="Voortgang naar volgende mijlpaal"
                      >
                        <div
                          className="h-full rounded-pill bg-accent"
                          style={{ width: `${Math.round(milestone.progress * 100)}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                </CardBody>
              </Card>
            </div>
          </div>
        ) : null}

        {/* Eerstvolgende boeking */}
        <Card>
          <CardHeader
            title="Eerstvolgende workshop"
            action={
              <Link
                href="/boekingen"
                className="text-sm font-semibold text-ink underline underline-offset-4"
              >
                Alle boekingen
              </Link>
            }
          />
          {nextBooking ? (
            <CardBody className="space-y-2">
              <p className="font-display text-lg">{nextBooking.workshop_name}</p>
              <p className="text-sm text-muted">
                {formatDate(nextBooking.scheduled_date)} · {relativeDay(nextBooking.scheduled_date)}
              </p>
              <p className="text-sm text-muted">
                {nextBooking.workshop_count > 1 ? `${nextBooking.workshop_count} workshops · ` : ""}
                {formatDuration(nextBooking.minutes_per_workshop)}
                {nextBooking.location ? ` · ${nextBooking.location}` : ""}
              </p>
              <BookingStatusBadge status={nextBooking.status} />
            </CardBody>
          ) : (
            <EmptyState
              icon={CalendarDays}
              title="Nog geen workshop gepland"
              description="Zodra een boeking definitief is, ziet u die hier terug."
            />
          )}
        </Card>

        {/* Recente factuur */}
        <Card>
          <CardHeader
            title="Recente factuur"
            action={
              <Link
                href="/facturen"
                className="text-sm font-semibold text-ink underline underline-offset-4"
              >
                Alle facturen
              </Link>
            }
          />
          {latestInvoice ? (
            <CardBody className="space-y-2">
              <p className="font-display text-lg">
                Factuur {latestInvoice.invoice_number ?? "—"}
              </p>
              <p className="text-sm text-muted">
                {formatShortDate(latestInvoice.invoice_date)} ·{" "}
                {formatEuroCents(latestInvoice.total_incl_cents)}
              </p>
              <InvoiceStatusBadge state={latestInvoice.state} />
            </CardBody>
          ) : (
            <EmptyState
              icon={FileText}
              title="Nog geen facturen"
              description="Facturen verschijnen hier zodra ze door Skool Workshop zijn verstuurd."
            />
          )}
        </Card>

        {/* Recente berichten */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recente berichten"
            action={
              <Link
                href="/berichten"
                className="text-sm font-semibold text-ink underline underline-offset-4"
              >
                Naar berichten
              </Link>
            }
          />
          {latestThread ? (
            <ul className="divide-y divide-line-soft">
              {threads.map((thread) => (
                <li key={thread.id}>
                  <Link
                    href={`/berichten/${thread.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-surface-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">
                        {thread.subject ?? "Zonder onderwerp"}
                      </span>
                      <span className="block text-sm text-muted">
                        {thread.message_count} bericht{thread.message_count === 1 ? "" : "en"}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm text-muted">
                      {relativeDay(thread.last_message_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={MessageSquare}
              title="Nog geen berichten"
              description="Zodra er contact is over een boeking, vindt u de e-mailwisseling hier terug."
            />
          )}
        </Card>
      </div>
    </>
  );
}
