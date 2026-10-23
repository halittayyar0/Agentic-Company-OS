import { createHash } from "node:crypto";
import {
  assertOllamaRequestCurrent,
  prepareOllamaInferenceRequest,
  type OllamaInferenceRequest,
} from "@workspace/ai-server";
import type { OperationReceipt } from "@workspace/db";
import { canonicalArgumentHash } from "./operation-receipts";

type Authority = Pick<
  OllamaInferenceRequest,
  "origin" | "generation" | "boundary"
>;
type Scope = {
  taskId: number;
  agentId: number;
  originAttemptId: string;
  logicalExecutionId: string;
};
type ReadReceipt = Pick<
  OperationReceipt,
  | "id"
  | "toolName"
  | "executionKind"
  | "sideEffectClass"
  | "state"
  | "reconciliationDecision"
  | "argumentHash"
  | "finishedAt"
  | "taskId"
  | "agentId"
  | "originAttemptId"
  | "logicalExecutionId"
>;
type FileRead = {
  path: string;
  content: string;
  sizeBytes: number;
  version: string;
  truncated: boolean;
  editable: boolean;
};
type Document = NonNullable<ReturnType<typeof prepareLocalFileObservation>> & {
  receiptId: string;
};
type Captured = {
  observation: Omit<Document, "receiptId">;
  argumentHash: string;
  modelId: string;
  authority: Authority;
};
type Route = { provider: string; modelId: string };

const FILE_BYTE_LIMIT = 4096;
const DOCUMENT_LIMIT = 4;
// Leave room for the scope/count envelope inside the 16384-byte private payload.
const PAYLOAD_BYTE_LIMIT = 16000;

