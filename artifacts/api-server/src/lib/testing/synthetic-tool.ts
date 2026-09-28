import { createHash } from "node:crypto";
import {
  runDurableExternalEffect,
  type ToolExecutionResult,
  type ToolRuntimeContext,
  type executeTool,
} from "../orchestrator/execute-tool";
import { SYNTHETIC_FIXTURE_TOOL_NAME } from "./synthetic-completion";
import {
  buildSyntheticFixtureArguments,
  resolveSyntheticFault,
  type SyntheticFaultPlan,
  type SyntheticFaultSource,
  type SyntheticFixtureArguments,
  type SyntheticStepIdentity,
} from "./synthetic-fault-plan";

export interface SyntheticToolExecutorOptions {
  runId: string;
  seed: number;
  identity: SyntheticStepIdentity;
  faultPlan: SyntheticFaultPlan;
  faultSource?: SyntheticFaultSource;
  taskLifecycle?: {
    autonomyMode: "continuous";
    cadenceSeconds: number;
    createdAt: Date;
    cycleCount: number;
  };
}

function result(
  content: string,
  toolOutcome: ToolExecutionResult["toolOutcome"],
): ToolExecutionResult {
  return {
    content,
    createdTasks: [],
    createdAgents: [],
    toolOutcome,
  };
}

function parseFixtureArguments(
  rawArgs: string,
): SyntheticFixtureArguments | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArgs || "{}");
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const value = parsed as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  if (
    keys.join("\u0000") !== ["operationKey", "runId", "value"].join("\u0000")
  ) {
    return null;
  }
  if (
    typeof value.runId !== "string" ||
    typeof value.operationKey !== "string" ||
    typeof value.value !== "string" ||
    Buffer.byteLength(value.runId, "utf8") > 128 ||
    !/^synthetic:v1:[a-f0-9]{64}$/u.test(value.operationKey) ||
    !/^work-unit:[a-f0-9]{32}$/u.test(value.value)
  ) {
    return null;
  }
  return {
    runId: value.runId,
    operationKey: value.operationKey,
    value: value.value,
  };
}

function exactFixtureArguments(
  left: SyntheticFixtureArguments,
  right: SyntheticFixtureArguments,
): boolean {
  return (
    left.runId === right.runId &&
    left.operationKey === right.operationKey &&
    left.value === right.value
  );
}

export function createSyntheticToolExecutor(
  options: SyntheticToolExecutorOptions,
): typeof executeTool {
  const expected = buildSyntheticFixtureArguments(options);
  return async (context: ToolRuntimeContext, name: string, rawArgs: string) => {
    if (name !== SYNTHETIC_FIXTURE_TOOL_NAME) {
      return result(
        "ENGELLENDI: sentetik endurance çalıştırıcısı yalnız kendi veritabanı fixture aracını kabul eder.",
        "rejected",
      );
    }
    const parsed = parseFixtureArguments(rawArgs);
    if (!parsed || !exactFixtureArguments(parsed, expected)) {
      return result(
        "ENGELLENDI: sentetik fixture argümanları doğrulanamadı.",
        "rejected",
      );
    }
    if (
      context.taskId !== options.identity.taskId ||
      context.operationIdentity?.executionKind !== "task_step" ||
      !context.runtimeAttemptId ||
      context.preapprovedAction
    ) {
      return result(
        "ENGELLENDI: sentetik fixture yalnız tam kimlikli endurance task adımında çalışır.",
        "rejected",
      );
    }
    const fault = options.faultSource
      ? await options.faultSource.resolve(options.identity)
      : resolveSyntheticFault(options.faultPlan, options.identity);
    if (
      fault.outcome === "timeout" ||
      fault.outcome === "rate_limit" ||
      fault.outcome === "malformed"
    ) {
      return result(
        "ENGELLENDI: model katmanı için ayrılmış sentetik hata araca ulaşmamalıdır.",
        "rejected",
      );
    }
    const valueHash = `sha256:${createHash("sha256")
      .update(parsed.value, "utf8")
      .digest("hex")}`;
    const effectResult = await runDurableExternalEffect(context, {
      toolName: SYNTHETIC_FIXTURE_TOOL_NAME,
      normalizedArgs: {
        schemaVersion: 1,
        runId: options.runId,
        operationKey: parsed.operationKey,
        valueHash,
      },
      execute: async ({ startEffect }) => {
        await startEffect();
        if (fault.outcome === "unknown_outcome") {
          return {
            result: result(
              "Sentetik fixture etkisi başladı ancak sonucu doğrulanamadı.",
              "unknown",
            ),
          };
        }
        return {
          result: result(
            "Sentetik fixture kalıcı olarak kaydedildi.",
            "succeeded",
          ),
          resultData: {
            schemaVersion: 1,
            runId: options.runId,
            operationKey: parsed.operationKey,
            valueHash,
            ok: true,
          },
        };
      },
      onError: async () =>
        result(
          "Sentetik fixture kalıcı biçimde tamamlanamadı; ham hata saklanmadı.",
          "rejected",
        ),
    });
    if (effectResult.toolOutcome !== "succeeded" || !options.taskLifecycle) {
      return effectResult;
    }
    const lifecycle = options.taskLifecycle;
    const createdAtMs = lifecycle.createdAt.getTime();
    if (
      lifecycle.autonomyMode !== "continuous" ||
      !Number.isSafeInteger(lifecycle.cadenceSeconds) ||
      lifecycle.cadenceSeconds < 60 ||
      lifecycle.cadenceSeconds > 604_800 ||
      !Number.isSafeInteger(lifecycle.cycleCount) ||
      lifecycle.cycleCount < 0 ||
      !Number.isFinite(createdAtMs)
    ) {
      throw new Error("Synthetic lifecycle metadata is invalid.");
    }
    const nextRunAt = new Date(
      createdAtMs +
        (lifecycle.cycleCount + 1) * lifecycle.cadenceSeconds * 1_000,
    );
    if (!Number.isFinite(nextRunAt.getTime())) {
      throw new Error("Synthetic lifecycle cadence exceeds the date range.");
    }
    return {
      ...effectResult,
      durableTaskLifecycleIntent: {
        kind: "complete",
        resultSummary: `Synthetic endurance work unit completed for run ${options.runId}.`,
        continuous: true,
        cycleCompletedAt: new Date(),
        nextRunAt,
        judgeVerdict: "pass",
        allowActiveContinuousChildren: true,
      },
    };
  };
}
