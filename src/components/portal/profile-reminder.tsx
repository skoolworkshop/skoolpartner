import Link from "next/link";
import { ArrowRight, UserRound } from "lucide-react";

/**
 * Nette herinnering om het account compleet te maken.
 *
 * Bewust géén blokkade: boekingen, facturen en berichten blijven gewoon
 * bereikbaar. Iemand die snel een factuur wil opzoeken moet daar niet eerst
 * een formulier voor hoeven invullen.
 */
export function ProfileReminder({ complete }: { complete: boolean }) {
  if (complete) return null;

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
            Wij missen nog uw telefoonnummer. Dat hebben wij nodig om u op de dag van de workshop te
            kunnen bereiken.
          </p>
        </div>
      </div>

      <Link
        href="/account"
        className="inline-flex min-h-11 shrink-0 items-center gap-1 self-start whitespace-nowrap pl-13 text-sm font-semibold text-ink underline underline-offset-4 sm:ml-auto sm:self-center sm:pl-0"
      >
        Aanvullen
        <ArrowRight aria-hidden className="size-3.5" />
      </Link>
    </div>
  );
}
