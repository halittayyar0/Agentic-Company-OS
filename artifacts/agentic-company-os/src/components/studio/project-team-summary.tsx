import { Link } from "wouter";
import type { Agent } from "@workspace/api-client-react";
import { UsersRound } from "lucide-react";
import { AgentAvatar } from "@/components/agent/agent-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/components/i18n/locale-provider";
import { studioText, type ProjectStudioCopy } from "@/lib/project-studio-copy";

export default function ProjectTeamSummary({
  c,
  members,
  owner,
  loading,
  memberCount,
}: {
  c: ProjectStudioCopy;
  members: Agent[];
  owner: Agent | undefined;
  loading: boolean;
  memberCount: number;
}) {
  const { locale } = useLocale();
  if (loading) {
    return (
      <div className="rounded-[22px] border border-border/70 bg-background/35 p-4">
        <Skeleton className="h-5 w-28 rounded-full" />
        <div className="mt-3 flex gap-1">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="size-9 rounded-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <aside className="rounded-[22px] border border-border/70 bg-background/35 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[12px] font-semibold text-muted-foreground">
          <UsersRound size={14} className="text-primary" aria-hidden /> {c.team}
        </p>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-[12px] font-semibold text-muted-foreground">
          {studioText(c.members, { count: memberCount.toLocaleString(locale) })}
        </span>
      </div>

      {members.length ? (
        <div className="mt-3 flex items-center" aria-label={c.memberLabel}>
          <div className="flex flex-wrap gap-1">
            {members.slice(0, 8).map((member) => (
              <Link
                key={member.id}
                href={`/agents/${member.id}`}
                aria-label={`${member.name}, ${member.role}`}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full ring-2 ring-card transition-transform duration-300 hover:z-10 hover:-translate-y-1"
              >
                <AgentAvatar agent={member} size="sm" showStatus />
              </Link>
            ))}
          </div>
          {memberCount > 8 ? (
            <span className="ms-2 flex size-8 items-center justify-center rounded-full border border-border bg-secondary text-[12px] font-bold">
              +{memberCount - 8}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">{c.emptyTeam}</p>
      )}

      {owner ? (
        <p className="mt-3 text-[12px] leading-4 text-muted-foreground">
          {studioText(c.coordinatorHelp, { name: owner.name })}
        </p>
      ) : null}
    </aside>
  );
}
