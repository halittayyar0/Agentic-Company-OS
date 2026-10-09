import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { redactAuditText } from "./audit-redaction";
import type {
  CodexServerApproval,
  CodexServerEvent,
} from "./codex-app-server-client";

export class CodexActionScopeError extends Error {
  constructor(readonly kind: "protocol" | "unsupported_capability") {
    super(`codex_action_${kind}`);
    this.name = "CodexActionScopeError";
  }
}
type Change = Readonly<{
  path: string;
  kind: Readonly<
    { type: "add" | "delete" } | { type: "update"; move_path: string | null }
  >;
  diff: string;
}>;
type Effect = Readonly<
  | { type: "commandExecution"; command: string; cwd: string }
  | { type: "fileChange"; changes: readonly Change[] }
>;
/** Full, bounded, secret-free native preview. Digest covers exact text and
 * paths plus native lifecycle identity; it is not a sandbox enforcement proof. */
export interface CodexExactAction {
  readonly version: 1;
  readonly threadId: string;
  readonly turnId: string;
  readonly itemId: string;
  readonly startedAtMs: number;
  readonly revision: number;
  readonly effect: Effect;
  readonly digest: string;
}
export interface CodexExactApprovalRequest extends CodexServerApproval {
  readonly action: CodexExactAction;
}
/** Native completion evidence only. No command output, patch content or
 * assertion that the application deliverable was built, tested or delivered. */
export interface CodexActionReceipt {
  readonly threadId: string;
  readonly turnId: string;
  readonly itemId: string;
  readonly actionDigest: string;
  readonly revision: number;
  readonly status: "completed" | "failed" | "declined";
  readonly exitCode: number | null;
  readonly completedAtMs: number;
  readonly decision: "accept" | "decline" | "cancel" | null;
  readonly proofScope: "codex_item";
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9_:-]{1,160}$/u.test(v);
const time = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const protocol = (): never => {
  throw new CodexActionScopeError("protocol");
};
const unsupported = (): never => {
  throw new CodexActionScopeError("unsupported_capability");
};
const within = (base: string, target: string) => {
  const relative = path.relative(base, target);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
};

/** One tracker per owned turn. All capture/final checks are synchronous, so
 * a received patch update cannot slip behind an await at the reply boundary.
 * Filesystem checks are point-in-time; OS containment remains mandatory. */
