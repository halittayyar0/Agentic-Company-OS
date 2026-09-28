import {
  getGetModelCatalogQueryKey,
  getHealthCheckQueryKey,
  getReadinessCheckQueryKey,
  useGetModelCatalog,
  useHealthCheck,
  useReadinessCheck,
  type ReadinessStatus,
} from "@workspace/api-client-react";
import {
  Bot,
  CheckCircle2,
  CircleDashed,
  Database,
  ExternalLink,
  RefreshCw,
  ServerCog,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Link } from "wouter";

import { Panel, SectionTitle } from "@/components/fx";
import { useOpsControl } from "@/components/ops/ops-control-provider";
import { cn } from "@/lib/utils";

export function SystemHealthPanel({ agentCount }: { agentCount: number }) {
  const health = useHealthCheck({
    query: {
      queryKey: getHealthCheckQueryKey(),
      refetchInterval: 30_000,
    },
  });
  const readiness = useReadinessCheck({
    query: {
      queryKey: getReadinessCheckQueryKey(),
      retry: false,
      refetchInterval: 15_000,
    },
  });
  const catalog = useGetModelCatalog({
    query: {
      queryKey: getGetModelCatalogQueryKey(),
      staleTime: 30_000,
    },
  });
  const { isScopeBlocked } = useOpsControl();
  const taskStartBlocked = isScopeBlocked("task_scheduler");
  const readinessState =
    readiness.data ??
    (readiness.error as { data?: ReadinessStatus } | null)?.data ??
    null;
  const providerCount =
    catalog.data?.providers.filter((provider) => provider.available).length ??
    0;

  const retryAll = () => {
    void health.refetch();
    void readiness.refetch();
    void catalog.refetch();
  };

  return (
    <Panel sheen className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3 sm:px-5">
        <SectionTitle
          icon={<ServerCog className="size-4 text-primary" />}
          title="Sistem Sağlığı & İlk Çalıştırma"
        />
        <button
          type="button"
          onClick={retryAll}
          disabled={
            health.isFetching || readiness.isFetching || catalog.isFetching
          }
          className="inline-flex items-center gap-1.5 rounded text-[12px] font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <RefreshCw
            className={cn(
              "size-3",
              (health.isFetching ||
                readiness.isFetching ||
                catalog.isFetching) &&
                "animate-spin motion-reduce:animate-none",
            )}
          />
          Yeniden denetle
        </button>
      </div>

      <div className="grid grid-cols-1 divide-y divide-border/70 md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-4">
        <HealthCheck
          icon={ServerCog}
          label="API süreci"
          state={
            health.isPending
              ? "checking"
              : health.data?.status === "ok"
                ? "ready"
                : "error"
          }
          detail={
            health.isPending
              ? "Bağlantı denetleniyor"
              : health.data?.status === "ok"
                ? "HTTP süreci yanıt veriyor"
                : "Health endpoint erişilemiyor"
          }
        />
        <HealthCheck
          icon={Database}
          label="Runtime & veri"
          state={
            readiness.isPending
              ? "checking"
              : readinessState?.status === "ready"
                ? "ready"
                : "error"
          }
          detail={readinessDetail(readinessState)}
        />
        <HealthCheck
          icon={Sparkles}
          label="Model sağlayıcısı"
          state={
            catalog.isPending
              ? "checking"
              : catalog.isError || providerCount === 0
                ? "error"
                : "ready"
          }
          detail={
            catalog.isPending
              ? "Katalog denetleniyor"
              : catalog.isError
                ? "Sağlayıcı durumu alınamadı"
                : providerCount > 0
                  ? `${providerCount} sağlayıcı kullanılabilir`
                  : "Kullanılabilir sağlayıcı yok"
          }
          href={providerCount === 0 ? "/settings" : undefined}
        />
        <HealthCheck
          icon={Bot}
          label="İlk ajan"
          state={agentCount > 0 ? "ready" : "action"}
          detail={
            agentCount > 0
              ? `${agentCount} ajan kadroda`
              : "İlk uzman ajanını oluştur"
          }
          href={agentCount > 0 ? undefined : "/agents/new"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/70 bg-secondary/15 px-4 py-2.5 text-[12px] text-muted-foreground sm:px-5">
        <span className="font-semibold text-foreground/80">
          Sonraki güvenli adım:
        </span>
        {catalog.isPending ? (
          <span>Model sağlayıcısı doğrulanıyor.</span>
        ) : catalog.isError ? (
          <span>Model durumu alınmadan ilk görev önerilmiyor.</span>
        ) : providerCount === 0 ? (
          <Link href="/settings" className="text-primary hover:underline">
            model sağlayıcısını yapılandır
          </Link>
        ) : agentCount === 0 ? (
          <Link href="/agents/new" className="text-primary hover:underline">
            ilk ajanı kur
          </Link>
        ) : taskStartBlocked ? (
          <span>
            Güvenlik freni kaldırılana kadar yeni görev başlatma kapalı.
          </span>
        ) : (
          <Link href="/projects/new" className="text-primary hover:underline">
            doğrulanabilir ilk görevi başlat
          </Link>
        )}
        <span className="ml-auto hidden font-mono text-[12px] uppercase tracking-wider text-muted-foreground/55 sm:inline">
          health ≠ readiness
        </span>
      </div>
    </Panel>
  );
}

function HealthCheck({
  icon: Icon,
  label,
  state,
  detail,
  href,
}: {
  icon: typeof ServerCog;
  label: string;
  state: "checking" | "ready" | "error" | "action";
  detail: string;
  href?: string;
}) {
  const content = (
    <div className="flex items-start gap-3 px-4 py-4 sm:px-5">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg border",
          state === "ready"
            ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300"
            : state === "error"
              ? "border-rose-400/25 bg-rose-500/10 text-rose-300"
              : "border-amber-400/25 bg-amber-500/10 text-amber-300",
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-xs font-bold">
          {label}
          {state === "ready" ? (
            <CheckCircle2 className="size-3.5 text-emerald-400" aria-hidden />
          ) : state === "error" ? (
            <TriangleAlert className="size-3.5 text-rose-400" aria-hidden />
          ) : (
            <CircleDashed
              className="size-3.5 animate-spin text-amber-300 motion-reduce:animate-none"
              aria-hidden
            />
          )}
        </span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">
          {detail}
        </span>
      </span>
      {href ? (
        <ExternalLink className="mt-1 size-3 text-primary" aria-hidden />
      ) : null}
    </div>
  );

  return href ? (
    <Link
      href={href}
      className="block transition-colors hover:bg-secondary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {content}
    </Link>
  ) : (
    <div role="status">{content}</div>
  );
}

function readinessDetail(state: ReadinessStatus | null): string {
  if (!state) return "Readiness durumu alınamadı";
  if (state.status === "ready") return "Startup ve veritabanı hazır";
  if (state.checks.shuttingDown) return "Sunucu kontrollü kapanıyor";
  if (!state.checks.startup) return "Runtime başlangıcı tamamlanmadı";
  if (!state.checks.database) return "Veritabanı hazır değil";
  return "Runtime trafik almaya hazır değil";
}
