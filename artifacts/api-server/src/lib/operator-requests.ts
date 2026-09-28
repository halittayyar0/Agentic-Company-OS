import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import {
  agentsTable,
  databaseBackend,
  db,
  dbReady,
  operatorRequestsTable as requests,
  operatorRequestKinds,
  operatorRequestFailureCodes,
  type OperatorRequestKind,
  type OperatorRequestRow,
  type OperatorRequestFailureCode,
} from "@workspace/db";
import {
  lockRuntimeControlState,
  type RuntimeTransaction,
} from "./orchestrator/runtime-emergency-stop";
import {
  decryptRuntimeEnvelope,
  digestRuntimePayload,
  encryptRuntimeEnvelope,
  readRuntimeControlKey,
} from "./runtime-control-crypto";
import type { VmExecOutcome } from "./vm/sandbox";

type Failure =
  | "invalid_request"
  | "identity_conflict"
  | "busy"
  | "agent_missing"
  | "ownership_lost"
  | "execution_blocked"
  | "key_unavailable"
  | "invalid_result";
export class OperatorRequestError extends Error {
  constructor(readonly code: Failure) {
    super(code);
    this.name = "OperatorRequestError";
  }
}
export type OperatorRequestOwner = {
  requestId: string;
  agentId: number;
  kind: OperatorRequestKind;
  ownerId: string;
};
export type OperatorReceipt = {
  requestId: string;
  agentId: number;
  kind: OperatorRequestKind;
  state: OperatorRequestRow["state"];
  createdAt: string;
  expiresAt: string;
  dispatchedAt: string | null;
  completedAt: string | null;
  failureCode: OperatorRequestFailureCode | null;
  terminal: { ok: boolean; exitCode: number | null; durationMs: number } | null;
  resultAvailability:
    "available" | "unavailable" | "not_recorded" | "not_applicable";
  result: VmExecOutcome | null;
};
type LiveRow = OperatorRequestRow & { live: boolean };
const active = ["reserved", "dispatched"] as const;
const terminal = (kind: OperatorRequestKind) =>
  kind === "terminal_sandbox" || kind === "terminal_host";
const cleanup = (kind: OperatorRequestKind) =>
  kind === "browser_release" || kind === "browser_close";
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const positive = (value: number) =>
  Number.isInteger(value) && value > 0 && value <= 2147483647;
