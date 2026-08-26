import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ActionForm } from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { BookingStatusBadge, InvoiceStatusBadge } from "@/components/portal/status-badges";
import { requireAdmin } from "@/lib/auth/session";
import { getOrganizationDetail } from "@/lib/admin/queries";
import { visibilityLabel } from "@/lib/messaging/visibility";
import { formatEuroCents, formatPoints, formatShortDate } from "@/lib/format";
import { pointsToCents } from "@/lib/loyalty/calc";
import { getSettings } from "@/lib/settings";
import {
  addMemberByEmailAction,
  addOrganizationDomainAction,
  deleteOrganizationAction,
  inviteMemberAction,
  manualAdjustmentAction,
} from "../../actions";

export const metadata: Metadata = { title: "Organisatie" };

interface MemberRow {
  id: string;
  role: string;
  status: string;
  profiles: { email: string; full_name: string | null } | null;
}

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAdmin();
  const { id } = await params;
  const detail = await getOrganizationDetail(id);
  if (!detail) notFound();

  const settings = await getSettings();
  const members = detail.members as unknown as MemberRow[];
  const balance = detail.balance;

  return (
    <>
      <Link
        href="/admin/organisaties"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Terug naar organisaties
      </Link>

      <h1 className="mb-1 text-[30px]">{detail.organization.name}</h1>
      <p className="mb-6 text-[15px] text-muted">
        {detail.organization.city ?? "—"} · {detail.organization.kind} ·{" "}
        {detail.organization.skoolpartner_enrolled_at
          ? `SkoolPartner sinds ${formatShortDate(detail.organization.skoolpartner_enrolled_at)}`
          : "neemt nog niet deel aan SkoolPartner"}
      </p>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="SkoolPoints" />
          <CardBody>
            {balance ? (
              <dl className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm text-muted">Beschikbaar</dt>
                  <dd className="font-display text-2xl">
                    {formatPoints(balance.available_points)}
                  </dd>
                  <dd className="text-sm text-muted">
                    {formatEuroCents(
                      pointsToCents(balance.available_points, settings.point_value_cents_per_100)
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted">In behandeling</dt>
                  <dd className="font-display text-2xl text-muted">
                    {formatPoints(balance.pending_points)}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted">Gereserveerd</dt>
                  <dd className="font-display text-xl text-muted">
                    {formatPoints(balance.reserved_points)}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted">Totaal gespaard</dt>
                  <dd className="font-display text-xl text-muted">
                    {formatPoints(balance.lifetime_earned_points)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted">
                Deze organisatie heeft nog geen SkoolPartner-account. Dat wordt automatisch
                aangemaakt zodra u het eerste lidmaatschap goedkeurt.
              </p>
            )}

            <div className="mt-5 border-t border-line-soft pt-5">
              <p className="mb-3 text-sm font-semibold">Handmatige correctie</p>
              <ActionForm action={manualAdjustmentAction} submitLabel="Correctie vastleggen">
                <input type="hidden" name="organization_id" value={detail.organization.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Punten (mag negatief)" htmlFor="points" required>
                    <Input id="points" name="points" type="number" step={1} required />
                  </Field>
                  <Field label="Omschrijving" htmlFor="description">
                    <Input id="description" name="description" placeholder="Correctie boeking maart" />
                  </Field>
                </div>
                <Field label="Reden" htmlFor="reason" required hint="Wordt vastgelegd in het audit log.">
                  <Input id="reason" name="reason" required minLength={3} />
                </Field>
              </ActionForm>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Gebruikers" />
          <ul className="divide-y divide-line-soft">
            {members.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {member.profiles?.full_name ?? member.profiles?.email}
                  </span>
                  <span className="block text-sm text-muted">{member.profiles?.email}</span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <Badge tone={member.role === "beheerder" ? "info" : "neutral"}>
                    {member.role}
                  </Badge>
                  <Badge
                    tone={
                      member.status === "active"
                        ? "success"
                        : member.status === "pending"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {member.status}
                  </Badge>
                </span>
              </li>
            ))}
            {members.length === 0 ? (
              <li className="px-5 py-4 text-sm text-muted">Nog geen gebruikers gekoppeld.</li>
            ) : null}
          </ul>
          <CardBody className="border-t border-line-soft">
            <p className="mb-3 text-sm font-semibold">Gebruiker uitnodigen</p>
            <ActionForm action={inviteMemberAction} submitLabel="Uitnodiging aanmaken">
              <input type="hidden" name="organization_id" value={detail.organization.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="E-mailadres" htmlFor="invite-email" required>
                  <Input id="invite-email" name="email" type="email" required />
                </Field>
                <Field label="Rol" htmlFor="invite-role">
                  <Select id="invite-role" name="role" defaultValue="lid">
                    <option value="lid">Lid</option>
                    <option value="beheerder">Beheerder</option>
                  </Select>
                </Field>
              </div>
            </ActionForm>

            <p className="mb-3 mt-6 text-sm font-semibold">
              Bestaand account direct toevoegen
            </p>
            <p className="mb-3 text-sm text-muted">
              Heeft deze persoon al een account in SkoolPartner? Dan hoeft er geen uitnodiging
              heen: voeg het adres hier toe en de toegang staat meteen open.
            </p>
            <ActionForm action={addMemberByEmailAction} submitLabel="Direct toevoegen">
              <input type="hidden" name="organization_id" value={detail.organization.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="E-mailadres" htmlFor="direct-email" required>
                  <Input id="direct-email" name="email" type="email" required />
                </Field>
                <Field label="Rol" htmlFor="direct-role">
                  <Select id="direct-role" name="role" defaultValue="lid">
                    <option value="lid">Lid</option>
                    <option value="beheerder">Beheerder</option>
                  </Select>
                </Field>
              </div>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Domeinen"
            description="Alleen geverifieerde, niet-publieke domeinen worden gebruikt om boekingen en gebruikers te herkennen."
          />
          <ul className="divide-y divide-line-soft">
            {detail.domains.map((domain) => (
              <li key={domain.id} className="flex items-center justify-between px-5 py-3">
                <span className="font-mono text-sm">{domain.domain}</span>
                <Badge tone={domain.is_verified ? "success" : "warning"}>
                  {domain.is_verified ? "Geverifieerd" : "Niet geverifieerd"}
                </Badge>
              </li>
            ))}
            {detail.domains.length === 0 ? (
              <li className="px-5 py-4 text-sm text-muted">Nog geen domeinen.</li>
            ) : null}
          </ul>
          <CardBody className="border-t border-line-soft">
            <ActionForm action={addOrganizationDomainAction} submitLabel="Domein toevoegen" inline>
              <input type="hidden" name="organization_id" value={detail.organization.id} />
              <Field label="Domein" htmlFor="domain" className="min-w-56 flex-1">
                <Input id="domain" name="domain" placeholder="goudsewaarden.nl" required />
              </Field>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Geverifieerde contactpersonen" description="Bepaalt welke e-mailthreads zichtbaar zijn." />
          <ul className="divide-y divide-line-soft">
            {detail.contacts.map((contact) => (
              <li key={contact.id} className="flex items-center justify-between px-5 py-3">
                <span className="truncate text-sm">{contact.email}</span>
                <Badge tone={contact.is_verified ? "success" : "neutral"}>
                  {contact.is_verified ? "Geverifieerd" : "Niet actief"}
                </Badge>
              </li>
            ))}
            {detail.contacts.length === 0 ? (
              <li className="px-5 py-4 text-sm text-muted">Nog geen contactpersonen.</li>
            ) : null}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Boekingen" />
          <ul className="divide-y divide-line-soft">
            {detail.bookings.map((booking) => (
              <li key={booking.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{booking.workshop_name}</span>
                  <span className="block text-sm text-muted">
                    {formatShortDate(booking.scheduled_date)} · {booking.workshop_count} ×{" "}
                    {booking.minutes_per_workshop} min
                  </span>
                </span>
                <BookingStatusBadge status={booking.status} />
              </li>
            ))}
            {detail.bookings.length === 0 ? (
              <li className="px-5 py-4 text-sm text-muted">Nog geen boekingen.</li>
            ) : null}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Facturen" />
          <ul className="divide-y divide-line-soft">
            {detail.invoices.map((invoice) => (
              <li key={invoice.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {invoice.invoice_number ?? "(concept)"}
                  </span>
                  <span className="block text-sm text-muted">
                    {formatShortDate(invoice.invoice_date)} ·{" "}
                    {formatEuroCents(invoice.total_incl_cents)}
                  </span>
                </span>
                <InvoiceStatusBadge state={invoice.state} />
              </li>
            ))}
            {detail.invoices.length === 0 ? (
              <li className="px-5 py-4 text-sm text-muted">Nog geen facturen.</li>
            ) : null}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title="Berichten"
            description="Alle e-mailgesprekken van deze organisatie, ook de gesprekken die de klant zelf niet ziet."
          />
          <ul className="divide-y divide-line-soft">
            {detail.threads.map((thread) => (
              <li key={thread.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="min-w-0">
                  <Link
                    href={`/admin/berichten/${thread.id}`}
                    className="block truncate font-medium underline underline-offset-4"
                  >
                    {thread.subject ?? "Zonder onderwerp"}
                  </Link>
                  <span className="block text-sm text-muted">
                    {formatShortDate(thread.last_message_at)} · {thread.message_count}{" "}
                    {thread.message_count === 1 ? "bericht" : "berichten"}
                  </span>
                </span>
                <Badge tone={visibilityLabel(thread.visibility).tone}>
                  {visibilityLabel(thread.visibility).short}
                </Badge>
              </li>
            ))}
            {detail.threads.length === 0 ? (
              <li className="px-5 py-4 text-sm text-muted">Nog geen berichten.</li>
            ) : null}
          </ul>
        </Card>

        {session.profile?.is_super_admin ? (
          <Card className="lg:col-span-2 border-danger/40">
            <CardHeader
              title="Organisatie definitief verwijderen"
              description="Onomkeerbaar. Alles van deze organisatie verdwijnt uit de database: boekingen, facturen, factuurregels, SkoolPoints, inwisselverzoeken, reviews, berichten en resultaten, inclusief de bestanden in de opslag. De accounts van de medewerkers blijven bestaan, alleen hun lidmaatschap verdwijnt."
            />
            <CardBody className="space-y-4">
              <Alert tone="warning" title="Denk aan uw administratieplicht">
                Facturen moet u zeven jaar bewaren. Zorg dat de administratie in Moneybird op orde
                is voordat u dit doet, want deze kopieën in SkoolPartner zijn daarna weg.
              </Alert>

              <ActionForm
                action={deleteOrganizationAction}
                submitLabel="Definitief verwijderen"
                variant="danger"
              >
                <input type="hidden" name="organization_id" value={detail.organization.id} />
                <input type="hidden" name="verwacht" value={detail.organization.name} />
                <Field
                  label={`Typ ter bevestiging de naam over: ${detail.organization.name}`}
                  htmlFor="bevestig-organisatie"
                >
                  <Input
                    id="bevestig-organisatie"
                    name="bevestiging"
                    autoComplete="off"
                    placeholder={detail.organization.name}
                  />
                </Field>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
