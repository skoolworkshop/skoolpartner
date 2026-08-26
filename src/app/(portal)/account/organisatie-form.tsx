"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { RefreshCw, Trash2, Upload } from "lucide-react";

import { OrgLogo } from "@/components/portal/org-logo";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import {
  fetchOwnLogo,
  removeOwnLogo,
  updateCjpNumber,
  updateOrganizationWebsite,
  uploadOwnLogo,
  type AccountState,
} from "./actions";

const initial: AccountState = { status: "idle" };

function Knop({
  children,
  variant = "secondary",
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size="sm" disabled={pending}>
      {pending ? "Bezig…" : children}
    </Button>
  );
}

function Melding({ state }: { state: AccountState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <Alert tone={state.status === "ok" ? "success" : "danger"} className="mt-3">
      {state.message}
    </Alert>
  );
}

/**
 * De gegevens van de organisatie in het account.
 *
 * Het logo, de website en het CJP-schoolnummer horen bij de school en niet bij
 * een persoon. Iedereen die bij deze school hoort mag ze aanpassen, en al hun
 * collega's zien dezelfde wijziging.
 */
export function OrganisatieGegevens({
  organizationName,
  logoUrl,
  logoSource,
  website,
  cjpNumber,
  hasCjp,
}: {
  organizationName: string;
  logoUrl: string | null;
  logoSource: string | null;
  website: string | null;
  cjpNumber: string | null;
  hasCjp: boolean | null;
}) {
  const [cjpState, cjpAction] = useActionState(updateCjpNumber, initial);
  const [siteState, siteAction] = useActionState(updateOrganizationWebsite, initial);
  const [uploadState, uploadAction] = useActionState(uploadOwnLogo, initial);
  const [haalState, haalAction] = useActionState(async () => fetchOwnLogo(), initial);
  const [wisState, wisAction] = useActionState(async () => removeOwnLogo(), initial);

  const [cjpOpen, setCjpOpen] = useState(false);
  const [logoOpen, setLogoOpen] = useState(false);

  const cjpWeergave = cjpNumber
    ? cjpNumber
    : hasCjp === true
      ? "Nog niet ingevuld"
      : hasCjp === false
        ? "Deze school heeft geen CJP-schoolnummer"
        : "Niet ingevuld";

  return (
    <div className="space-y-6">
      {/* Logo */}
      <div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <OrgLogo
            name={organizationName}
            logoUrl={logoUrl}
            size={48}
            className="border border-line-soft"
          />
          <div className="min-w-[12rem] flex-1">
            <p className="font-semibold">{organizationName}</p>
            <p className="text-sm text-muted">
              {logoUrl
                ? logoSource === "handmatig"
                  ? "Logo door uw school ingesteld."
                  : "Logo opgehaald van uw website."
                : "Nog geen logo. In het menu staat nu het standaardicoon."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setLogoOpen((open) => !open)}
            className="ml-auto shrink-0 text-sm font-semibold underline underline-offset-4"
          >
            {logoOpen ? "Sluiten" : logoUrl ? "Wijzigen" : "Instellen"}
          </button>
        </div>

        {logoOpen ? (
          <div className="mt-4 space-y-4 rounded-card border border-line-soft bg-surface-1 p-4">
            <form action={uploadAction} className="space-y-3">
              <Field
                label="Zelf een logo kiezen"
                htmlFor="logo"
                hint="PNG, JPG of WEBP, maximaal 2 MB. Een vierkant logo staat het mooist."
              >
                <input
                  id="logo"
                  name="logo"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="block w-full text-sm file:mr-3 file:min-h-11 file:rounded-pill file:border-0 file:bg-ink file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                />
              </Field>
              <Knop variant="primary">
                <Upload aria-hidden className="size-4" />
                Uploaden
              </Knop>
              <Melding state={uploadState} />
            </form>

            <div className="border-t border-line-soft pt-4">
              <form action={siteAction} className="space-y-3">
                <Field
                  label="Website van uw school"
                  htmlFor="website"
                  hint="Hier zoeken wij uw logo als u het niet zelf uploadt."
                >
                  <Input
                    id="website"
                    name="website"
                    defaultValue={website ?? ""}
                    placeholder="goudsewaarden.nl"
                  />
                </Field>
                <Knop>Website opslaan</Knop>
                <Melding state={siteState} />
              </form>
            </div>

            <div className="flex flex-wrap gap-3 border-t border-line-soft pt-4">
              <form action={haalAction}>
                <Knop>
                  <RefreshCw aria-hidden className="size-4" />
                  Logo van onze website halen
                </Knop>
              </form>

              {logoUrl ? (
                <form action={wisAction}>
                  <Knop variant="ghost">
                    <Trash2 aria-hidden className="size-4" />
                    Logo verwijderen
                  </Knop>
                </form>
              ) : null}
            </div>
            <Melding state={haalState} />
            <Melding state={wisState} />
          </div>
        ) : null}
      </div>

      {/* CJP */}
      <div className="border-t border-line-soft pt-5">
        {hasCjp === true && !cjpNumber ? (
          <Alert tone="warning" className="mb-3">
            Vul het CJP-schoolnummer van uw school aan.
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-sm font-semibold">CJP-schoolnummer</p>
          {!cjpOpen ? (
            <button
              type="button"
              onClick={() => setCjpOpen(true)}
              className="text-sm font-semibold underline underline-offset-4"
            >
              {cjpNumber ? "Aanpassen" : "Toevoegen"}
            </button>
          ) : null}
        </div>
        <p className="mt-0.5 text-[15px] text-muted">{cjpWeergave}</p>

        {cjpOpen ? (
          <form action={cjpAction} className="mt-3 space-y-3">
            <Field
              label="CJP-schoolnummer"
              htmlFor="cjp_school_number"
              hint="Leeg laten mag ook. Niet iedere school heeft een nummer, en het is nergens voor nodig om SkoolPartner te gebruiken."
            >
              <Input
                id="cjp_school_number"
                name="cjp_school_number"
                defaultValue={cjpNumber ?? ""}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Knop variant="primary">Opslaan</Knop>
              <button
                type="button"
                onClick={() => setCjpOpen(false)}
                className="text-sm font-semibold text-muted underline underline-offset-4"
              >
                Annuleren
              </button>
            </div>
          </form>
        ) : null}
        <Melding state={cjpState} />
      </div>
    </div>
  );
}
