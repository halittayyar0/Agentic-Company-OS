import {
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import type { AgentStatus, ModelTier } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { AGENT_STATUS_META, TIER_META } from "@/lib/format";

/* ------------------------------------------------------------------ */
/* PulseDot                                                            */
/* ------------------------------------------------------------------ */
export function PulseDot({
  className,
  pulse = false,
}: {
  className?: string;
  pulse?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-block size-2 rounded-full",
        pulse && "radar-dot",
        className,
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/* AgentStatusPill                                                     */
/* ------------------------------------------------------------------ */
export function AgentStatusPill({
  status,
  className,
}: {
  status: AgentStatus;
  className?: string;
}) {
  const meta = AGENT_STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] font-bold uppercase tracking-widest",
        meta.pillClass,
        className,
      )}
    >
      <PulseDot className={meta.dot} pulse={status === "working"} />
      {meta.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* TierChip / ProviderChip                                             */
/* ------------------------------------------------------------------ */
export function TierChip({ tier }: { tier: ModelTier }) {
  const meta = TIER_META[tier];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-px text-[12px] font-semibold",
        meta.className,
      )}
    >
      {meta.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */
export function Panel({
  children,
  className,
  sheen = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  sheen?: boolean;
}) {
  return (
    <div
      className={cn("glass rounded-xl shadow-sm", sheen && "sheen", className)}
      {...props}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PageHeader                                                          */
/* ------------------------------------------------------------------ */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? (
          <div className="mb-1.5 flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.22em] text-primary/80">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex items-center gap-3">{actions}</div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* TypingIndicator                                                     */
/* ------------------------------------------------------------------ */
export function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-1 py-2">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="typing-dot size-1.5 rounded-full bg-primary/70"
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SectionTitle                                                        */
/* ------------------------------------------------------------------ */
export function SectionTitle({
  icon,
  title,
  trailing,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight text-foreground/90">
        {icon}
        {title}
      </h2>
      {trailing}
    </div>
  );
}

/* ==================================================================== */
/* V2 FX — mission control grade                                        */
/* ==================================================================== */

/** Circular progress ring with animated value + center slot. */
export function StatRing({
  value,
  max = 100,
  size = 92,
  stroke = 8,
  label,
  sublabel,
  tone = "accent",
  children,
}: {
  value?: number;
  max?: number;
  size?: number;
  stroke?: number;
  label?: ReactNode;
  sublabel?: ReactNode;
  tone?: "accent" | "emerald" | "amber" | "rose" | "violet";
  children?: ReactNode;
}) {
  const pct = Math.min(1, Math.max(0, (value ?? 0) / max));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  const tones: Record<string, [string, string]> = {
    accent: ["hsl(217 100% 62%)", "hsl(258 90% 66%)"],
    emerald: ["hsl(158 78% 46%)", "hsl(187 92% 50%)"],
    amber: ["hsl(40 98% 56%)", "hsl(28 96% 53%)"],
    rose: ["hsl(350 90% 58%)", "hsl(330 85% 60%)"],
    violet: ["hsl(258 90% 66%)", "hsl(280 85% 68%)"],
  };
  const [from, to] = tones[tone] ?? tones.accent;
  const gid = `ring-${tone}-${size}`;

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        className="-rotate-90"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth={stroke}
          opacity={0.55}
        />
        <circle
          key={`${c}-${pct}`}
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gid})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className="fx-stroke-progress"
          style={
            {
              "--fx-stroke-start": c,
              filter: `drop-shadow(0 0 6px ${from}55)`,
            } as CSSProperties
          }
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">
        {children ?? (
          <>
            <span className="text-xl font-extrabold tabular-nums">{label}</span>
            {sublabel && (
              <span className="mt-1 text-[12px] font-bold uppercase tracking-widest text-muted-foreground/70">
                {sublabel}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Card that highlights a soft spotlight following the cursor. */
export function SpotlightCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    el.style.setProperty("--my", `${e.clientY - rect.top}px`);
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      className={cn(
        "group relative overflow-hidden rounded-xl border border-card-border bg-card/60 backdrop-blur transition-colors hover:border-primary/35",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(340px circle at var(--mx, 50%) var(--my, 50%), hsl(var(--glow-accent) / 0.09), transparent 65%)",
        }}
      />
      {children}
    </div>
  );
}
