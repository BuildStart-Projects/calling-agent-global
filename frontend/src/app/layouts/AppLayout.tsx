import { useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTheme } from "next-themes";
import {
  Bell, ChevronsLeft, ChevronsRight, LogOut, Menu, Monitor, Moon, MoreHorizontal, Plus, Shield, Sun, User,
} from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CreditsPill } from "@/features/credits/CreditsPill";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAgents } from "@/features/agents/useAgents";
import { visibleNav, type AgentType, type NavItem } from "@/app/nav";
import { initials } from "@/lib/format";
import { useNotifications } from "@/features/notifications/NotificationsPage";
import { cn } from "@/lib/utils";
import { CreditBanner, OutOfCreditsModal, WorkspaceBlocked } from "@/features/account/AccountGuards";

const COLLAPSE_KEY = "bs.sidebar.collapsed";

export function AppLayout() {
  const { workspace } = useAuth();
  if (workspace && workspace.status !== "active") return <WorkspaceBlocked />;
  return <ActiveLayout />;
}

function ActiveLayout() {
  const { data: agents } = useAgents();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");
  const [moreOpen, setMoreOpen] = useState(false);

  const items = useMemo(() => {
    const types = new Set<AgentType>((agents ?? []).map((a) => a.type));
    return visibleNav(types);
  }, [agents]);

  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      return !c;
    });
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-dvh bg-background">
        {/* Sidebar: icon rail on tablet, full on desktop (collapsible) */}
        <aside
          className={cn(
            "sticky top-0 z-30 hidden h-dvh shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 sm:flex",
            collapsed ? "w-[72px]" : "w-[72px] lg:w-64",
          )}
        >
          <div className={cn("flex h-16 items-center", collapsed ? "justify-center px-2" : "justify-center px-2 lg:justify-start lg:px-5")}>
            <Link to="/" className="group flex items-center rounded-lg p-1 outline-none transition focus-visible:ring-2 focus-visible:ring-brand-500" aria-label="BuildStart home page">
              {/* Full logo (mark + wordmark) when there's room; the mark alone on the narrow rail. */}
              <Logo variant="icon" className={cn("h-8 w-8 transition-transform duration-200 group-hover:scale-105", !collapsed && "lg:hidden")} />
              {!collapsed && <Logo tight className="hidden h-8 transition-opacity duration-200 group-hover:opacity-85 lg:block" />}
            </Link>
          </div>
          <SidebarNav items={items} collapsed={collapsed} />
          <div className="mt-auto space-y-1 border-t p-3">
            <button
              onClick={toggle}
              className="hidden w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground lg:flex"
            >
              {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
              {!collapsed && <span>Collapse</span>}
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar onMenu={() => setMoreOpen(true)} />
          <CreditBanner />
          <OutOfCreditsModal />
          <main className="flex-1 pb-24 sm:pb-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </main>
        </div>

        <MobileTabBar items={items} onMore={() => setMoreOpen(true)} />
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent side="left" className="w-72 p-0">
            <SheetHeader className="h-16 justify-center border-b px-4">
              <SheetTitle><Link to="/" aria-label="BuildStart home page" className="inline-flex rounded-lg p-1 outline-none focus-visible:ring-2 focus-visible:ring-brand-500"><Logo tight className="h-7" /></Link></SheetTitle>
            </SheetHeader>
            <div onClick={() => setMoreOpen(false)}>
              <SidebarNav items={items} collapsed={false} forceLabels />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
}

function SidebarNav({ items, collapsed, forceLabels }: { items: NavItem[]; collapsed: boolean; forceLabels?: boolean }) {
  const groups: Array<{ key: NavItem["group"]; label: string }> = [
    { key: "main", label: "Workspace" },
    { key: "modules", label: "Business" },
    { key: "account", label: "Account" },
  ];
  const showLabels = forceLabels || !collapsed;
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2" aria-label="Main">
      {groups.map((g) => {
        const groupItems = items.filter((i) => i.group === g.key);
        if (!groupItems.length) return null;
        return (
          <div key={g.key} className="space-y-1">
            {showLabels && (
              <p className={cn("px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground", !forceLabels && "hidden lg:block")}>
                {g.label}
              </p>
            )}
            {groupItems.map((item) => (
              <NavEntry key={item.to} item={item} showLabel={showLabels} forceLabel={forceLabels} />
            ))}
          </div>
        );
      })}
    </nav>
  );
}