let ephemeralKey: string | undefined;
function key(): string {
  try {
    if (process.env.RUNTIME_CONTROL_KEY !== undefined)
      return readRuntimeControlKey();
    if (databaseBackend === "pglite")
      return (ephemeralKey ??= randomBytes(32).toString("hex"));
  } catch {
    /* Do not disclose key details. */
  }
  throw new OperatorRequestError("key_unavailable");
}
function scope(agentId: number, requestId: string) {
  if (
    !positive(agentId) ||
    typeof requestId !== "string" ||
    !uuid.test(requestId)
  )
    throw new OperatorRequestError("invalid_request");
  return requestId.toLowerCase();
}
function canonical(input: unknown): unknown {
  let visited = 0;
  const visit = (value: unknown, depth: number): unknown => {
    if (++visited > 10000 || depth > 12)
      throw new OperatorRequestError("invalid_request");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string" && value.length <= 131072) return value;
    if (typeof value === "number" && Number.isFinite(value))
      return Object.is(value, -0) ? 0 : value;
    if (Array.isArray(value)) {
      if (value.length > 2000 || Object.keys(value).length !== value.length)
        throw new OperatorRequestError("invalid_request");
      return value.map((item) => visit(item, depth + 1));
    }
    if (
      value &&
      typeof value === "object" &&
      (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null)
    ) {
      const keys = Object.keys(value);
      if (keys.length > 64 || Object.getOwnPropertySymbols(value).length)
        throw new OperatorRequestError("invalid_request");
      const result = Object.create(null) as Record<string, unknown>;
      for (const name of keys.sort()) {
        const property = Object.getOwnPropertyDescriptor(value, name)!;
        if (!("value" in property))
          throw new OperatorRequestError("invalid_request");
        result[name] = visit(property.value, depth + 1);
      }
      return result;
    }
    throw new OperatorRequestError("invalid_request");
  };
  const result = visit(input, 0);
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 262144)
    throw new OperatorRequestError("invalid_request");
  return result;
}
function validResult(value: unknown): value is VmExecOutcome {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  const text = (value: unknown, limit: number) =>
    typeof value === "string" && value.length <= limit;
  return (
    Object.keys(r).every((k) =>
      [
        "ok",
        "exitCode",
        "stdout",
        "stderr",
        "durationMs",
        "note",
        "cwd",
      ].includes(k),
    ) &&
    typeof r.ok === "boolean" &&
    (r.exitCode === null ||
      (typeof r.exitCode === "number" &&
        Number.isInteger(r.exitCode) &&
        r.exitCode >= -2147483648 &&
        r.exitCode <= 2147483647)) &&
    (!r.ok || r.exitCode === 0) &&
    text(r.stdout, 262144) &&
    text(r.stderr, 262144) &&
    typeof r.durationMs === "number" &&
    Number.isInteger(r.durationMs) &&
    r.durationMs >= 0 &&
    r.durationMs <= 86400000 &&
    (r.note === null || text(r.note, 8192)) &&
    (r.cwd === null || text(r.cwd, 4096))
  );
}
const selection = {
  ...getTableColumns(requests),
  live: sql<boolean>`${requests.expiresAt} > clock_timestamp()`,
};
async function rowById(
  executor: typeof db | RuntimeTransaction,
  requestId: string,
): Promise<LiveRow | undefined> {
  const [row] = await executor
    .select(selection)
    .from(requests)
    .where(eq(requests.requestId, requestId))
    .limit(1);
  return row;
}
function project(row: LiveRow): OperatorReceipt {
  const expired =
    active.includes(row.state as (typeof active)[number]) && !row.live;
  const state = expired
    ? row.dispatchedAt
      ? "unknown"
      : "not_dispatched"
    : row.state;
  let result: VmExecOutcome | null = null;
  let resultAvailability: OperatorReceipt["resultAvailability"] = terminal(
    row.kind,
  )
    ? "not_recorded"
    : "not_applicable";
  if (terminal(row.kind) && state === "complete") {
    resultAvailability = "unavailable";
    try {
      if (row.resultCiphertext && row.resultNonce && row.resultAuthTag) {
        const decoded = decryptRuntimeEnvelope<{
          context: string;
          requestId: string;
          agentId: number;
          kind: string;
          result: unknown;
        }>(
          {
            ciphertext: row.resultCiphertext,
            nonce: row.resultNonce,
            authTag: row.resultAuthTag,
          },
          key(),
        );
        if (
          decoded.context === "operator-result/v1" &&
          decoded.requestId === row.requestId &&
          decoded.agentId === row.agentId &&
          decoded.kind === row.kind &&
          validResult(decoded.result) &&
          decoded.result.ok === row.ok &&
          decoded.result.exitCode === row.exitCode &&
          decoded.result.durationMs === row.durationMs
        ) {
          result = decoded.result;
          resultAvailability = "available";
        }
      }
    } catch {
      /* A lost key or corrupt blob cannot change execution state. */
    }
  }
  return {
    requestId: row.requestId,
    agentId: row.agentId,
    kind: row.kind,
    state,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    failureCode: expired ? "deadline_expired" : row.failureCode,
    terminal:
      terminal(row.kind) && state === "complete"
        ? { ok: row.ok!, exitCode: row.exitCode, durationMs: row.durationMs! }
        : null,
    resultAvailability,
    result,
  };
}
export async function readOperatorRequest(
  agentId: number,
  requestId: string,
): Promise<OperatorReceipt | null> {
  requestId = scope(agentId, requestId);
  await dbReady;
  const row = await rowById(db, requestId);
  return row?.agentId === agentId ? project(row) : null;
}
export async function reserveOperatorRequest(input: {
  requestId: string;
  agentId: number;
  kind: OperatorRequestKind;
  input: unknown;
}): Promise<
  | { admitted: true; owner: OperatorRequestOwner; receipt: OperatorReceipt }
  | { admitted: false; receipt: OperatorReceipt }
