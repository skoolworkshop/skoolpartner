import { Card, CardHeader } from "@/components/ui/card";
import { ContactTypeBadge, PortalBadge, PortalUitleg } from "@/components/admin/contact-badges";
import { DealKaart, type DealKaartGegevens } from "@/components/admin/deal-kaart";
import { LifecycleBadge } from "@/components/admin/crm-badges";
import type { PortalStatus } from "@/lib/crm/contacten";
import type { CrmContactType } from "@/lib/types/database";
import type { Lifecycle } from "@/lib/crm/regels";

/**
 * De visuele controle van de contacten, de organisaties en de dealkaarten.
 *
 * Het belangrijkste dat hier te zien moet zijn: het verschil tussen "geen
 * account", "account gevonden" en "account actief". Dat onderscheid is de kern
 * van deze ronde, en als het op het scherm niet duidelijk is, klopt het model
 * wel maar helpt het niemand.
 *
 * De gegevens zijn verzonnen testwaarden voor de opmaak.
 */

interface Rij {
  naam: string;
  functie: string;
  organisatie: string | null;
  type: CrmContactType | null;
  fase: Lifecycle | null;
  email: string | null;
  telefoon: string | null;
  deals: number;
  portal: PortalStatus;
}

const CONTACTEN: Rij[] = [
  {
    naam: "Nora Bakker",
    functie: "Cultuurcoördinator",
    organisatie: "Markenhage College",
    type: "cultuurcoordinator",
    fase: "klant",
    email: "n.bakker@markenhage.nl",
    telefoon: "076 123 45 67",
    deals: 2,
    portal: { stand: "geen" },
  },
  {
    naam: "Peter Jansen",
    functie: "Decaan",
    organisatie: "Markenhage College",
    type: "decaan",
    fase: "klant",
    email: "p.jansen@markenhage.nl",
    telefoon: null,
    deals: 0,
    portal: { stand: "geen" },
  },
  {
    naam: "Wil de Groot",
    functie: "Administratie",
    organisatie: "Markenhage College",
    type: "administratie",
    fase: "klant",
    email: "administratie@markenhage.nl",
    telefoon: "076 123 45 68",
    deals: 0,
    portal: {
      stand: "gekoppeld",
      userId: "u9",
      naam: "Wil de Groot",
      email: "administratie@markenhage.nl",
    },
  },
  {
    naam: "Emma Laboyrie",
    functie: "Opdrachtgever",
    organisatie: "Metis Montessori Lyceum",
    type: "opdrachtgever",
    fase: "klant",
    email: "e.laboyrie@msa.nl",
    telefoon: "+31 6 19422221",
    deals: 1,
    portal: { stand: "gevonden", userId: "u4", naam: null, email: "e.laboyrie@msa.nl" },
  },
  {
    naam: "Iemand die ooit belde",
    functie: "",
    organisatie: null,
    type: null,
    fase: "prospect",
    email: null,
    telefoon: "06 12 34 56 78",
    deals: 0,
    portal: { stand: "geen" },
  },
  {
    naam: "Jayden Refos",
    functie: "",
    organisatie: null,
    type: "deelnemer",
    fase: "lead",
    email: "jayden@voorbeeld.nl",
    telefoon: null,
    deals: 1,
    portal: { stand: "geen" },
  },
];

const DEALS: DealKaartGegevens[] = [
  {
    id: "1",
    titel: "Cultuurdag 2026",
    organisatie: "Markenhage College",
    contact: "Nora Bakker",
    waardeCents: 145000,
    datum: "2027-03-12",
    eigenaar: "Clinten",
    dagenInFase: 3,
    volgendeTaak: null,
    href: "#",
  },
  {
    id: "2",
    titel: "Introductiedag 2027",
    organisatie: "Markenhage College",
    contact: "Nora Bakker",
    waardeCents: 387176,
    datum: "2027-08-19",
    eigenaar: "Collega",
    dagenInFase: 21,
    volgendeTaak: { titel: "Offerte nabellen", dueOn: "2026-09-08", teLaat: false },
    href: "#",
  },
  {
    id: "3",
    titel: "Workshopreeks met een omschrijving die veel te lang is voor deze kaart",
    organisatie: "Openbare Scholengemeenschap Noord-West",
    contact: null,
    waardeCents: 78000,
    datum: null,
    eigenaar: null,
    dagenInFase: 118,
    volgendeTaak: { titel: "Terugbellen na de zomervakantie", dueOn: "2026-08-20", teLaat: true },
    href: "#",
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
      <Scherm titel="Contactenoverzicht, tabel op desktop">
        <Card>
          <CardHeader title="Overzicht" description="6 van 6 contacten" />
          <div className="overflow-x-auto">
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
                </tr>
              </thead>
              <tbody>
                {CONTACTEN.map((rij) => (
                  <tr key={rij.naam} className="border-b border-line-soft last:border-b-0">
                    <td className="px-5 py-3">
                      <span className="font-semibold text-ink">{rij.naam}</span>
                      {rij.functie ? (
                        <span className="block text-xs text-muted">{rij.functie}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-muted">
                      {rij.organisatie ?? <span className="text-muted-soft">geen</span>}
                    </td>
                    <td className="px-3 py-3">
                      <ContactTypeBadge type={rij.type} />
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-3 text-muted">
                      {rij.email ?? "—"}
                    </td>
                    <td className="hidden px-3 py-3 text-muted xl:table-cell">{rij.telefoon ?? "—"}</td>
                    <td className="px-3 py-3 tabular-nums text-muted">{rij.deals || "—"}</td>
                    <td className="px-5 py-3">
                      <PortalBadge portal={rij.portal} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Scherm>

      <Scherm titel="Hetzelfde overzicht op een telefoon">
        <div className="mx-auto max-w-[340px]">
          <Card>
            <ul>
              {CONTACTEN.map((rij) => (
                <li key={rij.naam} className="border-b border-line-soft px-5 py-3.5 last:border-b-0">
                  <p className="font-semibold text-ink">{rij.naam}</p>
                  <p className="truncate text-sm text-muted">
                    {[rij.functie, rij.organisatie, rij.email].filter(Boolean).join(" · ") ||
                      "geen verdere gegevens"}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <ContactTypeBadge type={rij.type} />
                    {rij.fase ? <LifecycleBadge waarde={rij.fase} /> : null}
                    <PortalBadge portal={rij.portal} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Scherm>

      <Scherm titel="De drie standen van de klantportaalstatus">
        <div className="grid gap-4 lg:grid-cols-3">
          <PortalUitleg portal={{ stand: "geen" }} organizationId={null} />
          <PortalUitleg
            portal={{ stand: "gevonden", userId: "u4", naam: null, email: "e.laboyrie@msa.nl" }}
            organizationId="demo"
          />
          <PortalUitleg
            portal={{
              stand: "gekoppeld",
              userId: "u9",
              naam: "Wil de Groot",
              email: "administratie@markenhage.nl",
            }}
            organizationId="demo"
          />
        </div>
      </Scherm>

      <Scherm titel="Dealkaarten: organisatie, contactpersoon, taak en tijd in de fase">
        <div className="flex gap-4 overflow-x-auto pb-2">
          {DEALS.map((deal) => (
            <div key={deal.id} className="w-[260px] shrink-0">
              <ul>
                <DealKaart deal={deal} />
              </ul>
            </div>
          ))}
        </div>
      </Scherm>
    </div>
  );
}
