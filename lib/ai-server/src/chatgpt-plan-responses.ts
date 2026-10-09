import type OpenAI from "openai";
import { observeCompletionResponseUsage } from "./completion-usage-observer";
import type { ChatGPTRegistration } from "./chatgpt-plan-types";
import type {
  UnifiedChatCompletionParams,
  UnifiedCompletion,
} from "./openrouter";

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const MODELS_URL = "https://api.openai.com/v1/models";
const TOOL_NAMESPACE = "local_tools";
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_STREAM_BYTES = 16 * 1024 * 1024;
const MAX_EVENT_BYTES = 8 * 1024 * 1024;
const MAX_ARGUMENT_BYTES = 256 * 1024;
type JsonObject = Record<string, unknown>;
type Message = OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam;
type Usage = NonNullable<UnifiedCompletion["usage"]>;
export type PlanInferenceFailureKind =
  | "sign_in_required"
  | "permission"
  | "unsupported"
  | "account_changed"
  | "quota"
  | "temporary"
  | "failed"
  | "incomplete"
  | "interrupted"
  | "protocol"
  | "cancelled"
  | "timeout";

/** Safe diagnostics only: never retain an upstream body, message or exception. */
export class PlanInferenceError extends Error {
  readonly name = "PlanInferenceError";
  constructor(
    readonly kind: PlanInferenceFailureKind,
    readonly usage: Usage | null = null,
    readonly code: string | null = null,
    readonly status: number | null = null,
    readonly requestId: string | null = null,
    readonly bodyShape:
      "error" | "detail" | "other" | "empty" | "stream" | null = null,
    readonly param: string | null = null,
    readonly retryAt: number | null = null,
    readonly requestStarted: boolean = status !== null,
  ) {
    super(`chatgpt_plan_${kind}`);
  }
}

interface TransportOptions {
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}
interface Replay {
  accountKey: string;
  output: JsonObject[];
  requestId: string | null;
}
// Ephemeral, backend-only continuity. Ordinary JSON serialization has no replay
// data or encrypted reasoning; callers explicitly preserve it through the helper.
const completionReplay = new WeakMap<UnifiedCompletion, Replay>();
const messageReplay = new WeakMap<object, Replay>();

export function chatGPTPlanRequestId(
  completion: UnifiedCompletion,
): string | null {
  return completionReplay.get(completion)?.requestId ?? null;
}

export function chatGPTPlanHistoryMessage(
  completion: UnifiedCompletion,
): Message {
  const message = completion.choices[0]?.message;
  if (!message) throw new PlanInferenceError("protocol");
  const history: Message = {
    role: "assistant",
    content: message.content,
    ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
  };
  const replay = completionReplay.get(completion);
  if (replay) messageReplay.set(history, replay);
  return history;
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}
function safeSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(value)
  );
}
export function resolveChatGPTPlanModelId(value: string): string | null {
  const slug = value.startsWith("chatgpt:") ? value.slice(8) : null;
  return safeSlug(slug) ? slug : null;
}
function accountKey(account: ChatGPTRegistration): string {
  return `${account.id}:${account.accountId}:${account.clientId}`;
}
function authorize(account: ChatGPTRegistration, now: number): string {
  const credentials = account.credentials;
  if (!credentials || credentials.expiresAt <= now)
    throw new PlanInferenceError("sign_in_required");
  if (
    !credentials.grants.includes("resource.invoke") ||
    !credentials.grants.includes("chatgpt.tokens.use.direct")
  )
    throw new PlanInferenceError("permission");
  if (!/^[\x21-\x7e]{1,32768}$/u.test(credentials.accessToken))
    throw new PlanInferenceError("sign_in_required");
  return credentials.accessToken;
}
function plainText(content: unknown): string {
  if (typeof content === "string") return content;
  if (
    Array.isArray(content) &&
    content.every(
      (part) =>
        object(part)?.type === "text" && typeof object(part)?.text === "string",
    )
  )
    return content.map((part) => (part as { text: string }).text).join("");
  throw new PlanInferenceError("unsupported");
}
function argumentObject(
  value: unknown,
  kind: PlanInferenceFailureKind,
): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value) > MAX_ARGUMENT_BYTES
  )
    throw new PlanInferenceError(kind);
  try {
    if (!object(JSON.parse(value))) throw new Error("not_object");
  } catch {
    throw new PlanInferenceError(kind);
  }
  return value;
}

