import { BrowserDiagnosticError } from "./browser-diagnostics";
import { getToolCopy, toolMessage } from "../orchestrator/tool-localization";
import type { WorkspaceLocale } from "../workspace-locale";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  assertLocalExecutionEpoch,
  captureLocalExecutionEpoch,
} from "../orchestrator/local-emergency-epoch";
import path from "node:path";
import type {
  Browser,
  BrowserContext,
  ElementHandle,
  Page,
  Route,
} from "playwright-core";
import { writeBinaryFile } from "./sandbox";
import {
  BrowserActionQueue,
  BrowserControlError,
  BrowserControlRegistry,
  BrowserSessionCloseGate,
  type BrowserControlState,
} from "./browser-control";
import { assertSafeBrowserUrl } from "./browser-network-policy";
import {
  closeBrowserEgressProxy,
  getBrowserEgressProxyUrl,
} from "./browser-egress-proxy";
export { assertSafeBrowserUrl } from "./browser-network-policy";

/**
 * Per-agent real browser sessions ("computer use").
 *
 * Uses the locally installed Chrome/Edge via playwright-core (no browser
 * download). Agents interact through text-oriented tools (snapshot with
 * element refs, click/type/scroll by ref); the operator additionally gets
 * raw pixel control (screenshot + mouse/keyboard) from the UI.
 */

const VIEWPORT = { width: 1280, height: 800 };
const MAX_SNAPSHOT_CHARS = 9000;
const EXTRACTABLE =
  "a, button, input, textarea, select, [role='button'], [role='link'], [role='tab'], [role='menuitem'], [onclick], label[for]";
const WEBSOCKETS_ALLOWED =
  process.env.AGENT_BROWSER_ALLOW_WEBSOCKETS === "true";
const MAX_BROWSER_SESSIONS = Math.max(
  1,
  Math.floor(Number(process.env.MAX_BROWSER_SESSIONS) || 4),
);
const BROWSER_SESSION_IDLE_MS = Math.max(
  60_000,
  Math.floor(Number(process.env.BROWSER_SESSION_IDLE_MS) || 15 * 60_000),
);
const BROWSER_CONTROL_LEASE_MS = Math.min(
  5 * 60_000,
  Math.max(
    5_000,
    Math.floor(Number(process.env.BROWSER_CONTROL_LEASE_MS) || 30_000),
  ),
);

type BeforeEffectHook = () => Promise<void>;

/**
 * The browser effect was dispatched, but Playwright could not prove whether it
 * completed. Callers must not report a definite failure or retry the action.
 */
export class BrowserActionOutcomeUnknownError extends BrowserDiagnosticError {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("Tarayici eylemi gonderildi ancak sonucu dogrulanamadi.", {
      key: "browserActionUnknown",
    });
    this.name = "BrowserActionOutcomeUnknownError";
    this.cause = cause;
  }
}

export function isBrowserActionOutcomeUnknownError(
  error: unknown,
): error is BrowserActionOutcomeUnknownError {
  return error instanceof BrowserActionOutcomeUnknownError;
}

export async function runAtMostOnceBrowserEffect<T>(
  effect: () => Promise<T>,
): Promise<T> {
  try {
    return await effect();
  } catch (error) {
    if (isBrowserActionOutcomeUnknownError(error)) throw error;
    throw new BrowserActionOutcomeUnknownError(error);
  }
}

async function enforceSafeRoute(route: Route): Promise<void> {
  const url = route.request().url();
  if (
    url === "about:blank" ||
    url.startsWith("data:") ||
    url.startsWith("blob:")
  ) {
    await route.continue();
    return;
  }
  try {
    await assertSafeBrowserUrl(url);
    await route.continue();
  } catch {
    await route.abort("blockedbyclient");
  }
}

type BrowserChannel = "chrome" | "msedge" | "chromium";

function resolveChannel(): BrowserChannel {
  const forced = process.env.AGENT_BROWSER_CHANNEL as
    BrowserChannel | undefined;
  if (forced) return forced;
  if (
    process.platform === "win32" &&
    fs.existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
  ) {
    return "chrome";
  }
  return "chromium";
}

let runtimeVisible: boolean | null =
  process.env.AGENT_BROWSER_HEADLESS === "false" ? true : null;

export function setBrowserVisible(visible: boolean): void {
  runtimeVisible = visible;
}

export interface BrowserSessionIdentity {
  readonly sessionId: string;
  readonly sessionEpoch: number;
}

interface Session extends BrowserSessionIdentity {
  agentId: number;
  channel: BrowserChannel;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  createdAt: Date;
  visible: boolean;
}

const sessions = new Map<number, Promise<Session>>();
const sessionEpochs = new Map<number, number>();
const sessionLastUsedAt = new Map<number, number>();
const browserControls = new BrowserControlRegistry(BROWSER_CONTROL_LEASE_MS);
const sessionCloseGate = new BrowserSessionCloseGate();
const operatorActionQueue = new BrowserActionQueue(64);
type BrowserSessionAffinityPublisher = (event: {
  agentId: number;
  session: BrowserSessionIdentity | null;
}) => Promise<void>;
let browserSessionAffinityPublisher: BrowserSessionAffinityPublisher | null =
  null;
const publishedSessionAffinities = new Map<number, string>();

export function configureBrowserSessionAffinityPublisher(
  publisher: BrowserSessionAffinityPublisher | null,
): void {
  browserSessionAffinityPublisher = publisher;
  if (!publisher) publishedSessionAffinities.clear();
}

async function publishSessionAffinity(session: Session): Promise<void> {
  const marker = `${session.sessionId}:${session.sessionEpoch}`;
  if (publishedSessionAffinities.get(session.agentId) === marker) return;
  if (!browserSessionAffinityPublisher) return;
  await browserSessionAffinityPublisher({
    agentId: session.agentId,
    session: {
      sessionId: session.sessionId,
      sessionEpoch: session.sessionEpoch,
    },
  });
  publishedSessionAffinities.set(session.agentId, marker);
}

async function clearPublishedSessionAffinity(agentId: number): Promise<void> {
  publishedSessionAffinities.delete(agentId);
  await browserSessionAffinityPublisher?.({ agentId, session: null });
}

