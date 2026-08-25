"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Building2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import {
  joinOrganizationAction,
  requestNewOrganizationAction,
  searchOrganizationsAction,
  type JoinState,
} from "./actions";

const initial: JoinState = { status: "idle" };

function Submit({ children, variant }: { children: React.ReactNode; variant?: "secondary" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} className="w-full">
      {pending ? "Bezig…" : children}
    </Button>
  );
}

export function JoinForm({
  suggestions,
}: {
  suggestions: { id: string; name: string; city: string | null; reason: string }[];
}) {
  const [searchState, searchAction] = useActionState(searchOrganizationsAction, initial);
  const [joinState, joinAction] = useActionState(joinOrganizationAction, initial);
  const [createState, createAction] = useActionState(requestNewOrganizationAction, initial);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[28px]">Bij welke organisatie hoort u?</h1>
        <p className="mt-2 text-[15px] text-muted">
          Uw boekingen, facturen en SkoolPoints horen bij uw organisatie. Een collega die later
          inlogt, ziet dezelfde gegevens.
        </p>
      </div>

      {joinState.status === "error" ? <Alert tone="danger">{joinState.message}</Alert> : null}

      {suggestions.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-display text-base">Op basis van uw e-mailadres</h2>
          <p className="text-sm text-muted">
            Dit is een suggestie. Skool Workshop controleert uw aanvraag voordat u toegang krijgt.
          </p>
          <ul className="space-y-2">
            {suggestions.map((org) => (
              <li key={org.id}>
                <form action={joinAction} className="contents">
                  <input type="hidden" name="organization_id" value={org.id} />
                  <input type="hidden" name="source" value="domain_match" />
                  <button
                    type="submit"
                    className="flex w-full items-center gap-3 rounded-card border border-line bg-white px-4 py-3 text-left hover:border-ink"
                  >
                    <Building2 aria-hidden className="size-5 shrink-0 text-muted" />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{org.name}</span>
                      {org.city ? (
                        <span className="block text-sm text-muted">{org.city}</span>
                      ) : null}
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="font-display text-base">Zoek uw organisatie</h2>
        <form action={searchAction} className="flex gap-2">
          <label htmlFor="query" className="sr-only">
            Naam van uw organisatie
          </label>
          <Input id="query" name="query" placeholder="De Goudse Waarden" className="flex-1" />
          <Button type="submit" variant="secondary" aria-label="Zoeken">
            <Search aria-hidden className="size-4" />
          </Button>
        </form>

        {searchState.status === "error" ? (
          <p className="text-sm text-danger">{searchState.message}</p>
        ) : null}
        {searchState.message && searchState.status === "ok" ? (
          <p className="text-sm text-muted">{searchState.message}</p>
        ) : null}

        {searchState.results && searchState.results.length > 0 ? (
          <ul className="space-y-2">
            {searchState.results.map((org) => (
              <li key={org.id}>
                <form action={joinAction} className="contents">
                  <input type="hidden" name="organization_id" value={org.id} />
                  <input type="hidden" name="source" value="self_request" />
                  <button
                    type="submit"
                    className="flex w-full items-center gap-3 rounded-card border border-line bg-white px-4 py-3 text-left hover:border-ink"
                  >
                    <Building2 aria-hidden className="size-5 shrink-0 text-muted" />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{org.name}</span>
                      {org.city ? (
                        <span className="block text-sm text-muted">{org.city}</span>
                      ) : null}
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="space-y-3 border-t border-line-soft pt-6">
        <h2 className="font-display text-base">Staat uw organisatie er niet bij?</h2>
        {createState.status === "error" ? (
          <Alert tone="danger">{createState.message}</Alert>
        ) : null}
        <form action={createAction} className="space-y-4">
          <Field label="Naam organisatie" htmlFor="name" required>
            <Input id="name" name="name" placeholder="De Goudse Waarden" required />
          </Field>
          <Field label="Plaats" htmlFor="city">
            <Input id="city" name="city" placeholder="Gouda" />
          </Field>
          <Submit variant="secondary">Organisatie aanvragen</Submit>
        </form>
      </section>
    </div>
  );
}
