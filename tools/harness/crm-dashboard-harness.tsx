import { DashboardScherm } from "@/app/admin/crm/dashboard-scherm";
import { maakPeriode, type DealInvoer, type FaseInvoer } from "@/lib/crm/dashboard-berekening";
import { berekenDashboard } from "@/lib/crm/dashboard-berekening";
import type { DashboardGegevens } from "@/lib/crm/dashboard";

/**
 * De visuele controle van het commerciele dashboard.
 *
 * Belangrijk: dit rendert het echte scherm met echte berekeningen, alleen op
 * verzonnen invoer. De cijfers hieronder zijn dus geen fictieve uitkomsten die
 * ik heb opgeschreven, maar het resultaat van dezelfde functies die in
 * productie draaien. Wat je op de schermafbeelding ziet, klopt dus ook echt
 * met de invoer die eronder staat.
 *
 * Waar deze harness vooral op let:
 *   - passen twaalf KPI-tegels op een telefoon zonder horizontaal geschuif?
 *   - blijft de grafiek leesbaar met twee merken in dezelfde maand?
 *   - is "onvoldoende data" duidelijk als er te weinig metingen zijn?
 */

const VANDAAG = "2026-09-02";

const FASES: FaseInvoer[] = [
  { id: "sw-1", brand: "skool_workshop", key: "nieuwe_aanvraag", label: "Nieuwe aanvraag", position: 10, isWon: false, isLost: false },
  { id: "sw-2", brand: "skool_workshop", key: "contact_gelegd", label: "In behandeling", position: 20, isWon: false, isLost: false },
  { id: "sw-3", brand: "skool_workshop", key: "offerte_verstuurd", label: "Offerte verstuurd", position: 30, isWon: false, isLost: false },
  { id: "sw-4", brand: "skool_workshop", key: "opvolging", label: "Opvolging", position: 40, isWon: false, isLost: false },
  { id: "sw-5", brand: "skool_workshop", key: "akkoord", label: "Klant bevestigd", position: 50, isWon: false, isLost: false },
  { id: "sw-9", brand: "skool_workshop", key: "afgerond", label: "Afgerond", position: 100, isWon: true, isLost: false },
  { id: "sw-0", brand: "skool_workshop", key: "verloren", label: "Niet doorgegaan", position: 200, isWon: false, isLost: true },
  { id: "su-1", brand: "suri_impact", key: "aanmelding", label: "Aanmelding", position: 10, isWon: false, isLost: false },
  { id: "su-9", brand: "suri_impact", key: "volledig_betaald", label: "Volledig betaald", position: 100, isWon: true, isLost: false },
];

function deal(
  id: string,
  stageId: string,
  title: string,
  waarde: number,
  sinds: string,
  extra: Partial<DealInvoer> = {}
): DealInvoer {
  return {
    id,
    brand: "skool_workshop",
    title,
    stageId,
    organizationId: `org-${id}`,
    contactId: null,
    valueCents: waarde,
    expectedDate: null,
    createdAt: `${sinds}T09:00:00Z`,
    closedAt: null,
    stageSince: `${sinds}T09:00:00Z`,
    ownerId: null,
    ...extra,
  };
}

const DEALS: DealInvoer[] = [
  deal("a", "sw-1", "Cultuurdag Markenhage", 145_000, "2026-08-28"),
  deal("b", "sw-1", "Introductiedagen Metis", 92_000, "2026-09-01"),
  deal("c", "sw-2", "Workshopreeks OSG Noord-West", 240_000, "2026-08-12"),
  deal("d", "sw-3", "Projectweek Da Vinci", 187_000, "2026-06-20"),
  deal("e", "sw-3", "Maatschappelijke stage Corlaer", 78_000, "2026-08-20"),
  deal("f", "sw-4", "Themadag burgerschap Calvijn", 132_000, "2026-07-15"),
  deal("g", "sw-5", "Sportdag Hermann Wesselink", 64_000, "2026-08-30"),
  deal("h", "sw-9", "Cultuurdag Fons Vitae", 156_000, "2026-07-01", {
    closedAt: "2026-09-01T09:00:00Z",
  }),
  deal("i", "sw-0", "Techniekdag Amstelveen College", 45_000, "2026-06-01", {
    closedAt: "2026-08-28T09:00:00Z",
  }),
  {
    ...deal("j", "su-9", "Breekjaar voorjaar, Jayden", 250_000, "2026-07-10", {
      closedAt: "2026-09-01T09:00:00Z",
    }),
    brand: "suri_impact",
    organizationId: null,
    contactId: "c-1",
  },
  {
    ...deal("k", "su-1", "Breekjaar najaar, Amina", 250_000, "2026-08-25"),
    brand: "suri_impact",
    organizationId: null,
    contactId: "c-2",
  },
];

