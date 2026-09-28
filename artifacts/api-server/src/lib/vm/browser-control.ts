import { BrowserDiagnosticError } from "./browser-diagnostics";
import { randomUUID } from "node:crypto";

export type BrowserControlOwner = "agent" | "operator";

export interface BrowserControlState {
  owner: BrowserControlOwner;
  leaseId: string | null;
  leaseExpiresAt: string | null;
  agentActionInFlight: boolean;
}

interface MutableBrowserControlState {
  owner: BrowserControlOwner;
  leaseId: string | null;
  leaseExpiresAtMs: number | null;
  agentClaims: Set<string>;
  operatorClaims: Set<string>;
}

export class BrowserControlError extends BrowserDiagnosticError {}

/** Serializes session closure against claims and session creation. */
export class BrowserSessionCloseGate {
  private readonly closing = new Map<number, string>();
  private shuttingDown = false;
  private pauseToken: string | null = null;

  assertAvailable(agentId: number): void {
    if (this.shuttingDown || this.pauseToken || this.closing.has(agentId)) {
      throw new BrowserControlError(
        "Tarayici oturumu kapatiliyor; yeni eylem baslatilamaz.",
        { key: "browserClosing" },
      );
    }
  }

  begin(agentId: number): string {
    this.assertAvailable(agentId);
    const token = randomUUID();
    this.closing.set(agentId, token);
    return token;
  }

  tryBegin(agentId: number): string | null {
    if (this.shuttingDown || this.pauseToken || this.closing.has(agentId))
      return null;
    const token = randomUUID();
    this.closing.set(agentId, token);
    return token;
  }

  finish(agentId: number, token: string): void {
    if (this.closing.get(agentId) === token) this.closing.delete(agentId);
  }

  beginShutdown(agentIds: Iterable<number>): void {
    this.shuttingDown = true;
    for (const agentId of agentIds) {
      if (!this.closing.has(agentId)) this.closing.set(agentId, randomUUID());
    }
  }

  /** Temporary global creation barrier used while emergency cleanup closes. */
  beginPause(agentIds: Iterable<number>): string {
    if (this.shuttingDown || this.pauseToken) {
      throw new BrowserControlError(
        "Tarayici runtime'i zaten kapatiliyor veya duraklatiliyor.",
        { key: "browserRuntimeClosing" },
      );
    }
    const token = randomUUID();
    this.pauseToken = token;
    for (const agentId of agentIds) this.closing.set(agentId, token);
    return token;
  }

  finishPause(token: string): void {
    if (this.pauseToken !== token) return;
    this.pauseToken = null;
    for (const [agentId, closingToken] of this.closing) {
      if (closingToken === token) this.closing.delete(agentId);
    }
  }
}

/** Bounded FIFO for operator mouse/keyboard/navigation actions. */
export class BrowserActionQueue {
  private readonly tails = new Map<number, Promise<void>>();
  private readonly depths = new Map<number, number>();

  constructor(private readonly maxDepth = 64) {}

  async enqueue<T>(agentId: number, operation: () => Promise<T>): Promise<T> {
    const depth = this.depths.get(agentId) ?? 0;
    if (depth >= this.maxDepth) {
      throw new BrowserControlError(
        `Tarayici girdi kuyrugu dolu (${this.maxDepth}); istemci yavaslamali.`,
        { key: "browserQueueFull", params: { limit: this.maxDepth } },
      );
    }
    const previous = this.tails.get(agentId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    this.tails.set(agentId, tail);
    this.depths.set(agentId, depth + 1);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      const nextDepth = Math.max(0, (this.depths.get(agentId) ?? 1) - 1);
      if (nextDepth === 0) this.depths.delete(agentId);
      else this.depths.set(agentId, nextDepth);
      if (this.tails.get(agentId) === tail) this.tails.delete(agentId);
    }
  }
}

function clampLeaseMs(value: number): number {
  return Math.min(5 * 60_000, Math.max(5_000, Math.floor(value)));
}

export class BrowserControlRegistry {
  private readonly states = new Map<number, MutableBrowserControlState>();
  private readonly leaseMs: number;

  constructor(leaseMs = 30_000) {
    this.leaseMs = clampLeaseMs(leaseMs);
  }

  private stateFor(agentId: number): MutableBrowserControlState {
    let state = this.states.get(agentId);
    if (!state) {
      state = {
        owner: "agent",
        leaseId: null,
        leaseExpiresAtMs: null,
        agentClaims: new Set(),
        operatorClaims: new Set(),
      };
      this.states.set(agentId, state);
    }
    return state;
  }

  private expireIfNeeded(state: MutableBrowserControlState, now: number): void {
    if (
      state.owner === "operator" &&
      state.leaseExpiresAtMs !== null &&
      state.leaseExpiresAtMs <= now &&
      state.operatorClaims.size === 0
    ) {
      state.owner = "agent";
      state.leaseId = null;
      state.leaseExpiresAtMs = null;
    }
  }

  snapshot(agentId: number, now = Date.now()): BrowserControlState {
    const state = this.stateFor(agentId);
    this.expireIfNeeded(state, now);
    return {
      owner: state.owner,
      leaseId: state.leaseId,
      leaseExpiresAt:
        state.leaseExpiresAtMs === null
          ? null
          : new Date(state.leaseExpiresAtMs).toISOString(),
      agentActionInFlight: state.agentClaims.size > 0,
    };
  }

  publicSnapshot(agentId: number, now = Date.now()): BrowserControlState {
    return { ...this.snapshot(agentId, now), leaseId: null };
  }

