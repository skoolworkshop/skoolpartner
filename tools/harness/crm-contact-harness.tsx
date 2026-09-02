import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ContactTypeBadge } from "@/components/admin/contact-badges";
import { LifecycleBadge } from "@/components/admin/crm-badges";
import { DetailIndeling } from "@/components/admin/detail-indeling";

/**
 * De nieuwe indeling van een contactpagina.
 *
 * WAT DEZE CONTROLE WEL EN NIET AANTOONT
 *
 *   Wel: dat het raster van DetailIndeling klopt. Drie kolommen op een breed
 *   scherm, twee met de rechterkolom eronder op een middelgroot scherm, en
 *   alles onder elkaar op een telefoon zonder horizontaal te hoeven schuiven.
 *   Dat raster is precies wat is veranderd.
 *
 *   Niet: hoe de tijdlijn, de takenlijst en het afsprakenblok er van binnen
 *   uitzien. Die blokken zijn niet aangeraakt en staan al in de controles van
 *   de contacten- en afsprakenschermen. Hier staat inhoud die er qua dichtheid
 *   op lijkt, zodat de kolommen op een echte hoeveelheid tekst worden getest.
 */

const TIJDLIJN = [
  { wanneer: "28 aug 2026", soort: "Telefoon", tekst: "Gebeld over de cultuurdag. Wil een offerte voor drie klassen, liefst in november." },
  { wanneer: "21 aug 2026", soort: "E-mail", tekst: "Offerte verstuurd, 3 workshops van 90 minuten." },
  { wanneer: "14 aug 2026", soort: "Notitie", tekst: "Budget loopt via de ouderraad, beslissing valt na de teamvergadering." },
  { wanneer: "02 jul 2026", soort: "Afspraak", tekst: "Kennismaking op school geweest, samen met de teamleider onderbouw." },
];

export function Harness() {
  return (
    <div className="px-4 py-8">
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h1 className="text-[30px]">Nora Bakker</h1>
        <ContactTypeBadge type="cultuurcoordinator" />
        <LifecycleBadge waarde="klant" />
      </div>
      <p className="mb-4 text-[15px] text-muted">Cultuurcoordinator · Markenhage College · Breda</p>

      <div className="mb-6 flex flex-wrap gap-2">
        <span className="inline-flex min-h-9 items-center gap-1.5 rounded-pill border border-line bg-white px-3.5 text-sm font-semibold text-ink">
          Mailen
        </span>
        <span className="inline-flex min-h-9 items-center gap-1.5 rounded-pill border border-line bg-white px-3.5 text-sm font-semibold text-ink">
          Bellen
        </span>
      </div>

      <DetailIndeling
        links={
          <>
            <Card>
              <CardHeader title="Contactgegevens" />
              <CardBody className="space-y-4">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted">E-mail</dt>
                  <dd className="break-words font-medium">n.bakker@markenhage.nl</dd>
                  <dt className="text-muted">Telefoon</dt>
                  <dd className="font-medium">076 123 45 67</dd>
                  <dt className="text-muted">Laatste contact</dt>
                  <dd className="font-medium">28 aug 2026</dd>
                  <dt className="text-muted">Toegevoegd</dt>
                  <dd className="font-medium">14 mrt 2025</dd>
                </dl>
                <p className="text-sm text-muted">
                  Er is een account in het klantportaal met hetzelfde adres. Een gelijk adres is een
                  aanwijzing en geen bewijs, dus koppelen blijft een bewuste keuze.
                </p>
              </CardBody>
            </Card>

            <details className="rounded-card border border-line-soft bg-white shadow-card">
              <summary className="cursor-pointer px-5 py-4 font-display text-base font-semibold">
                Gegevens aanpassen
              </summary>
              <div className="px-5 pb-5 text-sm text-muted">
                Het volledige formulier staat hier, ingeklapt tot je het nodig hebt.
              </div>
            </details>
          </>
        }
        midden={
          <Card>
            <CardHeader
              title="Tijdlijn"
              description="Wat er is gebeurd. Regels met Automatisch schrijft het systeem zelf."
            />
            <ul>
              {TIJDLIJN.map((regel) => (
                <li key={regel.wanneer} className="border-b border-line-soft px-5 py-3 last:border-b-0">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">{regel.soort}</span>
                    <span className="text-xs text-muted tabular-nums">{regel.wanneer}</span>
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
            <Card>
              <CardHeader title="Deals (2)" description="Verkoopkansen waar deze persoon bij betrokken is." />
              <ul>
                {[
                  { titel: "Cultuurdag 2026", fase: "Offerte verstuurd", bedrag: "€ 1.450,00" },
                  { titel: "Workshopreeks onderbouw", fase: "Opvolging", bedrag: "€ 2.370,00" },
                ].map((deal) => (
                  <li key={deal.titel} className="border-b border-line-soft last:border-b-0">
                    <span className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{deal.titel}</span>
                        <span className="block text-sm text-muted">{deal.fase}</span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">{deal.bedrag}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <CardHeader title="Afspraken (1)" />
              <CardBody>
                <p className="text-sm font-semibold">Kennismaking op school</p>
                <p className="text-sm text-muted">do 24 sep 2026, 10:00 tot 11:00</p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Taken (2)" description="Wat er nog moet gebeuren." />
              <CardBody>
                <p className="text-sm">Offerte nabellen · <span className="text-danger">18 aug 2026</span></p>
                <p className="mt-2 text-sm">Datum bevestigen bij de docent · 12 sep 2026</p>
              </CardBody>
            </Card>
          </>
        }
      />
    </div>
  );
}
