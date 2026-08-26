import {
  CalendarDays,
  FileText,
  FolderDown,
  LayoutDashboard,
  MessageSquare,
  Sparkles,
  UserRound,
} from "lucide-react";

/**
 * mobileLabel is de kortere variant voor de balk onderaan op mobiel. Daar
 * staan zeven items naast elkaar, dus een lang woord past niet.
 */
export const portalNav = [
  { href: "/dashboard", label: "Dashboard", mobileLabel: "Start", icon: LayoutDashboard },
  { href: "/boekingen", label: "Boekingen", mobileLabel: "Boeking", icon: CalendarDays },
  { href: "/facturen", label: "Facturen", mobileLabel: "Factuur", icon: FileText },
  { href: "/resultaten", label: "Resultaten", mobileLabel: "Resultaat", icon: FolderDown },
  { href: "/berichten", label: "Berichten", mobileLabel: "Bericht", icon: MessageSquare },
  { href: "/skoolpartner", label: "SkoolPartner", mobileLabel: "Punten", icon: Sparkles },
  { href: "/account", label: "Account", mobileLabel: "Account", icon: UserRound },
] as const;

export type PortalNavItem = (typeof portalNav)[number];
