import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  getGetOrgSummaryQueryKey,
  getHealthCheckQueryKey,
  useGetOrgSummary,
  useHealthCheck,
  type OrgSummary,
} from "@workspace/api-client-react";
import {
  Bot,
  CheckCircle2,
  FolderKanban,
  Home,
  LogOut,
  Menu,
  MessageSquareText,
  Plus,
  RadioTower,
  Search,
  Server,
  Settings2,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-gate";
import { useLocale } from "@/components/i18n/locale-provider";
import { CommandPalette } from "@/components/command-palette";
import {
  EmergencyControl,
  EmergencyStopBanner,
} from "@/components/ops/emergency-control";
import { ThemeToggle } from "@/components/theme-toggle";
import { KeeperMotionToggle } from "@/components/agent/keeper-motion-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDocumentVisible, useMediaQuery } from "@/hooks/use-page-activity";
import { useToast } from "@/hooks/use-toast";
import { adaptivePollingInterval } from "@/lib/adaptive-polling";
import { cn } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n";

interface AppShellProps {
  children: ReactNode;
}

type NavigationItem = {
  href: string;
  labelKey: MessageKey;
  icon: LucideIcon;
};

const PRIMARY_NAVIGATION: NavigationItem[] = [
  { href: "/", labelKey: "home", icon: Home },
  { href: "/projects", labelKey: "projects", icon: FolderKanban },
  { href: "/company-chat", labelKey: "companyRoom", icon: MessageSquareText },
];

const TEAM_NAVIGATION: NavigationItem[] = [
  { href: "/skills", labelKey: "skillsLibrary", icon: Search },
  { href: "/agents", labelKey: "experts", icon: Bot },
  { href: "/workforces", labelKey: "teams", icon: UsersRound },
];

const OPERATIONS_NAVIGATION: NavigationItem[] = [
  { href: "/operations", labelKey: "operations", icon: RadioTower },
  { href: "/approvals", labelKey: "approvals", icon: CheckCircle2 },
  { href: "/settings", labelKey: "connections", icon: Settings2 },
];

function pageName(location: string, t: (key: MessageKey) => string): string {
  if (location === "/") return t("home");
  if (
    location.startsWith("/projects/new") ||
    location.startsWith("/tasks/new")
  ) {
    return t("newProject");
  }
  if (location === "/projects" || location === "/tasks") return t("projects");
  if (/^\/(?:projects|tasks)\/\d+\/operations(?:\/|$)/.test(location)) {
    return t("projectOperations");
  }
  if (location.startsWith("/projects/") || location.startsWith("/tasks/")) {
    return t("project");
  }
  if (location.startsWith("/company-chat")) return t("companyRoom");
  if (location.startsWith("/workforces")) return t("teams");
  if (location.startsWith("/skills")) return t("skillsLibrary");
  if (location === "/agents") return t("experts");
  if (location.startsWith("/agents/new")) return t("newExpert");
  if (location.startsWith("/agents/")) return t("expertDetail");
  if (location.startsWith("/approvals")) return t("approvals");
  if (location.startsWith("/operations")) return t("operations");
  if (location.startsWith("/activity")) return t("operations");
  if (location.startsWith("/settings")) return t("settings");
  return "AgenticOS";
}

export function AppShell({ children }: AppShellProps) {
  const { t, locale, syncStatus, retrySync } = useLocale();
  const [location] = useLocation();
  const projectWorkspace = /^\/(?:projects|tasks)\/\d+(?:\/|$)/.test(location);
  const conversationContext =
    location.startsWith("/agents/") &&
    new URLSearchParams(window.location.search).get("from") === "conversations";
  const currentPageName = conversationContext
    ? t("agentChat")
    : pageName(location, t);
  const documentVisible = useDocumentVisible();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const { data: summary } = useGetOrgSummary({
    query: {
      queryKey: getGetOrgSummaryQueryKey(),
      refetchInterval: (query) =>
        adaptivePollingInterval({
          documentVisible,
          live:
            ((query.state.data as OrgSummary | undefined)?.workingAgents ?? 0) >
            0,
          liveMs: 5_000,
        }),
    },
  });

  useEffect(() => {
    document.title = `${currentPageName} — Agentic Company OS`;
    setMobileMenuOpen(false);
    let headingObserver: MutationObserver | undefined;
    const frame = window.requestAnimationFrame(() => {
      contentScrollRef.current?.scrollTo({ top: 0 });
      const main = mainRef.current;
      if (!main) return;
      if (
        location === "/operations" &&
        window.history.state?.acosFocusHeading
      ) {
        const focusHeading = () => {
          const heading = main.querySelector<HTMLHeadingElement>("h1");
          if (!heading) return false;
          heading.tabIndex = -1;
          heading.focus({ preventScroll: true });
          const nextState = { ...window.history.state };
          delete nextState.acosFocusHeading;
          window.history.replaceState(nextState, "");
          headingObserver?.disconnect();
          return true;
        };
        if (!focusHeading()) {
          headingObserver = new MutationObserver(focusHeading);
          headingObserver.observe(main, { childList: true, subtree: true });
        }
      } else {
        main.focus({ preventScroll: true });
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
      headingObserver?.disconnect();
    };
  }, [currentPageName, location]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const sidebar = document.getElementById("app-navigation");
    const main = mainRef.current;
    main?.setAttribute("inert", "");
    main?.setAttribute("aria-hidden", "true");
    const focusable = Array.from(
      sidebar?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    const frame = window.requestAnimationFrame(() => focusable[0]?.focus());
    const handleMenuKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileMenuOpen(false);
        window.requestAnimationFrame(() =>
          mobileMenuButtonRef.current?.focus(),
        );
        return;
      }
      if (event.key !== "Tab" || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleMenuKeys);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleMenuKeys);
      main?.removeAttribute("inert");
      main?.removeAttribute("aria-hidden");
    };
  }, [mobileMenuOpen]);

  const isActive = (href: string) => {
    if (conversationContext) return href === "/company-chat";
    if (href === "/projects") {
      return (
        location === "/projects" ||
        location.startsWith("/projects/") ||
        location === "/tasks" ||
        location.startsWith("/tasks/")
      );
    }
    return href === "/"
      ? location === "/"
      : location === href || location.startsWith(`${href}/`);
  };

  return (
    <div className="flex min-h-screen w-full bg-background font-sans text-foreground md:h-screen md:overflow-hidden">
      <a
        href="#main-content"
        className="sr-only rounded-control border-primary bg-card text-sm font-semibold text-primary shadow-lg focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[100] focus:min-h-11 focus:border focus:px-3 focus:py-2"
      >
        {t("skipToContent")}
      </a>

      {mobileMenuOpen ? (
        <button
          type="button"
          aria-label={t("closeMenu")}
          className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px] md:hidden"
          onClick={() => {
            setMobileMenuOpen(false);
            window.requestAnimationFrame(() =>
              mobileMenuButtonRef.current?.focus(),
            );
          }}
        />
      ) : null}

      <Sidebar
        mobileOpen={mobileMenuOpen}
        isActive={isActive}
        onNavigate={() => setMobileMenuOpen(false)}
        t={t}
      />

      <main
        ref={mainRef}
        id="main-content"
        tabIndex={-1}
        className="relative flex min-w-0 flex-1 flex-col overflow-hidden outline-none"
        aria-labelledby="current-page-name"
      >
        <TopBar
          pageTitle={currentPageName}
          workingExperts={
            summary?.workingAgents
              ? t("workingExperts").replace(
                  "{count}",
                  new Intl.NumberFormat(locale).format(summary.workingAgents),
                )
              : null
          }
          mobileMenuOpen={mobileMenuOpen}
          mobileMenuButtonRef={mobileMenuButtonRef}
          onOpenPalette={() => setPaletteOpen(true)}
          onToggleMobileMenu={() => setMobileMenuOpen((current) => !current)}
          t={t}
        />
        {syncStatus === "error" ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-destructive/25 bg-destructive/5 px-4 py-2 text-xs text-destructive sm:px-6"
          >
            <span>{t("localeError")}</span>
            <button
              type="button"
              onClick={retrySync}
              className="min-h-11 rounded-control px-2 font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("checkAgain")}
            </button>
          </div>
        ) : null}
        <EmergencyStopBanner />
        <div
          ref={contentScrollRef}
          className={cn(
            "min-h-0 flex-1 overflow-auto bg-background [scrollbar-gutter:stable]",
            projectWorkspace ? "p-0" : "px-[16px] py-5 sm:px-6 sm:py-7 lg:px-9",
          )}
        >
          <div
            className={cn(
              "mx-auto w-full",
              projectWorkspace
                ? "min-h-full max-w-none"
                : "max-w-[1500px] pb-10",
            )}
          >
            {children}
          </div>
        </div>
      </main>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}

