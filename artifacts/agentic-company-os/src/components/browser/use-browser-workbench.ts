import { useCallback, useEffect, useRef, useState } from "react";
import {
  closeBrowserSession,
  getBrowserView,
  navigateBrowser,
  sendBrowserInput,
  updateBrowserControl,
  type BrowserControlState,
  type BrowserInputEvent,
  type BrowserView,
  type OperatorRequestReceipt,
} from "@workspace/api-client-react";
import { readOperatorResponse } from "@/lib/operator-request";
import { useOpsControl } from "@/components/ops/ops-control-provider";
import { useDocumentVisible } from "@/hooks/use-page-activity";
import {
  browserLocalState,
  browserReviewSnapshot,
  clearBrowserReview,
  isBrowserRequestCurrent,
  sameBrowserRequest,
  type BrowserReviewSnapshot,
  readBrowserControl,
  readBrowserReceipt,
  readBrowserView,
  settleBrowserRequest,
  subscribeBrowserLocal,
  updateBrowserLocal,
  type BrowserRequest,
} from "@/lib/browser-workbench";

const options = () => ({ signal: AbortSignal.timeout(40_000) });
const releaseQuietly = (agentId: number, leaseId: string) =>
  updateBrowserControl(
    agentId,
    { action: "release", leaseId, requestId: crypto.randomUUID() },
    { signal: AbortSignal.timeout(8000), keepalive: true },
  ).catch(() => undefined);
type Notice = "error" | "sent" | null;