  beginAgentAction(agentId: number, now = Date.now()): string {
    const state = this.stateFor(agentId);
    this.expireIfNeeded(state, now);
    if (state.owner !== "agent") {
      throw new BrowserControlError(
        `Tarayici operator tarafindan devralindi; kontrol ${new Date(
          state.leaseExpiresAtMs ?? now,
        ).toISOString()} tarihine kadar ajan eylemlerine kapali.`,
        {
          key: "browserOperatorOwns",
          params: {
            expiresAt: new Date(state.leaseExpiresAtMs ?? now).toISOString(),
          },
        },
      );
    }
    const claimId = randomUUID();
    state.agentClaims.add(claimId);
    return claimId;
  }

  endAgentAction(agentId: number, claimId: string): void {
    // A system shutdown may have force-cleared the registry while an old
    // callback was unwinding. Do not recreate state for that stale claim.
    this.states.get(agentId)?.agentClaims.delete(claimId);
  }

  takeOver(agentId: number, now = Date.now()): BrowserControlState {
    const state = this.stateFor(agentId);
    this.expireIfNeeded(state, now);
    if (state.agentClaims.size > 0) {
      throw new BrowserControlError(
        "Ajan tarayici eylemi devam ediyor; devralma icin eylemin bitmesini bekleyip yeniden dene.",
        { key: "browserAgentBusy" },
      );
    }
    if (state.owner === "operator") {
      throw new BrowserControlError(
        "Tarayici baska bir operator lease'i tarafindan kontrol ediliyor.",
        { key: "browserOtherOperator" },
      );
    }
    state.owner = "operator";
    state.leaseId = randomUUID();
    state.leaseExpiresAtMs = now + this.leaseMs;
    return this.snapshot(agentId, now);
  }

  heartbeat(
    agentId: number,
    leaseId: string,
    now = Date.now(),
  ): BrowserControlState {
    const state = this.stateFor(agentId);
    this.expireIfNeeded(state, now);
    if (
      state.owner !== "operator" ||
      !state.leaseId ||
      state.leaseId !== leaseId
    ) {
      throw new BrowserControlError(
        "Tarayici kontrol lease'i gecersiz veya sona ermis.",
        { key: "browserLeaseInvalid" },
      );
    }
    state.leaseExpiresAtMs = now + this.leaseMs;
    return this.snapshot(agentId, now);
  }

  release(
    agentId: number,
    leaseId: string,
    now = Date.now(),
  ): BrowserControlState {
    const state = this.stateFor(agentId);
    this.expireIfNeeded(state, now);
    if (
      state.owner !== "operator" ||
      !state.leaseId ||
      state.leaseId !== leaseId
    ) {
      throw new BrowserControlError(
        "Yalnizca etkin kontrol lease'inin sahibi tarayiciyi ajana geri verebilir.",
        { key: "browserReleaseOwnerOnly" },
      );
    }
    if (state.operatorClaims.size > 0) {
      throw new BrowserControlError(
        "Operator tarayici eylemi devam ediyor; kontrol henuz birakilamaz.",
        { key: "browserOperatorBusy" },
      );
    }
    state.owner = "agent";
    state.leaseId = null;
    state.leaseExpiresAtMs = null;
    return this.snapshot(agentId, now);
  }

  assertOperator(agentId: number, leaseId: string, now = Date.now()): void {
    const state = this.stateFor(agentId);
    this.expireIfNeeded(state, now);
    if (
      state.owner !== "operator" ||
      !state.leaseId ||
      state.leaseId !== leaseId
    ) {
      throw new BrowserControlError(
        "Operator tarayici kontrolunu tam ve etkin leaseId ile devralmadan girdi gonderemez.",
        { key: "browserOperatorLeaseRequired" },
      );
    }
  }

  beginOperatorAction(
    agentId: number,
    leaseId: string,
    now = Date.now(),
  ): string {
    this.assertOperator(agentId, leaseId, now);
    const state = this.stateFor(agentId);
    const claimId = randomUUID();
    state.operatorClaims.add(claimId);
    state.leaseExpiresAtMs = now + this.leaseMs;
    return claimId;
  }

  endOperatorAction(agentId: number, claimId: string): void {
    // See endAgentAction: stale callbacks must not resurrect cleared leases.
    this.states.get(agentId)?.operatorClaims.delete(claimId);
  }

  hasActionsInFlight(agentId: number): boolean {
    const state = this.stateFor(agentId);
    return state.agentClaims.size > 0 || state.operatorClaims.size > 0;
  }

  assertClosable(agentId: number): void {
    if (this.hasActionsInFlight(agentId)) {
      throw new BrowserControlError(
        "Tarayici eylemi devam ederken oturum kapatilamaz; eylemin bitmesini bekle.",
        { key: "browserActionInFlight" },
      );
    }
  }

  assertCanClose(agentId: number, leaseId?: string, now = Date.now()): void {
    const state = this.stateFor(agentId);
    this.expireIfNeeded(state, now);
    // A caller presenting an old lease cannot downgrade itself to an
    // agent-owned close after expiry or release.
    if (leaseId) this.assertOperator(agentId, leaseId, now);
    if (
      state.owner === "operator" &&
      (!leaseId || !state.leaseId || state.leaseId !== leaseId)
    ) {
      throw new BrowserControlError(
        "Operator kontrolundeki tarayici yalnizca etkin exact leaseId ile kapatilabilir.",
        { key: "browserCloseOwnerOnly" },
      );
    }
    this.assertClosable(agentId);
  }

  clear(agentId: number): void {
    this.assertClosable(agentId);
    this.states.delete(agentId);
  }

  /**
   * Process-shutdown-only cleanup. Public/browser-route callers must use
   * assertCanClose + clear so ownership and in-flight safety stay enforced.
   */
  clearForSystemShutdown(agentId: number): void {
    this.states.delete(agentId);
  }
}