function Sidebar({
  mobileOpen,
  isActive,
  onNavigate,
  t,
}: {
  mobileOpen: boolean;
  isActive: (href: string) => boolean;
  onNavigate: () => void;
  t: (key: MessageKey) => string;
}) {
  const desktop = useMediaQuery("(min-width: 768px)");
  const hiddenFromAssistiveTech = !desktop && !mobileOpen;
  const sidebarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    if (hiddenFromAssistiveTech) sidebar.setAttribute("inert", "");
    else sidebar.removeAttribute("inert");
    return () => sidebar.removeAttribute("inert");
  }, [hiddenFromAssistiveTech]);

  return (
    <aside
      ref={sidebarRef}
      id="app-navigation"
      aria-label={t("mainMenu")}
      aria-hidden={hiddenFromAssistiveTech || undefined}
      className={cn(
        "fixed inset-y-0 start-0 z-50 flex w-[278px] max-w-[calc(100%-32px)] shrink-0 flex-col border-e border-border bg-card transition-transform duration-200 ease-out md:static md:z-20 md:translate-x-0 md:rtl:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full rtl:translate-x-full",
      )}
    >
      <div className="shrink-0 px-[12px] pb-2 pt-[12px] sm:px-3 sm:pt-3">
        <Link
          href="/"
          onClick={onNavigate}
          aria-label={t("home")}
          className="flex min-w-0 items-center gap-[12px] rounded-[14px] border border-border/80 bg-background/45 p-[10px] transition-colors hover:border-foreground/15 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:gap-3 sm:p-2.5"
        >
          <img
            src="/favicon.svg"
            alt=""
            aria-hidden="true"
            width="36"
            height="36"
            className="size-[36px] shrink-0 rounded-[11px]"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold tracking-[-0.02em] text-foreground">
              AgenticOS
            </span>
            <span className="block truncate text-[12px] text-muted-foreground">
              {t("localWorkspace")}
            </span>
          </span>
        </Link>
      </div>

      <nav
        aria-label={t("mainMenu")}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[12px] pb-3 sm:px-3"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) onNavigate();
        }}
      >
        <NavigationGroup
          label={t("workspaceGroup")}
          items={PRIMARY_NAVIGATION}
          isActive={isActive}
          t={t}
        />

        <div className="mt-4 border-t border-border/75 pt-3">
          <NavigationGroup
            label={t("companyGroup")}
            items={TEAM_NAVIGATION}
            isActive={isActive}
            t={t}
          />
        </div>

        <div className="mt-auto border-t border-border/75 pt-3">
          <NavigationGroup
            label={t("controlGroup")}
            items={OPERATIONS_NAVIGATION}
            isActive={isActive}
            t={t}
          />
        </div>
      </nav>

      <div className="shrink-0 border-t border-border/75 p-[12px] sm:p-3">
        <HealthControl t={t} />
        <div className="mt-2 flex items-center gap-[8px] sm:gap-2">
          <div className="shrink-0 [&>button]:!size-[44px] [&>button]:!border-border [&>button]:!bg-background/45 [&>button]:!text-foreground [&>button]:!shadow-none">
            <ThemeToggle />
          </div>
          <p className="min-w-0 flex-1 text-[12px] leading-4 text-muted-foreground">
            {t("localWorkspace")}
            <br />
            {t("openSource")}
          </p>
          <LogoutControl />
        </div>
      </div>
    </aside>
  );
}

