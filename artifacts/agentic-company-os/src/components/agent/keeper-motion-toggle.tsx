import { Pause, Play } from "lucide-react";
import { useLocale } from "@/components/i18n/locale-provider";
import { keeperMotionCopy } from "@/lib/keeper-copy";
import { setKeeperMotion, useKeeperMotion } from "@/lib/keeper-motion";
import { cn } from "@/lib/utils";

export function KeeperMotionToggle({ compact = false }: { compact?: boolean }) {
  const { locale } = useLocale();
  const c = keeperMotionCopy[locale];
  const enabled = useKeeperMotion();
  return (
    <button
      type="button"
      aria-label={enabled ? c.pause : c.enable}
      aria-pressed={enabled}
      title={`${enabled ? c.pause : c.enable}. ${c.help}`}
      onClick={() => setKeeperMotion(!enabled)}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-control border bg-card text-sm text-foreground hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        compact
          ? "size-[44px] shrink-0 p-0"
          : "min-h-11 min-w-0 max-w-full whitespace-normal px-3",
      )}
    >
      {enabled ? (
        <Pause size={15} aria-hidden />
      ) : (
        <Play size={15} aria-hidden />
      )}
      {!compact && (
        <span className="min-w-0 break-words text-start">
          {enabled ? c.live : c.calm}
        </span>
      )}
    </button>
  );
}
