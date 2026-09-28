import type { VmWriteResult } from "@workspace/api-client-react";
import {
  emptyFileSession,
  readFileSession,
  recoverFileSession,
  writeFileSession,
  type FileSession,
} from "./file-session";

type Snapshot = {
  session: FileSession;
  damaged: boolean;
  storageError: boolean;
};
export type SavedFile = VmWriteResult & { content: string };
const states = new Map<number, Snapshot>();
const listeners = new Map<
  number,
  Set<(state: Snapshot, saved?: SavedFile) => void>
>();
let unloadGuard = false;

export function getFileSession(agentId: number): Snapshot {
  let state = states.get(agentId);
  if (!state) {
    try {
      const loaded = readFileSession(agentId, window.sessionStorage);
      state = {
        ...loaded,
        session: recoverFileSession(loaded.session),
        storageError: loaded.damaged,
      };
    } catch {
      state = {
        session: emptyFileSession(agentId),
        damaged: true,
        storageError: true,
      };
    }
    states.set(agentId, state);
  }
  // Keep failed-storage drafts in memory across SPA navigation. A full reload
  // cannot retain them, so the native leave-page guard remains while needed.
  if (!unloadGuard) {
    window.addEventListener("beforeunload", (event) => {
      if (
        [...states.values()].some(
          (value) =>
            value.storageError &&
            (value.session.drafts.length ||
              value.session.newPath ||
              value.session.request),
        )
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
    unloadGuard = true;
  }
  return state;
}

export function putFileSession(
  session: FileSession,
  options: { reset?: boolean; saved?: SavedFile } = {},
): Snapshot {
  const current = getFileSession(session.agentId);
  let stored = false;
  if (!current.damaged || options.reset) {
    try {
      stored = writeFileSession(session, window.sessionStorage);
    } catch {
      /* blocked storage */
    }
  }
  const next = {
    session,
    damaged: current.damaged && !(options.reset && stored),
    storageError: !stored,
  };
  states.set(session.agentId, next);
  for (const listener of listeners.get(session.agentId) ?? [])
    listener(next, stored ? options.saved : undefined);
  return next;
}

export function subscribeFileSession(
  agentId: number,
  listener: (state: Snapshot, saved?: SavedFile) => void,
): () => void {
  const group = listeners.get(agentId) ?? new Set();
  group.add(listener);
  listeners.set(agentId, group);
  return () => {
    group.delete(listener);
    if (!group.size) listeners.delete(agentId);
  };
}
