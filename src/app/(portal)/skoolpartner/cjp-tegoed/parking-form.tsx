"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowLeft, PiggyBank } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { formatEuroCents, formatPoints } from "@/lib/format";
import {
  formatCentsPlain,
  parseAmountToCents,
  validateParkingInput,
  type ParkingInput,
} from "@/lib/tegoed/regels";
import { submitParkingRequest, type ParkingFormState } from "./actions";
import { ParkingSummary } from "./parking-summary";

const initial: ParkingFormState = { status: "idle" };

function VerstuurKnop() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Bezig…" : "Aanvraag versturen"}
    </Button>
  );
}

export interface ParkingFormProps {
  /** Wat wij al van u weten. Alles blijft aanpasbaar. */
  prefill: ParkingInput;
  minimumCents: number;
  bonusEnabled: boolean;
  bonusPoints: number;
  bonusMinimumCents: number;
  pointsName: string;
  supportEmail: string;
}

export function ParkingForm({
  prefill,
  minimumCents,
  bonusEnabled,
  bonusPoints,
  bonusMinimumCents,
  pointsName,
  supportEmail,
}: ParkingFormProps) {
  const [state, formAction] = useActionState(submitParkingRequest, initial);
  const [waarden, setWaarden] = useState<ParkingInput>(prefill);
  const [bevestigen, setBevestigen] = useState(false);
  const [geraakt, setGeraakt] = useState(false);

  function zet(veld: keyof ParkingInput, waarde: string) {
    setWaarden((vorig) => ({ ...vorig, [veld]: waarde }));
  }

  const controle = validateParkingInput(waarden, { minimumCents });
  // Pas fouten tonen als iemand een keer heeft geprobeerd door te gaan. Een
  // formulier dat meteen rood kleurt voelt onvriendelijk.
  const fouten = geraakt ? controle.errors : {};
  const serverFouten = state.errors ?? {};
  const bedrag = parseAmountToCents(waarden.amount);

  if (state.status === "ok") {
    return (
      <div className="space-y-4">
        <Alert tone="success" title="Aanvraag verstuurd">
          {state.message}
        </Alert>
        <p className="text-[15px] leading-relaxed text-muted">
          Zolang wij de aanvraag nog niet hebben bevestigd, staat er nog geen tegoed op uw account
          {bonusEnabled ? ` en zijn er nog geen bonuspunten toegekend` : ""}. Zodra dat wel zo is,
          ziet u het hieronder terug. Vragen? Mail ons op {supportEmail}.
        </p>
      </div>
    );
  }

  // Stap 2: alles nog één keer op een rij.
  if (bevestigen && controle.ok && controle.snapshot) {
    const snapshot = controle.snapshot;
    return (
      <div className="space-y-4">
        {state.status === "error" ? <Alert tone="danger">{state.message}</Alert> : null}

        <ParkingSummary
          snapshot={snapshot}
          bonusEnabled={bonusEnabled}
          bonusPoints={bonusPoints}
          bonusMinimumCents={bonusMinimumCents}
          pointsName={pointsName}
        />

        <form action={formAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="school_name" value={waarden.schoolName} />
          <input type="hidden" name="cjp_school_number" value={waarden.cjpSchoolNumber} />
          <input type="hidden" name="holder_name" value={waarden.holderName} />
          <input type="hidden" name="holder_email" value={waarden.holderEmail} />
          <input type="hidden" name="holder_phone" value={waarden.holderPhone} />
          <input type="hidden" name="amount" value={waarden.amount} />
          <VerstuurKnop />
          <button
            type="button"
            onClick={() => setBevestigen(false)}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted underline underline-offset-4 hover:text-ink"
          >
            <ArrowLeft aria-hidden className="size-4" />
            Aanpassen
          </button>
        </form>
      </div>
    );
  }

  // Stap 1: invullen.
  return (
    <div className="space-y-5">
      {state.status === "error" ? <Alert tone="danger">{state.message}</Alert> : null}

      <Field
        label="Welk bedrag wilt u parkeren?"
        htmlFor="amount"
        required
        hint={`Het bedrag dat u dit schooljaar niet meer bij CJP gaat besteden. Minimaal € ${formatCentsPlain(minimumCents)}.`}
        error={fouten.amount ?? serverFouten.amount}
      >
        <Input
          id="amount"
          name="amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="1250,00"
          value={waarden.amount}
          onChange={(event) => zet("amount", event.target.value)}
        />
      </Field>

      {bedrag.ok ? (
        <p className="rounded-card border border-line-soft px-4 py-3 text-[15px]">
          U parkeert{" "}
          <strong className="font-display text-lg">{formatEuroCents(bedrag.cents!)}</strong> bij
          Skool Workshop
          {bonusEnabled && bedrag.cents! >= bonusMinimumCents ? (
            <>
              , en u krijgt eenmalig {formatPoints(bonusPoints)} {pointsName} als bonus
            </>
          ) : bonusEnabled ? (
            <>. Vanaf {formatEuroCents(bonusMinimumCents)} ontvangt uw organisatie eenmalig {formatPoints(bonusPoints)} {pointsName}</>
          ) : null}
          .
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Naam van de school"
          htmlFor="school_name"
          required
          error={fouten.schoolName ?? serverFouten.schoolName}
        >
          <Input
            id="school_name"
            value={waarden.schoolName}
            onChange={(event) => zet("schoolName", event.target.value)}
          />
        </Field>

        <Field
          label="CJP-schoolnummer"
          htmlFor="cjp_school_number"
          required
          hint="Dit hebben wij nodig om uw budget bij CJP terug te vinden."
          error={fouten.cjpSchoolNumber ?? serverFouten.cjpSchoolNumber}
        >
          <Input
            id="cjp_school_number"
            value={waarden.cjpSchoolNumber}
            onChange={(event) => zet("cjpSchoolNumber", event.target.value)}
          />
        </Field>

        <Field
          label="Naam van de budgethouder"
          htmlFor="holder_name"
          required
          hint="Degene die over het CJP-budget gaat."
          error={fouten.holderName ?? serverFouten.holderName}
        >
          <Input
            id="holder_name"
            value={waarden.holderName}
            onChange={(event) => zet("holderName", event.target.value)}
          />
        </Field>

        <Field
          label="E-mailadres van de budgethouder"
          htmlFor="holder_email"
          required
          error={fouten.holderEmail ?? serverFouten.holderEmail}
        >
          <Input
            id="holder_email"
            type="email"
            value={waarden.holderEmail}
            onChange={(event) => zet("holderEmail", event.target.value)}
          />
        </Field>

        <Field
          label="Telefoonnummer van de budgethouder"
          htmlFor="holder_phone"
          error={fouten.holderPhone ?? serverFouten.holderPhone}
        >
          <Input
            id="holder_phone"
            type="tel"
            value={waarden.holderPhone}
            onChange={(event) => zet("holderPhone", event.target.value)}
          />
        </Field>
      </div>

      <p className="text-sm text-muted">
        Wij hebben alvast ingevuld wat wij van u weten. Klopt er iets niet, of gaat iemand anders
        over het budget? Pas het gerust aan. Wij bewaren deze gegevens zoals u ze nu invult, zodat
        bij deze aanvraag altijd zichtbaar blijft wie de budgethouder was.
      </p>

      <Button
        type="button"
        onClick={() => {
          setGeraakt(true);
          if (controle.ok) setBevestigen(true);
        }}
      >
        <PiggyBank aria-hidden className="size-4" />
        Verder naar controleren
      </Button>
    </div>
  );
}