const cijfers = berekenDashboard({
  deals: DEALS,
  fases: FASES,
  gebeurtenissen: [
    { dealId: "d", fromStageId: "sw-1", toStageId: "sw-2", createdAt: "2026-06-05T09:00:00Z" },
    { dealId: "d", fromStageId: "sw-2", toStageId: "sw-3", createdAt: "2026-06-20T09:00:00Z" },
    { dealId: "h", fromStageId: "sw-1", toStageId: "sw-2", createdAt: "2026-05-20T09:00:00Z" },
    { dealId: "h", fromStageId: "sw-2", toStageId: "sw-9", createdAt: "2026-07-01T09:00:00Z" },
  ],
  facturen: [
    { organizationId: "org-h", betaaldOp: "2026-09-05", betaaldCents: 156_000 },
    { organizationId: "org-c", betaaldOp: "2026-08-14", betaaldCents: 98_000 },
    { organizationId: "org-d", betaaldOp: "2026-07-22", betaaldCents: 212_000 },
    { organizationId: "org-h", betaaldOp: "2026-06-10", betaaldCents: 87_000 },
    { organizationId: "org-c", betaaldOp: "2026-05-18", betaaldCents: 143_000 },
    { organizationId: "org-x", betaaldOp: "2026-03-11", betaaldCents: 64_000 },
  ],
  suriBetalingen: [
    { dealId: "j", amountCents: 90_000, ontvangenOp: "2026-09-01" },
    { dealId: "j", amountCents: 160_000, ontvangenOp: "2026-08-05" },
    { dealId: "k", amountCents: 50_000, ontvangenOp: "2026-07-02" },
  ],
  taken: [
    {
      id: "t1",
      title: "Offerte Da Vinci nabellen",
      dueOn: "2026-08-18",
      doneAt: null,
      dealId: "d",
      organizationId: null,
      contactId: null,
      ownerId: null,
    },
    {
      id: "t2",
      title: "Datum Calvijn bevestigen",
      dueOn: "2026-09-02",
      doneAt: null,
      dealId: "f",
      organizationId: null,
      contactId: null,
      ownerId: null,
    },
    {
      id: "t3",
      title: "Terugbellen na de zomervakantie",
      dueOn: "2026-08-21",
      doneAt: null,
      dealId: "c",
      organizationId: null,
      contactId: null,
      ownerId: null,
    },
  ],
  afspraken: [
    {
      id: "m1",
      title: "Kennismaking Markenhage",
      startsAt: "2026-08-20T08:30:00.000Z",
      endsAt: "2026-08-20T09:30:00.000Z",
      status: "gepland",
      outcome: null,
      dealId: "a",
      organizationId: "org-a",
    },
    {
      id: "m2",
      title: "Belafspraak over de offerte",
      startsAt: "2026-09-02T13:00:00.000Z",
      endsAt: "2026-09-02T13:30:00.000Z",
      status: "gepland",
      outcome: null,
      dealId: "d",
      organizationId: "org-d",
    },
    {
      id: "m3",
      title: "Evaluatie na de workshopweek",
      startsAt: "2026-08-26T09:00:00.000Z",
      endsAt: "2026-08-26T09:45:00.000Z",
      status: "gehouden",
      outcome: null,
      dealId: "c",
      organizationId: "org-c",
    },
  ],
  periode: maakPeriode("deze-maand", VANDAAG),
  merk: "alles",
  vandaag: VANDAAG,
});

const GEGEVENS: DashboardGegevens = {
  ...cijfers,
  organisatieNamen: new Map([
    ["org-h", "Fons Vitae Lyceum"],
    ["org-c", "OSG Noord-West"],
    ["org-d", "Da Vinci College"],
    ["org-x", "Amstelveen College"],
  ]),
  heeftDeals: true,
  facturenZonderDatum: 0,
};

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
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Scherm titel="Het dashboard op een breed scherm">
        <DashboardScherm
          cijfers={GEGEVENS}
          periode={maakPeriode("deze-maand", VANDAAG)}
          merk="alles"
          vandaag={VANDAAG}
          aangepast={{ vanaf: null, tot: null }}
        />
      </Scherm>

      <Scherm titel="Hetzelfde dashboard op een telefoon">
        <div className="mx-auto max-w-[340px]">
          <DashboardScherm
            cijfers={GEGEVENS}
            periode={maakPeriode("deze-maand", VANDAAG)}
            merk="alles"
            vandaag={VANDAAG}
            aangepast={{ vanaf: null, tot: null }}
          />
        </div>
      </Scherm>
    </div>
  );
}
