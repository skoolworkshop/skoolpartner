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
  fullName,
  phone,
  jobTitle,
  email,
}: {
  fullName: string;
  phone: string;
  jobTitle: string;
  email: string;
}) {
  const [state, formAction] = useActionState(updateProfile, initial);

  return (
    <form action={formAction} className="space-y-4">
      {state.status === "ok" ? <Alert tone="success">{state.message}</Alert> : null}
      {state.status === "error" ? <Alert tone="danger">{state.message}</Alert> : null}

      <Field label="Naam" htmlFor="full_name" required>
        <Input id="full_name" name="full_name" defaultValue={fullName} required />
      </Field>

      <Field
        label="E-mailadres"
        htmlFor="email"
        required
        hint="Hiermee logt u in en hierop sturen wij bevestigingen, facturen en resultaten. Wilt u een ander adres gebruiken? Mail ons, dan regelen wij dat veilig."
      >
        <Input id="email" name="email" type="email" defaultValue={email} disabled />
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
