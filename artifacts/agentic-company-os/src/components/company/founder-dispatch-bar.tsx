import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Agent, Task, TaskInput } from "@workspace/api-client-react";
import {
  getGetOrgSummaryQueryKey,
  getListAgentsQueryKey,
  getListTasksQueryKey,
} from "@workspace/api-client-react";
import { CornerDownLeft, Repeat2, ShieldAlert } from "lucide-react";
import { AgentAvatar } from "@/components/agent/agent-avatar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { controlPlaneFetch } from "@/lib/auth";
import { cn } from "@/lib/utils";

type DispatchMode = "finite" | "continuous";

export function FounderDispatchBar({
  agents,
  selectedAgentId,
  onSelectedAgentIdChange,
  blocked,
  onTaskCreated,
}: {
  agents: Agent[];
  selectedAgentId: number | null;
  onSelectedAgentIdChange: (agentId: number) => void;
  blocked: boolean;
  onTaskCreated?: (task: Task) => void;
}) {
  const ceo = useMemo(
    () => agents.find((agent) => agent.templateKey === "ceo") ?? agents[0],
    [agents],
  );
  const selected =
    agents.find((agent) => agent.id === selectedAgentId) ?? ceo ?? null;
  const [command, setCommand] = useState("");
  const [mode, setMode] = useState<DispatchMode>("finite");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (selectedAgentId === null && ceo) onSelectedAgentIdChange(ceo.id);
  }, [ceo, onSelectedAgentIdChange, selectedAgentId]);

  const createTask = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("Projeyi üstlenecek ajan bulunamadı.");
      const taskInput = {
        title: commandTitle(command),
        brief: command.trim(),
        ownerAgentId: selected.id,
        priority: "normal",
        autonomyMode: mode,
        ...(mode === "continuous" ? { cadenceSeconds: 3_600 } : {}),
      } satisfies TaskInput;

      return controlPlaneFetch<Task>("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(taskInput),
      });
    },
    onSuccess: (task) => {
      setCommand("");
      void queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      void queryClient.invalidateQueries({
        queryKey: getListAgentsQueryKey({ includeInactive: false }),
      });
      void queryClient.invalidateQueries({
        queryKey: getGetOrgSummaryQueryKey(),
      });
      onTaskCreated?.(task);
      toast({
        title:
          mode === "continuous"
            ? "Sürekli proje başlatıldı"
            : "Proje başlatıldı",
        description: `${selected?.name ?? "Ajan"} · proje #${task.id}`,
      });
    },
    onError: (error) =>
      toast({
        title: "Proje başlatılamadı",
        description:
          error instanceof Error ? error.message : "Bağlantıyı kontrol edin.",
        variant: "destructive",
      }),
  });

  const submit = () => {
    if (!selected || !command.trim() || blocked || createTask.isPending) return;
    createTask.mutate();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const controlsDisabled = blocked || createTask.isPending;

  return (
    <section
      aria-labelledby="new-work-heading"
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="border-b border-border px-4 py-4 sm:px-5">
        <h2
          id="new-work-heading"
          className="text-lg font-semibold tracking-tight sm:text-xl"
        >
          Yeni proje başlat
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Hedefi tarif et. Seçtiğin ajan projeyi görevlere ayırıp ilerlemeyi
          kaydetsin.
        </p>
      </div>

      <div className="p-3 sm:p-4">
        <div className="rounded-md border border-input bg-background focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20">
          <textarea
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={8_000}
            rows={4}
            disabled={controlsDisabled}
            aria-label="Yeni projenin hedefi"
            aria-describedby="work-composer-help"
            placeholder={
              mode === "continuous"
                ? "Örn. Her saat yeni destek taleplerini incele ve engelleri bildir."
                : "Örn. Rakipleri doğrulanmış kaynaklarla incele ve karar notu hazırla."
            }
            className="min-h-28 w-full resize-y bg-transparent px-3 py-3 text-sm leading-6 outline-none placeholder:text-muted-foreground/60 disabled:cursor-not-allowed disabled:opacity-60"
          />

          <div className="flex flex-col gap-3 border-t border-border p-3 lg:flex-row lg:items-center">
            <div className="flex min-w-0 items-center gap-2 lg:w-64">
              {selected ? (
                <AgentAvatar agent={selected} size="sm" showStatus />
              ) : (
                <span className="size-9 rounded-md border border-border bg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <span className="block text-xs text-muted-foreground">
                  Sorumlu ajan
                </span>
                <Select
                  value={selected ? String(selected.id) : undefined}
                  onValueChange={(value) =>
                    onSelectedAgentIdChange(Number(value))
                  }
                  disabled={controlsDisabled}
                >
                  <SelectTrigger className="h-6 w-full gap-1 border-0 bg-transparent p-0 text-left text-sm font-medium shadow-none focus:ring-0">
                    <SelectValue placeholder="Ajan seç" />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={String(agent.id)}>
                        {agent.name} · {agent.role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div
              className="flex w-full rounded-md border border-border bg-muted/45 p-1 lg:ml-auto lg:w-auto"
              role="group"
              aria-label="Proje biçimi"
            >
              <ModeButton
                active={mode === "finite"}
                onClick={() => setMode("finite")}
                disabled={controlsDisabled}
              >
                Sonuca kadar
              </ModeButton>
              <ModeButton
                active={mode === "continuous"}
                onClick={() => setMode("continuous")}
                disabled={controlsDisabled}
              >
                <Repeat2 size={12} /> Sürekli
              </ModeButton>
            </div>

            <Button
              type="button"
              onClick={submit}
              disabled={
                !selected || !command.trim() || blocked || createTask.isPending
              }
              className="h-10 shrink-0 gap-2 rounded-md px-4"
            >
              <CornerDownLeft size={14} />
              {createTask.isPending ? "Başlatılıyor…" : "Projeyi başlat"}
            </Button>
          </div>
        </div>

        <div
          id="work-composer-help"
          className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"
        >
          <span>Enter ile başlat · yeni satır için Shift + Enter</span>
          {mode === "continuous" ? <span>Her saat yeniden çalışır</span> : null}
        </div>

        {blocked ? (
          <div
            role="status"
            className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5 text-sm text-amber-700 dark:text-amber-300"
          >
            <ShieldAlert size={15} className="mt-0.5 shrink-0" />
            Proje başlatma güvenlik freniyle durduruldu. Yazdığın taslak burada
            korunur.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ModeButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 lg:flex-none",
        active
          ? "bg-background text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function commandTitle(command: string): string {
  const oneLine = command.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 92) return oneLine;
  return oneLine.slice(0, 89).trim() + "…";
}
