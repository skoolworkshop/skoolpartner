import Link from "next/link";
import { ArrowRight, UserRound } from "lucide-react";

import { missingLabel, type ProfileCompleteness } from "@/lib/account";

/**
 * Nette herinnering om het account compleet te maken.
 *
 * Bewust géén blokkade: boekingen, facturen en berichten blijven gewoon
 * bereikbaar. Iemand die snel een factuur wil opzoeken moet daar niet eerst
 * een formulier voor hoeven invullen.
 *
 * Ontbreekt alleen het e-mailadres, dan sturen wij niet naar het formulier.
 * Dat veld kan een klant zelf niet wijzigen, dus dan helpt alleen contact.
 */
export function ProfileReminder({
  status,
  supportEmail,
}: {
  status: ProfileCompleteness;
  supportEmail: string;
}) {
  if (status.complete) return null;

  const alleenEmail = status.missing.length === 1 && status.missing[0] === "e-mailadres";

  return (
    <div className="mb-5 flex flex-col gap-3 rounded-card border border-accent/35 bg-accent-soft/25 p-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
      <div className="flex items-start gap-3 sm:items-center sm:gap-4">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-pill bg-accent text-ink"
        >
          <UserRound className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="font-display text-[17px] leading-snug">Maak uw account compleet</p>
          <p className="mt-0.5 text-sm text-muted">
            Wij missen nog {missingLabel(status.missing)}.{" "}
            {alleenEmail
              ? "Uw e-mailadres is ook uw inlogadres, dus dat regelen wij voor u."
              : "Dat hebben wij nodig om u te kunnen bereiken rond uw workshop."}
          </p>
        </div>
      </div>

      {alleenEmail ? (
        <a
          href={`mailto:${supportEmail}`}
          className="inline-flex min-h-11 shrink-0 items-center gap-1 self-start whitespace-nowrap pl-13 text-sm font-semibold text-ink underline underline-offset-4 sm:ml-auto sm:self-center sm:pl-0"
        >
          Neem contact op
          <ArrowRight aria-hidden className="size-3.5" />
        </a>
      ) : (
        <Link
          href="/account"
          className="inline-flex min-h-11 shrink-0 items-center gap-1 self-start whitespace-nowrap pl-13 text-sm font-semibold text-ink underline underline-offset-4 sm:ml-auto sm:self-center sm:pl-0"
        >
          Aanvullen
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      )}
    </div>
  );
}
