import { Card, CardHeader } from "@/components/ui/card";
import { PijplijnBord } from "@/components/admin/pijplijn-bord";
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
      <Scherm titel="Het pijplijnbord met alle fases">
        <PijplijnBord
          fases={[
            { id: "f1", key: "nieuwe_aanvraag", label: "Nieuwe aanvraag", isWon: false, isLost: false },
            { id: "f2", key: "contact_gelegd", label: "In behandeling", isWon: false, isLost: false },
            { id: "f3", key: "offerte_verstuurd", label: "Offerte verstuurd", isWon: false, isLost: false },
            { id: "f4", key: "opvolging", label: "Opvolging", isWon: false, isLost: false },
            { id: "f5", key: "akkoord", label: "Klant bevestigd", isWon: false, isLost: false },
            { id: "f6", key: "facturatie", label: "Facturatie", isWon: false, isLost: false },
            { id: "f7", key: "ingepland", label: "Agenda en planning", isWon: false, isLost: false },
            { id: "f8", key: "uitgevoerd", label: "Uitgevoerd", isWon: false, isLost: false },
            { id: "f9", key: "evaluatie", label: "Evaluatie", isWon: false, isLost: false },
            { id: "f10", key: "afgerond", label: "Afgerond", isWon: true, isLost: false },
            { id: "f11", key: "verloren", label: "Niet doorgegaan", isWon: false, isLost: true },
          ]}
          deals={[
            {
              id: "d1",
              stageId: "f3",
              titel: "Workshops | Xpect Primair",
              organisatie: "Xpect Primair",
              contact: "Richard Bakx",
              waardeCents: 88352,
              datum: null,
              eigenaar: null,
              volgendeTaak: null,
              href: "#",
            },
            {
              id: "d2",
              stageId: "f3",
              titel: "Kinderfeestje Videoclip Maken - Zilverschoon met een hele lange naam erachter",
              organisatie: null,
              contact: "Isabel De Smit",
              waardeCents: 0,
              datum: null,
              eigenaar: null,
              volgendeTaak: { titel: "Offerte nabellen", dueOn: "2026-08-18", teLaat: true },
              href: "#",
            },
            {
              id: "d3",
              stageId: "f4",
              titel: "Praktijkschool Stedebroec - Workshopdag",
              organisatie: "Praktijkschool Stedebroec",
              contact: "Roel Neefjes",
              waardeCents: 205644,
              datum: "2024-12-12",
              eigenaar: "Clinten",
              volgendeTaak: null,
              href: "#",
            },
          ]}
        />
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
