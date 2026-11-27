import { Link, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { Bot, Coins, FileText, Gauge, Package, ScrollText, Settings, Users } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MfaGate } from "@/features/admin/shared";
import { AgentsAdminPage, AuditPage, OverviewPage, WorkspacesPage } from "@/features/admin/AdminOps";
import { CreditsPage, PlansPage } from "@/features/admin/AdminCatalog";
import { PromptsPage, SettingsPage } from "@/features/admin/AdminSettings";

const NAV = [
  { to: "overview", label: "Overview", icon: Gauge, el: <OverviewPage /> },
  { to: "users", label: "Users", icon: Users, el: <WorkspacesPage /> },
  { to: "agents", label: "Agents", icon: Bot, el: <AgentsAdminPage /> },
  { to: "plans", label: "Plans & packs", icon: Package, el: <PlansPage /> },
  { to: "credits", label: "Credits & costs", icon: Coins, el: <CreditsPage /> },
  { to: "settings", label: "Settings", icon: Settings, el: <SettingsPage /> },
  { to: "prompts", label: "Prompts", icon: FileText, el: <PromptsPage /> },
  { to: "audit", label: "Audit log", icon: ScrollText, el: <AuditPage /> },
];

export default function AdminHome() {
  return (
    <div className="dark min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur sm:px-6">
        <Logo tone="dark" className="h-6" />
        <span className="rounded-full bg-brand-500/15 px-2.5 py-0.5 text-xs font-semibold text-brand-300">Superadmin</span>
        <Button asChild variant="ghost" size="sm" className="ml-auto"><Link to="/app">Back to app</Link></Button>
      </header>
      <MfaGate>
        <div className="flex">
          <nav className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 border-r p-3 md:block">
            {NAV.map((n) => (
              <NavLink key={n.to} to={`/admin/${n.to}`} className={({ isActive }) => cn("mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm", isActive ? "bg-brand-500/15 text-brand-300" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                <n.icon className="h-4 w-4" />{n.label}
              </NavLink>
            ))}
          </nav>
          <div className="min-w-0 flex-1">
            <nav className="flex gap-1 overflow-x-auto border-b px-4 py-2 md:hidden">
              {NAV.map((n) => <NavLink key={n.to} to={`/admin/${n.to}`} className={({ isActive }) => cn("whitespace-nowrap rounded-full px-3 py-1.5 text-sm", isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{n.label}</NavLink>)}
            </nav>
            <main className="p-4 sm:p-6">
              <Routes>
                {NAV.map((n) => <Route key={n.to} path={n.to} element={<><h1 className="mb-5 text-xl font-semibold">{n.label}</h1>{n.el}</>} />)}
                <Route path="*" element={<Navigate to="overview" replace />} />
              </Routes>
            </main>
          </div>
        </div>
      </MfaGate>
    </div>
  );
}
