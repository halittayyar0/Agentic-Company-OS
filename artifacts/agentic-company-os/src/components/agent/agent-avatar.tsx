import { useEffect, useState } from "react";
import type { Agent } from "@workspace/api-client-react";
import rosterAtlasUrl from "@/assets/company-keeper-atlas.webp";
import { cn } from "@/lib/utils";

const TEMPLATE_MASCOT_INDEX: Record<string, number> = {
  ceo: 0,
  marketing_director: 1,
  sales_director: 2,
  operations_director: 3,
  finance_director: 4,
  product_director: 5,
  engineering_director: 6,
  research_director: 7,
  support_director: 8,
  content_director: 9,
  specialist: 7,
  ux_designer: 5,
  quality_engineer: 3,
  data_analyst: 7,
  automation_specialist: 6,
};

const SIZE_CLASS = {
  xs: "h-8 w-[1.6rem] rounded-[0.55rem]",
  sm: "h-10 w-8 rounded-[0.65rem]",
  md: "h-[3.25rem] w-[2.6rem] rounded-xl",
  lg: "h-20 w-16 rounded-2xl",
  xl: "h-[7.5rem] w-24 rounded-[1.4rem]",
} as const;

function mascotIndex(agent: Agent): number {
  if (agent.templateKey && TEMPLATE_MASCOT_INDEX[agent.templateKey] != null) {
    return TEMPLATE_MASCOT_INDEX[agent.templateKey];
  }
  return Math.abs(agent.id - 1) % 10;
}

export function AgentAvatar({
  agent,
  imageSrc,
  size = "md",
  showStatus = false,
  className,
}: {
  agent: Agent;
  /** undefined uses the persisted endpoint, null forces the built-in mascot. */
  imageSrc?: string | null;
  size?: keyof typeof SIZE_CLASS;
  showStatus?: boolean;
  className?: string;
}) {
  const [customImageFailed, setCustomImageFailed] = useState(false);
  const index = mascotIndex(agent);
  const column = index % 5;
  const row = Math.floor(index / 5);
  const persistedImage = agent.avatarVersion
    ? `/api/agents/${agent.id}/avatar?v=${encodeURIComponent(agent.avatarVersion)}`
    : null;
  const requestedImage = imageSrc === undefined ? persistedImage : imageSrc;
  const customImage = customImageFailed ? null : requestedImage;

  useEffect(() => setCustomImageFailed(false), [requestedImage]);

  return (
    <span
      role="img"
      aria-label={agent.name}
      className={cn(
        "relative block shrink-0 overflow-visible border border-white/25 bg-card bg-no-repeat shadow-sm ring-1 ring-black/10",
        SIZE_CLASS[size],
        className,
      )}
    >
      {customImage ? (
        <img
          src={customImage}
          alt=""
          aria-hidden="true"
          decoding="async"
          loading="lazy"
          draggable={false}
          className="absolute inset-0 size-full rounded-[inherit] object-cover"
          onError={() => setCustomImageFailed(true)}
        />
      ) : (
        <span
          aria-hidden="true"
          className="absolute inset-0 overflow-hidden rounded-[inherit] bg-no-repeat"
          style={{
            backgroundImage: `url("${rosterAtlasUrl}")`,
            backgroundSize: "500% auto",
            backgroundPosition: `${column * 25}% ${row * 100}%`,
          }}
        />
      )}
      {showStatus ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute -bottom-1 -right-1 size-3 rounded-full border-2 border-background",
            agent.status === "working"
              ? "animate-pulse bg-emerald-500 motion-reduce:animate-none"
              : agent.status === "blocked"
                ? "bg-amber-500"
                : agent.status === "archived"
                  ? "bg-slate-500"
                  : "bg-blue-400",
          )}
        />
      ) : null}
    </span>
  );
}
