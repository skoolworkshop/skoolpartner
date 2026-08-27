import type { Metadata } from "next";
import { PiggyBank } from "lucide-react";

import { PageHeader } from "@/components/portal/page-header";
import { CjpParkingStatusBadge } from "@/components/portal/status-badges";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { requireMember } from "@/lib/auth/session";
import { formatDate, formatEuroCents, formatShortDate } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import {
  getCreditBalance,
  getCreditTransactions,
  getParkingRequests,
  heeftOpenAanvraag,
} from "@/lib/tegoed/queries";
import { CREDIT_TYPE_LABELS, amountFieldValue } from "@/lib/tegoed/regels";
import { ParkingForm } from "./parking-form";

export const metadata: Metadata = { title: "CJP-tegoed parkeren" };

export default async function CjpTegoedPage() {
  const session = await requireMember();
  const settings = await getSettings();
  const organizationId = session.activeOrganizationId;
  const organisatie = session.activeMembership.organization;

  const [saldo, aanvragen, mutaties] = await Promise.all([
    getCreditBalance(organizationId),
    getParkingRequests(organizationId),
    getCreditTransactions(organizationId),
  ]);

  const open = heeftOpenAanvraag(aanvragen);
  const naam = [session.profile?.first_name, session.profile?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  return (
    <>
      <PageHeader
        backHref="/skoolpartner"
        backLabel={`Terug naar ${settings.program_name}`}
        eyebrow="CJP"
        title="CJP-tegoed parkeren"
        description="Houdt u CJP-budget over? Dan kunt u dat bij ons parkeren voor gebruik binnen hetzelfde schooljaar."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Saldo */}
        <Card className="lg:col-span-2">
          <CardHeader title="Uw tegoed bij Skool Workshop" />
          <CardBody>
            <dl className="grid gap-5 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-muted">Nu beschikbaar</dt>
                <dd className="mt-0.5 font-display text-3xl">
                  {formatEuroCents(saldo.available_cents)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Totaal geparkeerd</dt>
                <dd className="mt-0.5 font-display text-xl text-muted">
                  {formatEuroCents(saldo.added_cents)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Al gebruikt</dt>
                <dd className="mt-0.5 font-display text-xl text-muted">
                  {formatEuroCents(saldo.spent_cents)}
                </dd>
              </div>
            </dl>

            <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-muted">
              Dit tegoed is een bedrag in euro&apos;s en staat helemaal los van uw{" "}
              {settings.points_name}. Wij zetten het nooit om naar punten en er zit geen
              onbeperkte looptijd op: u gebruikt het binnen hetzelfde schooljaar. U geeft bij een
              boeking aan dat u het wilt gebruiken, dan verrekenen wij het op de factuur.
            </p>
          </CardBody>
        </Card>

        {/* Aanvragen */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Tegoed parkeren"
            description={
              settings.cjp_parking_enabled
                ? "Vul hieronder in welk bedrag u wilt parkeren. U ziet alles nog een keer op een rij voordat u verstuurt."
                : undefined
            }
          />
          <CardBody>
            {!settings.cjp_parking_enabled ? (
              <Alert tone="info" title="Tijdelijk niet beschikbaar">
                CJP-tegoed parkeren staat op dit moment uit. Wilt u toch budget parkeren? Mail ons
                op {settings.support_email}.
              </Alert>
            ) : open ? (
              <Alert tone="info" title="U heeft al een aanvraag lopen">
                Er staat een aanvraag van {formatEuroCents(open.amount_cents)} open, ingediend op{" "}
                {formatShortDate(open.created_at)}. Zodra wij die hebben verwerkt, kunt u zo nodig
                een nieuwe indienen. Moet er iets aan deze aanvraag veranderen? Mail ons even op{" "}
                {settings.support_email}.
              </Alert>
            ) : (
              <ParkingForm
                prefill={{
                  schoolName: organisatie.name,
                  cjpSchoolNumber: organisatie.cjp_school_number ?? "",
                  holderName: naam || (session.profile?.full_name ?? ""),
                  holderEmail: session.email,
                  holderPhone: session.profile?.phone ?? "",
                  amount: amountFieldValue(null),
                }}
                minimumCents={settings.cjp_minimum_amount_cents}
                bonusEnabled={settings.cjp_bonus_enabled}
                bonusPoints={settings.cjp_bonus_points}
                bonusMinimumCents={settings.cjp_bonus_minimum_amount_cents}
                pointsName={settings.points_name}
                supportEmail={settings.support_email}
              />
            )}
          </CardBody>
        </Card>

        {/* Uw aanvragen */}
        {aanvragen.length > 0 ? (
          <Card className="lg:col-span-2">
            <CardHeader title="Uw aanvragen" />
            <ul className="divide-y divide-line-soft">
              {aanvragen.map((aanvraag) => (
                <li
                  key={aanvraag.id}
                  className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5"
                >
                  <div className="min-w-0">
                    <p className="font-semibold">{formatEuroCents(aanvraag.amount_cents)}</p>
                    <p className="text-sm text-muted">
                      Aangevraagd op {formatShortDate(aanvraag.created_at)} · budgethouder{" "}
                      {aanvraag.holder_name} · CJP-nummer {aanvraag.cjp_school_number}
                    </p>
                    {aanvraag.status === "confirmed" && aanvraag.decided_at ? (
                      <p className="text-sm text-muted">
                        Bevestigd op {formatShortDate(aanvraag.decided_at)}. Het bedrag staat op uw
                        tegoed.
                      </p>
                    ) : null}
                    {aanvraag.status === "rejected" ? (
                      <p className="text-sm text-muted">
                        Er is geen tegoed bijgeschreven.
                        {aanvraag.decision_note ? ` ${aanvraag.decision_note}` : ""}
                      </p>
                    ) : null}
                  </div>
                  <CjpParkingStatusBadge status={aanvraag.status} />
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {/* Historie */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Tegoedhistorie"
            description="Elke bij- en afboeking, met het bedrag dat daarna overbleef."
          />
          {mutaties.length > 0 ? (
            /*
              Bewust een lijst en geen tabel. Op een telefoon zou een tabel met
              vier kolommen zijwaarts moeten schuiven, en dan valt juist het
              bedrag buiten beeld. Dat is precies wat mensen willen zien.
            */
            <ul className="divide-y divide-line-soft">
              {metRestant(mutaties).map((rij) => (
                <li
                  key={rij.id}
                  className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-5 py-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{CREDIT_TYPE_LABELS[rij.type] ?? rij.type}</p>
                    <p className="text-sm text-muted">
                      {formatShortDate(rij.occurred_at)} ·{" "}
                      {rij.bookings
                        ? `${rij.bookings.workshop_name}${
                            rij.bookings.scheduled_date
                              ? `, ${formatDate(rij.bookings.scheduled_date)}`
                              : ""
                          }`
                        : rij.description}
                      {rij.invoice_number ? ` · factuur ${rij.invoice_number}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={`font-display text-lg ${
                        rij.amount_cents > 0 ? "text-success" : "text-muted"
                      }`}
                    >
                      {rij.amount_cents > 0 ? "+" : "−"}
                      {formatEuroCents(Math.abs(rij.amount_cents))}
                    </p>
                    <p className="text-sm text-muted">
                      daarna {formatEuroCents(rij.restant)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={PiggyBank}
              title="Nog geen tegoed"
              description="Zodra wij uw eerste aanvraag hebben bevestigd, ziet u hier precies wat erbij kwam en wat u heeft gebruikt."
            />
          )}
        </Card>
      </div>
    </>
  );
}

/**
 * Het restant na elke regel.
 *
 * De rijen komen nieuw naar oud binnen. Wij tellen daarom van onder naar boven
 * op, en zetten het resultaat terug in dezelfde volgorde.
 */
function metRestant<T extends { id: string; amount_cents: number }>(rijen: T[]): (T & { restant: number })[] {
  let saldo = 0;
  const omgekeerd = [...rijen].reverse().map((rij) => {
    saldo += rij.amount_cents;
    return { ...rij, restant: saldo };
  });
  return omgekeerd.reverse();
}