const idleSessionTimer = setInterval(
  () => {
    const cutoff = Date.now() - BROWSER_SESSION_IDLE_MS;
    for (const [agentId, lastUsedAt] of sessionLastUsedAt) {
      if (lastUsedAt < cutoff) void closeIdleSession(agentId);
    }
  },
  Math.min(60_000, BROWSER_SESSION_IDLE_MS),
);
idleSessionTimer.unref();

async function launchSession(agentId: number): Promise<Session> {
  const { chromium } = await import("playwright-core");
  const channel = resolveChannel();
  const executablePath = process.env.AGENT_BROWSER_EXECUTABLE_PATH?.trim();
  const headless = !(runtimeVisible ?? false);
  const proxyUrl = await getBrowserEgressProxyUrl();

  let browser: Browser;
  try {
    browser = await chromium.launch({
      channel: executablePath || channel === "chromium" ? undefined : channel,
      executablePath: executablePath || undefined,
      headless,
      chromiumSandbox: true,
      proxy: { server: proxyUrl },
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-quic",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--proxy-bypass-list=<-loopback>",
        "--no-first-run",
      ],
    });
  } catch (error) {
    throw new BrowserDiagnosticError(
      `Tarayici baslatilamadi (${channel}): ${error instanceof Error ? error.message : "bilinmeyen"}`,
      error instanceof Error
        ? {
            key: "browserLaunchFailed",
            params: { channel, message: error.message },
          }
        : { key: "browserLaunchUnavailable", params: { channel } },
      { cause: error },
    );
  }

  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      locale: "tr-TR",
      timezoneId: "Europe/Istanbul",
      deviceScaleFactor: 1,
      acceptDownloads: false,
      serviceWorkers: "block",
    });
    context.setDefaultTimeout(20_000);
    await context.route("**/*", enforceSafeRoute);
    await context.routeWebSocket("**/*", async (webSocketRoute) => {
      try {
        const parsed = new URL(webSocketRoute.url());
        if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
          throw new Error("Unsupported WebSocket scheme");
        }
        parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
        await assertSafeBrowserUrl(parsed.toString());
        if (!WEBSOCKETS_ALLOWED) {
          await webSocketRoute.close({
            code: 1008,
            reason: "WebSockets disabled by policy",
          });
          return;
        }
        webSocketRoute.connectToServer();
      } catch {
        await webSocketRoute.close({
          code: 1008,
          reason: "Blocked by network policy",
        });
      }
    });

    const page = await context.newPage();
    await page.goto("about:blank");
    const sessionEpoch = (sessionEpochs.get(agentId) ?? 0) + 1;
    sessionEpochs.set(agentId, sessionEpoch);
    return {
      sessionId: randomUUID(),
      sessionEpoch,
      agentId,
      channel,
      browser,
      context,
      page,
      createdAt: new Date(),
      visible: !headless,
    };
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
}

async function getOrCreate(agentId: number): Promise<Session> {
  sessionCloseGate.assertAvailable(agentId);
  let pending = sessions.get(agentId);
  const observed = pending;
  const needsSession = pending ? await settledBroken(pending) : true;
  sessionCloseGate.assertAvailable(agentId);
  if (needsSession) {
    // Another caller may have replaced a broken promise while this caller was
    // awaiting its health check. Re-enter instead of launching a second
    // browser and leaking the loser process.
    if (sessions.get(agentId) !== observed) return getOrCreate(agentId);
    if (pending && browserControls.hasActionsInFlight(agentId)) {
      throw new BrowserDiagnosticError(
        "Tarayici oturumu etkin eylem sirasinda koptu; eylem yeni oturumda otomatik tekrar edilmeyecek.",
        { key: "browserDisconnected" },
      );
    }
    if (!pending && sessions.size >= MAX_BROWSER_SESSIONS) {
      throw new BrowserDiagnosticError(
        `Tarayici oturum siniri dolu (${MAX_BROWSER_SESSIONS}). Bosta kalan oturumlar otomatik kapanir.`,
        { key: "browserSessionLimit", params: { limit: MAX_BROWSER_SESSIONS } },
      );
    }
    // A browser process restart is a hard control boundary: a stale operator
    // lease from the old process must never govern a new browser instance.
    browserControls.clear(agentId);
    const stale = pending;
    pending = (async () => {
      if (stale) {
        await stale
          .then((session) => session.browser.close().catch(() => undefined))
          .catch(() => undefined);
      }
      return launchSession(agentId);
    })().catch((error) => {
      sessions.delete(agentId);
      sessionLastUsedAt.delete(agentId);
      throw error;
    });
    sessions.set(agentId, pending);
  }
  sessionLastUsedAt.set(agentId, Date.now());
  if (!pending)
    throw new BrowserDiagnosticError("Tarayici oturumu olusturulamadi.", {
      key: "browserSessionMissing",
    });
  const session = await pending;
  try {
    await publishSessionAffinity(session);
  } catch (error) {
    if (sessions.get(agentId) === pending) sessions.delete(agentId);
    sessionLastUsedAt.delete(agentId);
    await session.browser.close().catch(() => undefined);
    throw new BrowserDiagnosticError(
      "Tarayici oturumu runtime sahibine guvenle baglanamadi; oturum kapatildi.",
      { key: "browserAffinityFailure" },
      { cause: error },
    );
  }
  sessionCloseGate.assertAvailable(agentId);
  return session;
}

async function settledBroken(pending: Promise<Session>): Promise<boolean> {
  try {
    const s = await pending;
    if (!s.browser.isConnected()) return true;
    return s.page.isClosed();
  } catch {
    return true;
  }
}

interface ExistingSession {
  pending: Promise<Session>;
  session: Session;
}

async function getExistingSession(
  agentId: number,
): Promise<ExistingSession | null> {
  const pending = sessions.get(agentId);
  if (!pending) return null;
  try {
    const session = await pending;
    if (
      sessions.get(agentId) !== pending ||
      !session.browser.isConnected() ||
      session.page.isClosed()
    ) {
      return null;
    }
    return { pending, session };
  } catch {
    return null;
  }
}

