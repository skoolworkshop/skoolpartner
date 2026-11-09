"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";

/**
 * Het codeveld voor de school.
 *
 * De link en de code gaan apart naar de klant. Wie de link doorstuurt of per
 * ongeluk ergens laat staan, geeft daarmee nog niemand inzage.
 */
export function CodePoort({
  token,
  meldAan,
}: {
  token: string;
  meldAan: (prev: { fout?: string }, formData: FormData) => Promise<{ fout?: string }>;
}) {
  const [stand, actie, bezig] = useActionState(meldAan, {});

  return (
    <Card>
      <CardHeader title="Indeling bekijken" description="Vul de code in die je van ons hebt gekregen." />
      <CardBody>
        <form action={actie} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <Field label="Code" htmlFor="code" required>
            <Input
              id="code"
              name="code"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              className="max-w-48 font-mono text-lg tracking-[0.2em] uppercase"
              placeholder="ABC123"
              required
            />
          </Field>
          {stand.fout ? <Alert tone="danger">{stand.fout}</Alert> : null}
          <Button type="submit" disabled={bezig}>
            {bezig ? "Bezig…" : "Bekijken"}
          </Button>
          <p className="text-sm text-muted">
            Code kwijt? Mail ons, dan sturen we een nieuwe. De oude vervalt dan.
          </p>
        </form>
      </CardBody>
    </Card>
  );
}
