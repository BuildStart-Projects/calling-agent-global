import { Link, useParams } from "react-router-dom";
import {
  Bell, BookOpen, Bot, CalendarDays, CreditCard, Gauge, Inbox, Megaphone, Phone, Settings, ShoppingBag, Target, Users, Wrench,
} from "lucide-react";
import { PageBody, PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";

const MODULES: Record<string, { title: string; description: string; icon: typeof Inbox; empty: string; phase: string }> = {
  inbox: { title: "Inbox", description: "Every WhatsApp conversation in one place.", icon: Inbox, empty: "Conversations appear here once your agent is connected to WhatsApp.", phase: "Phase 5" },
  calls: { title: "Calls", description: "Recordings, transcripts and summaries.", icon: Phone, empty: "Calls your agent handles will appear here with a summary and recording.", phase: "Phase 4" },
  campaigns: { title: "Campaigns", description: "Let your AI call your contacts for you.", icon: Megaphone, empty: "Call your leads back in one click. Campaigns unlock once your agent is live.", phase: "Phase 7" },
  knowledge: { title: "Knowledge", description: "Everything your agents know about your business.", icon: BookOpen, empty: "Add services, prices, FAQs and policies by chatting with the Orchestrator.", phase: "Phase 3" },
  bookings: { title: "Bookings", description: "Your calendar and availability.", icon: CalendarDays, empty: "Bookings made by your agent show up here.", phase: "Phase 6" },
  orders: { title: "Orders", description: "Orders taken by your agent.", icon: ShoppingBag, empty: "New orders appear here instantly.", phase: "Phase 6" },
  leads: { title: "Leads", description: "Interested customers to follow up.", icon: Target, empty: "Leads captured by your agent appear here.", phase: "Phase 6" },
  contacts: { title: "Contacts", description: "Everyone who talked to your agents.", icon: Users, empty: "Contacts are created automatically from calls, chats and imports.", phase: "Phase 5" },
  agents: { title: "Agents", description: "Your AI agents and their WhatsApp numbers.", icon: Bot, empty: "Create an agent to get started.", phase: "Phase 2" },
  usage: { title: "Usage", description: "Credits used by each agent.", icon: Gauge, empty: "Usage appears once your agents start working.", phase: "Phase 1" },
  billing: { title: "Billing", description: "Your plan, credits and invoices.", icon: CreditCard, empty: "Plans and top-ups arrive with Stripe billing.", phase: "Phase 8" },
  settings: { title: "Settings", description: "Workspace, profile and notifications.", icon: Settings, empty: "Workspace settings are on the way.", phase: "Phase 1" },
  notifications: { title: "Notifications", description: "Alerts about bookings, handoffs and your account.", icon: Bell, empty: "You're all caught up.", phase: "Phase 4" },
};

export default function ModulePage() {
  const { module = "" } = useParams();
  const m = MODULES[module];
  if (!m) {
    return (
      <PageBody className="pt-10">
        <EmptyState icon={Wrench} title="Page not found" description="This section doesn't exist." action={<Button asChild><Link to="/app">Back to dashboard</Link></Button>} />
      </PageBody>
    );
  }
  return (
    <>
      <PageHeader title={m.title} description={m.description} />
      <PageBody>
        <EmptyState
          icon={m.icon}
          title={`${m.title} is coming together`}
          description={m.empty}
          action={module === "agents" ? <Button asChild><Link to="/app/new">Create an agent</Link></Button> : <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">Ships in {m.phase}</span>}
        />
      </PageBody>
    </>
  );
}
