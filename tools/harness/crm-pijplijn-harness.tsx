import { Card, CardHeader } from "@/components/ui/card";
import { TaakRegel, TakenBlok, TijdlijnBlok } from "@/components/admin/tijdlijn-blok";
import type { Taak, TijdlijnRegel } from "@/lib/crm/tijdlijn";

/**
 * De visuele controle van fase 3 en 5.
 *
 * De tijdlijn met een systeemregel ertussen, taken in alle standen die er toe
 * doen (te laat, vandaag, later, zonder datum, afgerond), en een pijplijnkaart
 * met een lange naam erin. Dat laatste is waar een kolommenweergave als eerste
 * stukloopt.
 *
 * De gegevens zijn verzonnen testwaarden voor de opmaak.
 */

const BEHEERDERS = [
  { id: "u1", naam: "Clinten" },
  { id: "u2", naam: "Collega" },
];

const TIJDLIJN: TijdlijnRegel[] = [
  {
    id: "a1",
    kind: "systeem",
    summary: "Conceptboeking aangemaakt vanuit deze aanvraag. Nog niet bevestigd.",
    body: null,
    occurred_at: "2026-09-01T09:12:00.000Z",
    organization_id: "org",
    contact_id: null,
    deal_id: "deal",
    actor_id: "u1",
    is_system: true,
    created_at: "2026-09-01T09:12:00.000Z",
    updated_at: "2026-09-01T09:12:00.000Z",
    actorNaam: "Clinten",
  },
  {
    id: "a2",
    kind: "telefoon",
    summary: "Gebeld over de offerte",
    body: "Willen graag twee workshops op dezelfde dag. Budget moet nog langs de directie.\nTerugbellen na de herfstvakantie.",
    occurred_at: "2026-08-28T14:30:00.000Z",
    organization_id: "org",
    contact_id: null,
    deal_id: "deal",
    actor_id: "u2",
    is_system: false,
    created_at: "2026-08-28T14:30:00.000Z",
    updated_at: "2026-08-28T14:30:00.000Z",
    actorNaam: "Collega",
  },
  {
    id: "a3",
    kind: "notitie",
    summary: "Vorig jaar ook geboekt, toen via de cultuurcoördinator",
    body: null,
    occurred_at: "2026-08-14T08:00:00.000Z",
    organization_id: "org",
    contact_id: null,
    deal_id: null,
    actor_id: null,
    is_system: false,
    created_at: "2026-08-14T08:00:00.000Z",
    updated_at: "2026-08-14T08:00:00.000Z",
    actorNaam: null,
  },
];

function taak(over: Partial<Taak> & Pick<Taak, "id" | "title">): Taak {
  return {
    note: null,
    due_on: null,
    owner_id: "u1",
    organization_id: null,
    contact_id: null,
    deal_id: null,
    done_at: null,
    done_by: null,
    created_by: "u1",
    created_at: "2026-08-01T08:00:00.000Z",
    updated_at: "2026-08-01T08:00:00.000Z",
    ownerNaam: "Clinten",
    organisatieNaam: null,
    dagenTotVervaldatum: null,
    ...over,
  };
}

const TAKEN: Taak[] = [
  taak({
    id: "t1",
    title: "Offerte nabellen bij het Stedelijk Gymnasium",
    due_on: "2026-08-20",
    dagenTotVervaldatum: -13,
    organisatieNaam: "Stedelijk Gymnasium",
  }),
  taak({ id: "t2", title: "Datum bevestigen", due_on: "2026-09-02", dagenTotVervaldatum: 0 }),
  taak({
    id: "t3",
    title: "Factuur controleren",
    due_on: "2026-09-08",
    dagenTotVervaldatum: 6,
    ownerNaam: "Collega",
  }),
  taak({ id: "t4", title: "Drukker bellen over de flyers" }),
  taak({
    id: "t5",
    title: "Kennismakingsgesprek inplannen",
    due_on: "2026-08-25",
    dagenTotVervaldatum: -8,
    done_at: "2026-08-24T10:00:00.000Z",
    done_by: "u1",
  }),
];

