import assert from "node:assert/strict";
import test from "node:test";
import * as protocol from "./ollama-preparation-protocol.js";
const { readOllamaPullProgress } = protocol;

const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;

test("starter preparation reads split layers and acknowledges download without claiming readiness", async () => {
  const protocolPath = "./ollama-preparation-protocol.js";
  const catalogPath = "./ollama-preparation-catalog.js";
  const protocol = await import(protocolPath).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ERR_MODULE_NOT_FOUND") return null;
      throw error;
    },
  );
  assert.ok(protocol, "local model progress support must exist");
  const { starterModelRecipe } = await import(catalogPath);
  assert.equal(starterModelRecipe.id, "qwen35-2b");
  assert.equal(starterModelRecipe.model, "qwen3.5:2b-q4_K_M");
  assert.equal(starterModelRecipe.minimumRuntimeVersion, "0.40.3");
  assert.equal(starterModelRecipe.estimatedBytes, 1_945_782_446);
  const text = [
    { status: "pulling manifest" },
    { status: "pulling a", digest: digestA, total: 100, completed: 20 },
    { status: "pulling a", digest: digestA, total: 100, completed: 100 },
    { status: "pulling b", digest: digestB, total: 50, completed: 50 },
    { status: "verifying sha256 digest" },
    { status: "success" },
  ]
    .map((event) => JSON.stringify(event))
    .join("\r\n");
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += 17)
        controller.enqueue(bytes.slice(offset, offset + 17));
      controller.close();
    },
  });
  const events = [];
  for await (const event of protocol.readOllamaPullProgress(stream))
    events.push(event);
  assert.deepEqual(
    events.map((event) => event.phase),
    [
      "preparing",
      "downloading",
      "downloading",
      "downloading",
      "checking",
      "downloaded",
    ],
  );
  assert.deepEqual(events.at(-1), {
    phase: "downloaded",
    observedCompletedBytes: 150,
    observedTotalBytes: 150,
    progressReset: false,
    pullComplete: true,
  });
  assert.equal(
    events.some((event) => "ready" in event),
    false,
  );
  assert.equal(stream.locked, false);
});

function bodyOf(events: unknown[]): ReadableStream<Uint8Array> {
  return bytesOf(
    new TextEncoder().encode(
      events.map((event) => JSON.stringify(event)).join("\n"),
    ),
  );
}

function bytesOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>) {
  const events = [];
  for await (const event of readOllamaPullProgress(body)) events.push(event);
  return events;
}

async function fails(body: ReadableStream<Uint8Array>, code: string) {
  await assert.rejects(collect(body), (error: unknown) => {
    assert.ok(
      "OllamaPreparationProtocolError" in protocol,
      "protocol failures must have fixed typed codes",
    );
    assert.ok(error instanceof protocol.OllamaPreparationProtocolError);
    assert.equal(error.code, code);
    assert.equal(String(error).includes("PRIVATE_SENTINEL"), false);
    assert.equal("cause" in error, false);
    return true;
  });
  assert.equal(body.locked, false);
}

test("omitted zero counters and split UTF-8 are valid; byte regression remains visible", async () => {
  const encoded = new TextEncoder().encode(
    [
      { status: "pulling 层", digest: digestA, total: 100 },
      { status: "pulling 层", digest: digestA, total: 100, completed: 80 },
      { status: "pulling 层", digest: digestA, total: 100, completed: 30 },
      { status: "writing manifest" },
      { status: "success" },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n\n"),
  );
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of encoded) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  const events = await collect(stream);
  assert.equal(events[0].observedCompletedBytes, 0);
  assert.equal(events[2].observedCompletedBytes, 30);
  assert.equal(events[2].progressReset, true);
  assert.equal(events[3].phase, "checking");
});

