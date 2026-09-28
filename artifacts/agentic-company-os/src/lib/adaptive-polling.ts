export const LIVE_POLL_MS = 4_000;
export const IDLE_POLL_MS = 15_000;

export function adaptivePollingInterval({
  active = true,
  documentVisible,
  live,
  liveMs = LIVE_POLL_MS,
  idleMs = IDLE_POLL_MS,
}: {
  active?: boolean;
  documentVisible: boolean;
  live: boolean;
  liveMs?: number;
  idleMs?: number;
}): number | false {
  if (!active || !documentVisible) return false;
  return live ? liveMs : idleMs;
}
