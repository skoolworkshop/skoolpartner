import type { Metadata } from "next";

import { ActionForm } from "@/components/admin/action-form";
import { FragmentKiezer } from "@/components/admin/fragment-kiezer";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { requireAdmin } from "@/lib/auth/session";
import { hasServiceRole } from "@/lib/env";
import { getActiefMerk } from "@/lib/crm/actief-merk";
import { getTemplates, type Template } from "@/lib/crm/templates";
import { filterFragmenten, getFragmenten } from "@/lib/crm/fragmenten";
import { TOKENS, type KiesbaarFragment } from "@/lib/crm/fragment-tekst";
import { MERKEN, merkLabel } from "@/lib/crm/merk";
import { archiveerTemplateAction, bewaarTemplateAction } from "@/app/admin/crm/actions";

export const metadata: Metadata = { title: "Templates" };

/**
 * E-mailtemplates.
 *
 * Een template is een heel bericht: onderwerp en tekst, klaar om te versturen.
 * Dat is het verschil met een fragment, dat je halverwege een notitie plakt.
 *
 * De opzet volgt de rest van het CRM: eerst de lijst, dan pas een formulier.
 * Het nieuwe template en het bewerken zitten allebei achter een uitklap, zodat
 * dit scherm begint met wat je hebt en niet met wat je zou kunnen maken.
 */

