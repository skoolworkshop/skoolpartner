import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/admin/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { ContactTypeBadge, PortalBadge } from "@/components/admin/contact-badges";
import { LifecycleBadge } from "@/components/admin/crm-badges";
import { requireAdmin } from "@/lib/auth/session";
import { hasServiceRole } from "@/lib/env";
import { CONTACT_TYPE_LABELS, getContacten, type ContactFilter } from "@/lib/crm/contacten";
import { LIFECYCLE_LABELS, isLifecycle } from "@/lib/crm/regels";
import { createServiceSupabase } from "@/lib/supabase/server";
import { formatShortDate } from "@/lib/format";
import { bewaarContactAction } from "@/app/admin/crm/actions";
import { isContactType } from "@/lib/crm/contacten";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Contacten" };

const SNELFILTERS = [
  { key: "alles", label: "Alle contacten" },
  { key: "zonder-organisatie", label: "Zonder organisatie" },
  { key: "met-account", label: "Met klantportaalaccount" },
  { key: "zonder-account", label: "Zonder account" },
] as const;

export default async function ContactenPagina({
  searchParams,
}: {
  searchParams: Promise<{ zoek?: string; filter?: string; type?: string; fase?: string }>;
}) {
  await requireAdmin();

  if (!hasServiceRole()) {
    return (
      <Alert tone="warning" title="SUPABASE_SERVICE_ROLE_KEY ontbreekt">
        Zonder deze sleutel kan het CRM geen gegevens lezen.
      </Alert>
    );
  }

  const { zoek, filter = "alles", type, fase } = await searchParams;

  const opties: ContactFilter = {
    zoek,
    type: isContactType(type) ? type : "alles",
    lifecycle: isLifecycle(fase) ? fase : "alles",
    organisatie: filter === "zonder-organisatie" ? "zonder" : "alles",
    portal: filter === "met-account" ? "met" : filter === "zonder-account" ? "zonder" : "alles",
  };

  const supabase = createServiceSupabase();
  const [contacten, { data: organisaties }] = await Promise.all([
    getContacten(opties),
    supabase.from("organizations").select("id, name").order("name").limit(500),
  ]);

  const query = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const samen = { zoek, filter, type, fase, ...extra };
    for (const [k, v] of Object.entries(samen)) if (v && v !== "alles") p.set(k, v);
    const s = p.toString();
    return `/admin/crm/contacten${s ? `?${s}` : ""}`;
  };

  const zonderAccount = contacten.filter((c) => c.portal.stand === "geen").length;

  return (
    <>
      <h1 className="mb-1 text-[30px]">Contacten</h1>
      <p className="mb-6 max-w-3xl text-muted">
        Iedereen die je kent: docenten, cultuurcoördinatoren, decanen, directies, ouders,
        deelnemers en opdrachtgevers. Een contact is <strong className="text-ink">geen</strong>{" "}
        SkoolPartner-gebruiker. Alleen wie echt toegang heeft tot het klantportaal krijgt hier een
        accountlabel.
      </p>

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Gevonden</p>
            <p className="mt-1 font-display text-3xl tabular-nums">{contacten.length}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Zonder klantportaalaccount</p>
            <p className="mt-1 font-display text-3xl tabular-nums">{zonderAccount}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Zonder organisatie</p>
            <p className="mt-1 font-display text-3xl tabular-nums">
              {contacten.filter((c) => !c.contact.organization_id).length}
            </p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Overzicht"
          action={
            <form className="flex flex-wrap items-center gap-2" action="/admin/crm/contacten">
              <label htmlFor="zoek" className="sr-only">
                Zoek op naam, e-mail, telefoon of plaats
              </label>
              <input
                id="zoek"
                name="zoek"
                defaultValue={zoek ?? ""}
                placeholder="Naam, e-mail, telefoon of plaats"
                className="h-10 min-w-0 flex-1 rounded-pill border border-surface-2 bg-surface-2 px-4 text-sm"
              />
              <input type="hidden" name="filter" value={filter} />
              <button
                type="submit"
                className="min-h-10 rounded-pill bg-ink px-4 text-sm font-semibold text-white"
              >
                Zoek
              </button>
            </form>
          }
        />

        <div className="flex flex-wrap gap-1.5 border-b border-line-soft px-5 py-3">
          {SNELFILTERS.map((f) => (
            <Link
              key={f.key}
              href={query({ filter: f.key })}
              aria-current={f.key === filter ? "page" : undefined}
              className={cn(
                "rounded-pill px-3.5 py-1.5 text-sm font-semibold transition-colors",
                f.key === filter
                  ? "bg-accent-wash text-ink"
                  : "text-muted hover:bg-surface-2 hover:text-ink"
              )}
            >
              {f.label}
            </Link>
          ))}
        </div>

        {contacten.length === 0 ? (
          <EmptyState
            title="Niets gevonden"
            description={
              zoek
                ? `Geen contact dat past bij "${zoek}".`
                : "Voeg hieronder de eerste contactpersoon toe."
            }
          />
        ) : (
          <>
            {/* Tabel op desktop, kaartjes op mobiel. Een tabel van acht kolommen
                op een telefoon is onleesbaar, en horizontaal scrollen door een
                naamkolom werkt in de praktijk niet. */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line-soft text-left text-xs uppercase tracking-wider text-muted-soft">
                    <th className="px-5 py-2.5 font-semibold">Naam</th>
                    <th className="px-3 py-2.5 font-semibold">Organisatie</th>
                    <th className="px-3 py-2.5 font-semibold">Type</th>
                    <th className="px-3 py-2.5 font-semibold">E-mail</th>
                    <th className="hidden px-3 py-2.5 font-semibold xl:table-cell">Telefoon</th>
                    <th className="px-3 py-2.5 font-semibold">Deals</th>
                    <th className="whitespace-nowrap px-5 py-2.5 font-semibold">Klantportaal</th>
                    <th className="hidden px-5 py-2.5 font-semibold xl:table-cell">Toegevoegd</th>
                  </tr>
                </thead>
                <tbody>
                  {contacten.map(({ contact, organisatieNaam, portal, aantalDeals }) => (
                    <tr key={contact.id} className="border-b border-line-soft last:border-b-0 hover:bg-surface-2">
                      <td className="px-5 py-3">
                        <Link
                          href={`/admin/crm/contacten/${contact.id}`}
                          className="font-semibold text-ink underline-offset-4 hover:underline"
                        >
                          {contact.full_name}
                        </Link>
                        {contact.job_title ? (
                          <span className="block text-xs text-muted">{contact.job_title}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        {organisatieNaam ? (
                          <Link
                            href={`/admin/crm/organisaties/${contact.organization_id}`}
                            className="text-muted underline-offset-4 hover:text-ink hover:underline"
                          >
                            {organisatieNaam}
                          </Link>
                        ) : (
                          <span className="text-muted-soft">geen</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <ContactTypeBadge type={contact.contact_type} />
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-3 text-muted">
                        {contact.email ?? "—"}
                      </td>
                      <td className="hidden px-3 py-3 text-muted xl:table-cell">{contact.phone ?? "—"}</td>
                      <td className="px-3 py-3 tabular-nums text-muted">{aantalDeals || "—"}</td>
                      <td className="px-5 py-3">
                        <PortalBadge portal={portal} />
                      </td>
                      <td className="hidden px-5 py-3 text-muted xl:table-cell">{formatShortDate(contact.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="lg:hidden">
              {contacten.map(({ contact, organisatieNaam, portal }) => (
                <li key={contact.id} className="border-b border-line-soft last:border-b-0">
                  <Link href={`/admin/crm/contacten/${contact.id}`} className="block px-5 py-3.5 hover:bg-surface-2">
                    <p className="font-semibold text-ink">{contact.full_name}</p>
                    <p className="truncate text-sm text-muted">
                      {[contact.job_title, organisatieNaam, contact.email].filter(Boolean).join(" · ") ||
                        "geen verdere gegevens"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <ContactTypeBadge type={contact.contact_type} />
                      {contact.lifecycle ? <LifecycleBadge waarde={contact.lifecycle} /> : null}
                      <PortalBadge portal={portal} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Nieuw contact"
          description="Dit maakt geen inlogaccount aan en geeft geen toegang tot het klantportaal."
        />
        <CardBody>
          <ActionForm action={bewaarContactAction} submitLabel="Contact toevoegen">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Naam" htmlFor="nieuw-naam" required showOptional={false}>
                <Input id="nieuw-naam" name="fullName" required autoComplete="off" />
              </Field>
              <Field label="Organisatie" htmlFor="nieuw-org" hint="Leeg laten mag: niet iedereen hoort bij een school.">
                <Select id="nieuw-org" name="organizationId" defaultValue="">
                  <option value="">Geen organisatie</option>
                  {(organisaties ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Soort contact" htmlFor="nieuw-type">
                <Select id="nieuw-type" name="contactType" defaultValue="">
                  <option value="">Onbekend</option>
                  {Object.entries(CONTACT_TYPE_LABELS).map(([waarde, label]) => (
                    <option key={waarde} value={waarde}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Levensfase" htmlFor="nieuw-fase">
                <Select id="nieuw-fase" name="lifecycle" defaultValue="">
                  <option value="">Onbekend</option>
                  {Object.entries(LIFECYCLE_LABELS).map(([waarde, label]) => (
                    <option key={waarde} value={waarde}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Functie" htmlFor="nieuw-functie">
                <Input id="nieuw-functie" name="jobTitle" autoComplete="off" />
              </Field>
              <Field label="Plaats" htmlFor="nieuw-plaats">
                <Input id="nieuw-plaats" name="city" autoComplete="off" />
              </Field>
              <Field label="E-mailadres" htmlFor="nieuw-email">
                <Input id="nieuw-email" name="email" type="email" autoComplete="off" />
              </Field>
              <Field label="Telefoonnummer" htmlFor="nieuw-telefoon">
                <Input id="nieuw-telefoon" name="phone" type="tel" autoComplete="off" />
              </Field>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
