import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/admin/action-form";
import { Card } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { MerkSchakelaar } from "@/components/admin/merk-schakelaar";
import { PijplijnBord } from "@/components/admin/pijplijn-bord";
import { requireAdmin } from "@/lib/auth/session";
import { hasServiceRole } from "@/lib/env";
import { getActiefMerk } from "@/lib/crm/actief-merk";
import { getPijplijn } from "@/lib/crm/pijplijn";
import { createServiceSupabase } from "@/lib/supabase/server";
import { formatEuroCents } from "@/lib/format";
import { maakDealAction } from "@/app/admin/crm/actions";

export const metadata: Metadata = { title: "Deals" };

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

  /*
    WAT ER OP HET BORD KOMT

    Alleen de fases die niet gearchiveerd zijn. Sinds migratie 039 zijn dat er
    zes; de fases die daarin zijn samengevoegd bestaan nog wel, maar horen niet
    meer op het bord. Draait die migratie nog niet, dan is is_archived overal
    leeg en ziet het bord er precies zo uit als eerst.

    Niet doorgegaan hoort er ook niet bij. Een verloren deal is geen stap in het
    proces maar een uitkomst, en een permanente kolom met driehonderd afgewezen
    offertes maakt het bord onleesbaar. Ze staan onder het bord, ingeklapt.
  */
  const zichtbaar = kolommen.filter((k) => !k.fase.is_archived);
  const lopend = zichtbaar.filter((k) => !k.fase.is_won && !k.fase.is_lost);
  const gewonnen = zichtbaar.find((k) => k.fase.is_won);
  const verloren = kolommen.filter((k) => k.fase.is_lost);
  const verlorenDeals = verloren.flatMap((k) => k.deals);
  const openWaarde = lopend.reduce((som, k) => som + k.waardeCents, 0);
  const openAantal = lopend.reduce((som, k) => som + k.deals.length, 0);

  /*
    ALLE FASES OP HET BORD, OOK DE AFGESLOTEN

    Eerst stonden de gewonnen en verloren fases apart onder de pijplijn, in een
    eigen raster. Dat leek netjes, maar het betekende dat je een deal niet naar
    Afgerond of Niet doorgegaan kon slepen: die kolommen stonden er niet.

    Nu staan alle fases naast elkaar in de volgorde van het proces, en schuift
    het bord opzij als ze niet passen. Dat is ook hoe je erover praat: een deal
    schuift naar rechts tot hij klaar is.
  */
  const bordFases = zichtbaar
    .filter((k) => !k.fase.is_lost)
    .map((k) => ({
      id: k.fase.id,
      key: k.fase.key,
      label: k.fase.label,
      isWon: k.fase.is_won,
      isLost: k.fase.is_lost,
    }));

  const bordDeals = zichtbaar
    .filter((k) => !k.fase.is_lost)
    .flatMap((kolom) =>
    kolom.deals.map((regel) => ({
        id: regel.deal.id,
        stageId: regel.deal.stage_id,
      titel: regel.deal.title,
      organisatie: regel.organisatieNaam,
      contact: regel.contactNaam,
      waardeCents: regel.deal.value_cents,
      datum: regel.deal.expected_date,
      eigenaar: regel.ownerNaam,
      dagenInFase: regel.dagenInFase,
      volgendeTaak: regel.volgendeTaak,
      href: `/admin/crm/deal/${regel.deal.id}`,
      }))
    );

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[30px]">Deals</h1>
        <MerkSchakelaar actief={merk} />
      </div>

      {/*
        Drie getallen op een regel in plaats van drie kaarten. Ze zijn nuttig,
        maar ze zijn niet het scherm: het bord eronder is waar je werkt.
      */}
      <div className="mb-5 flex flex-wrap items-baseline gap-x-8 gap-y-2 rounded-card border border-line-soft bg-white px-5 py-3 shadow-card">
        <p className="text-sm text-muted">
          <span className="mr-2 font-display text-xl tabular-nums text-ink">{openAantal}</span>
          open {openAantal === 1 ? "deal" : "deals"}
        </p>
        <p className="text-sm text-muted">
          <span className="mr-2 font-display text-xl tabular-nums text-ink">
            {formatEuroCents(openWaarde)}
          </span>
          in de pijplijn
        </p>
        <p className="text-sm text-muted">
          <span className="mr-2 font-display text-xl tabular-nums text-ink">
            {gewonnen?.deals.length ?? 0}
          </span>
          gewonnen
        </p>
      </div>

      <PijplijnBord fases={bordFases} deals={bordDeals} />

      {/*
        De verloren deals: bereikbaar, maar niet in beeld zolang je ze niet
        opzoekt. Ze staan op aantal na de nieuwste bovenaan.
      */}
      {verlorenDeals.length > 0 ? (
        <details className="mt-4 rounded-card border border-line-soft bg-white shadow-card">
          <summary className="cursor-pointer px-5 py-3 text-sm font-semibold">
            Niet doorgegaan ({verlorenDeals.length})
          </summary>
          <ul className="border-t border-line-soft">
            {verlorenDeals.slice(0, 100).map((regel) => (
              <li key={regel.deal.id}>
                <Link
                  href={`/admin/crm/deal/${regel.deal.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-2.5 last:border-b-0 hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1 truncate">{regel.deal.title}</span>
                  <span className="shrink-0 text-sm text-muted">
                    {regel.organisatieNaam ?? regel.contactNaam ?? ""}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-muted">
                    {formatEuroCents(regel.deal.value_cents)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {verlorenDeals.length > 100 ? (
            <p className="px-5 py-3 text-sm text-muted">
              De honderd nieuwste staan hier. De rest vind je via de deal zelf.
            </p>
          ) : null}
        </details>
      ) : null}

      {/*
        Ingeklapt. Een aanvraag met de hand invoeren doe je af en toe; naar het
        bord kijken doe je de hele dag. Het formulier stond permanent onder de
        pijplijn en was daarmee het langste stuk van de pagina.
      */}
      <details className="mt-6 rounded-card border border-line-soft bg-white shadow-card">
        <summary className="cursor-pointer px-5 py-4 font-display text-base font-semibold">
          Aanvraag met de hand toevoegen
        </summary>
        <div className="px-5 pb-5">
          <p className="mb-4 text-sm text-muted">
            Komt in de eerste fase te staan. Zolang het aanvraagformulier nog via HubSpot loopt, zet
            je aanvragen hier met de hand in.
          </p>
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
        </div>
      </details>
    </>
  );
}
