import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ActionForm } from "@/components/admin/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ContactTypeBadge, PortalUitleg } from "@/components/admin/contact-badges";
import { LifecycleBadge, StilteBadge } from "@/components/admin/crm-badges";
import { TakenBlok, TijdlijnBlok } from "@/components/admin/tijdlijn-blok";
import { requireAdmin } from "@/lib/auth/session";
import { CONTACT_TYPE_LABELS, getContact } from "@/lib/crm/contacten";
import { getTakenVoor, getTijdlijn } from "@/lib/crm/tijdlijn";
import { LIFECYCLE_LABELS } from "@/lib/crm/regels";
import { createServiceSupabase } from "@/lib/supabase/server";
import { formatEuroCents, formatShortDate } from "@/lib/format";
import { bewaarContactAction, koppelPortalAccountAction } from "@/app/admin/crm/actions";

export const metadata: Metadata = { title: "Contact" };

export default async function ContactPagina({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const detail = await getContact(id);
  if (!detail) notFound();

  const { contact, organisatieNaam, portal, stilte, deals, boekingen, geverifieerdeMail } = detail;

  const supabase = createServiceSupabase();
  const [tijdlijn, taken, { data: organisaties }, { data: beheerders }] = await Promise.all([
    getTijdlijn({ contactId: id, organizationId: contact.organization_id }),
    getTakenVoor({ contactId: id }),
    supabase.from("organizations").select("id, name").order("name").limit(500),
    supabase.from("profiles").select("id, full_name, email").eq("is_admin", true).order("full_name"),
  ]);
  const beheerderLijst = (beheerders ?? []).map((b) => ({ id: b.id, naam: b.full_name ?? b.email }));

  return (
    <>
      <Link
        href="/admin/crm/contacten"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Terug naar contacten
      </Link>

      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h1 className="text-[30px]">{contact.full_name}</h1>
        <ContactTypeBadge type={contact.contact_type} />
        {contact.lifecycle ? <LifecycleBadge waarde={contact.lifecycle} /> : null}
        <StilteBadge stilte={stilte} />
      </div>
      <p className="mb-6 text-[15px] text-muted">
        {contact.job_title ? `${contact.job_title} · ` : ""}
        {organisatieNaam ? (
          <Link href={`/admin/organisaties/${contact.organization_id}`} className="underline">
            {organisatieNaam}
          </Link>
        ) : (
          "geen organisatie"
        )}
        {contact.city ? ` · ${contact.city}` : ""}
      </p>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Contactgegevens" />
          <CardBody className="space-y-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">E-mail</dt>
              <dd className="break-words font-medium">{contact.email ?? "niet ingevuld"}</dd>
              <dt className="text-muted">Telefoon</dt>
              <dd className="font-medium">{contact.phone ?? "niet ingevuld"}</dd>
              <dt className="text-muted">Laatste contact</dt>
              <dd className="font-medium">
                {contact.last_contact_at ? formatShortDate(contact.last_contact_at) : "niet vastgelegd"}
              </dd>
              <dt className="text-muted">Toegevoegd</dt>
              <dd className="font-medium">{formatShortDate(contact.created_at)}</dd>
            </dl>

            <PortalUitleg portal={portal} organizationId={contact.organization_id} />

            {portal.stand === "gevonden" ? (
              <ActionForm
                action={koppelPortalAccountAction}
                submitLabel="Ja, dit is dezelfde persoon"
                variant="secondary"
                inline
              >
                <input type="hidden" name="contactId" value={contact.id} />
                <input type="hidden" name="userId" value={portal.userId} />
              </ActionForm>
            ) : null}

            {portal.stand === "gekoppeld" ? (
              <ActionForm
                action={koppelPortalAccountAction}
                submitLabel="Koppeling weghalen"
                variant="ghost"
                inline
              >
                <input type="hidden" name="contactId" value={contact.id} />
                <input type="hidden" name="userId" value="" />
              </ActionForm>
            ) : null}

            {geverifieerdeMail ? (
              <p className="text-sm text-muted">
                Dit contact is ook een geverifieerde e-mailcontactpersoon van de organisatie. Daardoor
                kan er e-mailverkeer met dit adres zichtbaar zijn in het klantportaal.
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Gegevens aanpassen" />
          <CardBody>
            <ActionForm action={bewaarContactAction} submitLabel="Opslaan" variant="secondary">
              <input type="hidden" name="contactId" value={contact.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Naam" htmlFor="naam" required showOptional={false}>
                  <Input id="naam" name="fullName" defaultValue={contact.full_name} required />
                </Field>
                <Field label="Organisatie" htmlFor="org">
                  <Select id="org" name="organizationId" defaultValue={contact.organization_id ?? ""}>
                    <option value="">Geen organisatie</option>
                    {(organisaties ?? []).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Soort contact" htmlFor="type">
                  <Select id="type" name="contactType" defaultValue={contact.contact_type ?? ""}>
                    <option value="">Onbekend</option>
                    {Object.entries(CONTACT_TYPE_LABELS).map(([waarde, label]) => (
                      <option key={waarde} value={waarde}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Levensfase" htmlFor="fase">
                  <Select id="fase" name="lifecycle" defaultValue={contact.lifecycle ?? ""}>
                    <option value="">Onbekend</option>
                    {Object.entries(LIFECYCLE_LABELS).map(([waarde, label]) => (
                      <option key={waarde} value={waarde}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Functie" htmlFor="functie">
                  <Input id="functie" name="jobTitle" defaultValue={contact.job_title ?? ""} />
                </Field>
                <Field label="Plaats" htmlFor="plaats">
                  <Input id="plaats" name="city" defaultValue={contact.city ?? ""} />
                </Field>
                <Field label="E-mailadres" htmlFor="email">
                  <Input id="email" name="email" type="email" defaultValue={contact.email ?? ""} />
                </Field>
                <Field label="Telefoonnummer" htmlFor="telefoon">
                  <Input id="telefoon" name="phone" type="tel" defaultValue={contact.phone ?? ""} />
                </Field>
              </div>
              <Field label="Notitie" htmlFor="notitie">
                <Textarea id="notitie" name="note" rows={3} defaultValue={contact.note ?? ""} />
              </Field>
            </ActionForm>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title={`Deals (${deals.length})`}
            description="Verkoopkansen waar deze persoon bij betrokken is."
          />
          {deals.length > 0 ? (
            <ul>
              {deals.map((deal) => (
                <li key={deal.id} className="border-b border-line-soft last:border-b-0">
                  <Link
                    href={
                      deal.brand === "suri_impact"
                        ? `/admin/crm/suri/deelnemer/${deal.id}`
                        : `/admin/crm/deal/${deal.id}`
                    }
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-surface-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{deal.title}</span>
                      <span className="block text-sm text-muted">
                        {deal.faseLabel ?? "onbekende fase"}
                        {deal.expected_date ? ` · ${formatShortDate(deal.expected_date)}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {formatEuroCents(deal.value_cents)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <CardBody>
              <p className="text-sm text-muted">
                Nog geen deals. Een verkoopkans maak je aan in de pijplijn, en die kun je daarna aan
                deze persoon hangen.
              </p>
            </CardBody>
          )}
        </Card>

        <TijdlijnBlok
          onderwerp={{ contactId: contact.id, organizationId: contact.organization_id }}
          regels={tijdlijn}
        />

        <TakenBlok
          onderwerp={{ contactId: contact.id, organizationId: contact.organization_id }}
          taken={taken}
          beheerders={beheerderLijst}
        />

        {boekingen.length > 0 ? (
          <Card className="lg:col-span-2">
            <CardHeader
              title="Boekingen van de organisatie"
              description="Boekingen horen bij de school, niet bij een persoon. Ze staan hier ter informatie."
            />
            <ul>
              {boekingen.map((boeking) => (
                <li
                  key={boeking.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-3 last:border-b-0"
                >
                  <span className="min-w-0 truncate font-semibold">{boeking.workshop_name}</span>
                  <span className="shrink-0 text-sm text-muted">
                    {boeking.scheduled_date ? formatShortDate(boeking.scheduled_date) : "geen datum"} ·{" "}
                    {boeking.status}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
