import { lazy, Suspense, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "@/components/error-boundary";
import { AuthGate } from "@/components/auth/auth-gate";
import { OpsControlProvider } from "@/components/ops/ops-control-provider";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import { Route, Switch, useLocation, Router as WouterRouter } from "wouter";

import { AppShell } from "@/components/layout/app-shell";
import { LanguageSetup } from "@/components/i18n/language-setup";
import { LocaleProvider } from "@/components/i18n/locale-provider";
import { LocaleServerSync } from "@/components/i18n/locale-server-sync";
import { useLocale } from "@/components/i18n/locale-provider";
import Dashboard from "@/pages/dashboard";

// Keep the command center on the critical path and split the operation-heavy
// surfaces (chat, VM, browser workbench, settings) into route-level chunks.
const NewAgent = lazy(() => import("@/pages/agents/new"));
const AgentsList = lazy(() => import("@/pages/agents/list"));
const AgentDetail = lazy(() => import("@/pages/agents/detail"));
const TasksList = lazy(() => import("@/pages/tasks/list"));
const NewTask = lazy(() => import("@/pages/tasks/new"));
const TaskDetail = lazy(() => import("@/pages/tasks/detail"));
const ProjectOperations = lazy(() => import("@/pages/tasks/operations"));
const WorkforcesPage = lazy(() => import("@/pages/workforces"));
const ActivityRedirect = lazy(() => import("@/pages/activity"));
const OperationsPage = lazy(() => import("@/pages/operations"));
const Approvals = lazy(() => import("@/pages/approvals"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const SkillsPage = lazy(() => import("@/pages/skills"));
const CompanyChatPage = lazy(() => import("@/pages/company-chat"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function Router() {
  return (
    <AppShell>
      <RoutedErrorBoundary>
        <Suspense fallback={<RouteLoader />}>
          <Switch>
            <Route path="/" component={Dashboard} />

            <Route path="/agents" component={AgentsList} />
            <Route path="/agents/new" component={NewAgent} />
            <Route path="/agents/:agentId" component={AgentDetail} />

            <Route path="/projects" component={TasksList} />
            <Route path="/projects/new" component={NewTask} />
            <Route
              path="/projects/:projectId/operations"
              component={ProjectOperations}
            />
            <Route path="/projects/:projectId" component={TaskDetail} />

            {/* Legacy task URLs stay valid for existing bookmarks and API-era links. */}
            <Route path="/tasks" component={TasksList} />
            <Route path="/tasks/new" component={NewTask} />
            <Route
              path="/tasks/:taskId/operations"
              component={ProjectOperations}
            />
            <Route path="/tasks/:taskId" component={TaskDetail} />

            <Route path="/workforces" component={WorkforcesPage} />
            <Route path="/skills" component={SkillsPage} />

            <Route path="/operations" component={OperationsPage} />
            <Route path="/activity" component={ActivityRedirect} />
            <Route path="/approvals" component={Approvals} />
            <Route path="/company-chat" component={CompanyChatPage} />
            <Route path="/settings" component={SettingsPage} />

            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </RoutedErrorBoundary>
    </AppShell>
  );
}

function RouteLoader() {
  const { t } = useLocale();
  return (
    <div
      className="flex min-h-[55vh] items-center justify-center"
      role="status"
      aria-live="polite"
      aria-label={t("loadingScreen")}
    >
      <div className="flex items-center gap-3 border border-border bg-card px-4 py-3">
        <span className="size-2 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
        <span className="text-sm text-muted-foreground">
          {t("loadingScreen")}
        </span>
      </div>
    </div>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <LocaleProvider>
      <LanguageSetup>
        <QueryClientProvider client={queryClient}>
          <AuthGate>
            <LocaleServerSync />
            <OpsControlProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <Router />
              </WouterRouter>
            </OpsControlProvider>
          </AuthGate>
          <Toaster />
        </QueryClientProvider>
      </LanguageSetup>
    </LocaleProvider>
  );
}

export default App;
