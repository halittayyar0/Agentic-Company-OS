import { useMemo } from "react";
import type { MetricPoint } from "@/lib/metrics";

/**
 * Dependency-free sparkline: smooth area+line SVG chart.
 * data: monotonic-ish series; normalizes to viewbox automatically.
 */
export function Sparkline({
  data,
  width = 220,
  height = 44,
  stroke = "hsl(var(--glow-accent))",
  fill = true,
}: {
  data: Array<{ x: number; y: number }>;
  width?: number;
  height?: number;
  stroke?: string;
  fill?: boolean;
}) {
  const path = useMemo(
    () => buildPath(data, width, height),
    [data, width, height],
  );
  if (!path) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={`sp-${stroke.replace(/[^a-z]/gi, "")}-${width}`}
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop offset="0%" stopColor={stroke} stopOpacity={0.32} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      {fill && (
        <path
          d={path.area}
          fill={`url(#sp-${stroke.replace(/[^a-z]/gi, "")}-${width})`}
        />
      )}
      <path
        d={path.line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: `drop-shadow(0 0 4px ${stroke}66)` }}
      />
      {/* end dot */}
      <circle
        cx={path.lastX}
        cy={path.lastY}
        r={2.6}
        fill={stroke}
        style={{ filter: `drop-shadow(0 0 5px ${stroke})` }}
      />
    </svg>
  );
}

function buildPath(
  data: Array<{ x: number; y: number }>,
  w: number,
  h: number,
) {
  if (data.length < 2) return null;

  const xs = data.map((d) => d.x);
  const ys = data.map((d) => d.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs) || minX + 1;
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeY = maxY - minY || 1;

  // pad so the dot isn't clipped at edges
  const padL = 3;
  const padR = 6;
  const padT = 5;
  const padB = 3;

  const points = data.map((d) => ({
    x: padL + ((d.x - minX) / (maxX - minX || 1)) * (w - padL - padR),
    y: padT + (1 - (d.y - minY) / rangeY) * (h - padT - padB),
  }));

  let line = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cx = (prev.x + curr.x) / 2;
    line += ` C ${cx} ${prev.y}, ${cx} ${curr.y}, ${curr.x} ${curr.y}`;
  }
  const lastPt = points[points.length - 1];
  const firstPt = points[0];
  const area = `${line} L ${lastPt.x} ${h} L ${firstPt.x} ${h} Z`;

  return { line, area, lastX: lastPt.x, lastY: lastPt.y };
}

export type { MetricPoint };
