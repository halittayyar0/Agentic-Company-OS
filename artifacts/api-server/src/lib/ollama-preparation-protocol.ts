export interface OllamaPullProgress {
  phase: "preparing" | "downloading" | "checking" | "downloaded";
  observedCompletedBytes: number;
  observedTotalBytes: number;
  progressReset: boolean;
  pullComplete: boolean;
}

export type OllamaPreparationProtocolCode =
  | "INVALID_PROGRESS"
  | "FRAME_TOO_LARGE"
  | "TOO_MANY_LAYERS"
  | "MODEL_TOO_LARGE"
  | "UPSTREAM_ERROR"
  | "INCOMPLETE_PROGRESS"
  | "STREAM_FAILED";

export class OllamaPreparationProtocolError extends Error {
  constructor(readonly code: OllamaPreparationProtocolCode) {
    super(code);
    this.name = "OllamaPreparationProtocolError";
  }
}

const MAX_FRAME_BYTES = 64 * 1024;
const MAX_LAYERS = 32;
const MAX_OBSERVED_BYTES = 3 * 1024 ** 3;
const DIGEST = /^sha256:[a-f0-9]{64}$/;

function invalid(): never {
  throw new OllamaPreparationProtocolError("INVALID_PROGRESS");
}

function counter(value: unknown): number {
  // Ollama's Go response omits zero-valued counters.
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    invalid();
  return value;
}

export async function* readOllamaPullProgress(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<OllamaPullProgress> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const layers = new Map<string, { total: number; completed: number }>();
  const frame = new Uint8Array(MAX_FRAME_BYTES);
  let frameLength = 0;
  let acknowledged = false;
  let finished = false;

  const parse = (): OllamaPullProgress | undefined => {
    let line: string;
    try {
      line = decoder.decode(frame.subarray(0, frameLength)).trim();
    } catch {
      return invalid();
    }
    frameLength = 0;
    if (!line) return;
    if (acknowledged) invalid();
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return invalid();
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      invalid();
    const event = parsed as Record<string, unknown>;
    if ("error" in event)
      throw new OllamaPreparationProtocolError("UPSTREAM_ERROR");
    if (typeof event.status !== "string" || !event.status.trim()) invalid();
    let progressReset = false;
    if (event.digest !== undefined) {
      if (typeof event.digest !== "string" || !DIGEST.test(event.digest))
        invalid();
      const total = counter(event.total);
      const completed = counter(event.completed);
      if (completed > total) invalid();
      const previous = layers.get(event.digest);
      if (previous && previous.total !== total) invalid();
      if (!previous && layers.size >= MAX_LAYERS)
        throw new OllamaPreparationProtocolError("TOO_MANY_LAYERS");
      progressReset = previous !== undefined && completed < previous.completed;
      layers.set(event.digest, { total, completed });
    } else if (event.total !== undefined || event.completed !== undefined) {
      invalid();
    }
    let observedCompletedBytes = 0;
    let observedTotalBytes = 0;
    for (const layer of layers.values()) {
      observedCompletedBytes += layer.completed;
      observedTotalBytes += layer.total;
    }
    if (observedTotalBytes > MAX_OBSERVED_BYTES)
      throw new OllamaPreparationProtocolError("MODEL_TOO_LARGE");
    acknowledged = event.status === "success";
    return {
      phase: acknowledged
        ? "downloaded"
        : event.digest !== undefined
          ? "downloading"
          : event.status.startsWith("verifying") ||
              event.status === "writing manifest" ||
              event.status === "removing any unused layers"
            ? "checking"
            : "preparing",
      observedCompletedBytes,
      observedTotalBytes,
      progressReset,
      pullComplete: acknowledged,
    };
  };

  try {
    while (true) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch {
        throw new OllamaPreparationProtocolError("STREAM_FAILED");
      }
      if (chunk.done) break;
      let offset = 0;
      while (offset < chunk.value.byteLength) {
        const newline = chunk.value.indexOf(10, offset);
        const end = newline < 0 ? chunk.value.byteLength : newline;
        const length = end - offset;
        if (frameLength + length > MAX_FRAME_BYTES)
          throw new OllamaPreparationProtocolError("FRAME_TOO_LARGE");
        frame.set(chunk.value.subarray(offset, end), frameLength);
        frameLength += length;
        offset = end + 1;
        if (newline >= 0) {
          const event = parse();
          if (event) yield event;
        }
      }
    }
    if (frameLength) {
      const event = parse();
      if (event) yield event;
    }
    if (!acknowledged)
      throw new OllamaPreparationProtocolError("INCOMPLETE_PROGRESS");
    finished = true;
  } finally {
    try {
      if (!finished) await reader.cancel().catch(() => undefined);
    } finally {
      reader.releaseLock();
    }
  }
}