> {
  const requestId = scope(input.agentId, input.requestId);
  if (!operatorRequestKinds.includes(input.kind))
    throw new OperatorRequestError("invalid_request");
  const requestHash = digestRuntimePayload(
    {
      context: "operator-request/v1",
      requestId,
      agentId: input.agentId,
      kind: input.kind,
      input: canonical(input.input),
    },
    key(),
  );
  await dbReady;
  const saved = await db.transaction(async (tx) => {
    const runtime = await lockRuntimeControlState(tx);
    const existing = await rowById(tx, requestId);
    if (existing) {
      if (
        existing.agentId !== input.agentId ||
        existing.kind !== input.kind ||
        existing.requestHash !== requestHash
      )
        throw new OperatorRequestError("identity_conflict");
      return { admitted: false as const, row: existing };
    }
    if (runtime.emergencyStopEnabled && !cleanup(input.kind))
      throw new OperatorRequestError("execution_blocked");
    const [agent] = await tx
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.id, input.agentId))
      .limit(1);
    if (!agent) throw new OperatorRequestError("agent_missing");
    // Retire expired owners; never lend their identity or owner to a new call.
    await tx
      .update(requests)
      .set({
        state: sql`case when ${requests.dispatchedAt} is null then 'not_dispatched' else 'unknown' end`,
        completedAt: sql`clock_timestamp()`,
        failureCode: "deadline_expired",
      })
      .where(
        and(
          eq(requests.agentId, input.agentId),
          inArray(requests.state, [...active]),
          sql`${requests.expiresAt} <= clock_timestamp()`,
        ),
      );
    const [busy] = await tx
      .select({ id: requests.requestId })
      .from(requests)
      .where(
        and(
          eq(requests.agentId, input.agentId),
          inArray(requests.state, [...active]),
        ),
      )
      .limit(1);
    if (busy) throw new OperatorRequestError("busy");
    const ownerId = randomUUID();
    const ttlMs = terminal(input.kind) ? 180000 : 60000;
    await tx.insert(requests).values({
      requestId,
      agentId: input.agentId,
      kind: input.kind,
      requestHash,
      ownerId,
      runtimeVersion: runtime.version,
      state: "reserved",
      expiresAt: sql`clock_timestamp() + (${ttlMs} * interval '1 millisecond')`,
    });
    return { admitted: true as const, row: (await rowById(tx, requestId))! };
  });
  const receipt = project(saved.row);
  return saved.admitted
    ? {
        admitted: true,
        owner: {
          requestId,
          agentId: saved.row.agentId,
          kind: saved.row.kind,
          ownerId: saved.row.ownerId,
        },
        receipt,
      }
    : { admitted: false, receipt };
}
async function owned(
  tx: RuntimeTransaction,
  owner: OperatorRequestOwner,
): Promise<LiveRow> {
  const requestId = scope(owner.agentId, owner.requestId);
  const row = await rowById(tx, requestId);
  if (
    !row ||
    row.agentId !== owner.agentId ||
    row.kind !== owner.kind ||
    row.ownerId !== owner.ownerId ||
    !row.live ||
    !active.includes(row.state as (typeof active)[number])
  )
    throw new OperatorRequestError("ownership_lost");
  return row;
}
function liveOwnerWhere(owner: OperatorRequestOwner) {
  return and(
    eq(requests.requestId, owner.requestId.toLowerCase()),
    eq(requests.agentId, owner.agentId),
    eq(requests.kind, owner.kind),
    eq(requests.ownerId, owner.ownerId),
    inArray(requests.state, [...active]),
    sql`${requests.expiresAt} > clock_timestamp()`,
  );
}
export async function beforeOperatorEffect(
  owner: OperatorRequestOwner,
  existingTransaction?: RuntimeTransaction,
): Promise<void> {
  const check = async (tx: RuntimeTransaction) => {
    const runtime = await lockRuntimeControlState(tx);
    const row = await owned(tx, owner);
    if (
      !cleanup(row.kind) &&
      (runtime.emergencyStopEnabled || runtime.version !== row.runtimeVersion)
    )
      throw new OperatorRequestError("execution_blocked");
    const [agent] = await tx
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.id, row.agentId))
      .for("update");
    if (!agent) throw new OperatorRequestError("ownership_lost");
    const changed = await tx
      .update(requests)
      .set({
        state: "dispatched",
        dispatchedAt: sql`coalesce(${requests.dispatchedAt}, clock_timestamp())`,
      })
      .where(liveOwnerWhere(owner))
      .returning({ id: requests.requestId });
    if (changed.length !== 1) throw new OperatorRequestError("ownership_lost");
  };
  if (existingTransaction) await check(existingTransaction);
  else await db.transaction(check);
}
/** Initial admission commits before filesystem work; subsequent checks reuse
 * the file-lock transaction instead of requesting a second pool connection. */