function requestBody(
  params: UnifiedChatCompletionParams,
  account: ChatGPTRegistration,
) {
  const permitted = new Set([
    "model",
    "messages",
    "tools",
    "responseFormat",
    "signal",
    "disableRetries",
    "beforeRequest",
    "onResponseUsage",
  ]);
  if (
    Object.keys(params).some(
      (key) =>
        !permitted.has(key) &&
        (params as unknown as JsonObject)[key] !== undefined,
    )
  )
    throw new PlanInferenceError("unsupported");
  const model = resolveChatGPTPlanModelId(params.model);
  if (
    !model ||
    !Array.isArray(params.messages) ||
    params.messages.length > 512 ||
    (params.tools &&
      (!Array.isArray(params.tools) || params.tools.length > 256))
  )
    throw new PlanInferenceError("unsupported");
  const names = new Set<string>();
  const tools = (params.tools ?? []).map((tool) => {
    if (
      tool.type !== "function" ||
      !object(tool.function) ||
      !safeSlug(tool.function.name) ||
      names.has(tool.function.name) ||
      Object.keys(tool).some((key) => !["type", "function"].includes(key)) ||
      Object.keys(tool.function).some(
        (key) => !["name", "description", "parameters", "strict"].includes(key),
      ) ||
      (tool.function.parameters !== undefined &&
        !object(tool.function.parameters)) ||
      (tool.function.description !== undefined &&
        typeof tool.function.description !== "string") ||
      (tool.function.strict != null &&
        typeof tool.function.strict !== "boolean")
    )
      throw new PlanInferenceError("unsupported");
    names.add(tool.function.name);
    return {
      type: "function",
      name: tool.function.name,
      ...(tool.function.description !== undefined
        ? { description: tool.function.description }
        : {}),
      parameters: tool.function.parameters ?? {
        type: "object",
        properties: {},
      },
      strict: tool.function.strict ?? false,
    };
  });
  const input: JsonObject[] = [];
  const pendingCalls = new Set<string>();
  const seenCalls = new Set<string>();
  const addCall = (value: unknown) => {
    if (!safeSlug(value) || seenCalls.has(value))
      throw new PlanInferenceError("unsupported");
    pendingCalls.add(value);
    seenCalls.add(value);
  };
  for (const message of params.messages) {
    const replay = messageReplay.get(message);
    if (replay) {
      if (replay.accountKey !== accountKey(account))
        throw new PlanInferenceError("account_changed");
      for (const item of replay.output) {
        if (item.type === "function_call") addCall(item.call_id);
        input.push(item);
      }
      continue;
    }
    if (message.role === "tool") {
      if (!pendingCalls.delete(message.tool_call_id))
        throw new PlanInferenceError("unsupported");
      input.push({
        type: "function_call_output",
        call_id: message.tool_call_id,
        output: plainText(message.content),
      });
    } else if (["system", "developer", "user"].includes(message.role)) {
      input.push({
        role: message.role === "system" ? "developer" : message.role,
        content: plainText(message.content),
      });
    } else if (message.role === "assistant") {
      if (message.audio || message.function_call || message.refusal)
        throw new PlanInferenceError("unsupported");
      if (message.content !== null && message.content !== undefined)
        input.push({ role: "assistant", content: plainText(message.content) });
      for (const call of message.tool_calls ?? []) {
        if (call.type !== "function" || !safeSlug(call.function.name))
          throw new PlanInferenceError("unsupported");
        addCall(call.id);
        input.push({
          type: "function_call",
          call_id: call.id,
          namespace: TOOL_NAMESPACE,
          name: call.function.name,
          arguments: argumentObject(call.function.arguments, "unsupported"),
        });
      }
    } else throw new PlanInferenceError("unsupported");
  }
  if (pendingCalls.size) throw new PlanInferenceError("unsupported");
  if (
    params.responseFormat &&
    !["text", "json_object"].includes(params.responseFormat.type)
  )
    throw new PlanInferenceError("unsupported");
  const body = {
    model,
    input,
    store: false,
    stream: true,
    ...(tools.length
      ? { tools: [{ type: "namespace", name: TOOL_NAMESPACE, tools }] }
      : {}),
    ...(params.responseFormat
      ? { text: { format: params.responseFormat } }
      : {}),
  };
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized) > MAX_BODY_BYTES)
    throw new PlanInferenceError("unsupported");
  return { serialized, model, names, seenCalls };
}

