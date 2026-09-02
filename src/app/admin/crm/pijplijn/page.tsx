import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/admin/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { MerkSchakelaar } from "@/components/admin/merk-schakelaar";
import { requireAdmin } from "@/lib/auth/session";
import { hasServiceRole } from "@/lib/env";
import { getActiefMerk } from "@/lib/crm/actief-merk";
import { getPijplijn, type Kolom } from "@/lib/crm/pijplijn";
import { createServiceSupabase } from "@/lib/supabase/server";
import { formatEuroCents } from "@/lib/format";
import { DealKaart } from "@/components/admin/deal-kaart";
import { maakDealAction } from "@/app/admin/crm/actions";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Deals" };

function KolomKaart({ kolom }: { kolom: Kolom }) {
  const toon = kolom.fase.is_won ? "gewonnen" : kolom.fase.is_lost ? "verloren" : "lopend";

  return (
    // Het anker maakt het mogelijk om vanaf het dashboard rechtstreeks naar een
    // fase te springen. Verder verandert er niets aan dit scherm.
    <section id={`fase-${kolom.fase.key}`} className="min-w-0 scroll-mt-24">
      <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
        <h2
          className={cn(
            "truncate text-sm font-semibold",
            toon === "gewonnen" ? "text-success" : toon === "verloren" ? "text-muted" : "text-ink"
          )}
        >
          {kolom.fase.label}
        </h2>
        <span className="shrink-0 text-xs text-muted tabular-nums">{kolom.deals.length}</span>
      </div>

      <p className="mb-2 px-1 text-xs text-muted tabular-nums">
        {kolom.waardeCents > 0 ? formatEuroCents(kolom.waardeCents) : "—"}
      </p>

      <ul className="space-y-2">
        {kolom.deals.map((regel) => (
          <DealKaart
            key={regel.deal.id}
            deal={{
              id: regel.deal.id,
              titel: regel.deal.title,
              organisatie: regel.organisatieNaam,
              contact: regel.contactNaam,
              waardeCents: regel.deal.value_cents,
              datum: regel.deal.expected_date,
              eigenaar: regel.ownerNaam,
              dagenInFase: regel.dagenInFase,
              volgendeTaak: regel.volgendeTaak,
              href: `/admin/crm/deal/${regel.deal.id}`,
            }}
          />
        ))}
        {kolom.deals.length === 0 ? (
          <li className="rounded-card border border-dashed border-line px-3 py-4 text-center text-xs text-muted-soft">
            leeg
          </li>
        ) : null}
      </ul>
    </section>
  );
}

export default async function PijplijnPagina() {
  await requireAdmin();
  const merk = await getActiefMerk();

  if (!hasServiceRole()) {
    return (
      <Alert tone="warning" title="SUPABASE_SERVICE_ROLE_KEY ontbreekt">
        Zonder deze sleutel kan het CRM geen gegevens lezen.
      </Alert>
    );
  }

  if (merk === "suri_impact") {
    return (
      <>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[30px]">Deals</h1>
          <MerkSchakelaar actief={merk} />
        </div>
        <Card>
          <EmptyState
            title="Suri heeft een eigen scherm"
            description="Bij het Breekjaar loopt de pijplijn per reisperiode, want de plaatsen zijn beperkt. Daar zie je de deelnemers in de fase waarin ze staan."
            action={
              <Link
                href="/admin/crm/suri"
                className="inline-flex min-h-11 items-center rounded-pill bg-ink px-5 text-sm font-semibold text-white"
              >
                Naar de reisperiodes
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  const supabase = createServiceSupabase();
  const [{ kolommen }, { data: organisaties }] = await Promise.all([
    getPijplijn(merk),
    supabase.from("organizations").select("id, name").order("name").limit(500),
  ]);

  const { data: contacten } = await supabase
    .from("crm_contacts")
    .select("id, full_name, organization_id")
    .not("organization_id", "is", null)
    .order("full_name")
    .limit(1000);

  const lopend = kolommen.filter((k) => !k.fase.is_won && !k.fase.is_lost);
  const afgesloten = kolommen.filter((k) => k.fase.is_won || k.fase.is_lost);
  const openWaarde = lopend.reduce((som, k) => som + k.waardeCents, 0);
  const openAantal = lopend.reduce((som, k) => som + k.deals.length, 0);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[30px]">Deals</h1>
        <MerkSchakelaar actief={merk} />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Open aanvragen</p>
            <p className="mt-1 font-display text-3xl tabular-nums">{openAantal}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Waarde in de pijplijn</p>
            <p className="mt-1 font-display text-3xl tabular-nums">{formatEuroCents(openWaarde)}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Gewonnen</p>
            <p className="mt-1 font-display text-3xl tabular-nums">
              {afgesloten.find((k) => k.fase.is_won)?.deals.length ?? 0}
            </p>
          </CardBody>
        </Card>
      </div>

      {/* Alle fases naast elkaar, horizontaal scrollend binnen hun eigen kader.
          De pagina zelf schuift daardoor nooit opzij. */}
      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <div className="flex gap-4">
          {lopend.map((kolom) => (
            <div key={kolom.fase.id} className="w-[260px] shrink-0">
              <KolomKaart kolom={kolom} />
            </div>
          ))}
        </div>
      </div>

      {afgesloten.length > 0 ? (
        <>
          <h2 className="mb-3 mt-8 text-[22px]">Afgesloten</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {afgesloten.map((kolom) => (
              <KolomKaart key={kolom.fase.id} kolom={kolom} />
            ))}
          </div>
        </>
      ) : null}

      <Card className="mt-8">
        <CardHeader
          title="Nieuwe aanvraag"
          description="Komt in de eerste fase te staan. Zolang het aanvraagformulier nog via HubSpot loopt, zet je aanvragen hier met de hand in."
        />
        <CardBody>
          <ActionForm action={maakDealAction} submitLabel="Aanvraag toevoegen">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Organisatie" htmlFor="deal-org" required showOptional={false}>
                <Select id="deal-org" name="organizationId" required defaultValue="">
                  <option value="" disabled>
                    Kies een organisatie
                  </option>
                  {(organisaties ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Contactpersoon"
                htmlFor="deal-contact"
                hint="Met wie loopt dit gesprek? Kan later nog."
              >
                <Select id="deal-contact" name="contactId" defaultValue="">
                  <option value="">Nog niet bekend</option>
                  {(contacten ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Omschrijving" htmlFor="deal-title" required showOptional={false}>
                <Input id="deal-title" name="title" required placeholder="Cultuurdag maart" />
              </Field>
              <Field label="Verwachte waarde" htmlFor="deal-value" hint="In euro's.">
                <Input id="deal-value" name="value" inputMode="decimal" placeholder="1450,00" />
              </Field>
              <Field label="Verwachte datum" htmlFor="deal-date">
                <Input id="deal-date" name="expectedDate" type="date" />
              </Field>
              <Field label="Hoe binnengekomen" htmlFor="deal-source">
                <Input id="deal-source" name="source" placeholder="Telefoon" autoComplete="off" />
              </Field>
            </div>
            <Field label="Notitie" htmlFor="deal-note">
              <Textarea id="deal-note" name="note" rows={3} />
            </Field>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
