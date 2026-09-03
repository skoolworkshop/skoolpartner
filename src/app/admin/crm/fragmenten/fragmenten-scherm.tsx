import Link from "next/link";

import { ActionForm } from "@/components/admin/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { MERK_STIJL } from "@/lib/crm/merk";
import { TOKENS, voorbeeldVan } from "@/lib/crm/fragment-tekst";
import type { Fragment } from "@/lib/crm/fragmenten";
import { formatShortDate } from "@/lib/format";
import { archiveerFragmentAction, bewaarFragmentAction } from "@/app/admin/crm/actions";
import { cn } from "@/lib/utils";

/**
 * Het beheerscherm voor fragmenten.
 *
 * Losgetrokken van page.tsx zodat de visuele controle het echte scherm kan
 * renderen, net als bij de andere CRM-schermen.
 */

function MerkChip({ merk }: { merk: Fragment["brand"] }) {
  if (!merk) {
    return (
      <span className="rounded-pill bg-surface-3 px-2 py-0.5 text-xs font-semibold text-muted">
        Beide merken
      </span>
    );
  }
  const stijl = MERK_STIJL[merk];
  return (
    <span className={cn("rounded-pill px-2 py-0.5 text-xs font-semibold", stijl.chip)}>
      {stijl.label}
    </span>
  );
}