export async function closeSession(
  agentId: number,
  operatorLeaseId?: string,
  expectedSession?: BrowserSessionIdentity,
  beforeEffect?: BeforeEffectHook,
): Promise<boolean> {
  const pending = sessions.get(agentId);
  if (!pending) return false;
  const closeToken = sessionCloseGate.begin(agentId);
  try {
    browserControls.assertCanClose(agentId, operatorLeaseId);
    if (expectedSession) {
      const session = await pending;
      if (
        sessions.get(agentId) !== pending ||
        session.sessionId !== expectedSession.sessionId ||
        session.sessionEpoch !== expectedSession.sessionEpoch ||
        !session.browser.isConnected() ||
        session.page.isClosed()
      ) {
        throw new BrowserControlError(
          "Tarayici oturumu kapandi veya degisti; komut uygulanmadi.",
          { key: "browserSessionChanged" },
        );
      }
    }
    await beforeEffect?.();
    browserControls.assertCanClose(agentId, operatorLeaseId);
    if (sessions.get(agentId) !== pending)
      throw new BrowserControlError("Browser session changed before close.", {
        key: "browserSessionChanged",
      });
    sessions.delete(agentId);
    sessionLastUsedAt.delete(agentId);
    await clearPublishedSessionAffinity(agentId).catch(() => undefined);
    browserControls.clear(agentId);
    const registry = registries.get(agentId);
    registries.delete(agentId);
    await registry?.clear();
    try {
      const s = await pending;
      await s.browser.close().catch(() => undefined);
    } catch {
      /* never started */
    }
    return true;
  } finally {
    sessionCloseGate.finish(agentId, closeToken);
  }
}

async function closeIdleSession(agentId: number): Promise<boolean> {
  const pending = sessions.get(agentId);
  if (!pending) return false;
  const closeToken = sessionCloseGate.tryBegin(agentId);
  if (!closeToken) return false;
  try {
    const control = browserControls.snapshot(agentId);
    if (
      control.owner === "operator" ||
      browserControls.hasActionsInFlight(agentId)
    ) {
      return false;
    }
    sessions.delete(agentId);
    sessionLastUsedAt.delete(agentId);
    await clearPublishedSessionAffinity(agentId).catch(() => undefined);
    browserControls.clear(agentId);
    const registry = registries.get(agentId);
    registries.delete(agentId);
    await registry?.clear();
    try {
      const session = await pending;
      await session.browser.close().catch(() => undefined);
    } catch {
      /* never started */
    }
    return true;
  } finally {
    sessionCloseGate.finish(agentId, closeToken);
  }
}

export async function runWithAgentBrowserControl<T>(
  agentId: number,
  operation: (executionEpoch: number) => Promise<T>,
): Promise<T> {
  const executionEpoch = captureLocalExecutionEpoch();
  await getOrCreate(agentId);
  assertLocalExecutionEpoch(executionEpoch);
  sessionCloseGate.assertAvailable(agentId);
  const claimId = browserControls.beginAgentAction(agentId);
  try {
    assertLocalExecutionEpoch(executionEpoch);
    return await operation(executionEpoch);
  } finally {
    browserControls.endAgentAction(agentId, claimId);
  }
}

async function runWithExistingAgentBrowserControl<T>(
  agentId: number,
  expectedSession: BrowserSessionIdentity,
  operation: (session: Session, executionEpoch: number) => Promise<T>,
): Promise<T> {
  const executionEpoch = captureLocalExecutionEpoch();
  const existing = await getExistingSession(agentId);
  if (!existing) {
    throw new BrowserControlError(
      "Onayli tarayici oturumu artik yok veya kapandi; yeni onay gerekli.",
      { key: "browserApprovedSessionChanged" },
    );
  }

  sessionCloseGate.assertAvailable(agentId);
  const claimId = browserControls.beginAgentAction(agentId);
  try {
    assertLocalExecutionEpoch(executionEpoch);
    if (
      sessions.get(agentId) !== existing.pending ||
      !existing.session.browser.isConnected() ||
      existing.session.page.isClosed() ||
      existing.session.sessionId !== expectedSession.sessionId ||
      existing.session.sessionEpoch !== expectedSession.sessionEpoch
    ) {
      throw new BrowserControlError(
        "Onayli tarayici oturumu kapandi veya degisti; yeni onay gerekli.",
        { key: "browserApprovedSessionChanged" },
      );
    }
    sessionLastUsedAt.set(agentId, Date.now());
    return await operation(existing.session, executionEpoch);
  } finally {
    browserControls.endAgentAction(agentId, claimId);
  }
}

export async function getBrowserControlState(
  agentId: number,
): Promise<BrowserControlState> {
  return browserControls.publicSnapshot(agentId);
}

export async function takeOverBrowserControl(
  agentId: number,
  expectedSession?: BrowserSessionIdentity,
  beforeEffect?: BeforeEffectHook,
): Promise<BrowserControlState> {
  const executionEpoch = captureLocalExecutionEpoch();
  await beforeEffect?.();
  assertLocalExecutionEpoch(executionEpoch);
  if (expectedSession) {
    await assertExistingBrowserSessionIdentity(agentId, expectedSession);
  } else {
    await getOrCreate(agentId);
  }
  const identity = await getExistingBrowserSessionIdentity(agentId);
  if (!identity)
    throw new BrowserControlError("Browser session is unavailable.", {
      key: "browserSessionMissing",
    });
  await beforeEffect?.();
  await assertExistingBrowserSessionIdentity(agentId, identity);
  sessionCloseGate.assertAvailable(agentId);
  assertLocalExecutionEpoch(executionEpoch);
  return browserControls.takeOver(agentId);
}

export async function heartbeatBrowserControl(
  agentId: number,
  leaseId: string,
): Promise<BrowserControlState> {
  return browserControls.heartbeat(agentId, leaseId);
}

export async function releaseBrowserControl(
  agentId: number,
  leaseId: string,
  beforeEffect?: BeforeEffectHook,
): Promise<BrowserControlState> {
  browserControls.assertOperator(agentId, leaseId);
  await beforeEffect?.();
  return browserControls.release(agentId, leaseId);
}