/** Exact encoding used by the prompt, also used for its byte admission bound. */
export function privateSourceXml(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Complete, small, round-tripping UTF-8 from the original read, never a reread. */
export function prepareLocalFileObservation(
  args: Record<string, unknown>,
  file: FileRead,
) {
  if (
    Object.keys(args).length !== 1 ||
    typeof args.path !== "string" ||
    !args.path ||
    args.path.trim() !== args.path ||
    args.path.length > 1024 ||
    /[\u0000-\u001f\u007f]/u.test(args.path) ||
    !file.path ||
    file.path.length > 1024 ||
    /[\u0000-\u001f\u007f]/u.test(file.path) ||
    file.truncated ||
    !file.editable ||
    file.content.includes("\0") ||
    !Number.isSafeInteger(file.sizeBytes) ||
    file.sizeBytes < 0 ||
    file.sizeBytes > FILE_BYTE_LIMIT
  )
    return null;
  const bytes = Buffer.from(file.content, "utf8");
  if (
    bytes.length !== file.sizeBytes ||
    bytes.toString("utf8") !== file.content ||
    !/^[0-9a-f]{64}$/u.test(file.version) ||
    createHash("sha256").update(bytes).digest("hex") !== file.version
  )
    return null;
  return Object.freeze({
    requestedPath: args.path,
    resolvedPath: file.path,
    sha256: file.version,
    byteCount: file.sizeBytes,
    content: file.content,
  });
}

export interface PrivateLocalSourceReview {
  readonly taskId: number;
  readonly agentId: number;
  readonly modelId: string;
  readonly scope: "current_task_step_reads";
  readonly documents: readonly Readonly<Document>[];
  readonly omittedReads: number;
  assertCurrent(route: Route): void;
}

/**
 * One stepTask invocation owns this object. No global cache, database storage,
 * receipt output, API DTO or backup retains its sources. A restart/new step has
 * no observations; that absence is an evidence gap, never proof of success.
 */
export class LocalSourceReview {
  readonly #scope: Scope;
  readonly #pending = new Map<string, Captured>();
  readonly #confirmed: Array<Captured & { receiptId: string }> = [];
  #omittedReads = 0;
  readonly #prepareAuthority: (modelId: string) => Promise<Authority | null>;
  readonly #assertAuthority: (authority: Authority) => void;

  constructor(
    scope: Scope,
    dependencies: {
      prepareAuthority?: (modelId: string) => Promise<Authority | null>;
      assertAuthority?: (authority: Authority) => void;
    } = {},
  ) {
    this.#scope = Object.freeze({ ...scope });
    this.#prepareAuthority =
      dependencies.prepareAuthority ??
      (async (modelId) => {
        const request = await prepareOllamaInferenceRequest(modelId);
        return {
          origin: request.origin,
          generation: request.generation,
          boundary: request.boundary,
        };
      });
    this.#assertAuthority =
      dependencies.assertAuthority ?? assertOllamaRequestCurrent;
  }

  async stageRead(
    slot: string,
    modelId: string | undefined,
    args: Record<string, unknown>,
    file: FileRead,
  ): Promise<void> {
    this.#pending.delete(slot);
    if (!modelId?.startsWith("ollama:")) return;
    const observation = prepareLocalFileObservation(args, file);
    if (
      !observation ||
      this.#confirmed.length + this.#pending.size >= DOCUMENT_LIMIT
    ) {
      this.#omittedReads++;
      return;
    }
    try {
      const authority = await this.#prepareAuthority(modelId);
      if (!authority || authority.boundary !== "local") {
        this.#omittedReads++;
        return;
      }
      this.#assertAuthority(authority);
      this.#pending.set(slot, {
        observation,
        argumentHash: canonicalArgumentHash(args),
        modelId,
        authority: Object.freeze({ ...authority }),
      });
    } catch {
      // Provider preparation contains no source text. Missing authority means
      // no private handoff, and must not turn a valid file read into a failure.
      this.#omittedReads++;
    }
  }

  discardRead(slot: string): void {
    this.#pending.delete(slot);
  }

  confirmRead(slot: string, receipt: ReadReceipt): void {
    const pending = this.#pending.get(slot);
    this.#pending.delete(slot);
    if (!pending) return;
    const scope = this.#scope;
    if (
      receipt.toolName !== "vm_read_file" ||
      receipt.executionKind !== "task_step" ||
      receipt.sideEffectClass !== "read_only" ||
      receipt.state !== "succeeded" ||
      receipt.reconciliationDecision !== null ||
      !receipt.finishedAt ||
      receipt.taskId !== scope.taskId ||
      receipt.agentId !== scope.agentId ||
      receipt.originAttemptId !== scope.originAttemptId ||
      receipt.logicalExecutionId !== scope.logicalExecutionId ||
      receipt.argumentHash !== pending.argumentHash ||
      !receipt.id ||
      receipt.id.length > 120
    ) {
      this.#omittedReads++;
      return;
    }
    const next = { ...pending, receiptId: receipt.id };
    const documents = [...this.#confirmed, next].map(
      ({ observation, receiptId }) => ({ ...observation, receiptId }),
    );
    if (
      Buffer.byteLength(privateSourceXml(documents), "utf8") >
      PAYLOAD_BYTE_LIMIT
    ) {
      this.#omittedReads++;
      return;
    }
    this.#confirmed.push(next);
  }

  forJudge(
    modelId: string | null | undefined,
  ): PrivateLocalSourceReview | undefined {
    if (!modelId?.startsWith("ollama:")) return undefined;
    const selected = this.#confirmed.filter((item) => item.modelId === modelId);
    if (!selected.length) return undefined;
    const assertCurrent = (route: Route) => {
      if (route.provider !== "ollama" || route.modelId !== modelId)
        throw new Error(
          "Private source review must retain its original local model.",
        );
      for (const item of selected) this.#assertAuthority(item.authority);
    };
    try {
      assertCurrent({ provider: "ollama", modelId });
    } catch {
      return undefined;
    }
    return Object.freeze({
      taskId: this.#scope.taskId,
      agentId: this.#scope.agentId,
      modelId,
      scope: "current_task_step_reads" as const,
      documents: Object.freeze(
        selected.map(({ observation, receiptId }) =>
          Object.freeze({ ...observation, receiptId }),
        ),
      ),
      omittedReads:
        this.#omittedReads + this.#confirmed.length - selected.length,
      assertCurrent,
    });
  }
}