export function operatorEffectGuard(owner: OperatorRequestOwner) {
  return Object.assign(() => beforeOperatorEffect(owner), {
    revalidate: (tx?: RuntimeTransaction) => beforeOperatorEffect(owner, tx),
  });
}
export async function completeOperatorRequest(
  owner: OperatorRequestOwner,
  result?: VmExecOutcome,
): Promise<OperatorReceipt> {
  let encrypted: ReturnType<typeof encryptRuntimeEnvelope> | null = null;
  if (terminal(owner.kind)) {
    if (!validResult(result)) throw new OperatorRequestError("invalid_result");
    encrypted = encryptRuntimeEnvelope(
      {
        context: "operator-result/v1",
        requestId: owner.requestId.toLowerCase(),
        agentId: owner.agentId,
        kind: owner.kind,
        result,
      },
      key(),
    );
    if (encrypted.ciphertext.length > 8388608)
      throw new OperatorRequestError("invalid_result");
  } else if (result !== undefined)
    throw new OperatorRequestError("invalid_result");
  const finished = await db.transaction(async (tx) => {
    const runtime = await lockRuntimeControlState(tx);
    const row = await owned(tx, owner);
    if (
      !cleanup(row.kind) &&
      (runtime.emergencyStopEnabled || runtime.version !== row.runtimeVersion)
    )
      throw new OperatorRequestError("execution_blocked");
    const changed = await tx
      .update(requests)
      .set({
        state: "complete",
        completedAt: sql`clock_timestamp()`,
        ok: result?.ok ?? null,
        exitCode: result?.exitCode ?? null,
        durationMs: result?.durationMs ?? null,
        resultCiphertext: encrypted?.ciphertext ?? null,
        resultNonce: encrypted?.nonce ?? null,
        resultAuthTag: encrypted?.authTag ?? null,
      })
      .where(liveOwnerWhere(owner))
      .returning({ id: requests.requestId });
    if (changed.length !== 1) throw new OperatorRequestError("ownership_lost");
    return (await rowById(tx, row.requestId))!;
  });
  return project(finished);
}
export async function failOperatorRequest(
  owner: OperatorRequestOwner,
  code: OperatorRequestFailureCode,
): Promise<OperatorReceipt> {
  if (!operatorRequestFailureCodes.includes(code))
    throw new OperatorRequestError("invalid_request");
  const finished = await db.transaction(async (tx) => {
    await lockRuntimeControlState(tx);
    const row = await owned(tx, owner);
    const changed = await tx
      .update(requests)
      .set({
        state: row.dispatchedAt ? "unknown" : "not_dispatched",
        completedAt: sql`clock_timestamp()`,
        failureCode: code,
      })
      .where(liveOwnerWhere(owner))
      .returning({ id: requests.requestId });
    if (changed.length !== 1) throw new OperatorRequestError("ownership_lost");
    return (await rowById(tx, row.requestId))!;
  });
  return project(finished);
}