function readUsage(value: unknown): Usage | null {
  const usage = object(value);
  if (
    !usage ||
    ![usage.input_tokens, usage.output_tokens, usage.total_tokens].every(
      (n) => Number.isSafeInteger(n) && Number(n) >= 0,
    )
  )
    return null;
  return {
    prompt_tokens: usage.input_tokens as number,
    completion_tokens: usage.output_tokens as number,
    total_tokens: usage.total_tokens as number,
  };
}
const KNOWN_CODES = new Set([
  "subscription_sharing_user_not_eligible",
  "subscription_sharing_usage_limit_exceeded",
  "subscription_sharing_usage_unavailable",
  "subscription_sharing_unsupported_capability",
  "subscription_sharing_route_not_supported",
  "subscription_sharing_invalid_user",
  "chatpass_v2_scope_not_authorized",
  "chatpass_v2_invalid_authorization_context",
  "subscription_sharing_user_unavailable",
  "server_error",
  "rate_limit_exceeded",
  "invalid_api_key",
  "authentication_error",
  "invalid_request_error",
  "model_not_found",
]);
function failureKind(
  code: string | null,
  status: number | null,
): PlanInferenceFailureKind {
  if (
    code === "subscription_sharing_usage_limit_exceeded" ||
    code === "rate_limit_exceeded" ||
    status === 429
  )
    return "quota";
  if (code === "subscription_sharing_unsupported_capability")
    return "unsupported";
  if (
    code === "subscription_sharing_usage_unavailable" ||
    code === "subscription_sharing_user_unavailable" ||
    code === "server_error" ||
    (status !== null && status >= 500)
  )
    return "temporary";
  if (
    status === 401 ||
    status === 403 ||
    code === "subscription_sharing_user_not_eligible" ||
    code === "subscription_sharing_invalid_user" ||
    code?.startsWith("chatpass_v2_")
  )
    return "permission";
  return "failed";
}
function safeRequestId(
  value: unknown,
  account: ChatGPTRegistration,
): string | null {
  if (typeof value !== "string" || !/^[a-zA-Z0-9._-]{1,256}$/u.test(value))
    return null;
  const credentials = account.credentials!;
  return [
    credentials.accessToken,
    credentials.idToken,
    credentials.refreshToken,
  ].some((token) => token && value.includes(token))
    ? null
    : value;
}

interface Observation {
  usage: Usage | null;
  status: number | null;
  requestId: string | null;
  responseId: string | null;
  inferenceStarted: boolean;
}
function errorFromBody(
  body: unknown,
  observation: Observation,
  now: number,
  retryAfter: string | null = null,
): PlanInferenceError {
  const record = object(body),
    error = object(record?.error) ?? record;
  const code =
    typeof error?.code === "string" && KNOWN_CODES.has(error.code)
      ? error.code
      : null;
  const param =
    typeof error?.param === "string" &&
    /^(input|tools|model|text|service_tier|temperature|max_output_tokens|previous_response_id)(\.[a-z_]+|\[\d{1,3}\])*$/u.test(
      error.param,
    )
      ? error.param
      : null;
  let retryAt: number | null = null;
  if (retryAfter && /^\d{1,6}$/u.test(retryAfter))
    retryAt = now + Number(retryAfter) * 1000;
  else if (retryAfter) {
    const parsed = Date.parse(retryAfter);
    if (
      Number.isFinite(parsed) &&
      parsed >= now &&
      parsed <= now + 7 * 86400_000
    )
      retryAt = parsed;
  }
  return new PlanInferenceError(
    failureKind(code, observation.status),
    observation.usage,
    code,
    observation.status,
    observation.requestId,
    object(record?.error)
      ? "error"
      : typeof record?.detail === "string"
        ? "detail"
        : record
          ? "other"
          : "empty",
    param,
    retryAt,
    observation.inferenceStarted,
  );
}

