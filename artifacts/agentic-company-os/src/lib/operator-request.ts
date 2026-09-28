import type { OperatorRequestReceipt } from "@workspace/api-client-react";
import { validTerminalResult } from "./terminal-session";

export type OperatorScope = Pick<
  OperatorRequestReceipt,
  "agentId" | "requestId" | "kind"
>;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).sort().join() === [...keys].sort().join();
const date = (value: unknown) =>
  typeof value === "string" &&
  value.length <= 40 &&
  Number.isFinite(Date.parse(value));
const reasons = [
  "execution_blocked",
  "authority_unavailable",
  "invalid_session",
  "transport_unavailable",
  "execution_error",
  "deadline_expired",
  "server_interrupted",
];
const exit = (value: unknown) =>
  value === null ||
  (typeof value === "number" &&
    Number.isInteger(value) &&
    value >= -2147483648 &&
    value <= 2147483647);
function invalid(): never {
  throw new Error("Invalid operator request receipt");
}

export function readOperatorReceipt(
  value: unknown,
  expected: OperatorScope,
): OperatorRequestReceipt {
  if (
    !object(value) ||
    !exact(value, [
      "requestId",
      "agentId",
      "kind",
      "state",
      "createdAt",
      "expiresAt",
      "dispatchedAt",
      "completedAt",
      "failureCode",
      "terminal",
      "resultAvailability",
      "result",
    ]) ||
    value.requestId !== expected.requestId.toLowerCase() ||
    value.agentId !== expected.agentId ||
    value.kind !== expected.kind ||
    ![
      "reserved",
      "dispatched",
      "complete",
      "not_dispatched",
      "unknown",
    ].includes(String(value.state)) ||
    !date(value.createdAt) ||
    !date(value.expiresAt) ||
    (value.dispatchedAt !== null && !date(value.dispatchedAt)) ||
    (value.completedAt !== null && !date(value.completedAt))
  )
    invalid();
  const pending = value.state === "reserved" || value.state === "dispatched";
  const done = value.state === "complete";
  if (
    pending || done
      ? value.failureCode !== null
      : !reasons.includes(String(value.failureCode))
  )
    invalid();
  if (
    (pending && value.completedAt !== null) ||
    (done && !date(value.completedAt))
  )
    invalid();
  if (
    (value.state === "reserved" || value.state === "not_dispatched") &&
    value.dispatchedAt !== null
  )
    invalid();
  if (
    (value.state === "dispatched" || value.state === "unknown") &&
    !date(value.dispatchedAt)
  )
    invalid();
  const terminal =
    expected.kind === "terminal_sandbox" || expected.kind === "terminal_host";
  if (terminal && done) {
    const meta = value.terminal;
    if (
      !object(meta) ||
      !exact(meta, ["ok", "exitCode", "durationMs"]) ||
      typeof meta.ok !== "boolean" ||
      !exit(meta.exitCode) ||
      (meta.ok && meta.exitCode !== 0) ||
      typeof meta.durationMs !== "number" ||
      !Number.isInteger(meta.durationMs) ||
      meta.durationMs < 0 ||
      meta.durationMs > 86400000
    )
      invalid();
    if (value.resultAvailability === "available") {
      if (
        !validTerminalResult(value.result) ||
        value.result.ok !== meta.ok ||
        value.result.exitCode !== meta.exitCode ||
        value.result.durationMs !== meta.durationMs
      )
        invalid();
    } else if (
      value.resultAvailability !== "unavailable" ||
      value.result !== null
    )
      invalid();
  } else if (
    value.terminal !== null ||
    value.result !== null ||
    value.resultAvailability !== (terminal ? "not_recorded" : "not_applicable")
  )
    invalid();
  return value as unknown as OperatorRequestReceipt;
}

export function readOperatorResponse(
  value: unknown,
  expected: OperatorScope,
): { receipt: OperatorRequestReceipt; result: unknown } {
  if (!object(value) || !exact(value, ["receipt", "result"])) invalid();
  const receipt = readOperatorReceipt(value.receipt, expected);
  if (receipt.state !== "complete" && value.result !== null) invalid();
  if (expected.kind.startsWith("terminal_")) {
    if (value.result === null) {
      if (receipt.result !== null) invalid();
    } else if (
      !validTerminalResult(value.result) ||
      !receipt.result ||
      ["ok", "exitCode", "stdout", "stderr", "durationMs", "note", "cwd"].some(
        (key) =>
          (value.result as unknown as Record<string, unknown>)[key] !==
          (receipt.result as unknown as Record<string, unknown>)[key],
      )
    )
      invalid();
  }
  return { receipt, result: value.result };
}
