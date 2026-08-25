"use client";

import { useActionState, useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Textarea } from "@/components/ui/form";
import { replyToThread, type ReplyState } from "../actions";

const initial: ReplyState = { status: "idle" };

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      <Send aria-hidden className="size-4" />
      {pending ? "Versturen…" : "Versturen"}
    </Button>
  );
}

export function ReplyForm({ threadId, supportEmail }: { threadId: string; supportEmail: string }) {
  const [state, formAction] = useActionState(replyToThread, initial);
  const fieldId = useId();

  /**
   * Idempotency: zolang een bericht nog niet succesvol verstuurd is, blijft de
   * sleutel hetzelfde. Een dubbele klik of een herhaalde poging levert daardoor
   * nooit twee berichten op. Pas na een geslaagde verzending komt er een
   * nieuwe sleutel voor het volgende bericht.
   */
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  function submit(formData: FormData) {
    if (state.status === "ok") {
      idempotencyKey.current = crypto.randomUUID();
    }
    formData.set("idempotency_key", idempotencyKey.current);
    formAction(formData);
  }

  return (
    <form action={submit} className="space-y-3">
      <input type="hidden" name="thread_id" value={threadId} />

      {state.status === "error" ? <Alert tone="danger">{state.message}</Alert> : null}
      {state.status === "ok" ? <Alert tone="success">{state.message}</Alert> : null}

      <div className="space-y-1.5">
        <label htmlFor={fieldId} className="block text-sm font-semibold">
          Uw antwoord
        </label>
        <p className="text-sm text-muted">
          Uw bericht wordt verwerkt via {supportEmail} en blijft onderdeel van dit gesprek.
        </p>
        <Textarea
          /* Na een geslaagde verzending wordt het veld leeggemaakt door het
             opnieuw te laten opbouwen met een nieuwe sleutel. */
          key={state.submissionId ?? "concept"}
          id={fieldId}
          name="body"
          required
          minLength={2}
          maxLength={10000}
          placeholder="Typ hier uw bericht…"
        />
      </div>

      <SendButton />
    </form>
  );
}
