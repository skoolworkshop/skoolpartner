"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowLeft, CalendarCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { formatDate, formatEuroCents, formatPoints } from "@/lib/format";
import { pointsToCents } from "@/lib/loyalty/calc";
import { requestRedemption, type RedemptionState } from "./actions";

const initial: RedemptionState = { status: "idle" };

export interface RedeemableBooking {
  id: string;
  workshopName: string;
  scheduledDate: string | null;
  reference: string | null;
}

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Bezig…" : "Bevestig inwisselverzoek"}
    </Button>
  );
}

/** "CKV cultuurdag, 18 september 2026" */
function beschrijfBoeking(booking: RedeemableBooking): string {
  const datum = booking.scheduledDate ? formatDate(booking.scheduledDate) : null;
  return [booking.workshopName, datum].filter(Boolean).join(", ");
}

export function RedeemForm({
  availablePoints,
  minimumPoints,
  maximumPoints,
  pointValueCentsPer100,
  pointsName,
  bookings,
}: {
  availablePoints: number;
  minimumPoints: number;
  maximumPoints: number;
  pointValueCentsPer100: number;
  pointsName: string;
  bookings: RedeemableBooking[];
}) {
  const [state, formAction] = useActionState(requestRedemption, initial);
  const cap = maximumPoints > 0 ? Math.min(availablePoints, maximumPoints) : availablePoints;

  const [points, setPoints] = useState(() => (cap >= minimumPoints ? cap : 0));
  const [bookingId, setBookingId] = useState(() => bookings[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [bevestigen, setBevestigen] = useState(false);

  const gekozen = bookings.find((b) => b.id === bookingId) ?? null;
  const waardeCents = pointsToCents(points, pointValueCentsPer100);
  const teWeinig = availablePoints < minimumPoints;

  if (teWeinig) {
    return (
      <Alert tone="info" title="Nog niet genoeg punten">
        U kunt {pointsName} inwisselen vanaf {formatPoints(minimumPoints)} punten. U heeft er nu{" "}
        {formatPoints(availablePoints)}.
      </Alert>
    );
  }

  if (bookings.length === 0) {
    return (
      <Alert tone="info" title="Nog geen bevestigde workshop om het voordeel op te gebruiken">
        U kunt {pointsName} gebruiken op een workshop waarvan de datum al definitief is bevestigd en
        die nog moet komen. Zodra u zo&apos;n boeking heeft, kunt u hier uw punten inwisselen. U
        heeft nu {formatPoints(availablePoints)} punten, goed voor{" "}
        {formatEuroCents(pointsToCents(availablePoints, pointValueCentsPer100))} voordeel.
      </Alert>
    );
  }

  // Stap 2: alles nog één keer op een rij, in gewone taal.
  if (bevestigen && gekozen) {
    return (
      <div className="space-y-4">
        {state.status === "error" ? <Alert tone="danger">{state.message}</Alert> : null}

        <div className="rounded-card border border-accent/35 bg-accent-soft/25 p-5">
          <p className="font-display text-[19px] leading-snug">Klopt dit zo?</p>
          <dl className="mt-4 space-y-2 text-[15px]">
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-muted">U wisselt in</dt>
              <dd className="font-semibold">
                {formatPoints(points)} {pointsName}
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-muted">Waarde</dt>
              <dd className="font-display text-lg">{formatEuroCents(waardeCents)}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2 border-t border-accent/25 pt-2">
              <dt className="text-muted">Te gebruiken voor</dt>
              <dd className="text-right font-semibold">{beschrijfBoeking(gekozen)}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-muted">Punten na inwisselen</dt>
              <dd>{formatPoints(availablePoints - points)}</dd>
            </div>
          </dl>

          <p className="mt-4 text-sm text-muted">
            Wij reserveren deze punten meteen, zodat ze niet dubbel gebruikt kunnen worden. Zij
            worden pas definitief afgeschreven zodra wij het voordeel op uw factuur hebben verwerkt.
          </p>
        </div>

        <form action={formAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="points" value={points} />
          <input type="hidden" name="booking_id" value={bookingId} />
          <input type="hidden" name="note" value={note} />
          <ConfirmButton />
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

  // Stap 1: kiezen.
  return (
    <div className="space-y-4">
      {state.status === "ok" ? <Alert tone="success">{state.message}</Alert> : null}
      {state.status === "error" ? <Alert tone="danger">{state.message}</Alert> : null}

      <dl className="grid gap-3 rounded-card bg-surface-2 px-4 py-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">Beschikbaar</dt>
          <dd className="font-display text-lg">
            {formatPoints(availablePoints)} {pointsName}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Dat is nu waard</dt>
          <dd className="font-display text-lg">
            {formatEuroCents(pointsToCents(availablePoints, pointValueCentsPer100))}
          </dd>
        </div>
      </dl>

      <div className="space-y-4">
        <Field
          label="Voor welke workshop?"
          htmlFor="booking_id"
          required
          hint="Alleen workshops waarvan de datum definitief is bevestigd en die nog moeten komen."
        >
          <Select
            id="booking_id"
            value={bookingId}
            onChange={(event) => setBookingId(event.target.value)}
          >
            {bookings.map((booking) => (
              <option key={booking.id} value={booking.id}>
                {beschrijfBoeking(booking)}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={`Hoeveel ${pointsName} wilt u inwisselen?`}
          htmlFor="points"
          required
          hint={
            maximumPoints > 0
              ? `Minimaal ${formatPoints(minimumPoints)}, maximaal ${formatPoints(maximumPoints)} per boeking.`
              : `Minimaal ${formatPoints(minimumPoints)}.`
          }
        >
          <Input
            id="points"
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

        <p className="rounded-card border border-line-soft px-4 py-3 text-[15px]">
          Dat levert <strong className="font-display text-lg">{formatEuroCents(waardeCents)}</strong>{" "}
          voordeel op
          {gekozen ? (
            <>
              {" "}
              bij <strong>{beschrijfBoeking(gekozen)}</strong>
            </>
          ) : null}
          .
        </p>

        <Field label="Opmerking voor ons" htmlFor="note">
          <Textarea
            id="note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Niet verplicht."
          />
        </Field>

        <Button
          type="button"
          onClick={() => setBevestigen(true)}
          disabled={points < minimumPoints || points > cap || !bookingId}
        >
          <CalendarCheck aria-hidden className="size-4" />
          Punten inwisselen
        </Button>
      </div>
    </div>
  );
}
