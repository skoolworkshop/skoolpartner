import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { InschrijfFlow } from "@/components/inschrijven/inschrijf-flow";
import { publiekeInschrijvingAan } from "@/lib/env";
import { formatShortDate, formatTime } from "@/lib/format";
import { getPubliekeDag } from "@/lib/inschrijving/publiek";

export const metadata: Metadata = { title: "Inschrijven" };
export const dynamic = "force-dynamic";

/**
 * De openbare inschrijfpagina.
 *
 * Geen account nodig: een leerling van tien heeft er geen, en een school gaat
 * er geen aanmaken voor 200 kinderen. De beveiliging zit elders. De link
 * bevat een sleutel die je niet kunt raden, er staan nergens namen van
 * anderen op het scherm, en wie iets wil wijzigen moet eerst bewijzen dat hij
 * zelf die leerling is.
 */
export default async function InschrijvenPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  /*
    De schakelaar voor de praktijktest.

    Zolang PUBLIEKE_INSCHRIJVING op 'uit' staat, bestaat deze pagina niet.
    Geen schoolnaam, geen datum, geen programma: wie de link heeft krijgt
    hetzelfde te zien als wie hem verzint. Dat is bewust strenger dan "de
    inschrijving is gesloten", want in deze periode hoort er nog helemaal
    niets naar buiten te komen.
  */
  if (!publiekeInschrijvingAan()) notFound();

  const dag = await getPubliekeDag(slug);
  if (!dag) notFound();

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="text-sm font-semibold text-muted">{dag.organisatieNaam}</p>
        <h1 className="text-[30px]">{dag.naam}</h1>
        <p className="text-[15px] text-muted">
          {formatShortDate(dag.datum)}
          {dag.locatie ? ` · ${dag.locatie}` : ""}
        </p>
      </header>

      {/*
        Het programma van de dag, voordat je je meldt.

        Hier staat geen enkele naam en geen enkele keuze: alleen hoe laat de
        rondes zijn en waar de pauze valt. Dat mag iedereen met de link zien,
        en het haalt de onzekerheid weg of je wel op de goede pagina zit.
      */}
      {dag.rondes.length > 0 ? (
        <section className="mb-5 rounded-card border border-line-soft bg-white p-5 shadow-card">
          <h2 className="text-lg font-bold">Het programma</h2>
          <ul className="mt-2 divide-y divide-line-soft text-sm">
            {dag.rondes.map((ronde) => (
              <li
                key={ronde.id}
                className={`flex flex-wrap justify-between gap-x-4 py-1.5 ${ronde.pauze ? "text-muted" : ""}`}
              >
                <span className={ronde.pauze ? "" : "font-medium"}>
                  {ronde.label}
                  {ronde.pauze ? " · hier hoef je niets te kiezen" : ""}
                </span>
                <span className="tabular-nums">
                  {formatTime(ronde.begin)} tot {formatTime(ronde.eind)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {dag.open ? (
        <InschrijfFlow slug={slug} dag={dag} />
      ) : (
        <div className="rounded-card border border-line-soft bg-white p-5 shadow-card">
          <h2 className="text-[22px]">{dag.reden}</h2>
          <p className="mt-1 text-sm text-muted">
            Je docent weet wanneer je je kunt inschrijven, en krijgt van ons de indeling.
          </p>
        </div>
      )}
    </main>
  );
}