export async function runWithOperatorBrowserControl<T>(
  agentId: number,
  leaseId: string,
  operation: () => Promise<T>,
): Promise<T> {
  return runWithExistingOperatorBrowserControl(
    agentId,
    leaseId,
    undefined,
    operation,
  );
}

async function runWithExistingOperatorBrowserControl<T>(
  agentId: number,
  leaseId: string,
  expectedSession: BrowserSessionIdentity | undefined,
  operation: (session: Session, executionEpoch: number) => Promise<T>,
): Promise<T> {
  const executionEpoch = captureLocalExecutionEpoch();
  sessionCloseGate.assertAvailable(agentId);
  return operatorActionQueue.enqueue(agentId, async () => {
    assertLocalExecutionEpoch(executionEpoch);
    sessionCloseGate.assertAvailable(agentId);
    const claimId = browserControls.beginOperatorAction(agentId, leaseId);
    try {
      const existing = await getExistingSession(agentId);
      if (
        !existing ||
        sessions.get(agentId) !== existing.pending ||
        !existing.session.browser.isConnected() ||
        existing.session.page.isClosed() ||
        (expectedSession &&
          (existing.session.sessionId !== expectedSession.sessionId ||
            existing.session.sessionEpoch !== expectedSession.sessionEpoch))
      ) {
        throw new BrowserControlError(
          "Tarayici oturumu kapandi veya degisti; komut uygulanmadi.",
          { key: "browserSessionChanged" },
        );
      }
      assertLocalExecutionEpoch(executionEpoch);
      sessionLastUsedAt.set(agentId, Date.now());
      return await operation(existing.session, executionEpoch);
    } finally {
      browserControls.endOperatorAction(agentId, claimId);
    }
  });
}

export async function closeAllSessions(): Promise<void> {
  const entries = [...sessions.entries()];
  // Shutdown is a terminal boundary: block every future getOrCreate before
  // interrupting any in-flight page operation. Unlike the public route, this
  // privileged path intentionally ignores an operator lease.
  sessionCloseGate.beginShutdown(entries.map(([agentId]) => agentId));
  await Promise.all(
    entries.map(async ([agentId, pending]) => {
      sessions.delete(agentId);
      sessionLastUsedAt.delete(agentId);
      await clearPublishedSessionAffinity(agentId).catch(() => undefined);
      const registry = registries.get(agentId);
      registries.delete(agentId);
      await registry?.clear();
      try {
        const session = await pending;
        await session.browser.close().catch(() => undefined);
      } catch {
        /* never started */
      } finally {
        browserControls.clearForSystemShutdown(agentId);
      }
    }),
  );
  await closeBrowserEgressProxy();
}

/**
 * Interrupts all current browser work for an emergency stop without making
 * the process-level shutdown gate permanent. New session creation is blocked
 * atomically for the duration of cleanup; after cleanup, the persisted
 * emergency-stop gate remains responsible for blocking autonomous callers.
 */
export async function closeAllAgentSessionsForEmergencyStop(): Promise<void> {
  const entries = [...sessions.entries()];
  const pauseToken = sessionCloseGate.beginPause(
    entries.map(([agentId]) => agentId),
  );
  try {
    await Promise.all(
      entries.map(async ([agentId, pending]) => {
        sessions.delete(agentId);
        sessionLastUsedAt.delete(agentId);
        await clearPublishedSessionAffinity(agentId).catch(() => undefined);
        const registry = registries.get(agentId);
        registries.delete(agentId);
        await registry?.clear();
        try {
          const session = await pending;
          await session.browser.close().catch(() => undefined);
        } catch {
          /* never started */
        } finally {
          browserControls.clearForSystemShutdown(agentId);
        }
      }),
    );
    await closeBrowserEgressProxy();
  } finally {
    sessionCloseGate.finishPause(pauseToken);
  }
}

// ---------------------------------------------------------------------------
// Text snapshot (agent-facing accessibility-ish view)
// ---------------------------------------------------------------------------

interface RefEntry {
  ref: number;
  marker: string;
  handle: ElementHandle;
  tag: string;
  role: string;
  text: string;
  value?: string;
  href?: string;
  hasOnClick?: boolean;
  inputType?: string;
  name?: string;
  formAction?: string;
  formMethod?: string;
}

async function collectRefs(page: Page): Promise<RefEntry[]> {
  const handles = await page.$$(EXTRACTABLE);
  await Promise.all(
    handles.slice(220).map((handle) => handle.dispose().catch(() => undefined)),
  );
  const refs: RefEntry[] = [];
  let refCounter = 1;
  const snapshotId = randomUUID();

  for (const handle of handles.slice(0, 220)) {
    const marker = `${snapshotId}-${refCounter}`;
    const info = await handle.evaluate((el) => {
      // NOTE: no DOM globals here -- this callback type-checks in Node
      // context. Only element members are used.
      const rect = el.getBoundingClientRect();
      if (!rect || rect.width < 2 || rect.height < 2) return null;
      const tag = el.tagName.toLowerCase();
      const ariaLabel = el.getAttribute("aria-label") ?? "";
      const roleAttr = el.getAttribute("role");

      let role = roleAttr ?? tag;
      if (tag === "input") {
        const type = (el.getAttribute("type") ?? "text").toLowerCase();
        role = type === "checkbox" || type === "radio" ? type : "textbox";
      } else if (tag === "textarea") {
        role = "textarea";
      } else if (tag === "select") {
        role = "select";
      } else if (tag === "a") {
        role = roleAttr ?? "link";
      } else if (tag === "button") {
        role = roleAttr ?? "button";
      }

      const text =
        ariaLabel.replace(/\s+/g, " ").trim().slice(0, 80) ||
        (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80) ||
        (el.getAttribute("title") ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80) ||
        (el.getAttribute("placeholder") ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80);

      const inputType = (el.getAttribute("type") ?? "text").toLowerCase();
      const autocomplete = (
        el.getAttribute("autocomplete") ?? ""
      ).toLowerCase();
      const sensitiveValue =
        inputType === "password" ||
        [
          "current-password",
          "new-password",
          "one-time-code",
          "cc-number",
          "cc-csc",
        ].includes(autocomplete);
      const hasValue =
        tag === "input" || tag === "textarea"
          ? Object.prototype.hasOwnProperty.call(el, "value") || "value" in el
          : false;

      const form =
        (
          el as unknown as {
            form?: {
              action?: string;
              getAttribute(name: string): string | null;
            } | null;
          }
        ).form ?? null;
      return {
        tag,
        role,
        text,
        href:
          tag === "a"
            ? String(
                (el as unknown as { href?: string }).href ??
                  el.getAttribute("href") ??
                  "",
              ) || undefined
            : undefined,
        hasOnClick: el.hasAttribute("onclick"),
        inputType: tag === "input" ? inputType : undefined,
        name: el.getAttribute("name") ?? undefined,
        formAction: form
          ? String(form.action ?? form.getAttribute("action") ?? "") ||
            undefined
          : undefined,
        formMethod: form?.getAttribute("method")?.toLowerCase() ?? undefined,
        value: sensitiveValue
          ? "[REDACTED]"
          : hasValue
            ? String((el as unknown as { value?: string }).value ?? "").slice(
                0,
                60,
              )
            : undefined,
      };
    });

    if (!info) {
      await handle.dispose().catch(() => undefined);
      continue;
    }
    refs.push({ ref: refCounter++, marker, handle, ...info });
  }

  return refs;
}

