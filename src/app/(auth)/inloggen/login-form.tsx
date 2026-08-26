"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { sendLoginLink, verifyLoginCode, type AuthFormState } from "./actions";

const initialState: AuthFormState = { status: "idle" };

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Even geduld…" : children}
    </Button>
  );
}

export function LoginForm({
  mode = "login",
  next = "/dashboard",
}: {
  mode?: "login" | "register";
  next?: string;
}) {
  const [state, formAction] = useActionState(sendLoginLink, initialState);
  const [codeState, codeAction] = useActionState(verifyLoginCode, initialState);
  const [showCode, setShowCode] = useState(false);

  if (state.status === "sent") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-[28px]">Kijk in uw mailbox</h1>
          <p className="mt-2 text-[15px] text-muted">
            We hebben een inloglink gestuurd naar <strong className="text-ink">{state.email}</strong>.
            De link is 60 minuten geldig.
          </p>
        </div>

        <Alert tone="info">
          Geen mail ontvangen? Kijk ook in uw spam- of ongewenste berichtenmap. Bij schoolmailboxen
          duurt bezorging soms een paar minuten.
        </Alert>

        {showCode ? (
          <form action={codeAction} className="space-y-4">
            <input type="hidden" name="email" value={state.email} />
            <input type="hidden" name="volgende" value={next} />
            <Field
              label="Inlogcode uit de e-mail"
              htmlFor="code"
              required
              hint="Zes cijfers, onderaan de e-mail."
              error={codeState.status === "error" ? codeState.message : null}
            >
              <Input
                id="code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                className="text-center font-display text-2xl tracking-[0.4em]"
                required
              />
            </Field>
            <SubmitButton>Inloggen</SubmitButton>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setShowCode(true)}
            className="text-sm font-semibold text-ink underline underline-offset-4 hover:text-accent-strong"
          >
            Werkt de link niet? Voer de code uit de e-mail in
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px]">
          {mode === "register" ? "Account aanmaken" : "Inloggen op SkoolPartner"}
        </h1>
        <p className="mt-2 text-[15px] text-muted">
          {mode === "register"
            ? "Stap 1 van 2. Wij sturen u een link om uw e-mailadres te bevestigen. Daarna vult u uw organisatie- en adresgegevens in."
            : "Vul uw e-mailadres in. U ontvangt een inloglink, u hoeft geen wachtwoord te onthouden."}
        </p>
      </div>

      {state.status === "error" ? <Alert tone="danger">{state.message}</Alert> : null}

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="volgende" value={next} />
        {mode === "register" ? <input type="hidden" name="registreren" value="1" /> : null}

        {mode === "register" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Voornaam" htmlFor="first_name" required>
              <Input
                id="first_name"
                name="first_name"
                autoComplete="given-name"
                placeholder="Sanne"
                required
              />
            </Field>
            <Field label="Achternaam" htmlFor="last_name" required>
              <Input
                id="last_name"
                name="last_name"
                autoComplete="family-name"
                placeholder="de Vries"
                required
              />
            </Field>
          </div>
        ) : null}

        <Field
          label="E-mailadres"
          htmlFor="email"
          required
          hint={
            mode === "register"
              ? "Gebruik het adres van uw school of organisatie."
              : undefined
          }
        >
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="naam@uwschool.nl"
            defaultValue={state.email}
            required
          />
        </Field>

        <SubmitButton>
          <Mail aria-hidden className="size-4" />
          {mode === "register" ? "Account aanmaken" : "Stuur mij een inloglink"}
        </SubmitButton>
      </form>
    </div>
  );
}
