import { CheckCircle2, PartyPopper, Sparkles } from "lucide-react";

import { ButtonLink } from "@/components/ui/button";

const CONFETTI = Array.from({ length: 28 }, (_, index) => ({
  left: `${4 + ((index * 37) % 92)}%`,
  color: ["#f49700", "#ffd700", "#0f7b4f", "#1a4fa0", "#f05a7e"][index % 5],
  delay: `${(index % 9) * 0.13}s`,
  duration: `${2.5 + (index % 5) * 0.24}s`,
  rotate: `${(index * 29) % 180}deg`,
}));

export function BookingThankYou({ organizationName }: { organizationName: string }) {
  return (
    <section className="booking-thanks relative isolate overflow-hidden rounded-card border border-line-soft bg-white px-5 py-12 text-center shadow-card sm:px-10 sm:py-16">
      <div className="booking-confetti pointer-events-none absolute inset-0 -z-0" aria-hidden>
        {CONFETTI.map((particle, index) => (
          <span
            key={index}
            className="booking-confetti-piece"
            style={{
              left: particle.left,
              backgroundColor: particle.color,
              animationDelay: particle.delay,
              animationDuration: particle.duration,
              rotate: particle.rotate,
            }}
          />
        ))}
      </div>

      <div className="relative z-10 mx-auto max-w-2xl">
        <span className="mx-auto grid size-20 place-items-center rounded-full bg-success-wash text-success shadow-raise">
          <CheckCircle2 aria-hidden className="size-11" strokeWidth={2.2} />
        </span>
        <p className="eyebrow mt-7">Aanvraag ontvangen</p>
        <h1 className="mt-2 text-[34px] sm:text-[42px]">Bedankt voor uw aanvraag!</h1>
        <p className="mx-auto mt-4 max-w-xl text-[16px] leading-relaxed text-muted sm:text-[18px]">
          De workshopaanvraag van <strong className="text-ink">{organizationName}</strong> is goed
          bij ons binnengekomen. Skool Workshop neemt contact met u op over de mogelijkheden en
          vervolgstappen.
        </p>

        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/boekingen">
            <PartyPopper aria-hidden className="size-4" />
            Naar mijn boekingen
          </ButtonLink>
          <ButtonLink href="/dashboard" variant="secondary">
            <Sparkles aria-hidden className="size-4" />
            Naar het dashboard
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
