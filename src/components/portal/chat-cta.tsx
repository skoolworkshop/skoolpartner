import { MessageCircle } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * "Liever even chatten?" Verwijst naar het WhatsApp-nummer van Skool Workshop.
 *
 * De knop verschijnt alleen wanneer er in Admin > Instellingen daadwerkelijk
 * een adres is ingevuld. Zo staat er nooit een dode link in het portaal.
 */
function normalizeWhatsappUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  // Alleen cijfers ingevuld? Dan maken we er zelf een wa.me-adres van.
  const digits = value.replace(/[^\d]/g, "");
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}`;
}

export function ChatFloatingButton({
  enabled,
  url,
  label,
}: {
  enabled: boolean;
  url: string;
  label: string;
}) {
  const href = enabled ? normalizeWhatsappUrl(url) : null;
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "fixed right-4 z-30 inline-flex items-center gap-2 rounded-pill bg-ink px-4 py-3",
        "text-sm font-semibold text-white shadow-lg transition hover:bg-accent hover:text-ink",
        "bottom-24 sm:right-6 lg:bottom-6"
      )}
    >
      <MessageCircle aria-hidden className="size-5" />
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label}</span>
    </a>
  );
}

export function ChatCard({
  enabled,
  url,
  label,
  helpText,
}: {
  enabled: boolean;
  url: string;
  label: string;
  helpText: string;
}) {
  const href = enabled ? normalizeWhatsappUrl(url) : null;
  if (!href) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line-soft bg-surface-2 p-5">
      <div className="min-w-0">
        <p className="font-semibold">{label}</p>
        <p className="mt-1 text-sm text-muted">{helpText}</p>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-pill bg-accent px-5 py-3 text-sm font-semibold text-ink transition hover:bg-accent-strong hover:text-white"
      >
        <MessageCircle aria-hidden className="size-4" />
        Chat via WhatsApp
      </a>
    </div>
  );
}
