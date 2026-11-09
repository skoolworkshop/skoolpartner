"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";
import type { AdminState } from "@/app/admin/actions";

/**
 * Een formulier dat eerst waarschuwt en pas daarna doet.
 *
 * Sommige wijzigingen raken leerlingen die al ingeschreven zijn: een
 * uitvoering uitzetten waar al twaalf kinderen in zitten, of klassen
 * inperken terwijl er iemand uit een andere klas in zit. Die wijzigingen zijn
 * niet verboden, maar ze horen niet per ongeluk te gebeuren.
 *
 * De serveractie geeft dan `bevestig` terug met een uitleg erbij. Pas dan
 * verschijnt de tweede knop, die hetzelfde formulier nog eens verstuurt met
 * bevestigd erbij. Er wordt nooit iemand verplaatst of verwijderd; de
 * waarschuwing vertelt alleen wat het gevolg is.
 */

const beginstand: AdminState = { status: "idle" };

function Knop({
  label,
  variant = "ink",
}: {
  label: string;
  variant?: "primary" | "ink" | "secondary" | "ghost" | "danger" | "accent";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size="sm" disabled={pending}>
      {pending ? "Bezig…" : label}
    </Button>
  );
}

export function BevestigForm({
  action,
  children,
  submitLabel,
  bevestigLabel = "Toch doorgaan",
  variant = "ink",
  inline = false,
  className,
}: {
  action: (prev: AdminState, formData: FormData) => Promise<AdminState>;
  children?: React.ReactNode;
  submitLabel: string;
  bevestigLabel?: string;
  variant?: "primary" | "ink" | "secondary" | "ghost" | "danger" | "accent";
  inline?: boolean;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, beginstand);
  const moetBevestigen = state.status === "error" && state.bevestig === true;

  return (
    <form
      action={formAction}
      className={cn(
        inline ? "flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-end" : "space-y-3",
        className,
      )}
    >
      {children}
      <Knop label={submitLabel} variant={variant} />

      {moetBevestigen ? (
        <>
          <Alert tone="warning" className={inline ? "w-full" : undefined}>
            {state.message}
          </Alert>
          {/*
            Dezelfde velden, maar deze knop stuurt bevestigd mee. Een knop in
            een formulier mag een eigen naam en waarde hebben; daardoor is er
            geen tweede formulier nodig met dezelfde verborgen velden erin.
          */}
          <Button type="submit" name="bevestigd" value="ja" variant="danger" size="sm">
            {bevestigLabel}
          </Button>
        </>
      ) : null}

      {state.status === "ok" ? (
        <Alert tone="success" className={inline ? "w-full" : undefined}>
          {state.message}
        </Alert>
      ) : null}
      {state.status === "error" && !moetBevestigen ? (
        <Alert tone="danger" className={inline ? "w-full" : undefined}>
          {state.message}
        </Alert>
      ) : null}
    </form>
  );
}