function FragmentKaart({ fragment }: { fragment: Fragment }) {
  const voorbeeld = voorbeeldVan(fragment.body);

  return (
    <li className="border-b border-line-soft px-5 py-4 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-semibold text-ink">{fragment.name}</span>
          <span className="font-mono text-xs text-muted-soft">{fragment.shortcut}</span>
          <MerkChip merk={fragment.brand} />
          {fragment.category ? (
            <span className="rounded-pill bg-surface-3 px-2 py-0.5 text-xs text-muted">
              {fragment.category}
            </span>
          ) : null}
          {fragment.isArchived ? (
            <span className="rounded-pill bg-surface-3 px-2 py-0.5 text-xs font-semibold text-muted">
              Gearchiveerd
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-xs text-muted tabular-nums">
          {fragment.aantalKeerGebruikt === 0
            ? "nog niet gebruikt"
            : `${fragment.aantalKeerGebruikt}x gebruikt`}
          {fragment.laatstGebruikt ? `, laatst ${formatShortDate(fragment.laatstGebruikt)}` : ""}
        </span>
      </div>

      {/* Het voorbeeld, met duidelijk herkenbare voorbeeldwaarden. Zo zie je
          hoe de tekst loopt zonder dat er een echte klantnaam in staat. */}
      <p className="mt-2 whitespace-pre-line rounded-card bg-surface-2 px-3 py-2 text-sm text-muted">
        {voorbeeld.tekst}
      </p>

      {fragment.onbekendeTokens.length > 0 ? (
        <p className="mt-2 text-sm text-danger">
          Onbekend token: {fragment.onbekendeTokens.map((t) => `{{${t}}}`).join(", ")}. Dat blijft
          zo in de tekst staan. Waarschijnlijk een typefout.
        </p>
      ) : null}

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-semibold text-muted">Aanpassen</summary>
        <div className="mt-3 border-l-2 border-line-soft pl-4">
          <ActionForm action={bewaarFragmentAction} submitLabel="Opslaan">
            <input type="hidden" name="id" value={fragment.id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Naam" htmlFor={`naam-${fragment.id}`} required showOptional={false}>
                <Input
                  id={`naam-${fragment.id}`}
                  name="name"
                  defaultValue={fragment.name}
                  required
                  autoComplete="off"
                />
              </Field>
              <Field
                label="Sneltoets"
                htmlFor={`sneltoets-${fragment.id}`}
                hint="Kleine letters en streepjes."
              >
                <Input
                  id={`sneltoets-${fragment.id}`}
                  name="shortcut"
                  defaultValue={fragment.shortcut}
                  autoComplete="off"
                />
              </Field>
              <Field label="Merk" htmlFor={`merk-${fragment.id}`}>
                <Select id={`merk-${fragment.id}`} name="brand" defaultValue={fragment.brand ?? ""}>
                  <option value="">Beide merken</option>
                  <option value="skool_workshop">Skool Workshop</option>
                  <option value="suri_impact">Suri Impact</option>
                </Select>
              </Field>
              <Field label="Groep" htmlFor={`groep-${fragment.id}`}>
                <Input
                  id={`groep-${fragment.id}`}
                  name="category"
                  defaultValue={fragment.category ?? ""}
                  autoComplete="off"
                />
              </Field>
            </div>
            <Field label="Tekst" htmlFor={`tekst-${fragment.id}`} required showOptional={false}>
              <Textarea
                id={`tekst-${fragment.id}`}
                name="body"
                rows={8}
                defaultValue={fragment.body}
                required
              />
            </Field>
          </ActionForm>

          <div className="mt-3 border-t border-line-soft pt-3">
            <ActionForm
              action={archiveerFragmentAction}
              submitLabel={fragment.isArchived ? "Terughalen" : "Archiveren"}
              variant="secondary"
              inline
            >
              <input type="hidden" name="id" value={fragment.id} />
              <input type="hidden" name="archiveren" value={fragment.isArchived ? "nee" : "ja"} />
            </ActionForm>
            <p className="mt-2 text-xs text-muted">
              Archiveren haalt het fragment uit de keuzelijst. Verwijderen kan niet, want dan zou
              ook verdwijnen waar het ooit is gebruikt.
            </p>
          </div>
        </div>
      </details>
    </li>
  );
}

export function FragmentenScherm({
  fragmenten,
  categorieen,
  filter,
  toonArchief,
}: {
  fragmenten: Fragment[];
  categorieen: string[];
  filter: { zoek?: string; groep?: string };
  toonArchief: boolean;
}) {
  const query = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const samen = { zoek: filter.zoek, groep: filter.groep, archief: toonArchief ? "ja" : undefined, ...extra };
    for (const [k, v] of Object.entries(samen)) if (v) p.set(k, v);
    const s = p.toString();
    return `/admin/crm/fragmenten${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <h1 className="mb-6 text-[30px]">Fragmenten</h1>

      <Card className="mb-6">
        <CardHeader
          title={`Alle fragmenten (${fragmenten.length})`}
          action={
            <form className="flex flex-wrap items-center gap-2" action="/admin/crm/fragmenten">
              <label htmlFor="zoek" className="sr-only">
                Zoek een fragment
              </label>
              <input
                id="zoek"
                name="zoek"
                defaultValue={filter.zoek ?? ""}
                placeholder="Naam, sneltoets of tekst"
                className="h-10 min-w-0 flex-1 rounded-pill border border-surface-2 bg-surface-2 px-4 text-sm"
              />
              {toonArchief ? <input type="hidden" name="archief" value="ja" /> : null}
              <button
                type="submit"
                className="min-h-10 rounded-pill bg-ink px-4 text-sm font-semibold text-white"
              >
                Zoek
              </button>
            </form>
          }
        />

        {categorieen.length > 0 || toonArchief ? (
          <div className="flex flex-wrap gap-1.5 border-b border-line-soft px-5 py-3">
            <Link
              href={query({ groep: undefined })}
              aria-current={!filter.groep ? "page" : undefined}
              className={cn(
                "rounded-pill px-3.5 py-1.5 text-sm font-semibold transition-colors",
                !filter.groep ? "bg-accent-wash text-ink" : "text-muted hover:bg-surface-2"
              )}
            >
              Alles
            </Link>
            {categorieen.map((groep) => (
              <Link
                key={groep}
                href={query({ groep })}
                aria-current={filter.groep === groep ? "page" : undefined}
                className={cn(
                  "rounded-pill px-3.5 py-1.5 text-sm font-semibold transition-colors",
                  filter.groep === groep ? "bg-accent-wash text-ink" : "text-muted hover:bg-surface-2"
                )}
              >
                {groep}
              </Link>
            ))}
            <Link
              href={query({ archief: toonArchief ? undefined : "ja" })}
              className="ml-auto rounded-pill px-3.5 py-1.5 text-sm font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              {toonArchief ? "Archief verbergen" : "Archief tonen"}
            </Link>
          </div>
        ) : null}

        {fragmenten.length === 0 ? (
          <EmptyState
            title="Nog geen fragmenten"
            description="Maak er hieronder een aan. Begin met de zinnen die je nu elke week opnieuw typt."
          />
        ) : (
          <ul>
            {fragmenten.map((fragment) => (
              <FragmentKaart key={fragment.id} fragment={fragment} />
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <details>
            <summary className="cursor-pointer px-5 py-4 font-display text-base font-semibold">
              Nieuw fragment
            </summary>
          <CardBody>
            <ActionForm action={bewaarFragmentAction} submitLabel="Fragment opslaan">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Naam" htmlFor="nieuw-naam" required showOptional={false}>
                  <Input id="nieuw-naam" name="name" required autoComplete="off" />
                </Field>
                <Field label="Sneltoets" htmlFor="nieuw-sneltoets" hint="Bijvoorbeeld: offerte-nabellen">
                  <Input id="nieuw-sneltoets" name="shortcut" autoComplete="off" />
                </Field>
                <Field label="Merk" htmlFor="nieuw-merk" hint="Beide merken is het normale geval.">
                  <Select id="nieuw-merk" name="brand" defaultValue="">
                    <option value="">Beide merken</option>
                    <option value="skool_workshop">Skool Workshop</option>
                    <option value="suri_impact">Suri Impact</option>
                  </Select>
                </Field>
                <Field label="Groep" htmlFor="nieuw-groep" hint="Bijvoorbeeld: opvolging, planning.">
                  <Input id="nieuw-groep" name="category" autoComplete="off" list="fragment-groepen" />
                </Field>
              </div>
              <datalist id="fragment-groepen">
                {categorieen.map((groep) => (
                  <option key={groep} value={groep} />
                ))}
              </datalist>
              <Field
                label="Tekst"
                htmlFor="nieuw-tekst"
                required
                showOptional={false}
                hint="Gebruik de tokens hiernaast om er automatisch gegevens in te zetten."
              >
                <Textarea id="nieuw-tekst" name="body" rows={8} required />
              </Field>
            </ActionForm>
          </CardBody>
          </details>
        </Card>

        <Card>
          <details>
            <summary className="cursor-pointer px-5 py-4 font-display text-base font-semibold">
              Personalisatievelden
            </summary>
          <CardBody>
            <p className="mb-3 text-sm text-muted">
              Ontbreekt een gegeven, dan blijft het token zichtbaar staan in plaats van dat er een
              gat in de zin valt. Wil je liever een terugvalwaarde, schrijf dan{" "}
              <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">
                {"{{voornaam|relatie}}"}
              </code>
              .
            </p>
            <dl className="space-y-2">
              {TOKENS.map((token) => (
                <div key={token.naam} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                  <dt className="font-mono text-xs text-accent-strong">{`{{${token.naam}}}`}</dt>
                  <dd className="text-sm text-muted">
                    {token.uitleg}{" "}
                    <span className="text-muted-soft">Bijvoorbeeld: {token.voorbeeld}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </CardBody>
          </details>
        </Card>
      </div>
    </>
  );
}