function Velden({
  template,
  fragmenten,
}: {
  template?: Template;
  fragmenten: KiesbaarFragment[];
}) {
  const id = template?.id ?? "nieuw";
  return (
    <>
      {template ? <input type="hidden" name="id" value={template.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Naam" htmlFor={`naam-${id}`} required showOptional={false}>
          <Input
            id={`naam-${id}`}
            name="name"
            required
            autoComplete="off"
            defaultValue={template?.name}
            placeholder="Offerte nabellen"
          />
        </Field>
        <Field label="Merk" htmlFor={`merk-${id}`} hint="Leeg laten betekent: voor beide merken.">
          <Select id={`merk-${id}`} name="brand" defaultValue={template?.brand ?? ""}>
            <option value="">Beide merken</option>
            {MERKEN.map((waarde) => (
              <option key={waarde} value={waarde}>
                {merkLabel(waarde)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Onderwerp" htmlFor={`onderwerp-${id}`} required showOptional={false}>
        <Input
          id={`onderwerp-${id}`}
          name="subject"
          required
          autoComplete="off"
          defaultValue={template?.subject}
          placeholder="Je offerte voor {{organisatie}}"
        />
      </Field>

      <Field label="Bericht" htmlFor={`tekst-${id}`} required showOptional={false}>
        <Textarea id={`tekst-${id}`} name="body" rows={8} required defaultValue={template?.body} />
      </Field>
      <FragmentKiezer
        fragmenten={fragmenten}
        context={{}}
        doelId={`tekst-${id}`}
        onderwerp={{}}
        label="Fragment invoegen"
        gebruikVastleggen={false}
      />

      <Field label="Categorie" htmlFor={`categorie-${id}`}>
        <Input
          id={`categorie-${id}`}
          name="category"
          autoComplete="off"
          defaultValue={template?.category ?? ""}
          placeholder="Offerte"
        />
      </Field>
    </>
  );
}

export default async function TemplatesPagina({
  searchParams,
}: {
  searchParams: Promise<{ zoek?: string; archief?: string }>;
}) {
  await requireAdmin();
  const merk = await getActiefMerk();
  const { zoek, archief } = await searchParams;

  if (!hasServiceRole()) {
    return (
      <Alert tone="warning" title="SUPABASE_SERVICE_ROLE_KEY ontbreekt">
        Zonder deze sleutel kan het CRM geen gegevens lezen.
      </Alert>
    );
  }

  const toonArchief = archief === "ja";
  const [templates, alleFragmenten] = await Promise.all([
    getTemplates({ merk, zoek, metGearchiveerde: toonArchief }),
    getFragmenten(),
  ]);
  const zichtbaar = toonArchief ? templates.filter((t) => t.isArchived) : templates;
  const fragmenten = filterFragmenten(alleFragmenten, { merk }).map((fragment) => ({
    id: fragment.id,
    naam: fragment.name,
    sneltoets: fragment.shortcut,
    categorie: fragment.category,
    tekst: fragment.body,
  }));

  return (
    <>
      <h1 className="mb-5 text-[30px]">Templates</h1>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <form className="flex flex-1 flex-wrap items-center gap-2" action="/admin/crm/templates">
          {toonArchief ? <input type="hidden" name="archief" value="ja" /> : null}
          <label className="sr-only" htmlFor="zoek">
            Zoeken
          </label>
          <input
            id="zoek"
            name="zoek"
            defaultValue={zoek ?? ""}
            placeholder="Zoek op naam, onderwerp of tekst"
            className="h-10 min-w-56 flex-1 rounded-card border border-line bg-white px-3 text-sm"
          />
          <button type="submit" className="h-10 rounded-pill bg-ink px-4 text-sm font-semibold text-white">
            Zoeken
          </button>
        </form>
        <a
          href={toonArchief ? "/admin/crm/templates" : "/admin/crm/templates?archief=ja"}
          className="text-sm font-semibold text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          {toonArchief ? "Terug naar de lijst" : "Archief"}
        </a>
      </div>

      {zichtbaar.length === 0 ? (
        <Card>
          <EmptyState
            title={toonArchief ? "Niets gearchiveerd" : "Nog geen templates"}
            description={
              toonArchief
                ? "Gearchiveerde templates verschijnen hier."
                : "Maak er een aan, of neem ze over uit HubSpot."
            }
          />
        </Card>
      ) : (
        <Card>
          <ul>
            {zichtbaar.map((template) => (
              <li key={template.id} className="border-b border-line-soft last:border-b-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-5 pt-3.5">
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold text-ink">{template.name}</span>
                    <span className="rounded-pill bg-surface-3 px-2 py-0.5 text-xs text-muted">
                      {template.brand ? merkLabel(template.brand) : "Beide merken"}
                    </span>
                    {template.category ? (
                      <span className="text-xs text-muted">{template.category}</span>
                    ) : null}
                  </span>
                  {template.onbekendeTokens.length > 0 ? (
                    <span className="shrink-0 text-xs font-semibold text-danger">
                      Onbekend veld: {template.onbekendeTokens.join(", ")}
                    </span>
                  ) : null}
                </div>
                <p className="truncate px-5 pb-1 text-sm text-muted">{template.subject}</p>
                <p className="line-clamp-2 px-5 pb-3 text-sm text-muted-soft">{template.body}</p>

                <details className="border-t border-line-soft">
                  <summary className="cursor-pointer px-5 py-2.5 text-sm font-semibold">
                    Bewerken
                  </summary>
                  <CardBody className="pt-0">
                    <ActionForm action={bewaarTemplateAction} submitLabel="Opslaan" variant="secondary">
                      <Velden template={template} fragmenten={fragmenten} />
                    </ActionForm>
                    <div className="mt-4 border-t border-line-soft pt-4">
                      <ActionForm
                        action={archiveerTemplateAction}
                        submitLabel={template.isArchived ? "Terughalen" : "Archiveren"}
                        variant="ghost"
                        inline
                      >
                        <input type="hidden" name="id" value={template.id} />
                        <input type="hidden" name="terughalen" value={template.isArchived ? "ja" : "nee"} />
                      </ActionForm>
                      <p className="mt-2 text-xs text-muted">
                        Archiveren haalt het template uit de lijst. Het blijft bestaan, want het kan
                        in een verstuurd bericht of in een reeks zitten.
                      </p>
                    </div>
                  </CardBody>
                </details>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <details className="mt-5 rounded-card border border-line-soft bg-white shadow-card">
        <summary className="cursor-pointer px-5 py-4 font-display text-base font-semibold">
          Nieuw template
        </summary>
        <CardBody className="pt-0">
          <ActionForm action={bewaarTemplateAction} submitLabel="Template opslaan">
            <Velden fragmenten={fragmenten} />
          </ActionForm>
        </CardBody>
      </details>

      <Card className="mt-5">
        <CardHeader title="Velden die je kunt gebruiken" />
        <CardBody>
          <p className="mb-3 text-sm text-muted">
            Zet ze tussen dubbele accolades in het onderwerp of in de tekst. Ontbreekt een waarde,
            dan blijft het veld zichtbaar staan in plaats van te verdwijnen, zodat je het ziet
            voordat de ontvanger het ziet.
          </p>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {TOKENS.map((token) => (
              <div key={token.naam} className="flex flex-wrap items-baseline gap-2">
                <dt className="font-mono text-xs text-ink">{`{{${token.naam}}}`}</dt>
                <dd className="text-muted">{token.label}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>
    </>
  );
}