async function deadline<T>(
  action: (signal: AbortSignal) => Promise<T>,
  observation: Observation,
  caller: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const signal = caller
    ? AbortSignal.any([caller, controller.signal])
    : controller.signal;
  let removeListener = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    const stop = () =>
      reject(
        new PlanInferenceError(
          caller?.aborted ? "cancelled" : "timeout",
          observation.usage,
          null,
          observation.status,
          observation.requestId,
          "stream",
          null,
          null,
          observation.inferenceStarted,
        ),
      );
    if (signal.aborted) stop();
    else {
      signal.addEventListener("abort", stop, { once: true });
      removeListener = () => signal.removeEventListener("abort", stop);
    }
  });
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(1, Math.min(600_000, timeoutMs)),
  );
  try {
    if (signal.aborted) return await aborted;
    return await Promise.race([action(signal), aborted]);
  } catch (error) {
    if (error instanceof PlanInferenceError)
      throw new PlanInferenceError(
        error.kind,
        error.usage ?? observation.usage,
        error.code,
        error.status ?? observation.status,
        error.requestId ?? observation.requestId,
        error.bodyShape ?? "stream",
        error.param,
        error.retryAt,
        observation.inferenceStarted,
      );
    throw new PlanInferenceError(
      signal.aborted
        ? caller?.aborted
          ? "cancelled"
          : "timeout"
        : "interrupted",
      observation.usage,
      null,
      observation.status,
      observation.requestId,
      "stream",
      null,
      null,
      observation.inferenceStarted,
    );
  } finally {
    clearTimeout(timer);
    removeListener();
  }
}

