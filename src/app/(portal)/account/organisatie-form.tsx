"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { OrgLogo } from "@/components/portal/org-logo";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { updateCjpNumber, type AccountState } from "./actions";

const initial: AccountState = { status: "idle" };

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" disabled={pending}>
      {pending ? "Bezig…" : "Opslaan"}
    </Button>
  );
}

/**
 * De gegevens van de organisatie in het account.
 *
 * Het logo en het CJP-schoolnummer horen bij de school en niet bij de persoon.
 * Alle collega's van dezelfde school zien hier dus hetzelfde staan.
 */
export function OrganisatieGegevens({
  organizationName,
  logoUrl,
  cjpNumber,
  hasCjp,
  canEdit,
  supportEmail,
}: {
  organizationName: string;
  logoUrl: string | null;
  cjpNumber: string | null;
  hasCjp: boolean | null;
  canEdit: boolean;
  supportEmail: string;
}) {
  const [state, formAction] = useActionState(updateCjpNumber, initial);
  const [open, setOpen] = useState(false);

  const weergave = cjpNumber
    ? cjpNumber
    : hasCjp === true
      ? "Nog niet ingevuld"
      : hasCjp === false
        ? "Deze school heeft geen CJP-schoolnummer"
        : "Niet ingevuld";

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <OrgLogo name={organizationName} logoUrl={logoUrl} size={44} className="border border-line-soft" />
        <div className="min-w-0">
          <p className="truncate font-semibold">{organizationName}</p>
          <p className="text-sm text-muted">
            {logoUrl
              ? "Het logo halen wij van de website van uw school."
              : "Nog geen logo gevonden op de website van uw school."}
          </p>
        </div>
      </div>

      <div className="border-t border-line-soft pt-5">
        {state.status === "ok" ? (
          <Alert tone="success" className="mb-3">
            {state.message}
          </Alert>
        ) : null}
        {state.status === "error" ? (
          <Alert tone="danger" className="mb-3">
            {state.message}
          </Alert>
        ) : null}

        {hasCjp === true && !cjpNumber ? (
          <Alert tone="warning" className="mb-3">
            Vul het CJP-schoolnummer van uw school aan.
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-sm font-semibold">CJP-schoolnummer</p>
          {canEdit && !open ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-sm font-semibold underline underline-offset-4"
            >
              {cjpNumber ? "Aanpassen" : "Toevoegen"}
            </button>
          ) : null}
        </div>
        <p className="mt-0.5 text-[15px] text-muted">{weergave}</p>

        {open ? (
          <form action={formAction} className="mt-3 space-y-3">
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
              <Save />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm font-semibold text-muted underline underline-offset-4"
              >
                Annuleren
              </button>
            </div>
          </form>
        ) : null}

        {!canEdit ? (
          <p className="mt-2 text-sm text-muted">
            Alleen een beheerder van uw organisatie kan dit aanpassen. Klopt er iets niet? Mail ons
            op {supportEmail}.
          </p>
        ) : null}
      </div>
    </div>
  );
}
