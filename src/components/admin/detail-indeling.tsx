import type { ReactNode } from "react";

/**
 * De indeling van een detailscherm in het CRM: contact, organisatie, deal.
 *
 * ============================================================================
 * DRIE KOLOMMEN, ELK MET EEN EIGEN VRAAG
 * ============================================================================
 *
 *   links   Wie of wat is dit, en hoe bereik ik het.
 *   midden  Wat is er gebeurd. De tijdlijn.
 *   rechts  Waar hangt het aan: deals, afspraken, taken, boekingen.
 *
 * Daarvoor stonden dezelfde kaarten onder elkaar in twee kolommen. Alles was
 * even groot en even belangrijk, en om te zien of er vorige week nog iets was
 * gebeurd moest je eerst langs een openstaand bewerkformulier scrollen.
 *
 * WAAROM DIT EEN EIGEN COMPONENT IS EN GEEN LOSSE KLASSEN OP ELKE PAGINA
 *
 *   Omdat de visuele controle dan hetzelfde raster test als de echte pagina
 *   gebruikt. Zou elk scherm zijn eigen grid-klassen opschrijven, dan bewijst
 *   een schermafbeelding van het ene niets over het andere, en loopt de
 *   indeling stilletjes uit elkaar zodra er een scherm bijkomt.
 *
 * OVER DE VOLGORDE OP EEN TELEFOON
 *
 *   Onder elkaar, in deze volgorde: eerst wie het is, dan de historie, dan de
 *   rest. Er wordt niets verborgen en er is niets dat alleen op een groot
 *   scherm bestaat.
 */
export function DetailIndeling({
  links,
  midden,
  rechts,
}: {
  links: ReactNode;
  midden: ReactNode;
  rechts?: ReactNode;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)_minmax(0,330px)]">
      <div className="min-w-0 space-y-5">{links}</div>
      <div className="min-w-0 space-y-5">{midden}</div>
      {/*
        Op een middelgroot scherm past een derde kolom niet meer zonder dat de
        tijdlijn te smal wordt. Dan gaat dit blok over de volle breedte onder
        de andere twee staan, in plaats van dat er iets wordt weggelaten.
      */}
      {rechts ? <div className="min-w-0 space-y-5 lg:col-span-2 xl:col-span-1">{rechts}</div> : null}
    </div>
  );
}