export function useBrowserWorkbench(
  agentId: number,
  active: boolean,
  working: boolean,
) {
  const visible = useDocumentVisible();
  const { isScopeBlocked } = useOpsControl();
  const blocked = isScopeBlocked("agent_tools");
  const [local, setLocal] = useState(() => browserLocalState(agentId));
  const [view, setView] = useState<BrowserView | null>(null);
  const [control, setControl] = useState<BrowserControlState | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [live, setLive] = useState(true);
  const [fresh, setFresh] = useState(false);
  const [lost, setLost] = useState(false);
  const [received, setReceived] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<OperatorRequestReceipt | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [, tick] = useState(0);
  const lease = useRef<BrowserControlState | null>(null);
  const generation = useRef(0);
  const revision = useRef(0);
  const viewSequence = useRef(0);
  const pending = useRef<Promise<unknown> | null>(null);
  const readingRef = useRef(false);
  const freshRef = useRef(false);
  const enabled = useRef(false);
  const blockedRef = useRef(blocked);
  const liveRef = useRef(live);
  enabled.current = active && visible;
  blockedRef.current = blocked;
  liveRef.current = live;
  const currentLease = () => {
    const state = lease.current;
    return state?.leaseId && Date.parse(state.leaseExpiresAt ?? "") > Date.now()
      ? state.leaseId
      : null;
  };
  const clearLease = () => {
    lease.current = null;
    tick((n) => n + 1);
  };
  const stale = () => {
    freshRef.current = false;
    setFresh(false);
  };

  useEffect(
    () =>
      subscribeBrowserLocal(agentId, () =>
        setLocal(browserLocalState(agentId)),
      ),
    [agentId],
  );

  const acceptView = useCallback(
    async (raw: unknown, epoch: number, rev: number, sequence: number) => {
      const next = readBrowserView(raw);
      if (next.pngBase64) {
        const image = new Image();
        image.src = `data:image/png;base64,${next.pngBase64}`;
        await image.decode();
        if (
          image.naturalWidth !== next.width ||
          image.naturalHeight !== next.height
        )
          throw new Error("invalid image dimensions");
      }
      if (
        !enabled.current ||
        epoch !== generation.current ||
        rev !== revision.current ||
        sequence !== viewSequence.current
      )
        return false;
      setView(next);
      setControl(next.control);
      if (next.control.owner === "agent") clearLease();
      // A renewed public expiry does not identify another operator. Only an exact
      // private heartbeat/input is authority; the server checks the lease again.
      setReceived(Date.now());
      setLost(false);
      freshRef.current = true;
      setFresh(true);
      return true;
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (!enabled.current || pending.current || readingRef.current) return false;
    readingRef.current = true;
    setReading(true);
    const epoch = generation.current,
      rev = revision.current,
      sequence = ++viewSequence.current;
    try {
      return await acceptView(
        await getBrowserView(agentId, options()),
        epoch,
        rev,
        sequence,
      );
    } catch {
      if (
        enabled.current &&
        epoch === generation.current &&
        rev === revision.current
      ) {
        stale();
        setLost(true);
      }
      return false;
    } finally {
      readingRef.current = false;
      setReading(false);
    }
  }, [agentId, acceptView]);

  useEffect(() => {
    const epoch = ++generation.current;
    if (active && visible) void refresh();
    return () => {
      if (generation.current === epoch) generation.current++;
      const id = lease.current?.leaseId;
      lease.current = null;
      freshRef.current = false;
      // Wait for this tab's dispatched request to settle before trying release.
      // A timeout is not cancellation; failed release is left to lease expiry.
      if (id)
        void Promise.resolve(pending.current).finally(() =>
          releaseQuietly(agentId, id),
        );
    };
  }, [active, visible, agentId, refresh]);

  useEffect(() => {
    if (!active || !visible || !live) {
      stale();
      return;
    }
    const timer = window.setInterval(
      () => void refresh(),
      working ? 1000 : 2800,
    );
    return () => window.clearInterval(timer);
  }, [active, visible, live, working, refresh]);

  useEffect(() => {
    if (!active || !visible) return;
    let renewing = false;
    const timer = window.setInterval(async () => {
      tick((n) => n + 1);
      const id = currentLease();
      if (!id || renewing || blockedRef.current) return;
      renewing = true;
      const epoch = generation.current,
        rev = revision.current;
      try {
        const response = await updateBrowserControl(
          agentId,
          { action: "heartbeat", leaseId: id },
          { signal: AbortSignal.timeout(5000) },
        );
        if (
          !response ||
          response.receipt !== null ||
          Object.keys(response).sort().join() !== "receipt,result"
        )
          throw new Error("invalid heartbeat");
        const state = readBrowserControl(response.result, true);
        if (state.leaseId !== id || state.owner !== "operator")
          throw new Error("wrong lease");
        if (
          enabled.current &&
          epoch === generation.current &&
          rev === revision.current &&
          lease.current?.leaseId === id
        ) {
          lease.current = state;
          setControl({ ...state, leaseId: null });
        }
      } catch {
        if (
          enabled.current &&
          epoch === generation.current &&
          rev === revision.current &&
          lease.current?.leaseId === id
        ) {
          clearLease();
          stale();
          setNotice("error");
        }
      } finally {
        renewing = false;
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [active, visible, agentId]);

  async function execute(
    kind: BrowserRequest["kind"],
    operation: (requestId: string) => Promise<unknown>,
    validate: (result: unknown, current: boolean) => Promise<void> | void,
    cleanup = false,
  ): Promise<boolean> {
    const state = browserLocalState(agentId);
    if (
      !enabled.current ||
      pending.current ||
      state.request ||
      state.damaged ||
      state.storageError ||
      (!cleanup && blockedRef.current)
    )
      return false;
    const request: BrowserRequest = {
      agentId,
      protocolVersion: 1,
      id: crypto.randomUUID(),
      kind,
      startedAt: Date.now(),
      status: "pending",
    };
    if (updateBrowserLocal(agentId, { request }, true).storageError) {
      if (sameBrowserRequest(browserLocalState(agentId).request, request))
        updateBrowserLocal(agentId, {
          request: { ...request, status: "unknown" },
        });
      return false;
    }
    const epoch = generation.current;
    revision.current++;
    viewSequence.current++;
    stale();
    setBusy(true);
    setNotice(null);
    setReceipt(null);
    let success = false;
    let dispatched = false;
    // Assign a promise before any awaited operation: rapid DOM events cannot
    // enqueue another effect, and unmount cleanup can await the dispatched one.
    const work = Promise.resolve()
      .then(() => {
        if (
          !enabled.current ||
          epoch !== generation.current ||
          (!cleanup && blockedRef.current)
        )
          throw Object.assign(new Error("cancelled before dispatch"), {
            status: 409,
          });
        dispatched = true;
        return operation(request.id);
      })
      .then(async (raw) => {
        const response = readOperatorResponse(raw, {
          agentId,
          requestId: request.id,
          kind: `browser_${kind}`,
        });
        const current =
          enabled.current &&
          epoch === generation.current &&
          isBrowserRequestCurrent(agentId, request);
        if (response.receipt.state !== "complete" || response.result === null) {
          if (current) setReceipt(response.receipt);
          settleBrowserRequest(agentId, request, true);
          if (current) clearLease();
          return;
        }
        await validate(response.result, current);
        settleBrowserRequest(agentId, request, false);
        success = current;
        if (current) setNotice("sent");
      })
      .catch(() => {
        // HTTP status alone cannot prove that an accepted action did not execute.
        settleBrowserRequest(agentId, request, dispatched);
        if (enabled.current && epoch === generation.current) {
          clearLease();
          setNotice(dispatched ? null : "error");
        }
      })
      .finally(() => {
        pending.current = null;
        setBusy(false);
      });
    pending.current = work;
    await work;
    if (enabled.current && epoch === generation.current) await refresh();
    return success;
  }

  async function take() {
    if (
      !freshRef.current ||
      control?.owner === "operator" ||
      control?.agentActionInFlight
    )
      return false;
    return execute(
      "take_over",
      (requestId) =>
        updateBrowserControl(
          agentId,
          { action: "take_over", requestId },
          options(),
        ),
      async (raw, current) => {
        const state = readBrowserControl(raw, true);
        if (state.owner !== "operator" || !state.leaseId)
          throw new Error("missing lease");
        if (!current) {
          await releaseQuietly(agentId, state.leaseId);
          return;
        }
        lease.current = state;
        setControl({ ...state, leaseId: null });
      },
    );
  }
  async function release() {
    const id = currentLease();
    if (!id) return false;
    return execute(
      "release",
      (requestId) =>
        updateBrowserControl(
          agentId,
          { action: "release", leaseId: id, requestId },
          options(),
        ),
      (raw, current) => {
        const state = readBrowserControl(raw);
        if (state.owner !== "agent") throw new Error("release not confirmed");
        if (current) {
          clearLease();
          setControl(state);
        }
      },
      true,
    );
  }
  async function navigate(url: string) {
    const id = currentLease();
    if (!id || !freshRef.current || !liveRef.current) return false;
    return execute(
      "navigate",
      (requestId) =>
        navigateBrowser(agentId, { url, leaseId: id, requestId }, options()),
      async (raw, current) => {
        readBrowserView(raw);
        if (current)
          await acceptView(
            raw,
            generation.current,
            revision.current,
            ++viewSequence.current,
          );
      },
    );
  }
  async function input(
    payload: Omit<BrowserInputEvent, "leaseId" | "requestId">,
  ) {
    const id = currentLease();
    if (!id || !freshRef.current || !liveRef.current || !view?.available)
      return false;
    return execute(
      "input",
      (requestId) =>
        sendBrowserInput(
          agentId,
          { ...payload, leaseId: id, requestId },
          options(),
        ),
      (raw) => readBrowserReceipt(raw, payload.action),
    );
  }
  async function close() {
    const id = currentLease();
    if (!id) return false;
    return execute(
      "close",
      (requestId) =>
        closeBrowserSession(agentId, { leaseId: id, requestId }, options()),
      (raw, current) => {
        readBrowserReceipt(raw, "browser-session");
        if (current) clearLease();
      },
      true,
    );
  }
  function finishReview(snapshot: BrowserReviewSnapshot | null) {
    if (!snapshot || !freshRef.current || pending.current) return false;
    const cleared = clearBrowserReview(agentId, snapshot);
    if (cleared) {
      clearLease();
      stale();
      setReceipt(null);
    }
    return cleared;
  }
  function recordReceipt(
    original: BrowserRequest,
    next: OperatorRequestReceipt,
  ) {
    if (isBrowserRequestCurrent(agentId, original)) setReceipt(next);
    else settleBrowserRequest(agentId, original, true);
  }
  const owned = !!currentLease();
  const unavailable =
    !active ||
    !visible ||
    busy ||
    !!local.request ||
    local.damaged ||
    local.storageError;
  return {
    local,
    receipt,
    recordReceipt,
    reviewSnapshot: () => browserReviewSnapshot(agentId),
    view,
    control,
    busy,
    reading,
    live,
    setLive,
    fresh,
    lost,
    received,
    notice,
    blocked,
    owned,
    unavailable,
    canInput:
      !unavailable && owned && !blocked && fresh && live && !!view?.available,
    canNavigate: !unavailable && owned && !blocked && fresh && live,
    refresh,
    take,
    release,
    navigate,
    input,
    close,
    finishReview,
    retryStorage: () => updateBrowserLocal(agentId, {}, true),
    draft: (patch: { address?: string; text?: string }) =>
      updateBrowserLocal(agentId, patch),
  };
}
