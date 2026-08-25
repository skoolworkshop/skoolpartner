"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/form";
import { formatEuroCents, formatPoints } from "@/lib/format";
import { pointsToCents } from "@/lib/loyalty/calc";
import { requestRedemption, type RedemptionState } from "./actions";

const initial: RedemptionState = { status: "idle" };

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? "Bezig…" : "Verzoek indienen"}
    </Button>
  );
}

export function RedeemForm({
  availablePoints,
  minimumPoints,
  maximumPoints,
  pointValueCentsPer100,
  pointsName,
}: {
  availablePoints: number;
  minimumPoints: number;
  maximumPoints: number;
  pointValueCentsPer100: number;
  pointsName: string;
}) {
  const [state, formAction] = useActionState(requestRedemption, initial);
  const cap = maximumPoints > 0 ? Math.min(availablePoints, maximumPoints) : availablePoints;
  const [points, setPoints] = useState(() => (cap >= minimumPoints ? cap : 0));

  const belowMinimum = availablePoints < minimumPoints;

  if (belowMinimum) {
    return (
      <Alert tone="info" title="Nog niet genoeg punten">
        U kunt {pointsName} inwisselen vanaf {formatPoints(minimumPoints)} punten. U heeft er nu{" "}
        {formatPoints(availablePoints)}.
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {state.status === "ok" ? <Alert tone="success">{state.message}</Alert> : null}
      {state.status === "error" ? <Alert tone="danger">{state.message}</Alert> : null}

      <form action={formAction} className="space-y-4">
        <Field
          label={`Aantal ${pointsName}`}
          htmlFor="points"
          required
          hint={`Beschikbaar: ${formatPoints(availablePoints)}${
            maximumPoints > 0 ? ` · maximaal ${formatPoints(maximumPoints)} per boeking` : ""
          }`}
        >
          <Input
            id="points"
            name="points"
            type="number"
            inputMode="numeric"
            min={minimumPoints}
            max={cap}
            step={10}
            value={points}
            onChange={(event) => setPoints(Number(event.target.value))}
            required
          />
        </Field>

        <p className="rounded-card bg-surface-2 px-4 py-3 text-sm">
          Dat is{" "}
          <strong className="font-display text-base">
            {formatEuroCents(pointsToCents(points, pointValueCentsPer100))}
          </strong>{" "}
          Skool Voordeel op uw volgende boeking.
        </p>

        <Field
          label="Boekingsreferentie of aanvraag"
          htmlFor="booking_reference"
          hint="Weet u het nummer van de aanvraag al? Vul dat hier in, dan koppelen wij het voordeel meteen."
        >
          <Input id="booking_reference" name="booking_reference" placeholder="SW-2026-0123" />
        </Field>

        <Field label="Toelichting" htmlFor="note">
          <Textarea id="note" name="note" placeholder="Bijvoorbeeld: graag verrekenen met de projectdag in juni." />
        </Field>

        <SubmitButton disabled={points < minimumPoints || points > cap} />
      </form>
    </div>
  );
}