for (const [name, events, code] of [
  [
    "EOF is not success",
    [{ status: "pulling manifest" }],
    "INCOMPLETE_PROGRESS",
  ],
  ["empty stream is not success", [], "INCOMPLETE_PROGRESS"],
  [
    "upstream error is private",
    [{ error: "PRIVATE_SENTINEL" }],
    "UPSTREAM_ERROR",
  ],
  [
    "error wins over success",
    [{ status: "success", error: "PRIVATE_SENTINEL" }],
    "UPSTREAM_ERROR",
  ],
  [
    "reject trailing event",
    [{ status: "success" }, { status: "PRIVATE_SENTINEL" }],
    "INVALID_PROGRESS",
  ],
  [
    "reject duplicate success",
    [{ status: "success" }, { status: "success" }],
    "INVALID_PROGRESS",
  ],
  ["require object", [null], "INVALID_PROGRESS"],
  ["reject array", [[]], "INVALID_PROGRESS"],
  ["require status", [{ private: "PRIVATE_SENTINEL" }], "INVALID_PROGRESS"],
  ["require string status", [{ status: 1 }], "INVALID_PROGRESS"],
  [
    "reject malformed digest",
    [{ status: "pulling", digest: "PRIVATE_SENTINEL", total: 1 }],
    "INVALID_PROGRESS",
  ],
  [
    "reject uppercase digest",
    [{ status: "pulling", digest: `sha256:${"A".repeat(64)}`, total: 1 }],
    "INVALID_PROGRESS",
  ],
  [
    "reject negative",
    [{ status: "pulling", digest: digestA, total: -1 }],
    "INVALID_PROGRESS",
  ],
  [
    "reject fractional",
    [{ status: "pulling", digest: digestA, total: 1.5 }],
    "INVALID_PROGRESS",
  ],
  [
    "reject string counter",
    [{ status: "pulling", digest: digestA, total: "1" }],
    "INVALID_PROGRESS",
  ],
  [
    "reject null counter",
    [{ status: "pulling", digest: digestA, total: null }],
    "INVALID_PROGRESS",
  ],
  [
    "reject unsafe counter",
    [
      {
        status: "pulling",
        digest: digestA,
        total: Number.MAX_SAFE_INTEGER + 1,
      },
    ],
    "INVALID_PROGRESS",
  ],
  [
    "completed exceeds total",
    [{ status: "pulling", digest: digestA, total: 1, completed: 2 }],
    "INVALID_PROGRESS",
  ],
  [
    "counter requires digest",
    [{ status: "pulling", total: 1 }],
    "INVALID_PROGRESS",
  ],
  [
    "total cannot mutate",
    [
      { status: "pulling", digest: digestA, total: 1 },
      { status: "pulling", digest: digestA, total: 2 },
    ],
    "INVALID_PROGRESS",
  ],
  [
    "aggregate bound",
    [
      { status: "pulling", digest: digestA, total: 2 * 1024 ** 3 },
      { status: "pulling", digest: digestB, total: 2 * 1024 ** 3 },
    ],
    "MODEL_TOO_LARGE",
  ],
  [
    "layer bound",
    Array.from({ length: 33 }, (_, index) => ({
      status: "pulling",
      digest: `sha256:${index.toString(16).padStart(64, "0")}`,
      total: 1,
    })),
    "TOO_MANY_LAYERS",
  ],
] as const) {
  test(name, () => fails(bodyOf([...events]), code));
}

test("frame bound applies to bytes, with or without newline", async () => {
  for (const suffix of ["", "\n"])
    await fails(
      bytesOf(new TextEncoder().encode(" ".repeat(65_537) + suffix)),
      "FRAME_TOO_LARGE",
    );
  await fails(bodyOf([{ status: "层".repeat(23_000) }]), "FRAME_TOO_LARGE");
});

test("invalid JSON and UTF-8 become fixed safe errors", async () => {
  await fails(
    bytesOf(new TextEncoder().encode("PRIVATE_SENTINEL\n")),
    "INVALID_PROGRESS",
  );
  await fails(bytesOf(Uint8Array.of(0xc3, 0x28)), "INVALID_PROGRESS");
});

test("stream errors are private and cleanup cancels an unfinished body", async () => {
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new Error("PRIVATE_SENTINEL"));
    },
  });
  await fails(stream, "STREAM_FAILED");
  let cancelled = false;
  const open = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode('{"status":"pulling manifest"}\n'),
      );
    },
    cancel() {
      cancelled = true;
    },
  });
  const reader = readOllamaPullProgress(open);
  await reader.next();
  await reader.return(undefined);
  assert.equal(cancelled, true);
  assert.equal(open.locked, false);
});
