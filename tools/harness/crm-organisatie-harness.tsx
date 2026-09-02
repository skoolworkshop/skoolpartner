import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DetailIndeling } from "@/components/admin/detail-indeling";
import { LifecycleBadge, StilteBadge } from "@/components/admin/crm-badges";
import { RelatieDeals, RelatiePersonen, RelatieProfiel } from "@/components/admin/relatie-blok";
import { contactStilte } from "@/lib/crm/regels";
import type { CrmContactRow } from "@/lib/types/database";

/**
 * De CRM-pagina van een organisatie.
 *
 * Hier staan wel de echte blokken in, anders dan bij de contactharness: het
 * profielformulier, de personenlijst en de deallijst zijn precies de
 * componenten die de pagina gebruikt. Juist bij die drie wil je zien of ze in
 * een kolom van 320 pixels nog te lezen zijn, want het profiel bevat een
 * formulier met twee kolommen en de personenlijst een ingeklapt formulier.
 *
 * De gegevens zijn verzonnen testwaarden voor de opmaak.
 */

const VANDAAG = "2026-09-02";

function contact(
  id: string,
  naam: string,
  functie: string,
  email: string,
  telefoon: string | null
): CrmContactRow {
  return {
    id,
    organization_id: "demo",
    full_name: naam,
    email,
    phone: telefoon,
    job_title: functie,
    note: null,
    is_unsubscribed: false,
    owner_id: null,
    linked_contact_id: null,
    contact_type: "cultuurcoordinator",
    lifecycle: "klant",
    city: "Breda",
    portal_user_id: null,
    last_contact_at: null,
    created_by: null,
    created_at: "2025-03-14T10:00:00.000Z",
    updated_at: "2025-03-14T10:00:00.000Z",
  } as CrmContactRow;
}

export function Harness() {
  return (
    <div className="px-4 py-8">
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h1 className="text-[30px]">Markenhage College</h1>
        <LifecycleBadge waarde="klant" />
        <StilteBadge stilte={contactStilte("2026-06-14T10:00:00.000Z", VANDAAG)} />
      </div>
      <p className="mb-4 text-[15px] text-muted">Breda · school · eigenaar Clinten</p>

      <div className="mb-6">
        <span className="inline-flex min-h-9 items-center gap-1.5 rounded-pill border border-line bg-white px-3.5 text-sm font-semibold text-ink">
          Beheer in het klantportaal
        </span>
      </div>

      <DetailIndeling
        links={
          <>
            <RelatieProfiel
              organizationId="demo"
              vandaag={VANDAAG}
              omzetCents={1186000}
              openWaardeCents={382000}
              profiel={{
                organization_id: "demo",
                lifecycle: "klant",
                owner_id: "u1",
                source: "Beurs Onderwijs Anders",
                last_contact_at: "2026-06-14T10:00:00.000Z",
                next_action_at: "2026-09-15",
                note: "Willen een cultuurdag in maart. Budget loopt via de ouderraad.",
                created_at: "2025-03-14T10:00:00.000Z",
                updated_at: "2026-06-14T10:00:00.000Z",
              }}
              beheerders={[
                { id: "u1", naam: "Clinten" },
                { id: "u2", naam: "Collega" },
              ]}
            />

            <Card>
              <CardHeader title="SkoolPartner" />
              <CardBody>
                <p className="text-sm text-muted">
                  Neemt deel sinds 14 mrt 2025. Punten, tegoed, boekingen en facturen staan bij het
                  beheer.
                </p>
              </CardBody>
            </Card>
          </>
        }
        midden={
          <Card>
            <CardHeader
              title="Tijdlijn"
              description="Wat er is gebeurd. Regels met Automatisch schrijft het systeem zelf."
            />
            <ul>
              {[
                { soort: "Telefoon", wanneer: "28 aug 2026", tekst: "Gebeld over de cultuurdag. Wil een offerte voor drie klassen, liefst in november." },
                { soort: "E-mail", wanneer: "21 aug 2026", tekst: "Offerte verstuurd, 3 workshops van 90 minuten." },
                { soort: "Notitie", wanneer: "14 aug 2026", tekst: "Beslissing valt na de teamvergadering van 3 september." },
              ].map((regel) => (
                <li key={regel.wanneer} className="border-b border-line-soft px-5 py-3 last:border-b-0">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">{regel.soort}</span>
                    <span className="text-xs tabular-nums text-muted">{regel.wanneer}</span>
                  </p>
                  <p className="mt-1 text-sm text-muted">{regel.tekst}</p>
                </li>
              ))}
            </ul>
            <CardBody className="border-t border-line-soft">
              <p className="text-sm text-muted">Hier staat het formulier om iets vast te leggen.</p>
            </CardBody>
          </Card>
        }
        rechts={
          <>
            <RelatiePersonen
              organizationId="demo"
              contacten={[
                contact("c1", "Nora Bakker", "Cultuurcoördinator", "n.bakker@markenhage.nl", "076 123 45 67"),
                contact("c2", "Joost Verhoeven", "Teamleider onderbouw", "j.verhoeven@markenhage.nl", null),
              ]}
            />

            <RelatieDeals
              deals={[
                {
                  id: "d1",
                  title: "Cultuurdag 2026",
                  value_cents: 145000,
                  expected_date: "2026-11-12",
                  faseLabel: "Offerte verstuurd",
                  afgesloten: null,
                },
                {
                  id: "d2",
                  title: "Workshopreeks onderbouw",
                  value_cents: 237000,
                  expected_date: null,
                  faseLabel: "Opvolging",
                  afgesloten: null,
                },
              ]}
            />

            <Card>
              <CardHeader title="Afspraken (1)" />
              <CardBody>
                <p className="text-sm font-semibold">Kennismaking op school</p>
                <p className="text-sm text-muted">do 24 sep 2026, 10:00 tot 11:00</p>
              </CardBody>
            </Card>
          </>
        }
      />
    </div>
  );
}
