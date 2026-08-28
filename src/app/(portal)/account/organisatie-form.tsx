"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { MapPin, RefreshCw, Trash2, Upload } from "lucide-react";

import { OrgLogo } from "@/components/portal/org-logo";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import {
  fetchOwnLogo,
  lookupOwnOrganizationAddress,
  removeOwnLogo,
  updateCjpNumber,
  updateOrganizationDetails,
  updateOrganizationWebsite,
  uploadOwnLogo,
  type AccountState,
  type OrganizationAddressLookupState,
} from "./actions";

const initial: AccountState = { status: "idle" };
const initialAddress: OrganizationAddressLookupState = { status: "idle" };

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
  street,
  houseNumber,
  houseNumberAddition,
  postalCode,
  city,
  organizationPhone,
  logoUrl,
  logoSource,
  website,
  cjpNumber,
  hasCjp,
}: {
  organizationName: string;
  street: string | null;
  houseNumber: string | null;
  houseNumberAddition: string | null;
  postalCode: string | null;
  city: string | null;
  organizationPhone: string;
  logoUrl: string | null;
  logoSource: string | null;
  website: string | null;
  cjpNumber: string | null;
  hasCjp: boolean | null;
}) {
  const [cjpState, cjpAction] = useActionState(updateCjpNumber, initial);
  const [detailsState, detailsAction] = useActionState(updateOrganizationDetails, initial);
  const [addressState, addressAction, addressPending] = useActionState(
    lookupOwnOrganizationAddress,
    initialAddress
  );
  const [siteState, siteAction] = useActionState(updateOrganizationWebsite, initial);
  const [uploadState, uploadAction] = useActionState(uploadOwnLogo, initial);
  const [haalState, haalAction] = useActionState(async () => fetchOwnLogo(), initial);
  const [wisState, wisAction] = useActionState(async () => removeOwnLogo(), initial);

  const [cjpOpen, setCjpOpen] = useState(false);
  const [logoOpen, setLogoOpen] = useState(false);
  const addressKey = addressState.address
    ? [
        addressState.address.street,
        addressState.address.houseNumber,
        addressState.address.houseNumberAddition,
        addressState.address.postalCode,
        addressState.address.city,
      ].join("-")
    : "bestaand";

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
          <div className="min-w-0 flex-1 basis-48">
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

      {/* Gedeelde school- en adresgegevens */}
      <div className="border-t border-line-soft pt-5">
        <form action={detailsAction} className="space-y-4">
          <div>
            <h3 className="font-display text-base">School- en adresgegevens</h3>
            <p className="mt-1 text-sm text-muted">
              Deze gegevens zijn bij de registratie ingevuld en worden gedeeld met alle gebruikers van deze organisatie.
            </p>
          </div>

          <Field label="Naam school of organisatie" htmlFor="organization_name" required>
            <Input id="organization_name" name="organization_name" defaultValue={organizationName} autoComplete="organization" required />
          </Field>

          <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Field label="Postcode" htmlFor="organization_postal_code" required>
              <Input
                key={`postcode-${addressKey}`}
                id="organization_postal_code"
                name="postal_code"
                defaultValue={addressState.address?.postalCode ?? postalCode ?? ""}
                autoComplete="postal-code"
                placeholder="2801 AB"
                required
              />
            </Field>
            <Button
              type="submit"
              variant="secondary"
              formAction={addressAction}
              formNoValidate
              disabled={addressPending}
              className="w-full sm:w-auto"
            >
              <MapPin aria-hidden className="size-4" />
              {addressPending ? "Zoeken…" : "Adres automatisch invullen"}
            </Button>
          </div>

          {addressState.message ? (
            <Alert tone={addressState.status === "ok" ? "success" : "warning"}>
              {addressState.message}
            </Alert>
          ) : null}

          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <Field label="Straat" htmlFor="organization_street" required>
              <Input
                key={`straat-${addressKey}`}
                id="organization_street"
                name="street"
                defaultValue={addressState.address?.street ?? street ?? ""}
                autoComplete="address-line1"
                required
              />
            </Field>
            <Field label="Huisnummer" htmlFor="organization_house_number" required>
              <Input
                key={`huisnummer-${addressKey}`}
                id="organization_house_number"
                name="house_number"
                defaultValue={addressState.address?.houseNumber ?? houseNumber ?? ""}
                inputMode="numeric"
                required
              />
            </Field>
            <Field label="Toevoeging" htmlFor="organization_house_number_addition">
              <Input
                key={`toevoeging-${addressKey}`}
                id="organization_house_number_addition"
                name="house_number_addition"
                defaultValue={addressState.address?.houseNumberAddition ?? houseNumberAddition ?? ""}
                placeholder="A"
              />
            </Field>
          </div>

          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <Field label="Woonplaats" htmlFor="organization_city" required>
              <Input
                key={`woonplaats-${addressKey}`}
                id="organization_city"
                name="city"
                defaultValue={addressState.address?.city ?? city ?? ""}
                autoComplete="address-level2"
                required
              />
            </Field>
          </div>

          <Field label="Algemeen telefoonnummer organisatie" htmlFor="organization_phone" hint="Optioneel; uw persoonlijke telefoonnummer staat bij Uw gegevens.">
            <Input id="organization_phone" name="organization_phone" type="tel" defaultValue={organizationPhone} autoComplete="tel" />
          </Field>

          <Knop variant="primary">Organisatiegegevens opslaan</Knop>
          <Melding state={detailsState} />
        </form>
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
