import { MERKEN, MERK_STIJL, type Merk } from "@/lib/crm/merk";
import { kiesMerk } from "@/app/admin/crm/actions";
import { cn } from "@/lib/utils";

/**
 * De keuze tussen de twee merken.
 *
 * Bewust een gewoon formulier met knoppen en geen dropdown of clientcomponent.
 * Twee redenen: het werkt zonder JavaScript, en met twee merken is een lijst
 * die je moet uitklappen meer werk dan hij oplevert.
 */
export function MerkSchakelaar({ actief }: { actief: Merk }) {
  return (
    <form action={kiesMerk}>
      <fieldset className="flex flex-wrap items-center gap-1.5 rounded-pill bg-surface-3 p-1">
        <legend className="sr-only">Kies welk merk je bekijkt</legend>
        {MERKEN.map((merk) => {
          const stijl = MERK_STIJL[merk];
          const gekozen = merk === actief;
          return (
            <button
              key={merk}
              type="submit"
              name="merk"
              value={merk}
              aria-pressed={gekozen}
              title={stijl.omschrijving}
              className={cn(
                "flex min-h-9 items-center gap-2 rounded-pill px-3.5 py-1.5 text-sm font-semibold transition-colors",
                gekozen ? stijl.actief : "text-muted hover:bg-white hover:text-ink"
              )}
            >
              <span aria-hidden className={cn("size-2 rounded-pill", stijl.streep)} />
              {stijl.label}
            </button>
          );
        })}
      </fieldset>
    </form>
  );
}
