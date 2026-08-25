const euroFormatter = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat("nl-NL");

export function formatEuroCents(cents: number): string {
  return euroFormatter.format((cents ?? 0) / 100);
}

export function formatPoints(points: number): string {
  return numberFormatter.format(points ?? 0);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatShortDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 5);
}

export function formatDuration(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return hours === 1 ? "1 uur" : `${hours} uur`;
  return `${hours} uur ${rest} min`;
}

export function relativeDay(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const today = new Date();
  const diff = Math.round(
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) /
      86_400_000
  );
  if (diff === 0) return "vandaag";
  if (diff === 1) return "morgen";
  if (diff === -1) return "gisteren";
  if (diff > 1 && diff < 14) return `over ${diff} dagen`;
  if (diff < -1 && diff > -14) return `${Math.abs(diff)} dagen geleden`;
  return formatShortDate(date);
}

export function initials(name: string | null | undefined, fallback = "?"): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function firstName(fullName: string | null | undefined, email?: string | null): string {
  if (fullName && fullName.trim()) return fullName.trim().split(/\s+/)[0];
  if (email) return email.split("@")[0];
  return "daar";
}