export function createCodexActionTracker(input: {
  workspace: string;
  deniedPaths?: readonly string[];
  secrets: readonly string[];
}) {
  const workspace = input.workspace;
  const denied = [...(input.deniedPaths ?? [])];
  const secrets = [...input.secrets].filter(Boolean);
  if (!path.isAbsolute(workspace) || path.resolve(workspace) !== workspace)
    unsupported();
  function text(value: unknown, limit: number, allowEmpty = false): string {
    if (
      typeof value !== "string" ||
      (!allowEmpty && !value.trim()) ||
      Buffer.byteLength(value) > limit ||
      /\[REDACTED(?:_SECRET|_URL)?\]/u.test(value) ||
      secrets.some((secret) => value.includes(secret)) ||
      redactAuditText(value, value.length + 1, true) !== value
    )
      unsupported();
    return value as string;
  }
  function target(value: unknown, directory = false): string {
    const candidate = text(value, 4096);
    if (
      !path.isAbsolute(candidate) ||
      path.resolve(candidate) !== candidate ||
      !within(workspace, candidate) ||
      (!directory && candidate === workspace) ||
      denied.some((base) => within(base, candidate))
    )
      unsupported();
    if (
      process.platform === "win32" &&
      path
        .relative(workspace, candidate)
        .split(path.sep)
        .some(
          (part) =>
            /[<>:"|?*]/u.test(part) ||
            /[. ]$/u.test(part) ||
            /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(
              part,
            ),
        )
    )
      unsupported();
    // Walk all existing ancestors, including workspace ancestors. A missing
    // descendant is permitted; a dangling link/reparse point is not.
    for (let current = candidate; ; current = path.dirname(current)) {
      try {
        const stat = lstatSync(current);
        if (
          stat.isSymbolicLink() ||
          (current !== candidate && !stat.isDirectory()) ||
          (current === candidate &&
            (directory ? !stat.isDirectory() : !stat.isFile())) ||
          path.relative(current, realpathSync.native(current)) !== ""
        )
          unsupported();
      } catch (error) {
        if (!(
          object(error) &&
          error.code === "ENOENT" &&
          !directory &&
          within(workspace, current) &&
          current !== workspace
        ))
          unsupported();
      }
      if (path.dirname(current) === current) break;
    }
    return candidate;
  }
  // Even a read-only item with no human prompt must refer to our real root.
  target(workspace, true);
  function effect(item: Record<string, unknown>): Effect {
    if (item.type === "commandExecution") {
      if (
        item.pluginId != null ||
        item.scriptPath != null ||
        !["agent", "unifiedExecStartup"].includes(String(item.source))
      )
        unsupported();
      return Object.freeze({
        type: "commandExecution",
        command: text(item.command, 32 * 1024),
        cwd: target(item.cwd, true),
      });
    }
    if (
      item.type !== "fileChange" ||
      !Array.isArray(item.changes) ||
      item.changes.length < 1 ||
      item.changes.length > 128
    )
      protocol();
    const paths = new Set<string>();
    let bytes = 0;
    const changes = (item.changes as unknown[]).map((raw) => {
      if (!object(raw) || !object(raw.kind)) protocol();
      const change = raw as Record<string, unknown> & {
        kind: Record<string, unknown>;
      };
      const file = target(change.path);
      const diff = text(change.diff, 256 * 1024, true);
      bytes += Buffer.byteLength(diff);
      if (bytes > 256 * 1024) unsupported();
      let kind: Change["kind"];
      if (
        ["add", "delete"].includes(String(change.kind.type)) &&
        Object.keys(change.kind).length === 1
      )
        kind = Object.freeze({ type: change.kind.type as "add" | "delete" });
      else if (
        change.kind.type === "update" &&
        Object.keys(change.kind).length === 2 &&
        Object.hasOwn(change.kind, "move_path")
      )
        kind = Object.freeze({
          type: "update",
          move_path:
            change.kind.move_path === null
              ? null
              : target(change.kind.move_path),
        });
      else return unsupported();
      for (const name of [
        file,
        ...(kind.type === "update" && kind.move_path ? [kind.move_path] : []),
      ]) {
        const key = process.platform === "win32" ? name.toLowerCase() : name;
        if (paths.has(key)) protocol();
        paths.add(key);
      }
      return Object.freeze({ path: file, kind, diff });
    });
    return Object.freeze({
      type: "fileChange",
      changes: Object.freeze(changes),
    });
  }
  type Entry = {
    action: CodexExactAction;
    done: boolean;
    review?: AbortController;
    decision: CodexActionReceipt["decision"];
    reviewed: boolean;
    source?: string;
    availableDecisions?: readonly ("accept" | "decline" | "cancel")[];
  };
  const entries = new Map<string, Entry>();
  const receipts: CodexActionReceipt[] = [];
  let capturedBytes = 0;
  function make(
    scope: Pick<
      CodexExactAction,
      "threadId" | "turnId" | "itemId" | "startedAtMs" | "revision"
    >,
    action: Effect,
  ): CodexExactAction {
    const captured = { version: 1 as const, ...scope, effect: action };
    const encoded = JSON.stringify(captured);
    capturedBytes += Buffer.byteLength(encoded);
    if (capturedBytes > 1024 * 1024) unsupported();
    return Object.freeze({
      ...captured,
      digest: createHash("sha256").update(encoded).digest("hex"),
    });
  }
  function current(p: Record<string, unknown>, itemId: unknown) {
    if (!id(itemId)) protocol();
    const entry = entries.get(itemId as string);
    if (
      !entry ||
      entry.done ||
      p.threadId !== entry.action.threadId ||
      p.turnId !== entry.action.turnId
    )
      protocol();
    return entry!;
  }
  function recheck(action: CodexExactAction) {
    if (action.effect.type === "commandExecution")
      target(action.effect.cwd, true);
    else
      for (const change of action.effect.changes) {
        target(change.path);
        if (change.kind.type === "update" && change.kind.move_path)
          target(change.kind.move_path);
      }
  }
  function assertReview(action: CodexExactAction) {
    const entry = current(
      action as unknown as Record<string, unknown>,
      action.itemId,
    );
    if (entry.action !== action || !entry.review || entry.review.signal.aborted)
      protocol();
    recheck(action);
  }
  return {
    observe(event: CodexServerEvent): CodexActionReceipt | undefined {
      const p = event.params;
      if (
        event.method === "item/started" &&
        object(p.item) &&
        ["commandExecution", "fileChange"].includes(String(p.item.type))
      ) {
        if (
          !id(p.threadId) ||
          !id(p.turnId) ||
          !id(p.item.id) ||
          !time(p.startedAtMs) ||
          p.item.status !== "inProgress" ||
          entries.has(p.item.id) ||
          entries.size >= 128
        )
          protocol();
        const action = effect(p.item);
        const captured = make(
          {
            threadId: p.threadId as string,
            turnId: p.turnId as string,
            itemId: p.item.id as string,
            startedAtMs: p.startedAtMs as number,
            revision: 1,
          },
          action,
        );
        entries.set(captured.itemId, {
          action: captured,
          done: false,
          decision: null,
          reviewed: false,
          source: typeof p.item.source === "string" ? p.item.source : undefined,
        });
      } else if (event.method === "item/fileChange/patchUpdated") {
        const entry = current(p, p.itemId);
        if (entry.action.effect.type !== "fileChange") protocol();
        const updated = effect({ type: "fileChange", changes: p.changes });
        if (JSON.stringify(updated) !== JSON.stringify(entry.action.effect)) {
          entry.review?.abort(new CodexActionScopeError("protocol"));
          if (entry.decision !== null) protocol();
          entry.action = make(
            {
              threadId: entry.action.threadId,
              turnId: entry.action.turnId,
              itemId: entry.action.itemId,
              startedAtMs: entry.action.startedAtMs,
              revision: entry.action.revision + 1,
            },
            updated,
          );
        }
      } else if (
        event.method === "item/completed" &&
        object(p.item) &&
        ["commandExecution", "fileChange"].includes(String(p.item.type))
      ) {
        const entry = current(p, p.item.id);
        if (
          !time(p.completedAtMs) ||
          p.completedAtMs < entry.action.startedAtMs ||
          !["completed", "failed", "declined"].includes(
            String(p.item.status),
          ) ||
          JSON.stringify(effect(p.item)) !==
            JSON.stringify(entry.action.effect) ||
          (entry.source !== undefined && p.item.source !== entry.source)
        )
          protocol();
        let exitCode: number | null = null;
        if (p.item.type === "commandExecution") {
          if (
            p.item.exitCode != null &&
            (typeof p.item.exitCode !== "number" ||
              !Number.isSafeInteger(p.item.exitCode))
          )
            protocol();
          exitCode = (p.item.exitCode as number | null) ?? null;
          if (p.item.status === "completed" && exitCode !== 0) protocol();
        }
        if (
          entry.reviewed &&
          entry.decision === null &&
          p.item.status === "completed"
        )
          protocol();
        if (entry.decision === "decline" || entry.decision === "cancel") {
          if (p.item.status === "completed") protocol();
        }
        entry.done = true;
        entry.review?.abort(new CodexActionScopeError("protocol"));
        const receipt: CodexActionReceipt = Object.freeze({
          threadId: entry.action.threadId,
          turnId: entry.action.turnId,
          itemId: entry.action.itemId,
          actionDigest: entry.action.digest,
          revision: entry.action.revision,
          status: p.item.status as CodexActionReceipt["status"],
          exitCode,
          completedAtMs: p.completedAtMs as number,
          decision: entry.decision,
          proofScope: "codex_item",
        });
        receipts.push(receipt);
        return receipt;
      }
      return undefined;
    },
    review(request: CodexServerApproval) {
      const p = request.params;
      const entry = current(p, p.itemId);
      if (
        !time(p.startedAtMs) ||
        p.startedAtMs < entry.action.startedAtMs ||
        entry.reviewed
      )
        protocol();
      if (
        [
          "grantRoot",
          "proposedExecpolicyAmendment",
          "proposedNetworkPolicyAmendments",
          "additionalPermissions",
          "networkApprovalContext",
          "environmentId",
          "approvalId",
        ].some((key) => p[key] != null) ||
        (p.kind != null && p.kind !== "command")
      )
        unsupported();
      if (request.method === "item/commandExecution/requestApproval") {
        if (
          entry.action.effect.type !== "commandExecution" ||
          p.command !== entry.action.effect.command ||
          p.cwd !== entry.action.effect.cwd
        )
          protocol();
      } else if (
        request.method !== "item/fileChange/requestApproval" ||
        entry.action.effect.type !== "fileChange"
      )
        protocol();
      recheck(entry.action);
      let availableDecisions: readonly ("accept" | "decline" | "cancel")[] =
        Object.freeze(["accept", "decline", "cancel"]);
      if (p.availableDecisions != null) {
        if (
          !Array.isArray(p.availableDecisions) ||
          p.availableDecisions.length > 16
        )
          protocol();
        const choices = (p.availableDecisions as unknown[]).filter(
          (choice): choice is "accept" | "decline" | "cancel" =>
            choice === "accept" || choice === "decline" || choice === "cancel",
        );
        if (!choices.length || new Set(choices).size !== choices.length)
          unsupported();
        availableDecisions = Object.freeze(choices);
      }
      entry.reviewed = true;
      entry.review = new AbortController();
      entry.availableDecisions = availableDecisions;
      // Friendly summaries/reasons can contain secrets or differ from the
      // effect. Only our complete exact scope crosses the human-review port.
      const safeRequest: CodexExactApprovalRequest = Object.freeze({
        id: request.id,
        method: request.method,
        params: Object.freeze({
          threadId: entry.action.threadId,
          turnId: entry.action.turnId,
          itemId: entry.action.itemId,
          startedAtMs: p.startedAtMs,
          availableDecisions,
        }),
        action: entry.action,
      });
      return {
        request: safeRequest,
        action: entry.action,
        signal: entry.review.signal,
      };
    },
    assertReview,
    recordDecision(
      action: CodexExactAction,
      decision: "accept" | "decline" | "cancel",
    ) {
      assertReview(action);
      const entry = entries.get(action.itemId)!;
      if (entry.decision !== null) protocol();
      if (!entry.availableDecisions?.includes(decision)) unsupported();
      entry.decision = decision;
    },
    assertTerminal() {
      if ([...entries.values()].some((entry) => !entry.done)) protocol();
    },
    receipts: () => Object.freeze([...receipts]),
    close() {
      for (const entry of entries.values())
        entry.review?.abort(new CodexActionScopeError("protocol"));
    },
  };
}
