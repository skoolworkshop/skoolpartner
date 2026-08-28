"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { sendLoginLink, verifyLoginCode, type AuthFormState } from "./actions";

const initialState: AuthFormState = { status: "idle" };

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return <Button type="submit" className="w-full" disabled={pending}>{pending ? "Even geduld…" : children}</Button>;
}

function ResendButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="font-semibold text-ink underline underline-offset-4 disabled:opacity-50">
      {pending ? "Nieuwe code wordt verstuurd…" : "Nieuwe code sturen"}
    </button>
  );
}

function VerificationCodeInput() {
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  function update(index: number, raw: string) {
    const digit = raw.replace(/\D/g, "").slice(-1);
    setDigits((current) => current.map((value, position) => position === index ? digit : value));
    if (digit && index < 5) inputs.current[index + 1]?.focus();
  }

  function paste(raw: string) {
    const code = raw.replace(/\D/g, "").slice(0, 6);
    if (!code) return;
    setDigits(Array.from({ length: 6 }, (_, index) => code[index] ?? ""));
    inputs.current[Math.min(code.length, 6) - 1]?.focus();
  }

  return (
    <div>
      <label className="mb-2 block text-sm font-semibold text-ink" htmlFor="code-0">Verificatiecode</label>
      <input type="hidden" name="code" value={digits.join("")} />
      <div className="grid grid-cols-6 gap-2" onPaste={(event) => { event.preventDefault(); paste(event.clipboardData.getData("text")); }}>
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(element) => { inputs.current[index] = element; }}
            id={`code-${index}`}
            aria-label={`Cijfer ${index + 1} van 6`}
            value={digit}
            onChange={(event) => update(index, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Backspace" && !digit && index > 0) inputs.current[index - 1]?.focus();
              if (event.key === "ArrowLeft" && index > 0) inputs.current[index - 1]?.focus();
              if (event.key === "ArrowRight" && index < 5) inputs.current[index + 1]?.focus();
            }}
            inputMode="numeric"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            maxLength={1}
            className="h-14 min-w-0 rounded-xl border border-line bg-white text-center font-display text-2xl font-bold outline-none transition focus:border-ink focus:ring-2 focus:ring-accent/30"
            required
          />
        ))}
      </div>
    </div>
  );
}

export function LoginForm({ mode = "login", next = "/dashboard" }: { mode?: "login" | "register"; next?: string }) {
  const router = useRouter();
  const [state, formAction] = useActionState(sendLoginLink, initialState);
  const [resendState, resendAction] = useActionState(sendLoginLink, initialState);
  const [codeState, codeAction] = useActionState(verifyLoginCode, initialState);
  const channelInput = useRef<HTMLInputElement>(null);
  const channel = state.channel ?? "";

  useEffect(() => {
    if (state.status !== "sent" || !channel) return;
    const finish = (receivedChannel: string) => {
      if (receivedChannel !== channel) return;
      router.replace(next);
      router.refresh();
    };
    let broadcast: BroadcastChannel | null = null;
    try {
      broadcast = new BroadcastChannel(`skoolpartner-auth-${channel}`);
      broadcast.onmessage = (event) => finish(String(event.data?.channel ?? ""));
    } catch {
      // De storage-listener hieronder blijft beschikbaar als fallback.
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key !== "skoolpartner-auth-complete" || !event.newValue) return;
      try { finish(String(JSON.parse(event.newValue).channel ?? "")); } catch { /* negeren */ }
    };
    window.addEventListener("storage", onStorage);
    return () => { broadcast?.close(); window.removeEventListener("storage", onStorage); };
  }, [channel, next, router, state.status]);

  function prepareTabChannel() {
    if (channelInput.current && !channelInput.current.value) channelInput.current.value = crypto.randomUUID();
  }

  if (state.status === "sent" && state.email) {
    return (
      <div className="space-y-6">
        <div>
          <p className="eyebrow mb-2 text-accent-strong">Veilig inloggen</p>
          <h1 className="text-[30px]">Controleer je e-mail</h1>
          <p className="mt-2 text-[15px] text-muted">We hebben een tijdelijke verificatiecode gestuurd naar<br /><strong className="break-all text-ink">{state.email}</strong></p>
        </div>
        <form action={codeAction} className="space-y-5">
          <input type="hidden" name="email" value={state.email} />
          <input type="hidden" name="volgende" value={next} />
          <VerificationCodeInput />
          {codeState.status === "error" ? <Alert tone="danger">{codeState.message}</Alert> : null}
          <SubmitButton>Code bevestigen</SubmitButton>
        </form>
        <div className="space-y-2 text-sm text-muted">
          <form action={resendAction} className="flex flex-wrap items-center gap-1.5">
            <span>Geen code ontvangen?</span>
            <input type="hidden" name="email" value={state.email} />
            <input type="hidden" name="volgende" value={next} />
            <input type="hidden" name="kanaal" value={state.channel ?? ""} />
            {state.registration ? <input type="hidden" name="registreren" value="1" /> : null}
            <input type="hidden" name="first_name" value={state.firstName ?? ""} />
            <input type="hidden" name="last_name" value={state.lastName ?? ""} />
            <ResendButton />
          </form>
          {resendState.status === "sent" ? <p className="text-success">Er is een nieuwe code verstuurd.</p> : null}
          {resendState.status === "error" ? <p className="text-danger">{resendState.message}</p> : null}
          <p className="border-t border-line-soft pt-4 text-xs italic">De code is tijdelijk geldig en kan maar één keer worden gebruikt. In de e-mail staat ook een beveiligde link als alternatief.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow mb-2 text-accent-strong">Welkom bij SkoolPartner</p>
        <h1 className="text-[30px]">{mode === "register" ? "Account aanmaken" : "Inloggen op SkoolPartner"}</h1>
        <p className="mt-2 text-[15px] text-muted">{mode === "register" ? "Vul uw naam en e-mailadres in. Daarna bevestigt u uw adres met een tijdelijke code en vult u de schoolgegevens aan." : "Vul uw e-mailadres in. U ontvangt een tijdelijke verificatiecode; een wachtwoord is niet nodig."}</p>
      </div>
      {state.status === "error" ? <Alert tone="danger">{state.message}</Alert> : null}
      <form action={formAction} onSubmit={prepareTabChannel} className="space-y-4">
        <input type="hidden" name="volgende" value={next} />
        <input ref={channelInput} type="hidden" name="kanaal" defaultValue="" />
        {mode === "register" ? <input type="hidden" name="registreren" value="1" /> : null}
        {mode === "register" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Voornaam" htmlFor="first_name" required><Input id="first_name" name="first_name" autoComplete="given-name" placeholder="Sanne" defaultValue={state.firstName} required /></Field>
            <Field label="Achternaam" htmlFor="last_name" required><Input id="last_name" name="last_name" autoComplete="family-name" placeholder="de Vries" defaultValue={state.lastName} required /></Field>
          </div>
        ) : null}
        <Field label="E-mailadres" htmlFor="email" required hint={mode === "register" ? "Gebruik bij voorkeur het adres van uw school of organisatie." : undefined}>
          <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" placeholder="naam@uwschool.nl" defaultValue={state.email} required />
        </Field>
        <SubmitButton><Mail aria-hidden className="size-4" />Verificatiecode sturen</SubmitButton>
      </form>
    </div>
  );
}
