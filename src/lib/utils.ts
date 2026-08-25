import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function emailDomain(email: string | null | undefined): string | null {
  if (!email || !email.includes("@")) return null;
  return email.split("@").pop()!.trim().toLowerCase() || null;
}

export function uniqueStrings(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v && v.trim())).map((v) => v.trim())));
}
