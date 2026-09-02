import { Card, CardHeader } from "@/components/ui/card";
import {
  DeelnemerRegel,
  PeriodeKaart,
  type DeelnemerRegelGegevens,
  type PeriodeKaartGegevens,
} from "@/components/admin/periode-kaart";
import { RelatieBlok } from "@/components/admin/relatie-blok";
import { LifecycleBadge, StilteBadge } from "@/components/admin/crm-badges";
import { bezetting, contactStilte, type Lifecycle } from "@/lib/crm/regels";

/**
 * De visuele controle van fase 2 en 4.
 *
 * Juist de randgevallen staan hier bij elkaar: een lege periode, een volle,
 * eentje met te veel aanmeldingen, en deelnemers met een leeftijd die om
 * aandacht vraagt. Die zie je in de praktijk zelden achter elkaar, en dus
 * merk je pas laat als er eentje niet goed valt.
 *
 * De gegevens hieronder zijn verzonnen testwaarden voor de opmaak.
 */

function periode(
  naam: string,
  aangemeld: number,
  capaciteit: number,
  extra: Partial<PeriodeKaartGegevens> = {}
): PeriodeKaartGegevens {
  return {
    editionId: naam,
    name: naam,
    startsOn: "2027-03-12",
    endsOn: "2027-04-11",
    status: "open",
    capacity: capaciteit,
    priceCents: 425000,
    aangemeld,
    volledigBetaald: Math.max(aangemeld - 2, 0),
    ontvangenCents: aangemeld * 120000,
    stand: bezetting(aangemeld, capaciteit),
    ...extra,
  };
}

const PERIODES: PeriodeKaartGegevens[] = [
  periode("Maart 2027", 4, 15),
  periode("Oktober 2026", 14, 15, { startsOn: "2026-10-02", endsOn: "2026-11-01" }),
  periode("April 2027", 15, 15, { startsOn: "2027-04-30", endsOn: "2027-05-30" }),
  periode("Nog niet ingesteld", 17, 15, { priceCents: 0, status: "concept" }),
];

const DEELNEMERS: DeelnemerRegelGegevens[] = [
  {
    dealId: "1",
    naam: "Jayden Refos",
    email: "jayden@voorbeeld.nl",
    fase: "Aanbetaling ontvangen",
    leeftijd: { leeftijd: 19, toon: "goed", bericht: "19 bij vertrek." },
    stand: { volledig: false, openCents: 375000, teveelCents: 0 },
  },
  {
    dealId: "2",
    naam: "Naomi Pinas",
    email: "naomi@voorbeeld.nl",
    fase: "Volledig betaald",
    leeftijd: { leeftijd: 21, toon: "goed", bericht: "21 bij vertrek." },
    stand: { volledig: true, openCents: 0, teveelCents: 0 },
  },
  {
    dealId: "3",
    naam: "Ruben Doelwijt",
    email: null,
    fase: "Kennismakingsgesprek gepland",
    leeftijd: {
      leeftijd: 17,
      toon: "let-op",
      bericht: "17 bij vertrek, dus nog minderjarig. Toestemming van een ouder is nodig.",
    },
    stand: { volledig: false, openCents: 425000, teveelCents: 0 },
  },
  {
    dealId: "4",
    naam: "Iemand Met Een Heel Erg Lange Naam Van Der Berg-Van Der Meulen",
    email: "eenheellangemailadres.dattochmoetpassen@voorbeeldvaneenlangdomein.nl",
    fase: "Aanmelding",
    leeftijd: { leeftijd: 24, toon: "buiten", bericht: "24 bij vertrek, boven de doelgroep." },
    stand: { volledig: false, openCents: 0, teveelCents: 5000 },
  },
];

function Scherm({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <p className="mb-3 font-mono text-xs uppercase tracking-widest text-muted">{titel}</p>
      <div className="rounded-card border border-line bg-surface-2 p-4 sm:p-6">{children}</div>
    </section>
  );
}

export function Harness() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Scherm titel="Reisperiodes, van rustig tot overboekt">
        <div className="grid gap-4 sm:grid-cols-2">
          {PERIODES.map((p) => (
            <PeriodeKaart key={p.editionId} periode={p} />
          ))}
        </div>
      </Scherm>

      <Scherm titel="Deelnemers in een periode">
        <Card>
          <CardHeader title="Deelnemers" description="Op volgorde van de fase waarin ze staan." />
          <ul>
            {DEELNEMERS.map((d) => (
              <DeelnemerRegel key={d.dealId} deelnemer={d} />
            ))}
          </ul>
        </Card>
      </Scherm>

      <Scherm titel="De levensfases en de contactstilte">
        <div className="flex flex-wrap gap-2">
          {(["prospect", "lead", "klant", "oud_klant"] as Lifecycle[]).map((waarde) => (
            <LifecycleBadge key={waarde} waarde={waarde} />
          ))}
          <StilteBadge stilte={contactStilte(null, "2026-09-01")} />
          <StilteBadge stilte={contactStilte("2026-08-31", "2026-09-01")} />
          <StilteBadge stilte={contactStilte("2026-06-01", "2026-09-01")} />
          <StilteBadge stilte={contactStilte("2024-01-01", "2026-09-01")} />
        </div>
      </Scherm>

      <Scherm titel="Het relatieblok op de organisatiepagina">
        <div className="grid gap-5 lg:grid-cols-2">
          <RelatieBlok
            organizationId="demo"
            vandaag="2026-09-01"
            profiel={{
              organization_id: "demo",
              lifecycle: "prospect",
              owner_id: "u1",
              source: "Beurs Onderwijs Anders",
              last_contact_at: "2026-06-14T10:00:00.000Z",
              next_action_at: "2026-09-15",
              note: "Willen graag een cultuurdag in maart. Budget nog niet rond.",
              created_at: "2026-06-14T10:00:00.000Z",
              updated_at: "2026-06-14T10:00:00.000Z",
            }}
            contacten={[
              {
                id: "c1",
                organization_id: "demo",
                full_name: "Sanne de Vries",
                email: "s.devries@testschool.nl",
                phone: "06 12 34 56 78",
                job_title: "Cultuurcoördinator",
                note: null,
                is_unsubscribed: false,
                owner_id: null,
                linked_contact_id: null,
                contact_type: "cultuurcoordinator",
                lifecycle: "klant",
                city: "Amsterdam",
                portal_user_id: null,
                last_contact_at: null,
                created_by: null,
                created_at: "2026-06-14T10:00:00.000Z",
                updated_at: "2026-06-14T10:00:00.000Z",
              },
            ]}
            beheerders={[
              { id: "u1", naam: "Clinten" },
              { id: "u2", naam: "Collega" },
            ]}
          />
        </div>
      </Scherm>
    </div>
  );
}
