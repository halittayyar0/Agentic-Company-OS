import type { Agent } from "@workspace/api-client-react";
import {
  getGetVmStatusQueryKey,
  useGetVmStatus,
} from "@workspace/api-client-react";
import {
  FolderTree,
  Gauge,
  HardDrive,
  Sparkles,
  TerminalSquare,
} from "lucide-react";
import { formatBytes } from "@/lib/format";
import { Panel, PulseDot, SectionTitle } from "@/components/fx";
import { TerminalPanel } from "./terminal-panel";
import { FileExplorer } from "./file-explorer";

export function VmSection({
  agent,
  terminalAllowed,
}: {
  agent: Agent;
  terminalAllowed: boolean;
}) {
  return (
    <div className="flex h-full flex-col gap-4">
      {/* spec sheet */}
      <SpecSheet agentId={agent.id} />

      {!terminalAllowed && (
        <Panel className="border-amber-400/30 p-4 text-sm text-amber-300">
          Bu ajanın <b>terminal izni kapalı</b>. Ayarlar sekmesinden “Terminal
          Kullanma” yetkisini açabilirsiniz — çalışma alanı yine de görünür.
        </Panel>
      )}

      {/* split workbench */}
      <div className="grid min-h-[520px] flex-1 grid-cols-1 gap-4 lg:grid-cols-[1.15fr_1fr]">
        <FileExplorer agentId={agent.id} />
        <TerminalPanel agentId={agent.id} disabled={!terminalAllowed} />
      </div>
    </div>
  );
}

function SpecSheet({ agentId }: { agentId: number }) {
  const {
    data: status,
    isLoading,
    isError,
    refetch,
  } = useGetVmStatus(agentId, {
    query: { refetchInterval: 6000, queryKey: getGetVmStatusQueryKey(agentId) },
  });

  const used = status?.totalBytes ?? 0;

  return (
    <Panel sheen className="p-5">
      <SectionTitle
        icon={<TerminalSquare size={16} className="text-primary" />}
        title={
          <span className="text-base">
            Sanal Bilgisayar{" "}
            <span className="font-mono text-xs font-normal text-muted-foreground">
              agent-{agentId}@sandbox · izole çalışma alanı
            </span>
          </span>
        }
        trailing={
          isError ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/25 bg-rose-500/10 px-2.5 py-0.5 text-[12px] font-bold uppercase tracking-widest text-rose-300">
              durum alınamadı
            </span>
          ) : status?.exists ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-0.5 text-[12px] font-bold uppercase tracking-widest text-emerald-300">
              <PulseDot className="bg-emerald-400" pulse /> hazır
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/25 bg-sky-500/10 px-2.5 py-0.5 text-[12px] font-bold uppercase tracking-widest text-sky-300">
              ilk kullanımda kurulur
            </span>
          )
        }
      />

      {isLoading ? (
        <div
          className="mt-4 shimmer h-16 rounded-lg"
          role="status"
          aria-label="Sanal bilgisayar durumu yükleniyor"
        />
      ) : isError ? (
        <div
          className="mt-4 rounded-lg border border-rose-400/25 bg-rose-500/[0.06] p-4 text-sm text-rose-200"
          role="alert"
        >
          Sanal bilgisayar durumu alınamadı.{" "}
          <button
            type="button"
            onClick={() => void refetch()}
            className="font-semibold underline underline-offset-2"
          >
            Yeniden dene
          </button>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Spec
            icon={HardDrive}
            label="Disk Kullanımı"
            value={formatBytes(used)}
          >
            <span className="font-mono text-[12px] text-muted-foreground/60">
              yazılmış dosya içeriğinin doğrulanmış toplamı
            </span>
          </Spec>

          <Spec
            icon={FolderTree}
            label="Dosya"
            value={`${status?.fileCount ?? 0}`}
          >
            <span className="font-mono text-[12px] text-muted-foreground/60">
              dosyalar ajana özeldir
            </span>
          </Spec>

          <Spec icon={Gauge} label="Dizin" value={`${status?.dirCount ?? 0}`}>
            <span className="font-mono text-[12px] text-muted-foreground/60">
              sandbox kökü dışına çıkılamaz
            </span>
          </Spec>
        </div>
      )}

      <p className="mt-4 flex items-start gap-1.5 text-[12px] leading-relaxed text-muted-foreground/80">
        <Sparkles size={12} className="mt-0.5 shrink-0 text-primary" />
        Ajanınız gerçek komutlar (node, npm, git, python…) buradaki izole
        bilgisayarında çalışır; ürettiği kod ve dokümanlar bu dosyaların
        arasında durur. Siz de aşağıdaki terminale yazıp canlı müdahale
        edebilirsiniz.
      </p>
    </Panel>
  );
}

function Spec({
  icon: Icon,
  label,
  value,
  children,
}: {
  icon: typeof HardDrive;
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-card-border bg-secondary/25 p-3.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12px] font-bold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <Icon size={14} className="text-primary" />
      </div>
      <div className="font-mono text-xl font-bold">{value}</div>
      {children}
    </div>
  );
}