function NavEntry({ item, showLabel, forceLabel }: { item: NavItem; showLabel: boolean; forceLabel?: boolean }) {
  const Icon = item.icon;
  const link = (
    <NavLink
      to={item.to}
      end={item.to === "/app"}
      className={({ isActive }) =>
        cn(
          "group flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={cn("h-[18px] w-[18px] shrink-0", isActive && "text-brand-600 dark:text-brand-300")} />
          {showLabel && <span className={cn("truncate", !forceLabel && "hidden lg:inline")}>{item.label}</span>}
        </>
      )}
    </NavLink>
  );
  if (forceLabel) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" className={cn(showLabel && "lg:hidden")}>{item.label}</TooltipContent>
    </Tooltip>
  );
}

function MobileTabBar({ items, onMore }: { items: NavItem[]; onMore: () => void }) {
  const tabs = items.filter((i) => i.mobileTab).slice(0, 4);
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
      aria-label="Primary"
    >
      {tabs.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/app"}
            className={({ isActive }) =>
              cn("flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium", isActive ? "text-brand-600 dark:text-brand-300" : "text-muted-foreground")
            }
          >
            <Icon className="h-5 w-5" />
            {item.label === "Dashboard" ? "Home" : item.label}
          </NavLink>
        );
      })}
      <button onClick={onMore} className="flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground">
        <MoreHorizontal className="h-5 w-5" />
        More
      </button>
    </nav>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { user, signOut, isPlatformAdmin } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const name = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? "";
  const avatar = user?.user_metadata?.avatar_url as string | undefined;
  const { data: notes } = useNotifications();
  const unread = (notes ?? []).filter((n) => !n.read_at).length;

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur sm:px-6">
      <Button variant="ghost" size="icon" className="sm:hidden" onClick={onMenu} aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </Button>
      <Link to="/" className="rounded-lg p-1 outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:hidden" aria-label="BuildStart home page"><Logo tight className="h-6" /></Link>
      <div className="ml-auto flex items-center gap-2">
        <Button asChild size="sm" variant="outline" className="hidden md:inline-flex">
          <Link to="/app/new"><Plus className="mr-1 h-4 w-4" />New agent</Link>
        </Button>
        <CreditsPill />
        <Button variant="ghost" size="icon" aria-label="Notifications" asChild>
          <Link to="/app/notifications" className="relative"><Bell className="h-5 w-5" />{unread > 0 && <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-semibold text-white">{unread > 9 ? "9+" : unread}</span>}</Link>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="rounded-full outline-none ring-ring focus-visible:ring-2" aria-label="Account menu">
              <Avatar className="h-9 w-9">
                {avatar && <AvatarImage src={avatar} alt="" />}
                <AvatarFallback className="bg-brand-50 text-xs font-semibold text-brand-700">{initials(name)}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="truncate font-normal">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/app/settings")}><User className="mr-2 h-4 w-4" />Settings</DropdownMenuItem>
            {isPlatformAdmin && (
              <DropdownMenuItem onClick={() => navigate("/admin")}><Shield className="mr-2 h-4 w-4" />Superadmin</DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Theme</DropdownMenuLabel>
            <div className="grid grid-cols-3 gap-1 px-2 pb-2">
              {([
                ["light", Sun, "Light"],
                ["dark", Moon, "Dark"],
                ["system", Monitor, "System"],
              ] as const).map(([value, Icon, label]) => (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-md border px-2 py-1.5 text-[11px]",
                    theme === value ? "border-brand-500 bg-accent text-accent-foreground" : "hover:bg-muted",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={async () => { await signOut(); navigate("/"); }}>
              <LogOut className="mr-2 h-4 w-4" />Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
