import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Agent, Task, TaskInput } from "@workspace/api-client-react";
import {
  getGetOrgSummaryQueryKey,
  getListAgentsQueryKey,
  getListTasksQueryKey,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";
import {
  ArrowUpRight,
  AtSign,
  BriefcaseBusiness,
  Clock3,
  CornerDownLeft,
  Repeat2,
  ShieldCheck,
} from "lucide-react";
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

type CommandMode = "delegate" | "continuous";

export function FounderCommandDeck({
  agents,
  blocked,
}: {
  agents: Agent[];
  blocked: boolean;
}) {
  const ceo = useMemo(
    () => agents.find((agent) => agent.templateKey === "ceo") ?? agents[0],
    [agents],
  );
  const [agentId, setAgentId] = useState<string>(ceo ? String(ceo.id) : "");
  const [mode, setMode] = useState<CommandMode>("delegate");
  const [command, setCommand] = useState("");
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (!agentId && ceo) setAgentId(String(ceo.id));
  }, [agentId, ceo]);

  const selected = agents.find((agent) => String(agent.id) === agentId) ?? ceo;
  const createTask = useMutation({
    mutationFn: () => {
      const taskInput = {
        title: commandTitle(command),
        brief: command.trim(),
        ownerAgentId: Number(agentId),
        priority: "normal",
        autonomyMode: mode === "continuous" ? "continuous" : "finite",
        ...(mode === "continuous" ? { cadenceSeconds: 3600 } : {}),
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
      toast({
        title:
          mode === "continuous"
            ? "Sürekli sorumluluk kuruldu"
            : "İş çalışanına teslim edildi",
        description:
          (selected?.name ?? "Ajan") + " işi kendi bilgisayarında sürdürecek.",
      });
      navigate("/projects/" + task.id);
    },
    onError: (error) =>
      toast({
        title: "İş başlatılamadı",
        description:
          error instanceof Error ? error.message : "Bağlantıyı kontrol edin.",
        variant: "destructive",
      }),
  });

  const submit = () => {
    if (!command.trim() || !agentId || blocked || createTask.isPending) return;
    createTask.mutate();
  };

  return (
    <section className="founder-command-deck relative overflow-hidden rounded-[1.75rem] border border-card-border bg-card/86 shadow-lg">
      <div className="grid min-h-[250px] lg:grid-cols-[minmax(0,1fr)_310px]">
        <div className="relative z-10 p-5 md:p-7">
          <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            <span className="flex size-7 items-center justify-center rounded-lg bg-foreground text-background">
              <BriefcaseBusiness size={13} />
            </span>
            Kurucu komutu
          </div>
          <h1 className="mt-4 max-w-2xl text-2xl font-black tracking-[-0.045em] sm:text-3xl lg:text-[2.65rem] lg:leading-[1.04]">
            Bugün şirketin neyi{" "}
            <span className="text-primary">sahiplenmesini</span> istiyorsun?
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Sonucu tarif et, çalışanı seç. İş kendi çalışma alanında ilerler;
            yalnızca kararın veya onayın gerektiğinde sana döner.
          </p>

          <div className="mt-5 max-w-3xl overflow-hidden rounded-[1.3rem] border border-border bg-background/90 shadow-sm focus-within:border-primary/45">
            <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2">
              <Select value={agentId} onValueChange={setAgentId}>
                <SelectTrigger className="h-8 w-auto min-w-[180px] border-0 bg-secondary/70 shadow-none">
                  <AtSign size={12} className="mr-1.5" />
                  <SelectValue placeholder="Çalışan seç" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={String(agent.id)}>
                      {agent.name} · {agent.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ModeButton
                active={mode === "delegate"}
                icon={BriefcaseBusiness}
                label="Sonuca kadar"
                onClick={() => setMode("delegate")}
              />
              <ModeButton
                active={mode === "continuous"}
                icon={Repeat2}
                label="Sürekli iş"
                onClick={() => setMode("continuous")}
              />
              {mode === "continuous" ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[12px] font-bold text-emerald-600 dark:text-emerald-300">
                  <Clock3 size={10} /> her saat yeniden uyanır
                </span>
              ) : null}
            </div>
            <div className="flex items-end gap-2 p-2.5">
              <textarea
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
                rows={2}
                maxLength={65_536}
                disabled={blocked || createTask.isPending}
                placeholder={
                  mode === "continuous"
                    ? "Örn: Her gün rakip fiyatlarını izle, değişiklikleri değerlendir ve sabah kısa karar özeti hazırla."
                    : "Örn: Yeni ürün için rakip araştırması yap, bulguları karşılaştır ve karar raporu hazırla."
                }
                aria-label="Şirket komutu"
                className="scrollbar-none min-h-[68px] min-w-0 flex-1 resize-none bg-transparent px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/55"
              />
              <Button
                type="button"
                onClick={submit}
                disabled={
                  !command.trim() || !agentId || blocked || createTask.isPending
                }
                className="h-10 gap-1.5 bg-foreground text-background hover:bg-foreground hover:opacity-85"
              >
                <CornerDownLeft size={14} />
                {createTask.isPending ? "Başlıyor…" : "İşi başlat"}
              </Button>
            </div>
          </div>
        </div>

        <aside className="relative hidden overflow-hidden border-l border-border/75 bg-secondary/35 p-6 lg:flex lg:flex-col lg:justify-between">
          <div
            aria-hidden="true"
            className="absolute -right-10 -top-16 size-56 rounded-full opacity-25 blur-3xl"
            style={{ backgroundColor: selected?.avatarColor }}
          />
          {selected ? (
            <div className="relative z-10">
              <AgentAvatar
                agent={selected}
                size="xl"
                showStatus
                className="shadow-xl"
              />
              <p className="mt-4 text-lg font-black tracking-tight">
                {selected.name}
              </p>
              <p className="text-xs text-muted-foreground">{selected.role}</p>
              <div className="mt-4 rounded-xl border border-border/75 bg-background/70 p-3">
                <p className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  <ShieldCheck size={11} /> Çalışma sınırı
                </p>
                <p className="mt-1.5 text-[12px] leading-relaxed text-foreground/75">
                  agent-{selected.id} kalıcı alanı · kendi tarayıcısı, terminali
                  ve dosyaları
                </p>
              </div>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => selected && navigate("/agents/" + selected.id)}
            className="relative z-10 mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
          >
            Çalışan masasını aç <ArrowUpRight size={12} />
          </button>
        </aside>
      </div>
    </section>
  );
}

function ModeButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Repeat2;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-bold transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      <Icon size={11} /> {label}
    </button>
  );
}

function commandTitle(command: string): string {
  const oneLine = command.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 92) return oneLine;
  return oneLine.slice(0, 89).trim() + "…";
}
