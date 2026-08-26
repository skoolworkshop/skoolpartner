import { BackLink } from "./back-link";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  backHref,
  backLabel = "Terug",
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** Waar de terugknop heen gaat als er geen vorige pagina binnen de app is. */
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="mb-7 border-b border-line-soft pb-6">
      {backHref ? <BackLink href={backHref} label={backLabel} /> : null}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
          <h1 className="text-[32px] sm:text-[38px]">{title}</h1>
          {description ? (
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}
