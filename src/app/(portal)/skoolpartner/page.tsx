import type { Metadata } from "next";
import { Sparkles } from "lucide-react";

import { PageHeader } from "@/components/portal/page-header";
import {
  LoyaltyStatusBadge,
  RedemptionStatusBadge,
} from "@/components/portal/status-badges";
import { PartnerCard } from "@/components/skoolpartner/partner-card";
import { ExternalButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { requireMember } from "@/lib/auth/session";
import { formatEuroCents, formatPoints, formatShortDate } from "@/lib/format";
import { pointsToCents } from "@/lib/loyalty/calc";
import {
  getLoyaltyBalance,
  getLoyaltyTransactions,
  getRedemptionRequests,
} from "@/lib/portal/queries";
import { getSettings } from "@/lib/settings";
import { RedeemForm } from "./redeem-form";

export const metadata: Metadata = { title: "SkoolPartner" };

export default async function SkoolPartnerPage() {
  const session = await requireMember();
  const settings = await getSettings();
  const organizationId = session.activeOrganizationId;

  const [balance, transactions, redemptions] = await Promise.all([
    getLoyaltyBalance(organizationId),
    getLoyaltyTransactions(organizationId),
    getRedemptionRequests(organizationId),
  ]);

  const organizationName = session.activeMembership.organization.name;
  const openRedemptions = redemptions.filter((r) => r.status === "requested" || r.status === "approved");

  if (!settings.loyalty_enabled) {
    return (
      <>
        <PageHeader title={settings.program_name} />
        <Alert tone="info" title="Tijdelijk niet beschikbaar">
          {settings.program_name} is op dit moment niet actief. Uw {settings.points_name} blijven
          bewaard.
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={settings.program_name}
        description={settings.how_it_works_text || undefined}
        action={
          <ExternalButtonLink href={settings.new_booking_cta_url} target="_blank">
            {settings.new_booking_cta_label}
          </ExternalButtonLink>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <PartnerCard
          organizationName={organizationName}
          memberSince={balance.enrolled_at}
          availablePoints={balance.available_points}
          pendingPoints={balance.pending_points}
          pointValueCentsPer100={settings.point_value_cents_per_100}
          programName={settings.program_name}
          pointsName={settings.points_name}
        />

        <Card>
          <CardHeader title={`Uw ${settings.points_name}`} />
          <CardBody>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
              <div>
                <dt className="text-sm text-muted">Beschikbaar</dt>
                <dd className="mt-0.5 font-display text-2xl">
                  {formatPoints(balance.available_points)}
                </dd>
                <dd className="text-sm text-muted">
                  {formatEuroCents(
                    pointsToCents(balance.available_points, settings.point_value_cents_per_100)
                  )}{" "}
                  Skool Voordeel
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">In behandeling</dt>
                <dd className="mt-0.5 font-display text-2xl text-muted">
                  {formatPoints(balance.pending_points)}
                </dd>
                <dd className="text-sm text-muted">Beschikbaar na betaling van de factuur</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Gereserveerd</dt>
                <dd className="mt-0.5 font-display text-xl text-muted">
                  {formatPoints(balance.reserved_points)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Totaal gespaard</dt>
                <dd className="mt-0.5 font-display text-xl text-muted">
                  {formatPoints(balance.lifetime_earned_points)}
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        {/* Inwisselen */}
        <Card className="lg:col-span-2">
          <CardHeader
            title={`${settings.points_name} gebruiken`}
            description={`Geef aan hoeveel punten u wilt inzetten. Wij verwerken het voordeel op uw volgende boeking via ${settings.support_email}.`}
          />
          <CardBody className="space-y-5">
            {openRedemptions.length > 0 ? (
              <Alert tone="info" title="U heeft een lopend verzoek">
                Er staat een verzoek van {formatPoints(openRedemptions[0].points)}{" "}
                {settings.points_name} open. Die punten zijn zolang gereserveerd.
              </Alert>
            ) : null}

            <RedeemForm
              availablePoints={balance.available_points}
              minimumPoints={settings.redemption_minimum_points}
              maximumPoints={settings.redemption_maximum_points_per_booking}
              pointValueCentsPer100={settings.point_value_cents_per_100}
              pointsName={settings.points_name}
            />
          </CardBody>
        </Card>

        {/* Verzoeken */}
        {redemptions.length > 0 ? (
          <Card className="lg:col-span-2">
            <CardHeader title="Uw inwisselverzoeken" />
            <ul className="divide-y divide-line-soft">
              {redemptions.map((request) => (
                <li
                  key={request.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
                >
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {formatPoints(request.points)} {settings.points_name} ·{" "}
                      {formatEuroCents(request.value_cents)}
                    </p>
                    <p className="text-sm text-muted">
                      {formatShortDate(request.created_at)}
                      {request.booking_reference ? ` · ${request.booking_reference}` : ""}
                    </p>
                  </div>
                  <RedemptionStatusBadge status={request.status} />
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {/* Historie */}
        <Card className="lg:col-span-2">
          <CardHeader title="Puntenhistorie" />
          {transactions.length > 0 ? (
            <ul className="divide-y divide-line-soft">
              {transactions.map((transaction) => {
                const positive = transaction.points > 0;
                return (
                  <li
                    key={transaction.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <span
                        className={`w-20 shrink-0 font-display text-lg ${
                          positive ? "text-success" : "text-muted"
                        }`}
                      >
                        {positive ? "+" : "−"}
                        {formatPoints(Math.abs(transaction.points))}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {transaction.description}
                        </span>
                        <span className="block text-sm text-muted">
                          {formatShortDate(transaction.occurred_at)} ·{" "}
                          {formatEuroCents(
                            pointsToCents(
                              Math.abs(transaction.points),
                              transaction.point_value_cents_per_100
                            )
                          )}
                        </span>
                      </span>
                    </div>
                    <LoyaltyStatusBadge status={transaction.status} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={Sparkles}
              title={`Nog geen ${settings.points_name}`}
              description="Zodra uw eerste workshop is bevestigd, ziet u hier hoeveel punten u heeft verdiend."
              action={
                <ExternalButtonLink href={settings.new_booking_cta_url} target="_blank">
                  {settings.new_booking_cta_label}
                </ExternalButtonLink>
              }
            />
          )}
        </Card>

        {/* Spelregels */}
        <Card className="lg:col-span-2">
          <CardHeader title="Spelregels" />
          <CardBody>
            <div className="max-w-2xl space-y-4 text-[15px] leading-relaxed text-muted">
              {settings.rules_text
                .split("\n")
                .filter((line) => line.trim().length > 0)
                .map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
