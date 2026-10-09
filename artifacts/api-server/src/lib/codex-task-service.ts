import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, sourceChangesTable } from "@workspace/db";
import { chatgptConnectionRuntime } from "./chatgpt-connection-runtime";
import { createCodexTaskAuthority } from "./codex-task-authority";
import {
  createCodexTaskProcessPorts,
  readCodexTaskExecutableDigest,
} from "./codex-task-process";
import {
  claimCodexTaskSession,
  runCodexTaskInSession,
} from "./codex-task-session";
import { createCodexTaskApprovalBridge } from "./codex-task-approvals";
import { CodexTaskError } from "./codex-task-adapter";
import { getCodexTaskCopy } from "./codex-task-copy";
import { recordCodexTaskUsage } from "./codex-task-usage";
import { assertTaskInferenceAdmission } from "./orchestrator/task-spend-admission";
import {
  ensureSandbox,
  getSandboxWorkingDirectory,
  safeResolve,
} from "./vm/sandbox";
import type { ToolRuntimeContext } from "./orchestrator/execute-tool";
import { codexTaskConfigured } from "./codex-task-capability";
export { codexTaskConfigured } from "./codex-task-capability";

const unsupported = (): never => {
  throw new CodexTaskError("unsupported_capability");
};
export function validCodexTaskArguments(
  value: Record<string, unknown>,
): value is Record<string, unknown> & { prompt: string } {
  return (
    Object.keys(value).length === 1 &&
    typeof value.prompt === "string" &&
    value.prompt.trim().length > 0 &&
    Buffer.byteLength(value.prompt) <= 64 * 1024 &&
    !value.prompt.includes("\0")
  );
}
/** Backend selection only. A model may request a job but cannot supply a host
 * directory, executable, runtime home, account, model or process policy. */
export async function resolveCodexTaskWorkspace(
  context: ToolRuntimeContext,
): Promise<string> {
  const validate = async () =>
    context.assertTaskLease!(
      getCodexTaskCopy(context.locale ?? "tr").workspace,
    );
  const beforeEffect = Object.assign(validate, { revalidate: validate });
  const rows = await db
    .select()
    .from(sourceChangesTable)
    .where(eq(sourceChangesTable.taskId, context.taskId!));
  if (rows.length > 1) unsupported();
  if (rows.length === 1) {
    const change = rows[0];
    if (change.agentId !== context.agent.id || change.state !== "draft")
      unsupported();
    await ensureSandbox(context.agent.id, beforeEffect);
    return safeResolve(context.agent.id, `source-changes/${change.id}`).abs;
  }
  const directory = await getSandboxWorkingDirectory(
    context.agent.id,
    beforeEffect,
  );
  return safeResolve(context.agent.id, directory).abs;
}
interface Dependencies {
  environment?: NodeJS.ProcessEnv;
  runtime?: Parameters<typeof createCodexTaskAuthority>[1];
  resolveWorkspace?: typeof resolveCodexTaskWorkspace;
  processPorts?: typeof createCodexTaskProcessPorts;
  beforeTurnBoundary?(): Promise<void>;
  recordUsage?: typeof recordCodexTaskUsage;
  checkpointTimeoutMs?: number;
}
/** Production backend lifecycle. The outer durable tool envelope provides the
 * at-most-once invocation boundary; this service separately owns a protected
 * native session, current authority, exact human review and provider usage.
 * Completion is only a native turn checkpoint, never a verified deliverable. */