class RefRegistry {
  private map = new Map<number, RefEntry>();

  async set(entries: RefEntry[]): Promise<void> {
    const previous = [...this.map.values()];
    this.map.clear();
    for (const e of entries) this.map.set(e.ref, e);
    await Promise.all(
      previous.map((entry) => entry.handle.dispose().catch(() => undefined)),
    );
  }

  get(ref: number): RefEntry | undefined {
    return this.map.get(ref);
  }

  async clear(): Promise<void> {
    const previous = [...this.map.values()];
    this.map.clear();
    await Promise.all(
      previous.map((entry) => entry.handle.dispose().catch(() => undefined)),
    );
  }

  nth(indexFromEnd: number): RefEntry | undefined {
    const list = [...this.map.values()];
    return list[list.length - 1 - indexFromEnd];
  }
}

const registries = new Map<number, RefRegistry>();

function registryFor(agentId: number): RefRegistry {
  let r = registries.get(agentId);
  if (!r) {
    r = new RefRegistry();
    registries.set(agentId, r);
  }
  return r;
}

export function getBrowserRefInfo(
  agentId: number,
  ref: number,
): Pick<RefEntry, "tag" | "role" | "text" | "href" | "hasOnClick"> | null {
  const entry = registryFor(agentId).get(ref);
  if (!entry) return null;
  return {
    tag: entry.tag,
    role: entry.role,
    text: entry.text,
    href: entry.href,
    hasOnClick: entry.hasOnClick,
  };
}

export interface BrowserActionBinding extends BrowserSessionIdentity {
  snapshotMarker: string;
  pageUrl: string;
  tag: string;
  role: string;
  text: string;
  context: string | null;
  href: string | null;
  hasOnClick: boolean;
  inputType: string | null;
  autocomplete: string | null;
  sensitive: boolean;
  name: string | null;
  formAction: string | null;
  formMethod: string | null;
}

