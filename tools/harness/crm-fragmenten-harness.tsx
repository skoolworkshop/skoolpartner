import { FragmentenScherm } from "@/app/admin/crm/fragmenten/fragmenten-scherm";
import { FragmentKiezer } from "@/components/admin/fragment-kiezer";
import type { Fragment } from "@/lib/crm/fragmenten";
import type { KiesbaarFragment, TokenContext } from "@/lib/crm/fragment-tekst";

/**
 * De visuele controle van de fragmenten.
 *
 * Dit rendert het echte scherm met de echte tekstverwerking; alleen de
 * gegevens zijn verzonnen testwaarden voor de opmaak.
 *
 * Waar deze harness vooral op let:
 *   - blijft een fragment met een lange tekst leesbaar op een telefoon?
 *   - valt een onbekend token voldoende op?
 *   - past de keuzelijst binnen het scherm, ook op 390 pixels?
 */

function fragment(waarden: Partial<Fragment> & { id: string; name: string; body: string }): Fragment {
  return {
    brand: null,
    shortcut: waarden.id,
    category: null,
    isArchived: false,
    createdAt: "2026-08-01T09:00:00Z",
    aantalKeerGebruikt: 0,
    laatstGebruikt: null,
    tokens: [],
    onbekendeTokens: [],
    ...waarden,
  };
}

const FRAGMENTEN: Fragment[] = [
  fragment({
    id: "aanhef",
    name: "Aanhef",
    shortcut: "aanhef",
    body: "Beste {{voornaam|relatie}},",
    category: "basis",
    aantalKeerGebruikt: 34,
    laatstGebruikt: "2026-09-01T14:20:00Z",
    tokens: ["voornaam"],
  }),
  fragment({
    id: "offerte-nabellen",
    name: "Offerte nabellen",
    shortcut: "offerte-nabellen",
    brand: "skool_workshop",
    category: "opvolging",
    body:
      "Beste {{voornaam|relatie}},\n\nEerder stuurde ik jullie een voorstel voor {{deal}}. Ik ben benieuwd of het zo aansluit bij wat jullie voor ogen hebben, en of er nog iets ontbreekt.\n\nAls het handiger is om even te bellen, hoor ik graag wanneer het jullie schikt.\n\nMet vriendelijke groet,\n{{mijn_naam}}",
    aantalKeerGebruikt: 12,
    laatstGebruikt: "2026-08-28T09:05:00Z",
    tokens: ["voornaam", "deal", "mijn_naam"],
  }),
  fragment({
    id: "typefout",
    name: "Fragment met een typefout",
    shortcut: "typefout",
    category: "opvolging",
    body: "Beste {{voornaan}},\n\nOver {{organistie}} wilde ik nog iets vragen.",
    tokens: [],
    onbekendeTokens: ["voornaan", "organistie"],
  }),
  fragment({
    id: "breekjaar-info",
    name: "Breekjaar, korte uitleg",
    shortcut: "breekjaar-info",
    brand: "suri_impact",
    category: "informatie",
    body:
      "Beste {{voornaam|relatie}},\n\nHet Suri Impact Breekjaar is een vierweeks tussenjaarprogramma in Suriname voor jongeren van 17 tot en met 22 jaar.\n\nMet vriendelijke groet,\n{{mijn_naam}}",
    aantalKeerGebruikt: 3,
    laatstGebruikt: "2026-07-11T11:00:00Z",
    tokens: ["voornaam", "mijn_naam"],
  }),
  fragment({
    id: "oude-tekst",
    name: "Oude prijsopbouw",
    shortcut: "oude-tekst",
    category: "archief",
    body: "Deze tekst gebruiken wij niet meer.",
    isArchived: true,
    aantalKeerGebruikt: 41,
    laatstGebruikt: "2026-02-03T10:00:00Z",
  }),
];

const KIESBAAR: KiesbaarFragment[] = FRAGMENTEN.filter((f) => !f.isArchived).map((f) => ({
  id: f.id,
  naam: f.name,
  sneltoets: f.shortcut,
  categorie: f.category,
  tekst: f.body,
}));

const CONTEXT: TokenContext = {
  voornaam: "Nora",
  achternaam: "Bakker",
  volledige_naam: "Nora Bakker",
  functie: "Cultuurcoordinator",
  organisatie: "Markenhage College",
  plaats: "Breda",
  deal: "Cultuurdag 2026",
  bedrag: "€ 1.450,00",
  datum: "12 maart 2027",
  mijn_naam: "Clinten",
  mijn_email: "info@skoolworkshop.nl",
  vandaag: "2 september 2026",
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
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Scherm titel="De keuzelijst, open, zoals hij bij een notitie staat">
        <div className="rounded-card border border-line-soft bg-white p-5">
          <label htmlFor="demo-body" className="mb-1.5 block text-sm font-semibold">
            Toelichting
          </label>
          <textarea
            id="demo-body"
            rows={4}
            defaultValue="Gebeld met de school over de datum."
            className="mb-3 w-full rounded-card border border-line bg-white px-3 py-2 text-sm"
          />
          <FragmentKiezer
            fragmenten={KIESBAAR}
            context={CONTEXT}
            doelId="demo-body"
            onderwerp={{ dealId: "demo" }}
            standaardOpen
          />
        </div>
      </Scherm>

      <Scherm titel="Het beheerscherm op een breed scherm">
        <FragmentenScherm
          fragmenten={FRAGMENTEN.filter((f) => !f.isArchived)}
          categorieen={["basis", "opvolging", "informatie"]}
          filter={{}}
          toonArchief={false}
        />
      </Scherm>

      <Scherm titel="Hetzelfde scherm op een telefoon">
        <div className="mx-auto max-w-[340px]">
          <FragmentenScherm
            fragmenten={FRAGMENTEN}
            categorieen={["basis", "opvolging", "informatie", "archief"]}
            filter={{}}
            toonArchief
          />
        </div>
      </Scherm>
    </div>
  );
}
