import type {
  BrowserControlState,
  BrowserView,
} from "@workspace/api-client-react";

export const browserRequestKinds = [
  "take_over",
  "release",
  "navigate",
  "input",
  "close",
] as const;
export type BrowserRequest = {
  protocolVersion?: 1;
  id: string;
  agentId: number;
  kind: (typeof browserRequestKinds)[number];
  startedAt: number;
  status: "pending" | "unknown";
};
export function sameBrowserRequest(
  left: BrowserRequest | null,
  right: BrowserRequest | null,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.id === right.id &&
    left.agentId === right.agentId &&
    left.kind === right.kind &&
    left.startedAt === right.startedAt &&
    left.protocolVersion === right.protocolVersion
  );
}
export const browserStorageKey = (agentId: number) =>
  `acos.browser-request.v1.${agentId}`;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export function parseBrowserRequest(
  raw: string | null,
  agentId: number,
): BrowserRequest | null {
  if (raw === null) return null;
  if (raw.length > 1000) throw new Error("invalid record");
  const value: unknown = JSON.parse(raw);
  if (
    !object(value) ||
    ![
      "agentId,id,kind,startedAt,status",
      "agentId,id,kind,protocolVersion,startedAt,status",
    ].includes(Object.keys(value).sort().join()) ||
    (value.protocolVersion !== undefined && value.protocolVersion !== 1) ||
    value.agentId !== agentId ||
    typeof value.id !== "string" ||
    !uuid.test(value.id) ||
    !browserRequestKinds.includes(value.kind as BrowserRequest["kind"]) ||
    !Number.isSafeInteger(value.startedAt) ||
    Number(value.startedAt) <= 0 ||
    !["pending", "unknown"].includes(String(value.status))
  )
    throw new Error("invalid record");
  return { ...(value as BrowserRequest), status: "unknown" };
}
export function validBrowserText(text: string): boolean {
  return (
    text.length > 0 &&
    text.length <= 4096 &&
    !text.includes("\0") &&
    new TextDecoder("utf-8", { ignoreBOM: true }).decode(
      new TextEncoder().encode(text),
    ) === text
  );
}
export function browserUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw || raw.length > 2048 || /[\u0000-\u0020]/u.test(raw)) return null;
  try {
    const url = new URL(
      /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`,
    );
    return ["http:", "https:"].includes(url.protocol) &&
      url.hostname &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function readBrowserControl(
  value: unknown,
  privateLease = false,
): BrowserControlState {
  if (
    !object(value) ||
    !["agent", "operator"].includes(String(value.owner)) ||
    typeof value.agentActionInFlight !== "boolean" ||
    (value.leaseId !== null &&
      (typeof value.leaseId !== "string" || !uuid.test(value.leaseId))) ||
    (value.leaseExpiresAt !== null &&
      (typeof value.leaseExpiresAt !== "string" ||
        !Number.isFinite(Date.parse(value.leaseExpiresAt))))
  )
    throw new Error("invalid browser control");
  if (
    value.owner === "agent" &&
    (value.leaseId !== null || value.leaseExpiresAt !== null)
  )
    throw new Error("invalid agent control");
  if (
    value.owner === "operator" &&
    (!value.leaseExpiresAt || (privateLease && !value.leaseId))
  )
    throw new Error("invalid operator control");
  return {
    owner: value.owner as BrowserControlState["owner"],
    leaseId: privateLease ? (value.leaseId as string | null) : null,
    leaseExpiresAt: value.leaseExpiresAt as string | null,
    agentActionInFlight: value.agentActionInFlight,
  };
}
export function readBrowserView(value: unknown): BrowserView {
  if (
    !object(value) ||
    typeof value.available !== "boolean" ||
    typeof value.visible !== "boolean" ||
    !Number.isInteger(value.width) ||
    !Number.isInteger(value.height) ||
    Number(value.width) < 1 ||
    Number(value.height) < 1 ||
    Number(value.width) > 8192 ||
    Number(value.height) > 8192 ||
    [value.url, value.title].some(
      (v) => v !== null && (typeof v !== "string" || v.length > 16384),
    ) ||
    (value.pngBase64 !== null &&
      (typeof value.pngBase64 !== "string" ||
        value.pngBase64.length > 12_000_000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(value.pngBase64))) ||
    (value.available && !value.pngBase64)
  )
    throw new Error("invalid browser view");
  return {
    available: value.available,
    visible: value.visible,
    width: Number(value.width),
    height: Number(value.height),
    url: value.url as string | null,
    title: value.title as string | null,
    pngBase64: value.pngBase64 as string | null,
    note: null,
    control: readBrowserControl(value.control),
  };
}
export function readBrowserReceipt(value: unknown, path: string): void {
  if (
    !object(value) ||
    value.path !== path ||
    typeof value.deleted !== "boolean" ||
    (path !== "browser-session" && !value.deleted)
  )
    throw new Error("invalid browser receipt");
}
export function browserPoint(
  x: number,
  y: number,
  rect: { left: number; top: number; width: number; height: number },
  width: number,
  height: number,
) {
  if (
    ![x, y, rect.left, rect.top, rect.width, rect.height, width, height].every(
      Number.isFinite,
    ) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    width <= 0 ||
    height <= 0
  )
    return null;
  const scale = Math.min(rect.width / width, rect.height / height);
  const left = rect.left + (rect.width - width * scale) / 2;
  const top = rect.top + (rect.height - height * scale) / 2;
  if (
    x < left ||
    y < top ||
    x > left + width * scale ||
    y > top + height * scale
  )
    return null;
  return {
    x: Math.min(width - 1, Math.floor((x - left) / scale)),
    y: Math.min(height - 1, Math.floor((y - top) / scale)),
  };
}

export type BrowserLocalState = {
  storedRaw: string | null | undefined;
  request: BrowserRequest | null;
  damaged: boolean;
  storageError: boolean;
  address: string;
  text: string;
};
const states = new Map<number, BrowserLocalState>();
const listeners = new Map<number, Set<() => void>>();
let guarded = false;
export function browserLocalState(agentId: number): BrowserLocalState {
  let state = states.get(agentId);
  if (!state) {
    state = {
      storedRaw: undefined,
      request: null,
      damaged: false,
      storageError: false,
      address: "",
      text: "",
    };
    try {
      state.storedRaw = window.sessionStorage.getItem(
        browserStorageKey(agentId),
      );
      state.request = parseBrowserRequest(state.storedRaw, agentId);
    } catch {
      state.damaged = true;
      state.storageError = true;
    }
    states.set(agentId, state);
  }
  if (!guarded) {
    window.addEventListener("beforeunload", (event) => {
      if (
        [...states.values()].some(
          (s) => s.text || s.address || (s.storageError && s.request),
        )
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
    guarded = true;
  }
  return state;
}
export function updateBrowserLocal(
  agentId: number,
  patch: Partial<BrowserLocalState>,
  persist = false,
): BrowserLocalState {
  const current = browserLocalState(agentId);
  const next = { ...current, ...patch };
  if (persist) {
    try {
      const observed = window.sessionStorage.getItem(
        browserStorageKey(agentId),
      );
      if (observed !== current.storedRaw) {
        next.storedRaw = observed;
        next.request = current.request;
        next.damaged = true;
        next.request = parseBrowserRequest(observed, agentId);
        next.damaged = false;
        throw new Error("local record changed");
      }
      if (current.damaged && patch.damaged !== false)
        throw new Error("damaged data requires review");
      const raw = next.request ? JSON.stringify(next.request) : null;
      if (next.request)
        window.sessionStorage.setItem(
          browserStorageKey(agentId),
          JSON.stringify(next.request),
        );
      else window.sessionStorage.removeItem(browserStorageKey(agentId));
      if (window.sessionStorage.getItem(browserStorageKey(agentId)) !== raw)
        throw new Error("storage readback failed");
      next.storageError = false;
      next.storedRaw = raw;
    } catch {
      next.storageError = true;
      if (next.storedRaw === current.storedRaw && next.request === null) {
        next.request = current.request;
        next.damaged = current.damaged;
      }
    }
  }
  states.set(agentId, next);
  for (const listener of listeners.get(agentId) ?? []) listener();
  return next;
}
export function settleBrowserRequest(
  agentId: number,
  expected: BrowserRequest,
  unknown: boolean,
): void {
  const current = browserLocalState(agentId);
  if (!sameBrowserRequest(current.request, expected)) return;
  try {
    const stored = parseBrowserRequest(
      window.sessionStorage.getItem(browserStorageKey(agentId)),
      agentId,
    );
    if (!sameBrowserRequest(stored, expected)) {
      updateBrowserLocal(agentId, { request: stored, storageError: true });
      return;
    }
  } catch {
    updateBrowserLocal(agentId, {
      damaged: true,
      storageError: true,
      request: { ...expected, status: "unknown" },
    });
    return;
  }
  const settled = updateBrowserLocal(
    agentId,
    { request: unknown ? { ...expected, status: "unknown" } : null },
    true,
  );
  if (settled.storageError && !settled.request)
    updateBrowserLocal(agentId, {
      request: { ...expected, status: "unknown" },
    });
}
export function isBrowserRequestCurrent(
  agentId: number,
  expected: BrowserRequest,
): boolean {
  if (!sameBrowserRequest(browserLocalState(agentId).request, expected))
    return false;
  try {
    return sameBrowserRequest(
      parseBrowserRequest(
        window.sessionStorage.getItem(browserStorageKey(agentId)),
        agentId,
      ),
      expected,
    );
  } catch {
    return false;
  }
}
export type BrowserReviewSnapshot = {
  request: BrowserRequest | null;
  raw: string | null;
};
export function browserReviewSnapshot(
  agentId: number,
): BrowserReviewSnapshot | null {
  try {
    return {
      request: browserLocalState(agentId).request,
      raw: window.sessionStorage.getItem(browserStorageKey(agentId)),
    };
  } catch {
    return null;
  }
}
export function clearBrowserReview(
  agentId: number,
  snapshot: BrowserReviewSnapshot,
): boolean {
  const current = browserLocalState(agentId);
  if (
    current.request?.status === "pending" ||
    !sameBrowserRequest(current.request, snapshot.request)
  )
    return false;
  try {
    if (
      window.sessionStorage.getItem(browserStorageKey(agentId)) !== snapshot.raw
    )
      return false;
  } catch {
    return false;
  }
  const cleared = updateBrowserLocal(
    agentId,
    { request: null, damaged: false },
    true,
  );
  return !cleared.storageError;
}
export function subscribeBrowserLocal(
  agentId: number,
  listener: () => void,
): () => void {
  const group = listeners.get(agentId) ?? new Set();
  group.add(listener);
  listeners.set(agentId, group);
  return () => {
    group.delete(listener);
    if (!group.size) listeners.delete(agentId);
  };
}
