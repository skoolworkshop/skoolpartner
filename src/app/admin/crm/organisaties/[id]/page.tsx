import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Settings2 } from "lucide-react";

import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { OrgLogo } from "@/components/portal/org-logo";
import { DetailIndeling } from "@/components/admin/detail-indeling";
import { LifecycleBadge, StilteBadge } from "@/components/admin/crm-badges";
import { RelatieDeals, RelatiePersonen, RelatieProfiel } from "@/components/admin/relatie-blok";
import { TakenBlok, TijdlijnBlok } from "@/components/admin/tijdlijn-blok";
import { AfsprakenBlok } from "@/components/admin/afspraak-blok";
import { requireAdmin } from "@/lib/auth/session";
import { hasServiceRole } from "@/lib/env";
import { getFragmentHulp } from "@/lib/crm/fragmenten";
import { deelIn, getAfspraken } from "@/lib/crm/afspraken";
import { getRelatieProfiel } from "@/lib/crm/relaties";
import { getTakenVoor, getTijdlijn } from "@/lib/crm/tijdlijn";
import { contactStilte, type Lifecycle } from "@/lib/crm/regels";
import { createServiceSupabase } from "@/lib/supabase/server";
import { formatShortDate } from "@/lib/format";

export const metadata: Metadata = { title: "Organisatie" };

/**
 * De CRM-kant van een school of organisatie.
 *
 * ============================================================================
 * WAAROM DIT EEN EIGEN PAGINA IS EN GEEN BLOK OP DE BEHEERPAGINA
 * ============================================================================
 *
 * Er waren twee dingen door elkaar gaan lopen. Op /admin/organisaties/[id]
 * stond alles: punten, tegoed, domeinen, gebruikers, facturen, Moneybird en
 * een knop om de organisatie definitief te verwijderen, en daartussen ook de
 * levensfase, de eigenaar, de deals en de tijdlijn.
 *
 * Dat zijn twee verschillende vragen die je op verschillende momenten stelt:
 *
 *   Beheer  Wie mag hier inloggen, klopt het tegoed, welke domeinen horen bij
 *           deze school. Dat gaat over een bestaande klant in SkoolPartner.
 *
 *   CRM     In welke fase zit deze relatie, wie volgt hem op, wat is er
 *           besproken en wat loopt er aan verkoopkansen. Dat gaat over de
 *           commerciele relatie, en die bestaat ook als de school helemaal
 *           geen SkoolPartner-account heeft.
 *
 * Ze blijven wel op dezelfde organisatie slaan en ze staan een klik van elkaar
 * af. Er is niets weggehaald: de commerciele blokken staan nu hier in plaats
 * van tussen het beheer.
 */
export default async function CrmOrganisatiePagina({ params }: { params: Promise<{ id: string }> }) {
  const sessie = await requireAdmin();
  const { id } = await params;

  if (!hasServiceRole()) {
    return (
      <Alert tone="warning" title="SUPABASE_SERVICE_ROLE_KEY ontbreekt">
        Zonder deze sleutel kan het CRM geen gegevens lezen.
      </Alert>
    );
  }

  const supabase = createServiceSupabase();
  const { data: organisatie } = await supabase
    .from("organizations")
    .select("id, name, city, kind, logo_url, skoolpartner_enrolled_at")
    .eq("id", id)
    .maybeSingle();

  if (!organisatie) notFound();

  const vandaag = new Date().toISOString().slice(0, 10);

  const fragmentHulp = await getFragmentHulp(
    { organizationId: id },
    { naam: sessie.profile?.full_name ?? null, email: sessie.email }
  );

  const [relatie, tijdlijn, taken, afspraken] = await Promise.all([
    getRelatieProfiel(id),
    getTijdlijn({ organizationId: id }),
    getTakenVoor({ organizationId: id }),
    getAfspraken({ organizationId: id }),
  ]);

  const afsprakenIndeling = deelIn(afspraken, new Date().toISOString());
  const lifecycle = (relatie.profiel?.lifecycle ?? "klant") as Lifecycle;
  const stilte = contactStilte(relatie.profiel?.last_contact_at ?? null, vandaag);

  return (
    <>
      <Link
        href="/admin/crm/organisaties"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Terug naar organisaties
      </Link>

      <div className="mb-1 flex flex-wrap items-center gap-3">
        <OrgLogo
          name={organisatie.name}
          logoUrl={organisatie.logo_url}
          size={40}
          className="border border-line-soft"
        />
        <h1 className="text-[30px]">{organisatie.name}</h1>
        <LifecycleBadge waarde={lifecycle} />
        <StilteBadge stilte={stilte} />
      </div>
      <p className="mb-4 text-[15px] text-muted">
        {organisatie.city ?? "plaats onbekend"} · {organisatie.kind}
        {relatie.eigenaarNaam ? ` · eigenaar ${relatie.eigenaarNaam}` : " · geen eigenaar"}
      </p>

      {/*
        Een deur naar het beheer, geen tweede exemplaar ervan. Wie het tegoed of
        de gebruikers moet aanpassen, hoort daar en niet hier te zijn.
      */}
      <div className="mb-6">
        <Link
          href={`/admin/organisaties/${id}`}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-pill border border-line bg-white px-3.5 text-sm font-semibold text-ink hover:bg-surface-2"
        >
          <Settings2 aria-hidden className="size-4 text-muted" />
          Beheer in het klantportaal
        </Link>
      </div>

      <DetailIndeling
        links={
          <>
            <RelatieProfiel
              organizationId={id}
              profiel={relatie.profiel}
              beheerders={relatie.beheerders}
              omzetCents={relatie.omzetCents}
              openWaardeCents={relatie.openWaardeCents}
              vandaag={vandaag}
            />

            <Card>
              <CardHeader title="SkoolPartner" />
              <CardBody>
                <p className="text-sm text-muted">
                  {organisatie.skoolpartner_enrolled_at
                    ? `Neemt deel sinds ${formatShortDate(organisatie.skoolpartner_enrolled_at)}. Punten, tegoed, boekingen en facturen staan bij het beheer.`
                    : "Neemt nog niet deel aan SkoolPartner. Een relatie in het CRM heeft daar ook geen account voor nodig."}
                </p>
              </CardBody>
            </Card>
          </>
        }
        midden={
          <TijdlijnBlok
            onderwerp={{ organizationId: id }}
            regels={tijdlijn}
            fragmenten={fragmentHulp.fragmenten}
            fragmentContext={fragmentHulp.context}
          />
        }
        rechts={
          <>
            <RelatiePersonen organizationId={id} contacten={relatie.contacten} />
            <RelatieDeals deals={relatie.deals} />
            <AfsprakenBlok
              onderwerp={{ organizationId: id }}
              indeling={afsprakenIndeling}
              beheerders={relatie.beheerders}
            />
            <TakenBlok
              onderwerp={{ organizationId: id }}
              taken={taken}
              beheerders={relatie.beheerders}
            />
          </>
        }
      />
    </>
  );
}