function NavigationGroup({
  label,
  items,
  isActive,
  t,
}: {
  label: string;
  items: NavigationItem[];
  isActive: (href: string) => boolean;
  t: (key: MessageKey) => string;
}) {
  return (
    <div>
      <p className="mb-2 px-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
        {label}
      </p>
      <div className="space-y-0.5">
        {items.map((item) => (
          <NavigationLink
            key={item.href}
            item={item}
            active={isActive(item.href)}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}

function NavigationLink({
  item,
  active,
  t,
}: {
  item: NavigationItem;
  active: boolean;
  t: (key: MessageKey) => string;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center gap-2.5 rounded-control px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-background/75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:min-h-10",
        active &&
          "bg-background text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))]",
      )}
    >
      <Icon
        size={16}
        strokeWidth={1.75}
        className={cn("shrink-0", active && "text-primary")}
        aria-hidden
      />
      <span className="min-w-0 flex-1 py-2 [overflow-wrap:anywhere]">
        {t(item.labelKey)}
      </span>
      {active ? (
        <span
          className="ms-auto size-1.5 rounded-full bg-primary"
          aria-hidden
        />
      ) : null}
    </Link>
  );
}

function TopBar({
  pageTitle,
  workingExperts,
  mobileMenuOpen,
  mobileMenuButtonRef,
  onOpenPalette,
  onToggleMobileMenu,
  t,
}: {
  pageTitle: string;
  workingExperts: string | null;
  mobileMenuOpen: boolean;
  mobileMenuButtonRef: RefObject<HTMLButtonElement | null>;
  onOpenPalette: () => void;
  onToggleMobileMenu: () => void;
  t: (key: MessageKey) => string;
}) {
  return (
    <header className="relative z-30 flex h-[64px] shrink-0 items-center gap-[8px] border-b border-border/75 bg-background/90 px-[12px] backdrop-blur-xl sm:h-16 sm:gap-2 sm:px-5">
      <button
        ref={mobileMenuButtonRef}
        type="button"
        onClick={onToggleMobileMenu}
        aria-expanded={mobileMenuOpen}
        aria-controls="app-navigation"
        aria-label={mobileMenuOpen ? t("closeMenu") : t("openMenu")}
        className="grid size-[44px] shrink-0 place-items-center rounded-control border border-border bg-card text-foreground hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:hidden"
      >
        {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
      </button>

      <p
        id="current-page-name"
        className="min-w-0 truncate text-[13px] font-semibold tracking-[-0.015em] text-foreground"
      >
        {pageTitle}
      </p>

      <div className="ms-auto flex min-w-0 shrink-0 items-center gap-[6px] sm:gap-1.5">
        {workingExperts ? (
          <span
            className="hidden items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1.5 text-[12px] text-muted-foreground sm:inline-flex"
            aria-live="polite"
          >
            <span
              className="size-1.5 rounded-full bg-verified-foreground"
              aria-hidden
            />
            {workingExperts}
          </span>
        ) : null}

        <button
          type="button"
          onClick={onOpenPalette}
          aria-label={t("openSearch")}
          className="flex h-[44px] min-w-[44px] items-center gap-2 rounded-control border border-border bg-card px-[12px] text-sm text-muted-foreground hover:border-foreground/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:h-11 sm:min-w-11 sm:w-40 sm:px-3"
        >
          <Search size={15} className="shrink-0" aria-hidden />
          <span className="hidden flex-1 truncate text-start sm:inline">
            {t("search")}
          </span>
          <kbd
            className="hidden font-sans text-[12px] text-muted-foreground/65 sm:inline"
            dir="ltr"
          >
            {/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"}
          </kbd>
        </button>

        <KeeperMotionToggle compact />
        <NewMenu t={t} />

        <div className="max-sm:[&_button]:!size-[44px] max-sm:[&_button]:!min-h-[44px] max-sm:[&_button]:!min-w-[44px] max-sm:[&_button]:!p-0 [&_button]:!h-10 [&_button]:!rounded-[11px] [&_button]:!border-border [&_button]:!bg-card [&_button]:!text-foreground [&_button]:!shadow-none [&_button:hover]:!border-foreground/20">
          <EmergencyControl />
        </div>
      </div>
    </header>
  );
}

function NewMenu({ t }: { t: (key: MessageKey) => string }) {
  const [, navigate] = useLocation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-control bg-foreground px-[12px] text-sm font-semibold text-background transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:h-11 sm:min-w-11 sm:px-3"
          aria-label={t("createNew")}
        >
          <Plus size={15} aria-hidden />
          <span className="hidden sm:inline">{t("new")}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-48 rounded-[12px] border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
      >
        <DropdownMenuItem
          onSelect={() => navigate("/projects/new")}
          className="min-h-11 gap-2 rounded-control px-2.5 py-2 text-sm focus:bg-accent"
        >
          <FolderKanban size={15} aria-hidden /> {t("newProject")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => navigate("/workforces")}
          className="min-h-11 gap-2 rounded-control px-2.5 py-2 text-sm focus:bg-accent"
        >
          <UsersRound size={15} aria-hidden /> {t("newTeam")}
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-border" />
        <DropdownMenuItem
          onSelect={() => navigate("/agents/new")}
          className="min-h-11 gap-2 rounded-control px-2.5 py-2 text-sm focus:bg-accent"
        >
          <Bot size={15} aria-hidden /> {t("newExpert")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HealthControl({ t }: { t: (key: MessageKey) => string }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useHealthCheck({
    query: { refetchInterval: 30_000, queryKey: getHealthCheckQueryKey() },
  });
  const healthy = !isLoading && !isError && data?.status === "ok";
  const label = isLoading
    ? t("systemChecking")
    : healthy
      ? t("systemReady")
      : t("apiUnavailable");

  return (
    <button
      type="button"
      onClick={() =>
        void queryClient.invalidateQueries({
          queryKey: getHealthCheckQueryKey(),
        })
      }
      title={`${label}. ${t("checkAgain")}.`}
      aria-label={`${label}. ${t("checkAgain")}.`}
      className="flex min-h-11 md:min-h-10 w-full min-w-0 items-center gap-2.5 rounded-control border border-border bg-background/45 px-3 text-[12px] text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {isError ? (
        <Server size={14} className="shrink-0" aria-hidden />
      ) : (
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            healthy ? "bg-verified-foreground" : "bg-muted-foreground",
          )}
          aria-hidden
        />
      )}
      <span className="truncate">{label}</span>
    </button>
  );
}

function LogoutControl() {
  const { enabled, logout, logoutPending } = useAuth();
  const { t } = useLocale();
  const { toast } = useToast();

  if (!enabled) return null;

  const signOut = async () => {
    try {
      await logout();
    } catch {
      toast({
        title: t("signOutFailed"),
        description: t("signOutRetry"),
        variant: "destructive",
      });
    }
  };

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={logoutPending}
      aria-label={t(logoutPending ? "signingOut" : "signOutSecure")}
      title={t("signOut")}
      aria-busy={logoutPending}
      className="grid size-[44px] shrink-0 place-items-center rounded-control border border-border bg-background/45 text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-50"
    >
      <LogOut size={15} aria-hidden />
    </button>
  );
}
