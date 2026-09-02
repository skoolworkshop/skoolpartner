import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getBoekingsLink, getVrijeMomenten } from "@/lib/crm/boekingslinks";
import { AFSPRAAK_VORMEN, formatDuur, isAfspraakVorm } from "@/lib/crm/afspraken-regels";
import { BoekingsFormulier } from "@/app/afspraak/[slug]/boekings-formulier";

export const dynamic = "force-dynamic";

/**
 * De openbare boekingspagina.
 *
 * ============================================================================
 * DIT IS DE ENIGE PAGINA VAN HET CRM DIE ZONDER INLOGGEN TE BEREIKEN IS
 * ============================================================================
 *
 * Wat een bezoeker hier te zien krijgt, is bewust zo weinig mogelijk: de naam
 * van het gesprek, hoe lang het duurt, en de vrije momenten. Geen namen van
 * andere scholen, geen agenda-inhoud, geen aantallen, geen intern
 * taalgebruik. De vrije momenten komen uit een freeBusy-vraag aan Google, die
 * alleen begin- en eindtijden teruggeeft; de titels van je afspraken komen dus
 * nergens langs.
 *
 * Een link die niet bestaat en een link die uit staat leveren allebei een
 * gewone "niet gevonden" op. Zou een uitgezette link iets anders zeggen, dan
 * kun je daarmee afleiden welke links wel bestaan.
 *
 * noindex staat erop: dit hoort niet in Google te komen.
 */

export const metadata: Metadata = {
  title: "Afspraak inplannen",
  robots: { index: false, follow: false },
};

export default async function AfspraakPagina({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const link = await getBoekingsLink(slug);
  // Bestaat niet en staat uit geven hetzelfde antwoord. Zie de kop hierboven.
  if (!link || !link.isActive) notFound();

  const { dagen } = await getVrijeMomenten(link);

  const vorm = isAfspraakVorm(link.meetingForm)
    ? AFSPRAAK_VORMEN[link.meetingForm]
    : "In overleg";

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-10 sm:py-16">
      <header className="mb-8">
        <p className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted-soft">
          Skool Workshop
        </p>
        <h1 className="text-balance break-words text-[26px] leading-tight sm:text-[36px]">
          {link.name}
        </h1>
        <p className="mt-2 text-muted">
          {formatDuur(link.durationMinutes)} · {vorm}
          {link.location ? ` · ${link.location}` : ""}
        </p>
        {link.intro ? (
          <p className="mt-4 max-w-prose whitespace-pre-line text-muted">{link.intro}</p>
        ) : null}
      </header>

      <BoekingsFormulier
        slug={link.slug}
        dagen={dagen}
        tijdzone={link.timezone}
        duurTekst={formatDuur(link.durationMinutes)}
      />

      <footer className="mt-10 border-t border-line-soft pt-4 text-xs text-muted">
        <p>
          Je gegevens worden gebruikt om deze afspraak vast te leggen en te bevestigen. Je krijgt
          geen nieuwsbrief of reclame. Wil je dat we je gegevens verwijderen, mail dan naar{" "}
          <a href="mailto:info@skoolworkshop.nl" className="underline underline-offset-2">
            info@skoolworkshop.nl
          </a>
          .
        </p>
      </footer>
    </main>
  );
}