export async function runGovernedCodexTask(
  context: ToolRuntimeContext,
  input: { prompt: string; signal?: AbortSignal },
  dependencies: Dependencies = {},
) {
  const environment = dependencies.environment ?? process.env;
  if (!codexTaskConfigured(environment)) unsupported();
  if (
    !context.taskId ||
    !Number.isSafeInteger(context.taskId) ||
    !context.agent?.id ||
    context.preapprovedAction ||
    context.transactionalExecutor ||
    context.operationIdentity?.executionKind !== "task_step" ||
    typeof context.assertTaskLease !== "function"
  )
    unsupported();
  if (
    typeof input.prompt !== "string" ||
    !input.prompt.trim() ||
    Buffer.byteLength(input.prompt) > 64 * 1024 ||
    input.prompt.includes("\0") ||
    Object.keys(input).some((key) => key !== "prompt" && key !== "signal")
  )
    throw new CodexTaskError("protocol");
  const prompt = input.prompt,
    signal = input.signal;
  context = {
    ...context,
    agent: { ...context.agent },
    operationIdentity: { ...context.operationIdentity! },
  };
  const locale = context.locale ?? "tr",
    taskId = context.taskId!,
    agentId = context.agent.id,
    executable = environment.ACOS_CODEX_EXECUTABLE!;
  const configuredStorage = environment.CHATGPT_STORAGE_DIRECTORY;
  if (
    configuredStorage !== undefined &&
    (!path.isAbsolute(configuredStorage) ||
      path.normalize(configuredStorage) !== configuredStorage ||
      /[\u0000-\u001f\u007f]/u.test(configuredStorage))
  )
    unsupported();
  const storageDirectory =
    configuredStorage ?? path.join(homedir(), ".agentic-company-os-chatgpt");
  await context.assertTaskLease!(getCodexTaskCopy(locale).admission);
  await assertTaskInferenceAdmission(taskId, locale);
  let executableDigest: string;
  try {
    executableDigest = await readCodexTaskExecutableDigest(executable);
  } catch {
    return unsupported();
  }
  const workspace = await (
    dependencies.resolveWorkspace ?? resolveCodexTaskWorkspace
  )(context);
  const authority = await createCodexTaskAuthority(
    context,
    dependencies.runtime ?? chatgptConnectionRuntime,
    { signal },
  );
  // A source record may have changed while account admission ran. Never pair
  // the newly captured authority with an older resolved workspace path.
  if (
    (await (dependencies.resolveWorkspace ?? resolveCodexTaskWorkspace)(
      context,
    )) !== workspace
  )
    throw new CodexTaskError("ownership_lost");
  const session = await claimCodexTaskSession({
    authority,
    agentId,
    workspace,
    storageDirectory,
    executableDigest,
  });
  const bridge = createCodexTaskApprovalBridge({ authority, session, locale });
  const inferenceKey =
    "codex:" +
    createHash("sha256")
      .update(
        JSON.stringify({
          version: 1,
          taskId,
          agentId,
          logicalExecutionId: context.operationIdentity!.logicalExecutionId,
          callSlot: context.operationIdentity!.callSlot,
          modelToolCallId: context.operationIdentity!.modelToolCallId,
        }),
      )
      .digest("hex");
  const accountingContext = {
    inferenceKey,
    agentId,
    taskId,
    modelId: `chatgpt:${authority.model}`,
  };
  const recordUsage = dependencies.recordUsage ?? recordCodexTaskUsage;
  let accountingAttempted = false;
  let admissionError: unknown;
  let terminalResult:
    Awaited<ReturnType<typeof runCodexTaskInSession>> | undefined;
  let terminalFailure: CodexTaskError | undefined;
  try {
    const processPorts = (
      dependencies.processPorts ?? createCodexTaskProcessPorts
    )({
      authority,
      session,
      workspace,
      storageDirectory,
      executable,
      processExecEnabled: true,
    });
    terminalResult = await runCodexTaskInSession(
      session,
      { binding: authority.binding, prompt, signal },
      {
        ...processPorts,
        readBinding: () =>
          codexTaskConfigured(environment)
            ? authority.readBinding()
            : Promise.resolve(null),
        approve: bridge.approve,
        onActionReceipt: bridge.onActionReceipt,
        beforeTurnStart: async () => {
          try {
            if (!codexTaskConfigured(environment)) unsupported();
            await assertTaskInferenceAdmission(taskId, locale);
            await session.assertCurrent(authority.binding);
            await dependencies.beforeTurnBoundary?.();
          } catch (error) {
            admissionError = error;
            throw error;
          }
        },
        launch: async (prepared, binding) => {
          const owned = await processPorts.launch(prepared, binding);
          return {
            ...owned,
            stop: async () => {
              // Stop the actual owned tree even if metadata cleanup later fails.
              // Session publication waits for both cleanup acknowledgements.
              let failed = false;
              try {
                await owned.stop();
              } catch {
                failed = true;
              }
              try {
                await bridge.close();
              } catch {
                failed = true;
              }
              if (failed) throw new CodexTaskError("cleanup_failed");
            },
          };
        },
      },
      {
        checkpointTimeoutMs: dependencies.checkpointTimeoutMs,
        beforeCheckpoint: async (result) => {
          accountingAttempted = true;
          try {
            await recordUsage({
              ...accountingContext,
              usage: result.usage,
              outcome: "completed",
              failureKind: null,
            });
          } catch {
            throw new CodexTaskError(
              "accounting_failed",
              result.usage,
              result.actionReceipts,
              true,
              "verified",
            );
          }
        },
      },
    );
    return terminalResult;
  } catch (error) {
    await session.uncertain().catch(() => {});
    if (error instanceof CodexTaskError) {
      terminalFailure = error;
      if (
        !accountingAttempted &&
        (error.requestStarted || error.usage !== null)
      ) {
        accountingAttempted = true;
        try {
          await recordUsage({
            ...accountingContext,
            usage: error.usage,
            outcome: "failed",
            failureKind: `codex_${error.kind}`,
          });
        } catch {
          terminalFailure = new CodexTaskError(
            "accounting_failed",
            error.usage,
            error.actionReceipts,
            error.requestStarted,
            error.cleanupState,
          );
          throw terminalFailure;
        }
      }
      if (!error.requestStarted && admissionError) throw admissionError;
      throw error;
    }
    throw new CodexTaskError("protocol");
  } finally {
    try {
      await bridge.close();
    } catch {
      await session.uncertain().catch(() => {});
      throw new CodexTaskError(
        "cleanup_failed",
        terminalResult?.usage ?? terminalFailure?.usage ?? null,
        terminalResult?.actionReceipts ?? terminalFailure?.actionReceipts ?? [],
        terminalResult !== undefined ||
          terminalFailure?.requestStarted === true,
      );
    }
  }
}