async function jsonBody(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "",
    bytes = 0;
  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new PlanInferenceError("protocol");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function* events(
  response: Response,
  signal: AbortSignal,
): AsyncGenerator<JsonObject> {
  if (
    !response.body ||
    !/^text\/event-stream(?:;|$)/iu.test(
      response.headers.get("content-type") ?? "",
    )
  )
    throw new PlanInferenceError("protocol");
  const reader = response.body.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", onAbort, { once: true });
  let pending = "",
    data: string[] = [],
    label = "",
    bytes = 0,
    eventBytes = 0;
  const parse = (): JsonObject | null => {
    if (!data.length) {
      label = "";
      return null;
    }
    const raw = data.join("\n");
    data = [];
    eventBytes = 0;
    if (raw === "[DONE]") {
      label = "";
      return null;
    }
    let event: JsonObject | null = null;
    try {
      event = object(JSON.parse(raw));
    } catch {
      /* sanitized below */
    }
    if (
      !event ||
      typeof event.type !== "string" ||
      (label && label !== event.type)
    )
      throw new PlanInferenceError("protocol");
    label = "";
    return event;
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_STREAM_BYTES) throw new PlanInferenceError("protocol");
      pending += decoder.decode(chunk.value, { stream: true });
      if (Buffer.byteLength(pending) > MAX_EVENT_BYTES)
        throw new PlanInferenceError("protocol");
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline).replace(/\r$/u, "");
        pending = pending.slice(newline + 1);
        if (!line) {
          const event = parse();
          if (event) yield event;
        } else if (line.startsWith("data:")) {
          const value = line.slice(5).replace(/^ /u, "");
          eventBytes += Buffer.byteLength(value);
          if (eventBytes > MAX_EVENT_BYTES)
            throw new PlanInferenceError("protocol");
          data.push(value);
        } else if (line.startsWith("event:")) label = line.slice(6).trim();
      }
    }
    decoder.decode();
    // A truncated event without its terminating blank line is not committed.
  } finally {
    signal.removeEventListener("abort", onAbort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function normalizeResponse(
  response: JsonObject,
  names: Set<string>,
  previousCalls: Set<string>,
): { completion: UnifiedCompletion; output: JsonObject[] } {
  if (
    !safeSlug(response.id) ||
    !safeSlug(response.model) ||
    response.status !== "completed" ||
    response.error ||
    !Number.isSafeInteger(response.created_at) ||
    Number(response.created_at) < 0 ||
    !Array.isArray(response.output)
  )
    throw new PlanInferenceError("protocol");
  const output: JsonObject[] = [],
    text: string[] = [];
  const calls: NonNullable<
    UnifiedCompletion["choices"][number]["message"]["tool_calls"]
  > = [];
  const ids = new Set<string>();
  for (const raw of response.output) {
    const item = object(raw);
    if (!item || !safeSlug(item.id) || ids.has(item.id))
      throw new PlanInferenceError("protocol");
    ids.add(item.id);
    if (item.type === "function_call") {
      if (
        !safeSlug(item.call_id) ||
        ids.has(item.call_id) ||
        !safeSlug(item.name) ||
        !names.has(item.name) ||
        previousCalls.has(item.call_id) ||
        item.async === true ||
        (item.caller != null && object(item.caller)?.type !== "direct") ||
        item.namespace !== TOOL_NAMESPACE ||
        (item.status !== undefined && item.status !== "completed")
      )
        throw new PlanInferenceError("protocol");
      ids.add(item.call_id);
      const args = argumentObject(item.arguments, "protocol");
      calls.push({
        id: item.call_id,
        type: "function",
        function: { name: item.name, arguments: args },
      });
      output.push({
        type: "function_call",
        id: item.id,
        call_id: item.call_id,
        namespace: TOOL_NAMESPACE,
        name: item.name,
        arguments: args,
        ...(item.status ? { status: item.status } : {}),
      });
    } else if (item.type === "message") {
      if (
        item.role !== "assistant" ||
        item.status !== "completed" ||
        !Array.isArray(item.content) ||
        (item.phase != null &&
          !["commentary", "final_answer"].includes(String(item.phase)))
      )
        throw new PlanInferenceError("protocol");
      const content: JsonObject[] = [];
      for (const rawPart of item.content) {
        const part = object(rawPart);
        if (part?.type === "output_text" && typeof part.text === "string") {
          text.push(part.text);
          content.push({
            type: "output_text",
            text: part.text,
            annotations: [],
          });
        } else if (
          part?.type === "refusal" &&
          typeof part.refusal === "string"
        ) {
          text.push(part.refusal);
          content.push({ type: "refusal", refusal: part.refusal });
        } else throw new PlanInferenceError("protocol");
      }
      output.push({
        type: "message",
        id: item.id,
        role: "assistant",
        status: "completed",
        ...(item.phase !== undefined ? { phase: item.phase } : {}),
        content,
      });
    } else if (item.type === "reasoning") {
      if (
        typeof item.encrypted_content !== "string" ||
        !Array.isArray(item.summary)
      )
        throw new PlanInferenceError("protocol");
      const summary = item.summary.map((rawPart) => {
        const part = object(rawPart);
        if (part?.type !== "summary_text" || typeof part.text !== "string")
          throw new PlanInferenceError("protocol");
        return { type: "summary_text", text: part.text };
      });
      output.push({
        type: "reasoning",
        id: item.id,
        summary,
        encrypted_content: item.encrypted_content,
      });
    } else throw new PlanInferenceError("protocol");
  }
  const usage = readUsage(response.usage);
  return {
    output,
    completion: {
      id: response.id,
      object: "chat.completion",
      created: response.created_at as number,
      model: `chatgpt:${response.model}`,
      choices: [
        {
          index: 0,
          finish_reason: calls.length ? "tool_calls" : "stop",
          logprobs: null,
          message: {
            role: "assistant",
            content: text.length ? text.join("\n") : null,
            refusal: null,
            ...(calls.length ? { tool_calls: calls } : {}),
          },
        },
      ],
      ...(usage ? { usage } : {}),
    },
  };
}

/** Single billable attempt. Recovery never silently changes account or provider. */
export async function completeChatGPTPlanResponse(
  params: UnifiedChatCompletionParams,
  account: ChatGPTRegistration,
  options: TransportOptions = {},
): Promise<UnifiedCompletion> {
  const now = options.now ?? Date.now;
  const token = authorize(account, now()),
    body = requestBody(params, account);
  const observation: Observation = {
    usage: null,
    status: null,
    requestId: null,
    responseId: null,
    inferenceStarted: false,
  };
  return deadline(
    async (signal) => {
      signal.throwIfAborted();
      await params.beforeRequest?.();
      signal.throwIfAborted();
      observation.inferenceStarted = true;
      const response = await (options.fetch ?? globalThis.fetch)(
        RESPONSES_URL,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: body.serialized,
          redirect: "error",
          credentials: "omit",
          signal,
        },
      );
      if (signal.aborted) {
        void response.body?.cancel().catch(() => {});
        signal.throwIfAborted();
      }
      observation.status = response.status;
      observation.requestId = safeRequestId(
        response.headers.get("x-request-id"),
        account,
      );
      if (response.status !== 200) {
        throw errorFromBody(
          await jsonBody(response, signal),
          observation,
          now(),
          response.headers.get("retry-after"),
        );
      }
      try {
        for await (const event of events(response, signal)) {
          const value = object(event.response);
          if (value) {
            const usage = readUsage(value.usage);
            if (usage) observation.usage = usage;
            if (typeof value.id === "string") {
              if (
                !safeSlug(value.id) ||
                (observation.responseId && observation.responseId !== value.id)
              )
                throw new PlanInferenceError("protocol");
              observation.responseId = value.id;
            }
          }
          if (event.type === "response.failed" || event.type === "error")
            throw errorFromBody(
              event.type === "error" ? event : value,
              observation,
              now(),
            );
          if (event.type === "response.incomplete")
            throw new PlanInferenceError(
              "incomplete",
              observation.usage,
              null,
              observation.status,
              observation.requestId,
              "stream",
            );
          if (event.type === "response.completed") {
            if (!value) throw new PlanInferenceError("protocol");
            // The service may report a canonical model version for a selected alias.
            const normalized = normalizeResponse(
              value,
              body.names,
              body.seenCalls,
            );
            completionReplay.set(normalized.completion, {
              accountKey: accountKey(account),
              output: normalized.output,
              requestId: observation.requestId,
            });
            await observeCompletionResponseUsage(
              params,
              normalized.completion,
              "chatgpt",
            );
            return normalized.completion;
          }
        }
        throw new PlanInferenceError(
          "interrupted",
          observation.usage,
          null,
          observation.status,
          observation.requestId,
          "stream",
        );
      } catch (error) {
        if (
          error instanceof PlanInferenceError &&
          error.usage === null &&
          observation.usage !== null
        )
          throw new PlanInferenceError(
            error.kind,
            observation.usage,
            error.code,
            observation.status,
            observation.requestId,
            error.bodyShape ?? "stream",
            error.param,
            error.retryAt,
          );
        throw error;
      }
    },
    observation,
    params.signal,
    options.timeoutMs ?? 120_000,
  );
}

export async function listChatGPTPlanModels(
  account: ChatGPTRegistration,
  options: TransportOptions & { signal?: AbortSignal } = {},
): Promise<Array<{ id: string; label: string }>> {
  const now = options.now ?? Date.now,
    token = authorize(account, now());
  const observation: Observation = {
    usage: null,
    status: null,
    requestId: null,
    responseId: null,
    inferenceStarted: false,
  };
  return deadline(
    async (signal) => {
      const response = await (options.fetch ?? globalThis.fetch)(MODELS_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        redirect: "error",
        credentials: "omit",
        signal,
      });
      observation.status = response.status;
      observation.requestId = safeRequestId(
        response.headers.get("x-request-id"),
        account,
      );
      if (signal.aborted) {
        void response.body?.cancel().catch(() => {});
        signal.throwIfAborted();
      }
      const result = await jsonBody(response, signal);
      if (response.status !== 200)
        throw errorFromBody(
          result,
          observation,
          now(),
          response.headers.get("retry-after"),
        );
      const models = object(result)?.models;
      if (!Array.isArray(models) || models.length > 5000)
        throw new PlanInferenceError("protocol");
      const seen = new Set<string>(),
        visible: Array<{ id: string; label: string }> = [];
      for (const raw of models) {
        const model = object(raw);
        if (model?.visibility !== "list") continue;
        if (
          !safeSlug(model.slug) ||
          seen.has(model.slug) ||
          typeof model.display_name !== "string" ||
          !model.display_name.trim() ||
          model.display_name.length > 256 ||
          /[\u0000-\u001f\u007f]/u.test(model.display_name)
        )
          throw new PlanInferenceError("protocol");
        seen.add(model.slug);
        visible.push({
          id: `chatgpt:${model.slug}`,
          label: model.display_name,
        });
      }
      return visible;
    },
    observation,
    options.signal,
    options.timeoutMs ?? 10_000,
  );
}
