import { useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import {
  getListAgentsQueryKey,
  useListAgents,
} from "@workspace/api-client-react";
import type { Agent } from "@workspace/api-client-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Bot,
  Cog,
  FolderKanban,
  RadioTower,
  Inbox,
  ListTree,
  MessageSquareText,
  Plus,
  Workflow,
} from "lucide-react";
import { useOpsControl } from "@/components/ops/ops-control-provider";
import { useLocale } from "@/components/i18n/locale-provider";
import { AgentAvatar } from "@/components/agent/agent-avatar";
import type { MessageKey } from "@/lib/i18n";

const PAGES: Array<{ href: string; labelKey: MessageKey; icon: typeof Plus }> =
  [
    { href: "/", labelKey: "home", icon: ListTree },
    { href: "/projects", labelKey: "projects", icon: FolderKanban },
    { href: "/company-chat", labelKey: "companyRoom", icon: MessageSquareText },
    { href: "/workforces", labelKey: "teams", icon: Workflow },
    { href: "/skills", labelKey: "skillsLibrary", icon: Workflow },
    { href: "/agents", labelKey: "experts", icon: Bot },
    { href: "/approvals", labelKey: "approvals", icon: Inbox },
    { href: "/operations", labelKey: "operations", icon: RadioTower },
    { href: "/settings", labelKey: "settings", icon: Cog },
  ];

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const [location, navigate] = useLocation();
  const openerRef = useRef<HTMLElement | null>(null);
  const navigatingRef = useRef(false);
  const go = (target: string) => {
    navigatingRef.current = location !== target;
    onClose();
    navigate(target);
  };
  const { isScopeBlocked } = useOpsControl();
  const taskStartBlocked = isScopeBlocked("task_scheduler");
  const {
    data: agents,
    isPending: agentsPending,
    isError: agentsError,
    refetch: refetchAgents,
  } = useListAgents(
    { includeInactive: false },
    {
      query: {
        enabled: open,
        queryKey: getListAgentsQueryKey({ includeInactive: false }),
      },
    },
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const agentItems = useMemo(() => agents ?? [], [agents]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      onOpenAutoFocus={() => {
        openerRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        navigatingRef.current = false;
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (!navigatingRef.current)
          openerRef.current?.focus({ preventScroll: true });
      }}
    >
      <CommandInput
        aria-label={t("searchPagesAndExperts")}
        placeholder={t("searchPagesAndExperts")}
      />
      <CommandList label={t("commandResults")}>
        <CommandEmpty>{t("noResults")}</CommandEmpty>

        <CommandGroup heading={t("createNew")}>
          <PaletteItem
            icon={FolderKanban}
            label={
              taskStartBlocked ? t("projectStartBlocked") : t("newProject")
            }
            disabled={taskStartBlocked}
            run={() => go("/projects/new")}
          />
          <PaletteItem
            icon={Workflow}
            label={t("newTeam")}
            run={() => go("/workforces")}
          />
          <PaletteItem
            icon={Bot}
            label={t("newExpert")}
            run={() => go("/agents/new")}
          />
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t("pages")}>
          {PAGES.map((p) => (
            <PaletteItem
              key={p.href}
              icon={p.icon}
              label={t(p.labelKey)}
              run={() => go(p.href)}
            />
          ))}
        </CommandGroup>

        {open && agentsPending ? (
          <CommandGroup heading={t("experts")}>
            <CommandItem disabled>{t("expertsLoading")}</CommandItem>
          </CommandGroup>
        ) : open && agentsError ? (
          <CommandGroup heading={t("experts")}>
            <CommandItem onSelect={() => void refetchAgents()}>
              {t("expertsRetry")}
            </CommandItem>
          </CommandGroup>
        ) : agentItems.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading={`${t("experts")} · ${agentItems.length}`}>
              {agentItems.slice(0, 12).map((a) => (
                <AgentItem
                  key={a.id}
                  agent={a}
                  run={() => go(`/agents/${a.id}`)}
                />
              ))}
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}

function PaletteItem({
  icon: Icon,
  label,
  run,
  disabled = false,
}: {
  icon: typeof Plus;
  label: string;
  run: () => void;
  disabled?: boolean;
}) {
  return (
    <CommandItem
      onSelect={run}
      disabled={disabled}
      className="min-h-11 cursor-pointer gap-2.5"
    >
      <Icon size={15} className="text-primary" aria-hidden />
      {label}
    </CommandItem>
  );
}

function AgentItem({ agent, run }: { agent: Agent; run: () => void }) {
  return (
    <CommandItem
      onSelect={run}
      className="min-h-11 min-w-0 gap-[12px] cursor-pointer"
    >
      <AgentAvatar
        agent={agent}
        size="xs"
        showStatus
        className="h-[32px] w-[26px]"
      />
      <span className="min-w-0 flex-1">
        <span className="block [overflow-wrap:anywhere]">{agent.name}</span>
        <span className="block text-[12px] text-muted-foreground">
          {agent.role}
        </span>
      </span>
    </CommandItem>
  );
}
