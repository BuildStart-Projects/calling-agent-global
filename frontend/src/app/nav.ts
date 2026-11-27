import {
  LayoutDashboard, Inbox, Phone, Megaphone, BookOpen, Users, Bot, Gauge, CreditCard, Settings,
  CalendarDays, ShoppingBag, Target, type LucideIcon,
} from "lucide-react";

export type AgentType = "booking" | "inquiry" | "order";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Only show when the workspace has at least one agent of this type. */
  requiresType?: AgentType;
  /** Show in the mobile bottom tab bar. */
  mobileTab?: boolean;
  group: "main" | "modules" | "account";
};

export const NAV: NavItem[] = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard, group: "main", mobileTab: true },
  { to: "/app/inbox", label: "Inbox", icon: Inbox, group: "main", mobileTab: true },
  { to: "/app/calls", label: "Calls", icon: Phone, group: "main", mobileTab: true },
  { to: "/app/campaigns", label: "Campaigns", icon: Megaphone, group: "main", mobileTab: true },
  { to: "/app/knowledge", label: "Knowledge", icon: BookOpen, group: "main" },
  { to: "/app/bookings", label: "Bookings", icon: CalendarDays, group: "modules", requiresType: "booking" },
  { to: "/app/orders", label: "Orders", icon: ShoppingBag, group: "modules", requiresType: "order" },
  { to: "/app/leads", label: "Leads", icon: Target, group: "modules", requiresType: "inquiry" },
  { to: "/app/contacts", label: "Contacts", icon: Users, group: "modules" },
  { to: "/app/agents", label: "Agents", icon: Bot, group: "modules" },
  { to: "/app/usage", label: "Usage", icon: Gauge, group: "account" },
  { to: "/app/billing", label: "Billing", icon: CreditCard, group: "account" },
  { to: "/app/settings", label: "Settings", icon: Settings, group: "account" },
];

export function visibleNav(agentTypes: Set<AgentType>, hasLeads = false): NavItem[] {
  return NAV.filter((i) => {
    if (!i.requiresType) return true;
    if (i.requiresType === "inquiry" && hasLeads) return true;
    return agentTypes.has(i.requiresType);
  });
}
