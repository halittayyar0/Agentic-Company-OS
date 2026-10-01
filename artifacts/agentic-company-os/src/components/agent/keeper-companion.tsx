import { MessageCircle } from "lucide-react";
import type { Agent } from "@workspace/api-client-react";
import { useLocale } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { keeperMotionCopy, type KeeperCompanionCopy } from "@/lib/keeper-copy";
import { KeeperMotionToggle } from "./keeper-motion-toggle";

export function KeeperCompanion({
  agent,
  known,
  c,
  onTalk,
}: {
  agent: Agent;
  known: boolean;
  c: KeeperCompanionCopy;
  onTalk: () => void;
}) {
  const { locale } = useLocale();
  const mood = !known ? "unknown" : !agent.isActive ? "archived" : agent.status;
  return (
    <div className="keeper-companion min-w-0 space-y-3 rounded-xl border p-4">
      <p className="text-base font-semibold">{c.title}</p>
      <p className="text-sm leading-6">{c[mood]}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={onTalk}
          disabled={!known || !agent.isActive || agent.status === "archived"}
        >
          <MessageCircle size={16} aria-hidden /> {c.talk}
        </Button>
        <KeeperMotionToggle />
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        {c.ai} {keeperMotionCopy[locale].help}
      </p>
    </div>
  );
}
