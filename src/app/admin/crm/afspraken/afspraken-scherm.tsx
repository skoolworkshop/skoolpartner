import Link from "next/link";

import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { AfspraakRegel, StandBadge } from "@/components/admin/afspraak-blok";
import { AFSPRAAK_SOORTEN, formatDuur } from "@/lib/crm/afspraken-regels";
import type { Afspraak } from "@/lib/crm/afspraken";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Het overzicht van alle afspraken.
 *
 * De volgorde van de blokken is de boodschap: eerst wat blijft liggen, dan wat
 * eraan komt, dan wat is geweest. Wie dit scherm opent wil weten wat er nog
 * moet, niet wat er allemaal is geweest.
 */

function Onderwerp({ afspraak }: { afspraak: Afspraak }) {
  const delen: React.ReactNode[] = [];

  if (afspraak.organisatieNaam && afspraak.organizationId) {
    delen.push(
      <Link
        key="org"
        href={`/admin/organisaties/${afspraak.organizationId}`}
        className="underline-offset-4 hover:text-ink hover:underline"
      >
        {afspraak.organisatieNaam}
      </Link>
    );
  }
  if (afspraak.contactNaam && afspraak.contactId) {
    delen.push(
      <Link
        key="contact"
        href={`/admin/crm/contacten/${afspraak.contactId}`}
        className="underline-offset-4 hover:text-ink hover:underline"
      >
        {afspraak.contactNaam}
      </Link>
    );
  }
  if (afspraak.dealTitel && afspraak.dealId) {
    delen.push(
      <Link
        key="deal"
        href={`/admin/crm/deal/${afspraak.dealId}`}
        className="underline-offset-4 hover:text-ink hover:underline"
      >
        {afspraak.dealTitel}
      </Link>
    );
  }

  if (delen.length === 0) return <span className="text-muted-soft">—</span>;

  return (
    <span className="text-muted">
      {delen.map((deel, i) => (
        <span key={i}>
          {i > 0 ? " · " : ""}
          {deel}
        </span>
      ))}
    </span>
  );
}

