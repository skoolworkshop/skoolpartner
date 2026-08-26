"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Building2, Check, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import {
  completeRegistrationAction,
  searchOrganizationsAction,
  type JoinState,
  type RegistrationState,
} from "./actions";

const initialJoin: JoinState = { status: "idle" };
const initialRegistration: RegistrationState = { status: "idle", errors: {} };

interface OrganizationOption {
  id: string;
  name: string;
  city: string | null;
}

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Bezig…" : children}
    </Button>
  );
}

function OrganizationButton({
  org,
  gekozen,
  onKies,
}: {
  org: OrganizationOption;
  gekozen: boolean;
  onKies: (org: OrganizationOption) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onKies(org)}
      aria-pressed={gekozen}
      className={`flex w-full items-center gap-3 rounded-card border px-4 py-3 text-left transition-colors ${
        gekozen ? "border-ink bg-accent-wash/60" : "border-line bg-white hover:border-ink"
      }`}
    >
      {gekozen ? (
        <Check aria-hidden className="size-5 shrink-0 text-accent-strong" />
      ) : (
        <Building2 aria-hidden className="size-5 shrink-0 text-muted" />
      )}
      <span className="min-w-0">
        <span className="block truncate font-semibold">{org.name}</span>
        {org.city ? <span className="block text-sm text-muted">{org.city}</span> : null}
      </span>
    </button>
  );
}

