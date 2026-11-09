import type { Metadata } from "next";

import { CodePoort } from "@/components/indeling/code-poort";
import { IndelingOverzicht } from "@/components/indeling/indeling-overzicht";
import { getLijstGegevens, SOORT_LABELS, type Soort } from "@/lib/inschrijving/afronden";
import { klassenLijsten, workshopLijsten } from "@/lib/inschrijving/lijsten";
import { huidigeToegang } from "@/lib/inschrijving/toegang-cookie";
import { meldAanAction } from "./actions";

export const metadata: Metadata = { title: "Indeling", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const SOORTEN: Soort[] = ["klassen-xlsx", "workshops-xlsx", "klassen-pdf", "workshops-pdf"];

/**
 * De online omgeving voor de school.
 *
 * Geen account, want een contactpersoon gaat er geen aanmaken voor één dag.
 * In plaats daarvan twee dingen die apart naar de klant gaan: een link met een
 * sleutel die niemand raadt, en een code. Allebei nodig, allebei intrekbaar,
 * en allebei met een einddatum.
 *
 * Komt er geen geldige toegang uit, dan staat er niets anders op het scherm
 * dan het codeveld. Dus ook geen naam van de school en geen datum, want dat is
 * al informatie.
 */
export default async function IndelingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const toegang = await huidigeToegang(token);

  if (!toegang) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-10 sm:px-6">
        <CodePoort token={token} meldAan={meldAanAction} />
      </main>
    );
  }

  const gegevens = await getLijstGegevens(toegang.dagId);
  if (!gegevens) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-10 sm:px-6">
        <p className="text-sm text-muted">Deze dag staat niet meer in ons systeem.</p>
      </main>
    );
  }

  const klassen = klassenLijsten(gegevens);
  const workshops = workshopLijsten(gegevens);

  // Hoeveel rondes zijn er nog niet rond? Dat is wat de school wil weten
  // voordat ze deze lijsten gaat uitdelen.
  const echteRondes = gegevens.rondes.filter((ronde) => !ronde.pauze);
  const aantalOpen = gegevens.deelnemers.reduce((totaal, deelnemer) => {
    if (deelnemer.vrijgesteld) return totaal;
    return totaal + echteRondes.filter((ronde) => !deelnemer.keuzes[ronde.id]).length;
  }, 0);

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-8 sm:px-6">
      <IndelingOverzicht
        dag={gegevens.dag}
        klassen={klassen}
        workshops={workshops}
        aantalOpen={aantalOpen}
        downloads={SOORTEN.map((soort) => ({
          label: SOORT_LABELS[soort],
          href: `/indeling/${token}/bestand/${soort}`,
        }))}
      />
    </main>
  );
}