function Tabel({ afspraken }: { afspraken: Afspraak[] }) {
  return (
    <>
      {/* Tabel op desktop, kaartjes op mobiel. Zes kolommen op een telefoon
          lees je niet, en horizontaal schuiven om een tijdstip te zien werkt
          in de praktijk niet. */}
      {/* Het scrollkader zit om de tabel en niet om de pagina: een lange
          schoolnaam mag nooit het hele scherm zijwaarts duwen. */}
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="border-b border-line-soft text-left text-xs uppercase tracking-wider text-muted-soft">
              <th className="px-5 py-2.5 font-semibold">Wanneer</th>
              <th className="px-3 py-2.5 font-semibold">Waar gaat het over</th>
              <th className="px-3 py-2.5 font-semibold">Met wie</th>
              <th className="px-3 py-2.5 font-semibold">Soort</th>
              <th className="hidden px-3 py-2.5 font-semibold xl:table-cell">Van ons</th>
              <th className="px-5 py-2.5 font-semibold">Stand</th>
            </tr>
          </thead>
          <tbody>
            {afspraken.map((afspraak) => (
              <tr key={afspraak.id} className="border-b border-line-soft last:border-b-0">
                <td className="whitespace-nowrap px-5 py-3 tabular-nums">
                  {formatDateTime(afspraak.startsAt)}
                  <span className="block text-xs text-muted">
                    {formatDuur(afspraak.duurMinuten)}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span className="font-semibold text-ink">{afspraak.title}</span>
                  {afspraak.status === "gehouden" && !afspraak.outcome ? (
                    <span className="ml-2 rounded-pill bg-warning-wash px-2 py-0.5 text-xs font-semibold text-warning">
                      uitkomst ontbreekt
                    </span>
                  ) : null}
                </td>
                <td className="max-w-[260px] truncate px-3 py-3">
                  <Onderwerp afspraak={afspraak} />
                </td>
                <td className="px-3 py-3 text-muted">{AFSPRAAK_SOORTEN[afspraak.kind]}</td>
                <td className="hidden px-3 py-3 text-muted xl:table-cell">
                  {afspraak.ownerNaam ?? "—"}
                </td>
                <td className="px-5 py-3">
                  <StandBadge status={afspraak.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="lg:hidden">
        {afspraken.map((afspraak) => (
          <li key={afspraak.id} className="border-b border-line-soft px-5 py-3.5 last:border-b-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="min-w-0 font-semibold text-ink">{afspraak.title}</span>
              <span className="shrink-0 text-xs text-muted tabular-nums">
                {formatDateTime(afspraak.startsAt)}
              </span>
            </div>
            <p className="mt-0.5 truncate text-sm">
              <Onderwerp afspraak={afspraak} />
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <StandBadge status={afspraak.status} />
              <span className="rounded-pill bg-surface-3 px-2 py-0.5 text-xs text-muted">
                {AFSPRAAK_SOORTEN[afspraak.kind]}
              </span>
              {afspraak.status === "gehouden" && !afspraak.outcome ? (
                <span className="rounded-pill bg-warning-wash px-2 py-0.5 text-xs font-semibold text-warning">
                  uitkomst ontbreekt
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export function AfsprakenScherm({
  achterstallig,
  komend,
  geweest,
  zonderUitkomst,
}: {
  achterstallig: Afspraak[];
  komend: Afspraak[];
  geweest: Afspraak[];
  zonderUitkomst: Afspraak[];
}) {
  const totaal = achterstallig.length + komend.length + geweest.length;

  return (
    <>
      <h1 className="mb-1 text-[30px]">Afspraken</h1>
      <p className="mb-6 max-w-3xl text-muted">
        Gesprekken, bezoeken en belafspraken met scholen en deelnemers. Je plant ze aan bij de
        deal, de contactpersoon of de organisatie; hier zie je ze allemaal bij elkaar. Er gaat
        vanuit dit scherm geen uitnodiging de deur uit.
      </p>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-card border border-line-soft bg-white p-4 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-soft">Komt eraan</p>
          <p className="mt-1.5 font-display text-xl tabular-nums sm:text-2xl">{komend.length}</p>
        </div>
        <div className="rounded-card border border-line-soft bg-white p-4 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-soft">
            Blijft liggen
          </p>
          <p
            className={cn(
              "mt-1.5 font-display text-xl tabular-nums sm:text-2xl",
              achterstallig.length > 0 && "text-danger"
            )}
          >
            {achterstallig.length}
          </p>
        </div>
        <div className="rounded-card border border-line-soft bg-white p-4 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-soft">
            Uitkomst ontbreekt
          </p>
          <p
            className={cn(
              "mt-1.5 font-display text-xl tabular-nums sm:text-2xl",
              zonderUitkomst.length > 0 && "text-warning"
            )}
          >
            {zonderUitkomst.length}
          </p>
        </div>
        <div className="rounded-card border border-line-soft bg-white p-4 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-soft">Geweest</p>
          <p className="mt-1.5 font-display text-xl tabular-nums sm:text-2xl">{geweest.length}</p>
        </div>
      </div>

      {totaal === 0 ? (
        <Card>
          <EmptyState
            title="Nog geen afspraken"
            description="Plan er een aan bij een deal, een contactpersoon of een organisatie. Daarna staat hij hier."
          />
        </Card>
      ) : null}

      {achterstallig.length > 0 ? (
        <Card className="mb-6">
          <CardHeader
            title={`Blijft liggen (${achterstallig.length})`}
            description="Deze stonden gepland en het moment is voorbij. Zolang hier niets wordt bijgewerkt, klopt de telling van gehouden gesprekken niet."
          />
          <Tabel afspraken={achterstallig} />
          <CardBody className="border-t border-line-soft">
            <p className="text-sm text-muted">
              Afronden doe je bij de deal, de contactpersoon of de organisatie waar de afspraak bij
              hoort. Klik hierboven op de naam om er te komen.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {komend.length > 0 ? (
        <Card className="mb-6">
          <CardHeader title={`Komt eraan (${komend.length})`} />
          <Tabel afspraken={komend} />
        </Card>
      ) : null}

      {geweest.length > 0 ? (
        <Card>
          <CardHeader
            title={`Geweest (${geweest.length})`}
            description="Wat is afgerond, meest recente eerst."
          />
          <Tabel afspraken={geweest} />
        </Card>
      ) : null}
    </>
  );
}

export { AfspraakRegel };