export function RegistrationForm({
  email,
  suggestions,
  prefill,
}: {
  email: string;
  suggestions: OrganizationOption[];
  prefill: {
    firstName: string;
    lastName: string;
    jobTitle: string;
    phone: string;
  };
}) {
  const [searchState, searchAction] = useActionState(searchOrganizationsAction, initialJoin);
  const [state, formAction] = useActionState(completeRegistrationAction, initialRegistration);
  const [gekozen, setGekozen] = useState<OrganizationOption | null>(null);

  const fout = (veld: keyof RegistrationState["errors"]) => state.errors?.[veld] ?? null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[28px]">Maak uw registratie compleet</h1>
        <p className="mt-2 text-[15px] text-muted">
          Uw e-mailadres is bevestigd. Nog één keer uw gegevens, dan is uw SkoolPartner-account
          klaar. Vanaf dat moment sparen nieuwe workshopboekingen SkoolPoints.
        </p>
      </div>

      {state.status === "error" && state.message ? (
        <Alert tone="danger">{state.message}</Alert>
      ) : null}

      {/* Organisatie kiezen staat bewust buiten het formulier: zoeken mag het
          ingevulde formulier niet wegvagen. */}
      <section className="space-y-3 rounded-card border border-line-soft bg-surface-1 p-5">
        <h2 className="font-display text-base">Uw school of organisatie</h2>

        {suggestions.length > 0 ? (
          <>
            <p className="text-sm text-muted">
              Op basis van uw e-mailadres denken wij dat u hierbij hoort. Dit is een suggestie; wij
              controleren uw aanvraag voordat u de gegevens van die organisatie kunt zien.
            </p>
            <ul className="space-y-2">
              {suggestions.map((org) => (
                <li key={org.id}>
                  <OrganizationButton org={org} gekozen={gekozen?.id === org.id} onKies={setGekozen} />
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <form action={searchAction} className="flex gap-2 pt-1">
          <label htmlFor="query" className="sr-only">
            Zoek uw organisatie
          </label>
          <Input id="query" name="query" placeholder="Zoek op naam" className="flex-1" />
          <Button type="submit" variant="secondary" aria-label="Zoeken">
            <Search aria-hidden className="size-4" />
          </Button>
        </form>

        {searchState.message ? (
          <p
            className={`text-sm ${searchState.status === "error" ? "text-danger" : "text-muted"}`}
          >
            {searchState.message}
          </p>
        ) : null}

        {searchState.results && searchState.results.length > 0 ? (
          <ul className="space-y-2">
            {searchState.results.map((org) => (
              <li key={org.id}>
                <OrganizationButton org={org} gekozen={gekozen?.id === org.id} onKies={setGekozen} />
              </li>
            ))}
          </ul>
        ) : null}

        {gekozen ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-accent/35 bg-accent-soft/25 px-4 py-3">
            <p className="text-sm">
              U meldt zich aan bij <strong>{gekozen.name}</strong>. Wij controleren dat voordat u de
              gegevens van die organisatie ziet.
            </p>
            <button
              type="button"
              onClick={() => setGekozen(null)}
              className="text-sm font-semibold underline underline-offset-4"
            >
              Toch een andere
            </button>
          </div>
        ) : (
          <p className="text-sm text-muted">
            Staat uw organisatie er niet bij? Vul hieronder de naam en het adres in, dan maken wij
            haar aan.
          </p>
        )}
      </section>

      <form action={formAction} className="space-y-5">
        <input type="hidden" name="organization_id" value={gekozen?.id ?? ""} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Voornaam" htmlFor="first_name" required error={fout("firstName")}>
            <Input
              id="first_name"
              name="first_name"
              autoComplete="given-name"
              defaultValue={state.input?.firstName ?? prefill.firstName}
              required
            />
          </Field>
          <Field label="Achternaam" htmlFor="last_name" required error={fout("lastName")}>
            <Input
              id="last_name"
              name="last_name"
              autoComplete="family-name"
              defaultValue={state.input?.lastName ?? prefill.lastName}
              required
            />
          </Field>
        </div>

        <Field label="E-mailadres" htmlFor="email" required hint="Dit is ook uw inlogadres.">
          <Input id="email" name="email" type="email" defaultValue={email} disabled />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Functie"
            htmlFor="job_title"
            required
            error={fout("jobTitle")}
          >
            <Input
              id="job_title"
              name="job_title"
              placeholder="Cultuurcoördinator"
              defaultValue={state.input?.jobTitle ?? prefill.jobTitle}
              required
            />
          </Field>
          <Field
            label="Telefoonnummer"
            htmlFor="phone"
            required
            error={fout("phone")}
            hint="Zodat wij u op de dag van de workshop kunnen bereiken."
          >
            <Input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              placeholder="06 12345678"
              defaultValue={state.input?.phone ?? prefill.phone}
              required
            />
          </Field>
        </div>

        <Field
          label="Naam school of organisatie"
          htmlFor="organization_name"
          required
          error={fout("organizationName")}
        >
          <Input
            id="organization_name"
            name="organization_name"
            autoComplete="organization"
            placeholder="De Goudse Waarden"
            defaultValue={state.input?.organizationName ?? gekozen?.name ?? ""}
            key={gekozen?.id ?? "leeg"}
            required
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <Field label="Straat" htmlFor="street" required error={fout("street")}>
            <Input
              id="street"
              name="street"
              autoComplete="address-line1"
              defaultValue={state.input?.street ?? ""}
              required
            />
          </Field>
          <Field label="Huisnummer" htmlFor="house_number" required error={fout("houseNumber")}>
            <Input
              id="house_number"
              name="house_number"
              inputMode="numeric"
              defaultValue={state.input?.houseNumber ?? ""}
              required
            />
          </Field>
          <Field
            label="Toevoeging"
            htmlFor="house_number_addition"
            error={fout("houseNumberAddition")}
          >
            <Input
              id="house_number_addition"
              name="house_number_addition"
              placeholder="A"
              defaultValue={state.input?.houseNumberAddition ?? ""}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Field label="Postcode" htmlFor="postal_code" required error={fout("postalCode")}>
            <Input
              id="postal_code"
              name="postal_code"
              autoComplete="postal-code"
              placeholder="2801 AB"
              defaultValue={state.input?.postalCode ?? ""}
              required
            />
          </Field>
          <Field label="Plaats" htmlFor="city" required error={fout("city")}>
            <Input
              id="city"
              name="city"
              autoComplete="address-level2"
              placeholder="Gouda"
              defaultValue={state.input?.city ?? gekozen?.city ?? ""}
              required
            />
          </Field>
        </div>

        <Submit>Registratie afronden</Submit>

        <p className="text-sm text-muted">
          Kiest u een bestaande organisatie, dan leggen wij uw gegevens voor aan Skool Workshop
          voordat u de boekingen, facturen en punten van die organisatie kunt zien.
        </p>
      </form>
    </div>
  );
}
