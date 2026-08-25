import {
  CalendarDays,
  FileText,
  LayoutDashboard,
  MessageSquare,
  Sparkles,
  UserRound,
} from "lucide-react";

export const portalNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/boekingen", label: "Boekingen", icon: CalendarDays },
  { href: "/facturen", label: "Facturen", icon: FileText },
  { href: "/berichten", label: "Berichten", icon: MessageSquare },
  { href: "/skoolpartner", label: "SkoolPartner", icon: Sparkles },
  { href: "/account", label: "Account", icon: UserRound },
] as const;

export type PortalNavItem = (typeof portalNav)[number];
