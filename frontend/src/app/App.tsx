import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { RedirectIfAuthed, RequireAdmin, RequireAuth } from "@/features/auth/guards";
import { AppLayout } from "@/app/layouts/AppLayout";
import { FullPageSpinner } from "@/components/common/FullPageSpinner";

const LandingPage = lazy(() => import("@/pages/public/LandingPage"));
const LegalPage = lazy(() => import("@/pages/public/LegalPage"));
const LoginPage = lazy(() => import("@/pages/auth/LoginPage"));
const SignupPage = lazy(() => import("@/pages/auth/SignupPage"));
const ForgotPasswordPage = lazy(() => import("@/pages/auth/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("@/pages/auth/ResetPasswordPage"));
const AuthCallbackPage = lazy(() => import("@/pages/auth/AuthCallbackPage"));
const DashboardPage = lazy(() => import("@/pages/app/DashboardPage"));
const NewAgentPage = lazy(() => import("@/pages/app/NewAgentPage"));
const ModulePage = lazy(() => import("@/pages/app/ModulePage"));
const BuilderPage = lazy(() => import("@/pages/app/BuilderPage"));
const KnowledgePage = lazy(() => import("@/pages/app/KnowledgePage"));
const SetupStepPage = lazy(() => import("@/pages/app/SetupStepPage"));
const VoicePage = lazy(() => import("@/pages/app/setup/VoicePage"));
const MessagingPage = lazy(() => import("@/pages/app/setup/MessagingPage"));
const HandoffPage = lazy(() => import("@/pages/app/setup/HandoffPage"));
const TestPage = lazy(() => import("@/pages/app/setup/TestPage"));
const ConnectPage = lazy(() => import("@/pages/app/setup/ConnectPage"));
const CallsPage = lazy(() => import("@/features/calls/CallsPage"));
const InboxPage = lazy(() => import("@/features/inbox/InboxPage"));
const ContactsPage = lazy(() => import("@/features/contacts/ContactsPage"));
const NotificationsPage = lazy(() => import("@/features/notifications/NotificationsPage"));
const AgentsPage = lazy(() => import("@/pages/app/AgentsPage"));
const BookingsPage = lazy(() => import("@/features/bookings/BookingsPage"));
const OrdersPage = lazy(() => import("@/features/orders/OrdersPage"));
const LeadsPage = lazy(() => import("@/features/leads/LeadsPage"));
const BillingPage = lazy(() => import("@/features/billing/BillingPage"));
const CampaignsPage = lazy(() => import("@/features/campaigns/CampaignsPage"));
const CampaignEditor = lazy(() => import("@/features/campaigns/CampaignEditor"));
const CampaignDetail = lazy(() => import("@/features/campaigns/CampaignDetail"));
const UsagePage = lazy(() => import("@/features/usage/UsagePage"));
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage"));
const AdminHome = lazy(() => import("@/pages/admin/AdminHome"));
const NotFoundPage = lazy(() => import("@/pages/public/NotFoundPage"));

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
});

/** Public marketing/auth pages are light-only; the app follows the user's preference. */
function ThemedShell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const inApp = pathname.startsWith("/app") || pathname.startsWith("/admin");
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem forcedTheme={inApp ? undefined : "light"} storageKey="bs.theme">
      {children}
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemedShell>
          <AuthProvider>
            <Suspense fallback={<FullPageSpinner />}>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/terms" element={<LegalPage kind="terms" />} />
                <Route path="/privacy" element={<LegalPage kind="privacy" />} />
                <Route path="/auth/callback" element={<AuthCallbackPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route element={<RedirectIfAuthed />}>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/signup" element={<SignupPage />} />
                  <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                </Route>

                <Route element={<RequireAuth />}>
                  <Route path="/app" element={<AppLayout />}>
                    <Route index element={<DashboardPage />} />
                    <Route path="new" element={<NewAgentPage />} />
                    <Route path="agents/:id/build" element={<BuilderPage />} />
                    <Route path="agents/:id/voice" element={<VoicePage />} />
                    <Route path="agents/:id/messaging" element={<MessagingPage />} />
                    <Route path="agents/:id/handoff" element={<HandoffPage />} />
                    <Route path="agents/:id/test" element={<TestPage />} />
                    <Route path="agents/:id/connect" element={<ConnectPage />} />
                    <Route path="agents/:id/:step" element={<SetupStepPage />} />
                    <Route path="agents" element={<AgentsPage />} />
                    <Route path="calls" element={<CallsPage />} />
                    <Route path="inbox" element={<InboxPage />} />
                    <Route path="contacts" element={<ContactsPage />} />
                    <Route path="notifications" element={<NotificationsPage />} />
                    <Route path="bookings" element={<BookingsPage />} />
                    <Route path="orders" element={<OrdersPage />} />
                    <Route path="leads" element={<LeadsPage />} />
                    <Route path="billing" element={<BillingPage />} />
                    <Route path="campaigns" element={<CampaignsPage />} />
                    <Route path="campaigns/:id" element={<CampaignDetail />} />
                    <Route path="campaigns/:id/edit" element={<CampaignEditor />} />
                    <Route path="knowledge" element={<KnowledgePage />} />
                    <Route path="usage" element={<UsagePage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    <Route path=":module/*" element={<ModulePage />} />
                  </Route>
                </Route>

                <Route element={<RequireAdmin />}>
                  <Route path="/admin/*" element={<AdminHome />} />
                </Route>
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Suspense>
            <Toaster position="top-center" richColors closeButton />
          </AuthProvider>
        </ThemedShell>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
