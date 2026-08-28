"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { leaveOrganization, updateProfile, type AccountState } from "./actions";

const initial: AccountState = { status: "idle" };

function Save({ children = "Opslaan" }: { children?: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Bezig…" : children}
    </Button>
  );
}

export function ProfileForm({
  firstName,
  lastName,
  phone,
  jobTitle,
  email,
}: {
  firstName: string;
  lastName: string;
  phone: string;
  jobTitle: string;
  email: string;
}) {
  const [state, formAction] = useActionState(updateProfile, initial);

  return (
    <form action={formAction} className="space-y-4">
      {state.status === "ok" ? <Alert tone="success">{state.message}</Alert> : null}
      {state.status === "error" ? <Alert tone="danger">{state.message}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Voornaam" htmlFor="first_name" required>
          <Input id="first_name" name="first_name" defaultValue={firstName} autoComplete="given-name" required />
        </Field>
        <Field label="Achternaam" htmlFor="last_name" required>
          <Input id="last_name" name="last_name" defaultValue={lastName} autoComplete="family-name" required />
        </Field>
      </div>

      <Field
        label="E-mailadres"
        htmlFor="email"
        required
        hint="Hiermee logt u in. Bij wijzigen ontvangt u een bevestiging op het nieuwe adres."
      >
        <Input id="email" name="email" type="email" defaultValue={email} autoComplete="email" required />
      </Field>

      <Field
        label="Telefoonnummer"
        htmlFor="phone"
        required
        hint="Zodat wij u op de dag van de workshop kunnen bereiken. Een nummer uit het buitenland? Zet de landcode ervoor, bijvoorbeeld +32."
      >
        <Input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          defaultValue={phone}
          placeholder="06 12345678"
          required
        />
      </Field>

      <Field label="Functie" htmlFor="job_title">
        <Input id="job_title" name="job_title" defaultValue={jobTitle} placeholder="Cultuurcoördinator" />
      </Field>

      <Save />
    </form>
  );
}

export function LeaveOrganizationForm({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) {
  const [state, formAction] = useActionState(leaveOrganization, initial);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="organization_id" value={organizationId} />
      {state.status === "ok" ? <Alert tone="success">{state.message}</Alert> : null}
      {state.status === "error" ? <Alert tone="danger">{state.message}</Alert> : null}
      <p className="text-sm text-muted">
        U verliest hiermee de toegang tot de boekingen, facturen en berichten van{" "}
        {organizationName}. De gegevens van de organisatie zelf blijven bestaan.
      </p>
      <Button type="submit" variant="secondary">
        Lidmaatschap beëindigen
      </Button>
    </form>
  );
}
