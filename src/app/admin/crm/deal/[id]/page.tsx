import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ActionForm } from "@/components/admin/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { TakenBlok, TijdlijnBlok } from "@/components/admin/tijdlijn-blok";
import { AfsprakenBlok } from "@/components/admin/afspraak-blok";
import { requireAdmin } from "@/lib/auth/session";
import { getFragmentHulp } from "@/lib/crm/fragmenten";
import { deelIn, getAfspraken } from "@/lib/crm/afspraken";
import { getDeal } from "@/lib/crm/pijplijn";
import { getTakenVoor, getTijdlijn } from "@/lib/crm/tijdlijn";
import { createServiceSupabase } from "@/lib/supabase/server";
import { formatDateTime, formatEuroCents, formatShortDate } from "@/lib/format";
import {
  maakBoekingVanDealAction,
  werkDealBijAction,
  zetFaseAction,
} from "@/app/admin/crm/actions";

export const metadata: Metadata = { title: "Aanvraag" };

export default async function DealPagina({ params }: { params: Promise<{ id: string }> }) {
  const sessie = await requireAdmin();
  const { id } = await params;

  const detail = await getDeal(id);
  if (!detail) notFound();

  // Een Suri-aanmelding heeft een eigen scherm met betalingen en reisperiode.
  // Daar hoort deze pagina niet overheen te gaan.
  if (detail.deal.brand === "suri_impact") redirect(`/admin/crm/suri/deelnemer/${id}`);

  const supabase = createServiceSupabase();
  const [tijdlijn, taken, { data: beheerders }, { data: contacten }] = await Promise.all([
    getTijdlijn({ dealId: id, organizationId: detail.deal.organization_id }),
    getTakenVoor({ dealId: id }),
    supabase.from("profiles").select("id, full_name, email").eq("is_admin", true).order("full_name"),
    detail.deal.organization_id
      ? supabase
          .from("crm_contacts")
          .select("id, full_name")
          .eq("organization_id", detail.deal.organization_id)
          .order("full_name")
      : Promise.resolve({ data: [] }),
  ]);

  const beheerderLijst = (beheerders ?? []).map((b) => ({ id: b.id, naam: b.full_name ?? b.email }));
  const { deal, fase, fases, organisatieNaam, contactNaam, ownerNaam, boeking } = detail;

  // De fragmentkiezer bij de tijdlijn. Faalt zacht: geen fragmenten betekent
  // geen knop, en verder blijft het scherm precies zoals het was.
  const fragmentHulp = await getFragmentHulp(
    { dealId: deal.id, organizationId: deal.organization_id, contactId: deal.contact_id, merk: deal.brand },
    { naam: sessie.profile?.full_name ?? null, email: sessie.email }
  );

  // De afspraken bij dit onderwerp. Eerst wat blijft liggen, dan wat er
  // aankomt: dat is de volgorde waarin je ernaar kijkt.
  const afsprakenIndeling = deelIn(await getAfspraken({ dealId: deal.id, organizationId: deal.organization_id }), new Date().toISOString());
  const alleFases = [...fases.lopend, fases.gewonnen, fases.verloren].filter((f) => f !== null);
  const euro = (centen: number) => (centen / 100).toFixed(2).replace(".", ",");

  return (
    <>
      <Link
        href="/admin/crm/pijplijn"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Terug naar de pijplijn
      </Link>

      <h1 className="mb-1 text-[30px]">{deal.title}</h1>
      <p className="mb-6 text-[15px] text-muted">
        {organisatieNaam ? (
          <Link href={`/admin/organisaties/${deal.organization_id}`} className="underline">
            {organisatieNaam}
          </Link>
        ) : (
          "geen organisatie"
        )}{" "}
        · {fase.label} · {formatEuroCents(deal.value_cents)}
        {deal.expected_date ? ` · verwacht ${formatShortDate(deal.expected_date)}` : ""}
        {ownerNaam ? ` · ${ownerNaam}` : ""}
      </p>

      {contactNaam ? (
        <p className="mb-6 -mt-4 text-[15px] text-muted">
          Contactpersoon:{" "}
          <Link href={`/admin/crm/contacten/${deal.contact_id}`} className="underline">
            {contactNaam}
          </Link>
        </p>
      ) : null}

      {fase.is_won && !boeking ? (
        <Alert tone="info" title="Deze aanvraag is gewonnen" className="mb-5">
          Er hangt nog geen boeking aan. Hieronder maak je die aan als concept: hij verschijnt dan in
          Admin &gt; Boekingen, maar telt nog niet mee voor de klant en levert nog geen SkoolPoints
          op. Bevestigen doe je daar zelf zodra de afspraak vaststaat.
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Fase" description="Elke wisseling wordt vastgelegd in de historie." />
          <CardBody>
            <ActionForm action={zetFaseAction} submitLabel="Fase bijwerken">
              <input type="hidden" name="dealId" value={deal.id} />
              <Field label="Fase" htmlFor="stageId" required showOptional={false}>
                <Select id="stageId" name="stageId" defaultValue={fase.id}>
                  {alleFases.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Notitie" htmlFor="fase-note" hint="Wordt bij deze wisseling bewaard.">
                <Input id="fase-note" name="note" autoComplete="off" />
              </Field>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Gegevens" />
          <CardBody>
            <ActionForm action={werkDealBijAction} submitLabel="Opslaan" variant="secondary">
              <input type="hidden" name="dealId" value={deal.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Omschrijving" htmlFor="edit-title" required showOptional={false}>
                  <Input id="edit-title" name="title" defaultValue={deal.title} required />
                </Field>
                <Field label="Waarde" htmlFor="edit-value" hint="In euro's.">
                  <Input
                    id="edit-value"
                    name="value"
                    inputMode="decimal"
                    defaultValue={deal.value_cents ? euro(deal.value_cents) : ""}
                  />
                </Field>
                <Field label="Verwachte datum" htmlFor="edit-date">
                  <Input
                    id="edit-date"
                    name="expectedDate"
                    type="date"
                    defaultValue={deal.expected_date ?? ""}
                  />
                </Field>
                <Field label="Eigenaar" htmlFor="edit-owner">
                  <Select id="edit-owner" name="ownerId" defaultValue={deal.owner_id ?? ""}>
                    <option value="">Niemand</option>
                    {beheerderLijst.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.naam}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Contactpersoon" htmlFor="edit-contact">
                  <Select id="edit-contact" name="contactId" defaultValue={deal.contact_id ?? ""}>
                    <option value="">Nog niet bekend</option>
                    {(contacten ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.full_name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Hoe binnengekomen" htmlFor="edit-source">
                  <Input id="edit-source" name="source" defaultValue={deal.source ?? ""} />
                </Field>
              </div>
              <Field label="Notitie" htmlFor="edit-note">
                <Textarea id="edit-note" name="note" rows={3} defaultValue={deal.note ?? ""} />
              </Field>
            </ActionForm>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Boeking"
            description="De brug tussen het CRM en de uitvoering. Er wordt altijd een concept aangemaakt, nooit een bevestigde boeking."
          />
          <CardBody>
            {boeking ? (
              <div className="space-y-2">
                <p className="text-sm">
                  Er hangt een boeking aan deze aanvraag: {boeking.reference ?? boeking.id.slice(0, 8)} ·{" "}
                  <strong>{boeking.status}</strong>
                  {boeking.scheduled_date ? ` · ${formatShortDate(boeking.scheduled_date)}` : ""}
                </p>
                {boeking.status === "concept" ? (
                  <p className="text-sm text-muted">
                    Nog een concept. De klant ziet hem niet en er zijn geen punten toegekend.
                    Bevestigen doe je in Admin &gt; Boekingen.
                  </p>
                ) : null}
                <Link
                  href="/admin/boekingen"
                  className="inline-flex min-h-11 items-center rounded-pill bg-surface-3 px-5 text-sm font-semibold text-ink"
                >
                  Naar boekingen
                </Link>
              </div>
            ) : !fase.is_won ? (
              <p className="text-sm text-muted">
                Er wordt pas een boeking gemaakt als deze aanvraag in de gewonnen fase staat. Zo
                ontstaat er nooit een boeking uit iets wat nog loopt.
              </p>
            ) : (
              <ActionForm action={maakBoekingVanDealAction} submitLabel="Conceptboeking aanmaken">
                <input type="hidden" name="dealId" value={deal.id} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Workshopnaam" htmlFor="boeking-naam" required showOptional={false}>
                    <Input id="boeking-naam" name="workshopName" required defaultValue={deal.title} />
                  </Field>
                  <Field label="Datum" htmlFor="boeking-datum">
                    <Input
                      id="boeking-datum"
                      name="scheduledDate"
                      type="date"
                      defaultValue={deal.expected_date ?? ""}
                    />
                  </Field>
                  <Field label="Aantal workshops" htmlFor="boeking-aantal" required showOptional={false}>
                    <Input
                      id="boeking-aantal"
                      name="workshopCount"
                      type="number"
                      min={1}
                      defaultValue={1}
                    />
                  </Field>
                  <Field label="Minuten per workshop" htmlFor="boeking-minuten" required showOptional={false}>
                    <Input
                      id="boeking-minuten"
                      name="minutesPerWorkshop"
                      type="number"
                      min={1}
                      defaultValue={90}
                    />
                  </Field>
                  <Field label="Locatie" htmlFor="boeking-locatie">
                    <Input id="boeking-locatie" name="location" autoComplete="off" />
                  </Field>
                  <Field label="Kenmerk" htmlFor="boeking-kenmerk">
                    <Input id="boeking-kenmerk" name="reference" autoComplete="off" />
                  </Field>
                </div>
              </ActionForm>
            )}
          </CardBody>
        </Card>

        <TijdlijnBlok
          onderwerp={{ dealId: deal.id, organizationId: deal.organization_id }}
          regels={tijdlijn}
          fragmenten={fragmentHulp.fragmenten}
          fragmentContext={fragmentHulp.context}
        />

        <TakenBlok
          onderwerp={{ dealId: deal.id, organizationId: deal.organization_id }}
          taken={taken}
          beheerders={beheerderLijst}
        />

        <AfsprakenBlok
          onderwerp={{ dealId: deal.id, organizationId: deal.organization_id }}
          indeling={afsprakenIndeling}
          beheerders={beheerderLijst}
        />

        {detail.historie.length > 0 ? (
          <Card className="lg:col-span-2">
            <CardHeader title="Fasehistorie" />
            <ul>
              {detail.historie.map((regel) => (
                <li key={regel.id} className="border-b border-line-soft px-5 py-3 last:border-b-0">
                  <p className="font-semibold">
                    {regel.vanLabel ?? "begin"} → {regel.naarLabel ?? "onbekend"}
                  </p>
                  <p className="text-sm text-muted">
                    {formatDateTime(regel.created_at)}
                    {regel.actorNaam ? ` · ${regel.actorNaam}` : ""}
                    {regel.note ? ` · ${regel.note}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
