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
import {
  getCreditBalanceForAdmin,
  getCreditTransactionsForAdmin,
} from "@/lib/tegoed/queries";
import { CREDIT_TYPE_LABELS } from "@/lib/tegoed/regels";
import { formatEuroCents, formatPoints, formatShortDate } from "@/lib/format";
import { pointsToCents } from "@/lib/loyalty/calc";
import { getSettings } from "@/lib/settings";
import { OrgLogo } from "@/components/portal/org-logo";
import {
  clearOrganizationLogoAction,
  fetchOrganizationLogoAction,
  setCjpNumberAction,
  uploadOrganizationLogoAction,
  linkMoneybirdContactAction,
  unlinkMoneybirdContactAction,
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

  const [settings, tegoed, tegoedMutaties] = await Promise.all([
    getSettings(),
    getCreditBalanceForAdmin(id),
    getCreditTransactionsForAdmin(id, 25),
  ]);
  const members = detail.members as unknown as MemberRow[];
  const mbContacten = detail.moneybirdContacts as unknown as {
    external_id: string;
    external_label: string | null;
  }[];
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

      <div className="mb-1 flex items-center gap-3">
        <OrgLogo
          name={detail.organization.name}
          logoUrl={detail.organization.logo_url}
          size={40}
          className="border border-line-soft"
        />
        <h1 className="text-[30px]">{detail.organization.name}</h1>
      </div>
      <p className="mb-6 text-[15px] text-muted">
        {detail.organization.city ?? "—"} · {detail.organization.kind} ·{" "}
        {detail.organization.skoolpartner_enrolled_at
          ? `SkoolPartner sinds ${formatShortDate(detail.organization.skoolpartner_enrolled_at)}`
          : "neemt nog niet deel aan SkoolPartner"}
      </p>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Organisatiegegevens"
            description="Het logo en het CJP-schoolnummer horen bij de organisatie. Alle medewerkers zien hetzelfde."
          />
          <CardBody className="space-y-5">
            <div className="flex flex-wrap items-center gap-4">
              <OrgLogo
                name={detail.organization.name}
                logoUrl={detail.organization.logo_url}
                size={56}
                className="border border-line-soft"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Logo</p>
                <p className="text-sm text-muted">
                  {detail.organization.logo_url
                    ? detail.organization.logo_source === "handmatig"
                      ? "Handmatig ingesteld. Wordt nooit automatisch overschreven."
                      : "Automatisch gevonden op de website van deze organisatie."
                    : "Nog geen logo. In de zijbalk staat het standaardicoon."}
                  {detail.organization.logo_checked_at
                    ? ` Laatst gezocht op ${formatShortDate(detail.organization.logo_checked_at)}.`
                    : ""}
                </p>
              </div>
            </div>

            <ActionForm action={uploadOrganizationLogoAction} submitLabel="Logo uploaden">
              <input type="hidden" name="organization_id" value={detail.organization.id} />
              <Field
                label="Zelf een logo kiezen"
                htmlFor="admin-logo"
                hint="PNG, JPG of WEBP, maximaal 2 MB."
              >
                <input
                  id="admin-logo"
                  name="logo"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="block w-full text-sm file:mr-3 file:min-h-11 file:rounded-pill file:border-0 file:bg-ink file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                />
              </Field>
            </ActionForm>

            <div className="flex flex-wrap gap-3">
              <ActionForm action={fetchOrganizationLogoAction} submitLabel="Logo ophalen" inline>
                <input type="hidden" name="organization_id" value={detail.organization.id} />
              </ActionForm>

              {detail.organization.logo_url ? (
                <ActionForm
                  action={clearOrganizationLogoAction}
                  submitLabel="Logo verwijderen"
                  variant="secondary"
                  inline
                >
                  <input type="hidden" name="organization_id" value={detail.organization.id} />
                </ActionForm>
              ) : null}
            </div>

            <div className="border-t border-line-soft pt-5">
              <ActionForm action={setCjpNumberAction} submitLabel="CJP opslaan">
                <input type="hidden" name="organization_id" value={detail.organization.id} />
                <p className="mb-2 text-sm">
                  Heeft CJP-schoolnummer:{" "}
                  <strong>
                    {detail.organization.has_cjp === true
                      ? "Ja"
                      : detail.organization.has_cjp === false
                        ? "Nee"
                        : "Onbekend"}
                  </strong>
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="CJP-schoolnummer" htmlFor="cjp">
                    <Input
                      id="cjp"
                      name="cjp_school_number"
                      defaultValue={detail.organization.cjp_school_number ?? ""}
                      placeholder="Niet ingevuld"
                    />
                  </Field>
                  <Field label="Heeft de school een nummer?" htmlFor="has-cjp">
                    <Select
                      id="has-cjp"
                      name="has_cjp"
                      defaultValue={
                        detail.organization.has_cjp === true
                          ? "ja"
                          : detail.organization.has_cjp === false
                            ? "nee"
                            : "onbekend"
                      }
                    >
                      <option value="ja">Ja</option>
                      <option value="nee">Nee</option>
                      <option value="onbekend">Onbekend</option>
                    </Select>
                  </Field>
                </div>
              </ActionForm>
            </div>
          </CardBody>
        </Card>

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

        {/*
          CJP-tegoed staat bewust in een eigen kaartje naast SkoolPoints. Het
          is geld, geen punten, en die twee moeten in het beheer nooit door
          elkaar gaan lopen.
        */}
        <Card>
          <CardHeader
            title="CJP-tegoed"
            description="Een bedrag in euro's dat deze organisatie bij ons heeft geparkeerd. Los van SkoolPoints en zonder vervaldatum."
            action={
              <Link href="/admin/cjp-tegoed" className="text-sm underline underline-offset-4">
                Afboeken
              </Link>
            }
          />
          <CardBody>
            <dl className="grid grid-cols-3 gap-4">
              <div>
                <dt className="text-sm text-muted">Beschikbaar</dt>
                <dd className="font-display text-2xl">{formatEuroCents(tegoed.available_cents)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Geparkeerd</dt>
                <dd className="font-display text-xl text-muted">
                  {formatEuroCents(tegoed.added_cents)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Gebruikt</dt>
                <dd className="font-display text-xl text-muted">
                  {formatEuroCents(tegoed.spent_cents)}
                </dd>
              </div>
            </dl>

            {tegoedMutaties.length > 0 ? (
              <ul className="mt-5 divide-y divide-line-soft border-t border-line-soft">
                {tegoedMutaties.slice(0, 8).map((mutatie) => (
                  <li key={mutatie.id} className="flex items-start justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        {CREDIT_TYPE_LABELS[mutatie.type] ?? mutatie.type}
                        {mutatie.bookings ? ` · ${mutatie.bookings.workshop_name}` : ""}
                      </span>
                      <span className="block text-sm text-muted">
                        {formatShortDate(mutatie.occurred_at)}
                        {mutatie.invoice_number ? ` · factuur ${mutatie.invoice_number}` : ""}
                        {mutatie.note ? ` · ${mutatie.note}` : ""}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 font-display text-lg ${
                        mutatie.amount_cents > 0 ? "text-success" : "text-muted"
                      }`}
                    >
                      {mutatie.amount_cents > 0 ? "+" : "−"}
                      {formatEuroCents(Math.abs(mutatie.amount_cents))}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-5 text-sm text-muted">
                Deze organisatie heeft nog geen tegoed geparkeerd.
              </p>
            )}
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
              <Field label="E-mailadres" htmlFor="invite-email" required>
                <Input id="invite-email" name="email" type="email" required />
              </Field>
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
            title="Moneybird"
            description="Bepaalt bij welke klant een factuur terechtkomt. Wij koppelen op het Moneybird-contact-ID, want dat verandert niet; een bedrijfsnaam wel."
          />
          {mbContacten.length > 0 ? (
            <ul className="divide-y divide-line-soft">
              {mbContacten.map((rij) => (
                <li
                  key={rij.external_id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {rij.external_label ?? "Moneybird-contact"}
                    </span>
                    <span className="block font-mono text-sm text-muted">{rij.external_id}</span>
                  </span>
                  <ActionForm
                    action={unlinkMoneybirdContactAction}
                    submitLabel="Ontkoppelen"
                    variant="secondary"
                    inline
                  >
                    <input type="hidden" name="organization_id" value={detail.organization.id} />
                    <input type="hidden" name="external_id" value={rij.external_id} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-4 text-sm text-muted">
              Nog geen Moneybird-contact gekoppeld. Facturen van deze klant komen daardoor binnen
              als &quot;nog niet gekoppeld&quot; en zijn niet zichtbaar voor de klant zelf.
            </p>
          )}
          <CardBody className="border-t border-line-soft">
            <ActionForm action={linkMoneybirdContactAction} submitLabel="Koppelen">
              <input type="hidden" name="organization_id" value={detail.organization.id} />
              <Field
                label="Moneybird-contact"
                htmlFor="mb-contact"
                hint="Vul het contact-ID in, of zoek op naam. Bij meerdere treffers krijgt u de lijst terug."
              >
                <Input id="mb-contact" name="moneybird_contact" placeholder="De Goudse Waarden" />
              </Field>
            </ActionForm>
          </CardBody>
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
