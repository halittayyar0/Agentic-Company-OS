import { useSyncExternalStore } from "react";

const key = "acos.keeper-motion.v1";
const listeners = new Set<() => void>();
let enabled = true;
let initialized = false;

function readStored() {
  try {
    return window.localStorage.getItem(key) !== "off";
  } catch {
    return enabled;
  }
}
function snapshot() {
  if (!initialized && typeof window !== "undefined") {
    enabled = readStored();
    initialized = true;
  }
  return enabled;
}
function paint() {
  document.documentElement.dataset.keeperMotion = snapshot() ? "on" : "off";
  document.documentElement.dataset.keeperDocument = document.visibilityState;
}
function notify() {
  paint();
  for (const listener of listeners) listener();
}
function storage(event: StorageEvent) {
  if (event.key === key || event.key === null) {
    enabled = readStored();
    notify();
  }
}
function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    enabled = readStored();
    initialized = true;
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", paint);
  }
  listeners.add(listener);
  paint();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", paint);
    }
  };
}
export function setKeeperMotion(next: boolean) {
  enabled = next;
  initialized = true;
  try {
    window.localStorage.setItem(key, next ? "on" : "off");
  } catch {
    // The choice still works for this tab when storage is unavailable.
  }
  notify();
}
export function useKeeperMotion() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
