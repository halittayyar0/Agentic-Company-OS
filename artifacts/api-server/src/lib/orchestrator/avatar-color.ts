const PALETTE = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f97316",
  "#f59e0b",
  "#10b981",
  "#14b8a6",
  "#0ea5e9",
  "#3b82f6",
  "#ef4444",
];

export function avatarColorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}