async function bindingForHandle(
  session: Pick<Session, "page" | "sessionId" | "sessionEpoch">,
  handle: ElementHandle,
  snapshotMarker: string,
): Promise<BrowserActionBinding> {
  const element = await handle.evaluate((el) => {
    const tag = el.tagName.toLowerCase();
    const explicitRole = el.getAttribute("role");
    const inputType = (el.getAttribute("type") ?? "text").toLowerCase();
    const role =
      explicitRole ??
      (tag === "a"
        ? "link"
        : tag === "button"
          ? "button"
          : tag === "textarea"
            ? "textarea"
            : tag === "select"
              ? "select"
              : tag === "input"
                ? inputType === "checkbox" || inputType === "radio"
                  ? inputType
                  : "textbox"
                : tag);
    const text =
      (el.getAttribute("aria-label") ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80) ||
      (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80) ||
      (el.getAttribute("title") ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80) ||
      (el.getAttribute("placeholder") ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
    const contextElement = el.parentElement?.closest(
      'tr, [role="row"], li, article, form, [data-testid], [aria-label]',
    );
    const contextLabel = contextElement
      ? [
          contextElement.getAttribute("data-testid"),
          contextElement.getAttribute("aria-label"),
          contextElement.id,
          contextElement === el ? null : contextElement.textContent,
        ]
          .filter(Boolean)
          .join(" · ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 240)
      : "";
    const form =
      (
        el as unknown as {
          form?: {
            action?: string;
            getAttribute(name: string): string | null;
          } | null;
        }
      ).form ?? null;
    const autocomplete = (el.getAttribute("autocomplete") ?? "").toLowerCase();
    const sensitive =
      inputType === "password" ||
      [
        "current-password",
        "new-password",
        "one-time-code",
        "cc-number",
        "cc-csc",
      ].includes(autocomplete);
    return {
      tag,
      role,
      text,
      context: contextLabel || null,
      href:
        tag === "a"
          ? String(
              (el as unknown as { href?: string }).href ??
                el.getAttribute("href") ??
                "",
            ) || null
          : null,
      hasOnClick: el.hasAttribute("onclick"),
      inputType: tag === "input" ? inputType : null,
      autocomplete: autocomplete || null,
      sensitive,
      name: el.getAttribute("name"),
      formAction: form
        ? String(form.action ?? form.getAttribute("action") ?? "") || null
        : null,
      formMethod: form?.getAttribute("method")?.toLowerCase() ?? null,
    };
  });
  return {
    sessionId: session.sessionId,
    sessionEpoch: session.sessionEpoch,
    snapshotMarker,
    pageUrl: session.page.url(),
    ...element,
  };
}

export async function getExistingBrowserSessionIdentity(
  agentId: number,
): Promise<BrowserSessionIdentity | null> {
  const existing = await getExistingSession(agentId);
  if (!existing) return null;
  return {
    sessionId: existing.session.sessionId,
    sessionEpoch: existing.session.sessionEpoch,
  };
}

export async function assertExistingBrowserSessionIdentity(
  agentId: number,
  expectedSession: BrowserSessionIdentity,
): Promise<void> {
  const existing = await getExistingSession(agentId);
  if (
    !existing ||
    existing.session.sessionId !== expectedSession.sessionId ||
    existing.session.sessionEpoch !== expectedSession.sessionEpoch
  ) {
    throw new BrowserControlError(
      "Tarayici oturumu kapandi veya degisti; komut uygulanmadi.",
      { key: "browserSessionChanged" },
    );
  }
}

export async function listExistingBrowserSessions(): Promise<
  Array<{ agentId: number } & BrowserSessionIdentity>
> {
  const result: Array<{ agentId: number } & BrowserSessionIdentity> = [];
  for (const agentId of sessions.keys()) {
    const identity = await getExistingBrowserSessionIdentity(agentId);
    if (identity) result.push({ agentId, ...identity });
  }
  return result;
}

export async function getExistingBrowserActionBinding(
  agentId: number,
  ref: number,
): Promise<BrowserActionBinding | null> {
  const existing = await getExistingSession(agentId);
  if (!existing) return null;
  const entry = registries.get(agentId)?.get(ref);
  if (!entry) return null;
  const handle = await findHandleByRef(entry);
  if (!handle) return null;
  try {
    const binding = await bindingForHandle(
      existing.session,
      handle,
      entry.marker,
    );
    if (
      sessions.get(agentId) !== existing.pending ||
      binding.snapshotMarker !== entry.marker
    ) {
      return null;
    }
    return binding;
  } catch {
    return null;
  }
}

export async function getBrowserActionBinding(
  agentId: number,
  ref: number,
): Promise<BrowserActionBinding> {
  const session = await getOrCreate(agentId);
  const entry = registryFor(agentId).get(ref);
  if (!entry)
    throw new BrowserDiagnosticError(
      `ref=${ref} bulunamadi. Once browser_snapshot al.`,
      { key: "browserRefMissing", params: { ref } },
    );
  const handle = await findHandleByRef(entry);
  if (!handle)
    throw new BrowserDiagnosticError(`ref=${ref} artik sayfada gorunmuyor.`, {
      key: "browserRefDetached",
      params: { ref },
    });
  const binding = await bindingForHandle(session, handle, entry.marker);
  if (binding.snapshotMarker !== entry.marker) {
    throw new BrowserDiagnosticError(
      `ref=${ref} eski bir snapshot'a ait. Yeni snapshot al.`,
      { key: "browserRefStale", params: { ref } },
    );
  }
  return binding;
}

export interface BrowserSnapshotResult {
  url: string;
  title: string;
  lines: string[];
  charCount: number;
}

export async function snapshotPage(
  agentId: number,
  locale: WorkspaceLocale = "tr",
): Promise<BrowserSnapshotResult> {
  getToolCopy(locale);
  const session = await getOrCreate(agentId);
  return snapshotSessionPage(agentId, session, locale);
}

async function snapshotSessionPage(
  agentId: number,
  session: Session,
  locale: WorkspaceLocale = "tr",
): Promise<BrowserSnapshotResult> {
  const copy = getToolCopy(locale);
  const page = session.page;

  const [refs, bodyText, title, url] = await Promise.all([
    collectRefs(page),
    page.innerText("body").catch(() => ""),
    page.title().catch(() => ""),
    page.url(),
  ]);

  await registryFor(agentId).set(refs);

  const lines: string[] = [
    toolMessage(locale, "browserPage", {
      title: title || copy.browserUntitled,
      url,
    }),
    "",
    copy.browserReferences,
  ];
  for (const r of refs) {
    const label = r.value
      ? toolMessage(locale, "browserValue", { text: r.text, value: r.value })
      : r.text;
    lines.push(`  [ref=${r.ref}] ${r.role} "${label}"`);
  }
  lines.push("", copy.browserVisibleText);
  lines.push(bodyText.slice(0, MAX_SNAPSHOT_CHARS));

  return {
    url,
    title,
    lines,
    charCount: bodyText.length,
  };
}

// ---------------------------------------------------------------------------
// Agent-facing actions
// ---------------------------------------------------------------------------

export async function navigateTo(
  agentId: number,
  url: string,
  actor: "agent" | "operator" = "agent",
  operatorLeaseId?: string,
  beforeEffect?: BeforeEffectHook,
  expectedSession?: BrowserSessionIdentity,
): Promise<string> {
  const operation = async (
    executionEpoch?: number,
    existingSession?: Session,
  ): Promise<string> => {
    const session = existingSession ?? (await getOrCreate(agentId));
    const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    await assertSafeBrowserUrl(target);
    if (executionEpoch !== undefined) assertLocalExecutionEpoch(executionEpoch);
    await beforeEffect?.();
    if (executionEpoch !== undefined) assertLocalExecutionEpoch(executionEpoch);
    return runAtMostOnceBrowserEffect(async () => {
      await session.page.goto(target, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      if (executionEpoch !== undefined)
        assertLocalExecutionEpoch(executionEpoch);
      await snapshotSessionPage(agentId, session);
      return session.page.url();
    });
  };

  if (actor === "operator") {
    if (!operatorLeaseId) {
      throw new BrowserDiagnosticError(
        "Operator navigasyonu icin leaseId zorunludur.",
        { key: "browserOperatorLeaseRequired" },
      );
    }
    return runWithExistingOperatorBrowserControl(
      agentId,
      operatorLeaseId,
      expectedSession,
      (session, executionEpoch) => operation(executionEpoch, session),
    );
  }
  if (expectedSession) {
    return runWithExistingAgentBrowserControl(
      agentId,
      expectedSession,
      async (session, executionEpoch) => operation(executionEpoch, session),
    );
  }
  return runWithAgentBrowserControl(agentId, operation);
}

export async function clickRef(
  agentId: number,
  ref: number,
  expectedBinding?: BrowserActionBinding,
  beforeEffect?: BeforeEffectHook,
): Promise<void> {
  const operation = async (
    session: Session,
    executionEpoch: number,
  ): Promise<void> => {
    const entry = expectedBinding
      ? registries.get(agentId)?.get(ref)
      : registryFor(agentId).get(ref);
    if (!entry)
      throw new BrowserDiagnosticError(
        `ref=${ref} bulunamadi. Once browser_snapshot al.`,
        { key: "browserRefMissing", params: { ref } },
      );

    const handle = await findHandleByRef(entry);
    if (!handle)
      throw new BrowserDiagnosticError(`ref=${ref} artik sayfada gorunmuyor.`, {
        key: "browserRefDetached",
        params: { ref },
      });
    if (expectedBinding) {
      const liveBinding = await bindingForHandle(session, handle, entry.marker);
      if (JSON.stringify(liveBinding) !== JSON.stringify(expectedBinding)) {
        throw new BrowserDiagnosticError(
          "Sayfa veya hedef oge onaydan sonra degisti; yeni onay gerekli.",
          { key: "browserApprovedElementChanged" },
        );
      }
    }
    assertLocalExecutionEpoch(executionEpoch);
    await beforeEffect?.();
    assertLocalExecutionEpoch(executionEpoch);
    // Never retry or synthesize a click after an ambiguous timeout. The first
    // click may already have committed an external effect; at-most-once safety
    // is more important than bypassing Playwright actionability checks.
    await runAtMostOnceBrowserEffect(() => handle.click({ timeout: 10_000 }));
    await session.page
      .waitForLoadState("domcontentloaded", { timeout: 15_000 })
      .catch(() => undefined);
  };
  if (expectedBinding) {
    return runWithExistingAgentBrowserControl(
      agentId,
      expectedBinding,
      operation,
    );
  }
  return runWithAgentBrowserControl(agentId, async (executionEpoch) =>
    operation(await getOrCreate(agentId), executionEpoch),
  );
}

export async function fillRef(
  agentId: number,
  ref: number,
  text: string,
  expectedBinding?: BrowserActionBinding,
  beforeEffect?: BeforeEffectHook,
): Promise<void> {
  const operation = async (
    session: Session,
    executionEpoch: number,
  ): Promise<void> => {
    const entry = expectedBinding
      ? registries.get(agentId)?.get(ref)
      : registryFor(agentId).get(ref);
    if (!entry)
      throw new BrowserDiagnosticError(`ref=${ref} bulunamadi.`, {
        key: "browserRefMissing",
        params: { ref },
      });

    const handle = await findHandleByRef(entry);
    if (!handle)
      throw new BrowserDiagnosticError(`ref=${ref} artik sayfada gorunmuyor.`, {
        key: "browserRefDetached",
        params: { ref },
      });
    if (expectedBinding) {
      const liveBinding = await bindingForHandle(session, handle, entry.marker);
      if (JSON.stringify(liveBinding) !== JSON.stringify(expectedBinding)) {
        throw new BrowserDiagnosticError(
          "Sayfa veya hedef alan onaydan sonra degisti; yeni onay gerekli.",
          { key: "browserApprovedFieldChanged" },
        );
      }
    }
    assertLocalExecutionEpoch(executionEpoch);
    await beforeEffect?.();
    assertLocalExecutionEpoch(executionEpoch);
    await runAtMostOnceBrowserEffect(() =>
      handle.fill(text, { timeout: 10_000 }),
    );
  };
  if (expectedBinding) {
    return runWithExistingAgentBrowserControl(
      agentId,
      expectedBinding,
      operation,
    );
  }
  return runWithAgentBrowserControl(agentId, async (executionEpoch) =>
    operation(await getOrCreate(agentId), executionEpoch),
  );
}

export async function scrollPage(
  agentId: number,
  direction: "up" | "down",
  beforeEffect?: BeforeEffectHook,
): Promise<void> {
  const operation = async (executionEpoch: number): Promise<void> => {
    const session = await getOrCreate(agentId);
    assertLocalExecutionEpoch(executionEpoch);
    await beforeEffect?.();
    assertLocalExecutionEpoch(executionEpoch);
    await session.page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
    await session.page.mouse.wheel(0, direction === "down" ? 720 : -720);
    await session.page.waitForTimeout(250);
  };
  return runWithAgentBrowserControl(agentId, operation);
}

export async function waitForPage(
  agentId: number,
  milliseconds: number,
): Promise<void> {
  const boundedMs = Math.min(5_000, Math.max(250, Math.floor(milliseconds)));
  const operation = async (): Promise<void> => {
    const session = await getOrCreate(agentId);
    await session.page.waitForTimeout(boundedMs);
  };
  return runWithAgentBrowserControl(agentId, operation);
}

export async function extractText(agentId: number): Promise<string> {
  const session = await getOrCreate(agentId);
  return (await session.page.innerText("body").catch(() => "")).slice(
    0,
    MAX_SNAPSHOT_CHARS,
  );
}

async function findHandleByRef(entry: RefEntry): Promise<ElementHandle | null> {
  // Keep the exact Playwright object captured at snapshot time. A DOM
  // attribute is page-controlled and can be copied by a hostile MutationObserver;
  // an ElementHandle identity cannot silently retarget to a sibling node.
  try {
    const connected = await entry.handle.evaluate((el) => el.isConnected);
    return connected ? entry.handle : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Operator-facing pixel control
// ---------------------------------------------------------------------------

export interface BrowserView {
  available: boolean;
  pngBase64?: string | null;
  url?: string | null;
  title?: string | null;
  visible: boolean;
  control: BrowserControlState;
  width: number;
  height: number;
  note?: string | null;
}

export interface BrowserSessionState {
  active: boolean;
  channel: BrowserChannel | null;
  visible: boolean;
  url: string | null;
  title: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  control: BrowserControlState;
}

export async function inspectBrowserSession(
  agentId: number,
): Promise<BrowserSessionState> {
  const control = browserControls.publicSnapshot(agentId);
  const pending = sessions.get(agentId);
  if (!pending) {
    return {
      active: false,
      channel: null,
      visible: false,
      url: null,
      title: null,
      createdAt: null,
      lastUsedAt: null,
      control,
    };
  }
  try {
    const session = await pending;
    const active = session.browser.isConnected() && !session.page.isClosed();
    return {
      active,
      channel: session.channel,
      visible: session.visible,
      url: active ? session.page.url() : null,
      title: active
        ? (await session.page.title().catch(() => "")) || null
        : null,
      createdAt: session.createdAt.toISOString(),
      lastUsedAt: sessionLastUsedAt.has(agentId)
        ? new Date(sessionLastUsedAt.get(agentId)!).toISOString()
        : null,
      control,
    };
  } catch {
    return {
      active: false,
      channel: null,
      visible: false,
      url: null,
      title: null,
      createdAt: null,
      lastUsedAt: null,
      control,
    };
  }
}

export async function captureView(
  agentId: number,
  expectedSession?: BrowserSessionIdentity,
): Promise<BrowserView> {
  const fixedExisting = await getExistingSession(agentId);
  if (
    expectedSession &&
    (!fixedExisting ||
      fixedExisting.session.sessionId !== expectedSession.sessionId ||
      fixedExisting.session.sessionEpoch !== expectedSession.sessionEpoch)
  ) {
    throw new BrowserControlError(
      "Tarayici oturumu kapandi veya degisti; komut uygulanmadi.",
      { key: "browserSessionChanged" },
    );
  }
  if (!fixedExisting) {
    const control = browserControls.publicSnapshot(agentId);
    return {
      available: false,
      pngBase64: null,
      url: null,
      title: null,
      visible: false,
      control,
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      note: "Oturum yok - adres cubuguna bir URL yaz. Kontrol: agent.",
    };
  }
  const session = fixedExisting.session;
  const png = await session.page.screenshot({ type: "png" });
  const control = browserControls.publicSnapshot(agentId);
  return {
    available: true,
    pngBase64: png.toString("base64"),
    url: session.page.url(),
    title: (await session.page.title().catch(() => "")) || null,
    visible: session.visible,
    control,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    note:
      control.owner === "operator"
        ? `Kontrol: operator · lease ${control.leaseExpiresAt ?? "bilinmiyor"} tarihinde biter.`
        : control.agentActionInFlight
          ? "Kontrol: agent · eylem devam ediyor."
          : "Kontrol: agent · operator devralabilir.",
  };
}

/** Ensures a session exists before raw input arrives. */
export async function ensureSession(agentId: number): Promise<void> {
  await getOrCreate(agentId);
}

export interface RawInputPayload {
  action:
    "click" | "dblclick" | "move" | "wheel" | "keydown" | "type_text" | "drag";
  x?: number;
  y?: number;
  deltaX?: number;
  deltaY?: number;
  key?: string;
  text?: string;
  toX?: number;
  toY?: number;
}

export async function sendRawInput(
  agentId: number,
  payload: RawInputPayload,
  leaseId: string,
  expectedSession?: BrowserSessionIdentity,
  beforeEffect?: BeforeEffectHook,
): Promise<void> {
  if (
    payload.action === "type_text" &&
    (typeof payload.text !== "string" ||
      !payload.text.length ||
      payload.text.length > 4096 ||
      payload.text.includes("\0") ||
      Buffer.from(payload.text, "utf8").toString("utf8") !== payload.text)
  ) {
    throw new BrowserControlError(
      "Tarayıcı metni boş olmamalı, geçerli Unicode içermeli ve NUL içermemelidir; sınır 4096 UTF-16 kod birimidir.",
      { key: "browserInputTextInvalid" },
    );
  }
  const operation = async (
    session: Session,
    executionEpoch: number,
  ): Promise<void> => {
    const page = session.page;
    await beforeEffect?.();
    assertLocalExecutionEpoch(executionEpoch);
    await runAtMostOnceBrowserEffect(async () => {
      switch (payload.action) {
        case "click":
          await page.mouse.click(payload.x ?? 0, payload.y ?? 0, { delay: 40 });
          break;
        case "dblclick":
          await page.mouse.dblclick(payload.x ?? 0, payload.y ?? 0);
          break;
        case "move":
          await page.mouse.move(payload.x ?? 0, payload.y ?? 0, { steps: 6 });
          break;
        case "wheel":
          await page.mouse.wheel(
            Math.max(-10_000, Math.min(10_000, payload.deltaX ?? 0)),
            Math.max(-10_000, Math.min(10_000, payload.deltaY ?? 0)),
          );
          break;
        case "keydown": {
          const key = payload.key;
          if (!key) break;
          await page.keyboard.press(key.length === 1 ? key : key);
          break;
        }
        case "type_text":
          if (payload.text) {
            // Insert the completed text, including non-US keyboard characters,
            // without inventing an Enter/key sequence for pasted content.
            await page.keyboard.insertText(payload.text);
          }
          break;
        case "drag": {
          await page.mouse.move(payload.x ?? 0, payload.y ?? 0);
          let pressed = false;
          const nextEffect = async () => {
            await beforeEffect?.();
            assertLocalExecutionEpoch(executionEpoch);
            browserControls.assertOperator(agentId, leaseId);
          };
          try {
            await nextEffect();
            await page.mouse.down();
            pressed = true;
            await nextEffect();
            await page.mouse.move(payload.toX ?? 0, payload.toY ?? 0, {
              steps: 12,
            });
            await nextEffect();
            await page.mouse.up();
            pressed = false;
          } finally {
            // Release only this captured page's held button on interruption.
            // Cleanup cannot turn an interrupted drag into recorded success.
            if (pressed) await page.mouse.up().catch(() => undefined);
          }
          break;
        }
      }
    });
  };
  return runWithExistingOperatorBrowserControl(
    agentId,
    leaseId,
    expectedSession,
    operation,
  );
}

/** Saves the current screenshot into the agent's sandbox filesystem. */
export async function saveScreenshotToSandbox(
  agentId: number,
  name?: string,
  beforeEffect?: BeforeEffectHook,
): Promise<{ path: string; sizeBytes: number }> {
  const session = await getOrCreate(agentId);
  const png = await session.page.screenshot({ type: "png" });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = name?.trim() || `ekran-${stamp}.png`;
  const rel = `ekran-goruntuleri/${fileName.replace(/[^\w.-]+/g, "_")}`;
  return writeBinaryFile(agentId, rel, png, undefined, beforeEffect);
}