function DealKaart({
  titel,
  organisatie,
  bedrag,
  datum,
  eigenaar,
}: {
  titel: string;
  organisatie: string;
  bedrag: string;
  datum: string;
  eigenaar?: string;
}) {
  return (
    <li>
      <div className="block rounded-card border border-line-soft bg-white p-3 shadow-card">
        <p className="truncate font-semibold">{titel}</p>
        <p className="truncate text-sm text-muted">{organisatie}</p>
        <p className="mt-1 flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted">
          <span className="tabular-nums">{bedrag}</span>
          <span>{datum}</span>
        </p>
        {eigenaar ? <p className="mt-1 truncate text-xs text-muted">{eigenaar}</p> : null}
      </div>
    </li>
  );
}

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
      <Scherm titel="Pijplijn, kolommen naast elkaar">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="grid min-w-[720px] grid-cols-4 gap-4">
            <section className="min-w-0">
              <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
                <h2 className="truncate text-sm font-semibold text-ink">Nieuwe aanvraag</h2>
                <span className="shrink-0 text-xs text-muted tabular-nums">2</span>
              </div>
              <p className="mb-2 px-1 text-xs text-muted tabular-nums">€ 2.900,00</p>
              <ul className="space-y-2">
                <DealKaart
                  titel="Cultuurdag maart"
                  organisatie="Stedelijk Gymnasium"
                  bedrag="€ 1.450,00"
                  datum="12 mrt 2027"
                  eigenaar="Clinten"
                />
                <DealKaart
                  titel="Workshopreeks met een hele lange omschrijving die niet past"
                  organisatie="Openbare Scholengemeenschap Noord-West"
                  bedrag="€ 1.450,00"
                  datum="geen datum"
                />
              </ul>
            </section>

            <section className="min-w-0">
              <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
                <h2 className="truncate text-sm font-semibold text-ink">Contact gelegd</h2>
                <span className="shrink-0 text-xs text-muted tabular-nums">1</span>
              </div>
              <p className="mb-2 px-1 text-xs text-muted tabular-nums">€ 780,00</p>
              <ul className="space-y-2">
                <DealKaart
                  titel="Breakdance groep 7"
                  organisatie="De Regenboog"
                  bedrag="€ 780,00"
                  datum="4 nov 2026"
                  eigenaar="Collega"
                />
              </ul>
            </section>

            <section className="min-w-0">
              <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
                <h2 className="truncate text-sm font-semibold text-ink">Offerte verstuurd</h2>
                <span className="shrink-0 text-xs text-muted tabular-nums">0</span>
              </div>
              <p className="mb-2 px-1 text-xs text-muted tabular-nums">—</p>
              <ul className="space-y-2">
                <li className="rounded-card border border-dashed border-line px-3 py-4 text-center text-xs text-muted-soft">
                  leeg
                </li>
              </ul>
            </section>

            <section className="min-w-0">
              <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
                <h2 className="truncate text-sm font-semibold text-ink">Akkoord</h2>
                <span className="shrink-0 text-xs text-muted tabular-nums">1</span>
              </div>
              <p className="mb-2 px-1 text-xs text-muted tabular-nums">€ 2.100,00</p>
              <ul className="space-y-2">
                <DealKaart
                  titel="Sportdag"
                  organisatie="Het Kompas"
                  bedrag="€ 2.100,00"
                  datum="19 jan 2027"
                  eigenaar="Clinten"
                />
              </ul>
            </section>
          </div>
        </div>
      </Scherm>

      <Scherm titel="Taken in alle standen">
        <Card>
          <CardHeader title="Taken" description="Wat er nog moet gebeuren." />
          <ul>
            {TAKEN.map((t) => (
              <TaakRegel key={t.id} taak={t} toonRelatie />
            ))}
          </ul>
        </Card>
      </Scherm>

      <Scherm titel="De tijdlijn, met een systeemregel ertussen">
        <div className="grid gap-5 lg:grid-cols-2">
          <TijdlijnBlok onderwerp={{ organizationId: "org" }} regels={TIJDLIJN} />
          <TakenBlok
            onderwerp={{ organizationId: "org" }}
            taken={TAKEN.slice(0, 3)}
            beheerders={BEHEERDERS}
          />
        </div>
      </Scherm>

      <Scherm titel="Een lege tijdlijn">
        <div className="max-w-xl">
          <TijdlijnBlok onderwerp={{ organizationId: "org" }} regels={[]} />
        </div>
      </Scherm>
    </div>
  );
}
