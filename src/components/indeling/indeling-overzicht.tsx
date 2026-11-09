import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { KlasLijst, WorkshopLijst } from "@/lib/inschrijving/lijsten";
import { aantalMet } from "@/lib/inschrijving/regels";

/**
 * Wat de school ziet: de actuele indeling.
 *
 * ALTIJD DE LAATSTE STAND
 *
 *   Deze pagina rekent bij elk bezoek opnieuw. Er staat dus geen oude
 *   bijlage klaar die niet meer klopt. Verandert er nog iets, dan ziet de
 *   school dat hier zonder dat wij opnieuw hoeven te mailen.
 *
 * ALLEEN KIJKEN
 *
 *   Er valt hier niets te wijzigen. Dat voorkomt dat er op twee plekken
 *   tegelijk aan dezelfde indeling wordt getrokken.
 */

export interface OverzichtDag {
  naam: string;
  datumTekst: string;
  organisatie: string;
  locatie: string | null;
}

export function IndelingOverzicht({
  dag,
  klassen,
  workshops,
  aantalOpen,
  downloads,
}: {
  dag: OverzichtDag;
  klassen: KlasLijst[];
  workshops: WorkshopLijst[];
  aantalOpen: number;
  downloads: { label: string; href: string }[];
}) {
  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm font-semibold text-muted">{dag.organisatie}</p>
        <h1 className="text-[30px]">{dag.naam}</h1>
        <p className="text-[15px] text-muted">
          {dag.datumTekst}
          {dag.locatie ? ` · ${dag.locatie}` : ""}
        </p>
      </header>

      {aantalOpen > 0 ? (
        <p className="rounded-card border border-line-soft bg-surface-2 px-4 py-3 text-sm">
          Er {aantalOpen === 1 ? "staat" : "staan"} nog {aantalMet(aantalOpen, "plek", "plekken")} open. Wij
          delen die in zodra de inschrijving sluit, en dan klopt dit overzicht weer helemaal.
        </p>
      ) : null}

      <Card>
        <CardHeader
          title="Lijsten downloaden"
          description="De bestanden worden op het moment van downloaden gemaakt, dus ze kloppen met wat je hier ziet."
        />
        <CardBody>
          <ul className="flex flex-wrap gap-2">
            {downloads.map((bestand) => (
              <li key={bestand.href}>
                <a
                  href={bestand.href}
                  className="inline-flex rounded-pill border border-line-soft bg-white px-3.5 py-2 text-sm font-semibold hover:border-ink"
                >
                  {bestand.label}
                </a>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {/* ---------------------------------------------------------------
          Per klas
      --------------------------------------------------------------- */}
      <section className="space-y-3">
        <h2 className="text-[22px]">Per klas</h2>
        {klassen.map((klas) => (
          <Card key={klas.klas}>
            <CardHeader title={klas.klas} description={aantalMet(klas.regels.length, "leerling", "leerlingen")} />
            <CardBody className="px-0 py-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-line-soft text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-5 py-2 font-semibold">Naam</th>
                      {klas.rondes.map((ronde) => (
                        <th key={ronde.id} className="px-3 py-2 font-semibold">
                          {ronde.label}
                          <span className="block font-normal normal-case tracking-normal">{ronde.tijd}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {klas.regels.map((regel) => (
                      <tr key={regel.naam}>
                        <td className="px-5 py-2 font-medium">{regel.naam}</td>
                        {regel.perRonde.map((tekst, positie) => (
                          <td key={klas.rondes[positie]?.id ?? positie} className="px-3 py-2">
                            {tekst === "Nog niet ingedeeld" ? (
                              <span className="text-muted">{tekst}</span>
                            ) : (
                              tekst
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        ))}
      </section>

      {/* ---------------------------------------------------------------
          Per workshop
      --------------------------------------------------------------- */}
      <section className="space-y-3">
        <h2 className="text-[22px]">Per workshop</h2>
        {workshops.map((workshop) => (
          <Card key={`${workshop.rondeLabel}-${workshop.workshop}`}>
            <CardHeader
              title={workshop.workshop}
              description={[
                workshop.rondeLabel,
                workshop.tijd,
                workshop.ruimte,
                workshop.docent ? `begeleiding ${workshop.docent}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              action={
                <Badge tone={workshop.deelnemers.length > workshop.maximum ? "warning" : "neutral"}>
                  {workshop.deelnemers.length} van {workshop.maximum}
                </Badge>
              }
            />
            <CardBody>
              {workshop.deelnemers.length === 0 ? (
                <p className="text-sm text-muted">Nog niemand ingedeeld.</p>
              ) : (
                <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  {workshop.deelnemers.map((deelnemer) => (
                    <li key={`${deelnemer.klas}-${deelnemer.naam}`} className="flex justify-between gap-3">
                      <span className="truncate">{deelnemer.naam}</span>
                      <span className="shrink-0 text-muted">{deelnemer.klas}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        ))}
      </section>
    </div>
  );
}
