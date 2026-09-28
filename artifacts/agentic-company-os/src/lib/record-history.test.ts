import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchRecordPage,
  RecordPager,
  type RecordPage,
  type HistorySource,
} from "./record-history";

const event = (id: number, taskId = 10) => ({
  id,
  agentId: 2,
  taskId,
  summary: `Original 原文 ${id}`,
  type: "tool_used",
  detail: { actor: "agent", surface: "files" },
  severity: "info",
  createdAt: `2026-09-${id % 2 ? "01" : "03"}T12:00:00Z`,
});
const task = (id: number, parentTaskId: number | null) => ({
  id,
  parentTaskId,
  ownerAgentId: 2,
  title: "Original title",
  brief: "原文",
  status: "pending",
  updatedAt: "2026-09-28T00:00:00Z",
});
const signal = () => new AbortController().signal;
const response = (rows: unknown, cursor?: string) =>
  new Response(JSON.stringify(rows), {
    headers: cursor === undefined ? {} : { "X-Next-Before-Id": cursor },
  });

test("history uses exact scopes and accepts source order without rewriting records", async () => {
  for (const [source, url, rows] of [
    [
      { kind: "activity", agentId: 2, taskId: 10 },
      "/api/activity?limit=20&agentId=2&taskId=10&beforeId=9",
      [event(8), event(7)],
    ],
    [
      { kind: "task-activity", taskId: 10 },
      "/api/tasks/10/activity?limit=20&beforeId=9",
      [event(7), event(8)],
    ],
    [
      { kind: "subtasks", taskId: 10 },
      "/api/tasks/10/subtasks?limit=20&beforeId=9",
      [task(8, 10), task(7, 10)],
    ],
    [
      { kind: "projects" },
      "/api/tasks?limit=20&rootOnly=true&beforeId=9",
      [task(8, null), task(7, null)],
    ],
  ] as const) {
    const page = await fetchRecordPage(
      source,
      20,
      9,
      signal(),
      async (input, options) => {
        assert.equal(input, url);
        assert.equal(options?.credentials, "same-origin");
        assert.equal(options?.cache, "no-store");
        return response(rows, "7");
      },
    );
    assert.deepEqual(page.records, rows);
    assert.equal(page.nextBeforeId, 7);
    assert.equal(page.beforeId, 9);
    assert.ok(page.capturedAt > 0);
  }
});

test("history rejects foreign, duplicate, overfull, malformed and out-of-bound rows", async () => {
  const source: HistorySource = { kind: "activity", agentId: 2, taskId: 10 };
  for (const rows of [
    [event(3, 11)],
    [{ ...event(3), agentId: 4 }],
    [event(3), event(3)],
    [event(3), event(2), event(1)],
    [{ ...event(3), createdAt: "invalid" }],
    [{ ...event(3), severity: "unknown" }],
    [event(9)],
    { records: [event(3)] },
  ]) {
    await assert.rejects(
      fetchRecordPage(source, 2, 9, signal(), async () => response(rows)),
      /Invalid history page/,
    );
  }
  for (const [source, rows] of [
    [{ kind: "projects" }, [task(2, 1)]],
    [{ kind: "subtasks", taskId: 10 }, [task(2, null)]],
    [{ kind: "task-activity", taskId: 10 }, [event(2, 11)]],
  ] as const)
    await assert.rejects(
      fetchRecordPage(source, 20, null, signal(), async () => response(rows)),
      /Invalid history page/,
    );
});

test("only the canonical cursor header allows continuation, never array length", async () => {
  const source: HistorySource = { kind: "activity", agentId: 2 };
  const page = await fetchRecordPage(source, 2, null, signal(), async () =>
    response([event(8), event(7)]),
  );
  assert.equal(page.nextBeforeId, null);
  for (const cursor of [
    "0",
    "-1",
    "07",
    " 7",
    "7.0",
    "8",
    "9",
    "2147483648",
    "NaN",
    "",
  ]) {
    await assert.rejects(
      fetchRecordPage(source, 2, null, signal(), async () => {
        // A minimal response preserves header whitespace for strict validation.
        return {
          ok: true,
          status: 200,
          json: async () => [event(8), event(7)],
          headers: { get: () => cursor },
        } as unknown as Response;
      }),
      /Invalid history cursor/,
    );
  }
  await assert.rejects(
    fetchRecordPage(source, 2, null, signal(), async () => response([], "7")),
    /Invalid history cursor/,
  );
  await assert.rejects(
    fetchRecordPage(source, 0, null, signal(), async () => {
      throw new Error("must not request");
    }),
    /Invalid history scope/,
  );
});

const result = (
  beforeId: number | null,
  ids: number[],
  nextBeforeId: number | null,
): RecordPage<number> => ({
  beforeId,
  records: ids,
  nextBeforeId,
  capturedAt: 1,
});
test("failed older reads retain the page and retry target across visibility changes", async () => {
  const reads: Array<number | null> = [];
  let fail = true;
  const pager = new RecordPager<number>(async (before) => {
    reads.push(before);
    if (before === 8 && fail) throw new Error("private server detail");
    return before === null ? result(null, [10, 8], 8) : result(8, [7, 6], null);
  });
  await pager.start();
  const first = pager.getSnapshot().page;
  await pager.older();
  assert.equal(pager.getSnapshot().page, first);
  assert.equal(pager.getSnapshot().error, true);
  pager.stop();
  await pager.start();
  pager.poll();
  assert.deepEqual(reads, [null, 8]);
  fail = false;
  await pager.retry();
  assert.deepEqual(reads, [null, 8, 8]);
  assert.deepEqual(pager.getSnapshot().trail, [null]);
  assert.deepEqual(pager.getSnapshot().page?.records, [7, 6]);
  pager.poll();
  await pager.start();
  assert.deepEqual(reads, [null, 8, 8]);
  await pager.newer();
  assert.deepEqual(pager.getSnapshot().page?.records, [10, 8]);
  await pager.older();
  await pager.latest();
  assert.deepEqual(pager.getSnapshot().trail, []);
  assert.deepEqual(pager.getSnapshot().page?.records, [10, 8]);
  pager.stop();
});

test("stopped and replaced reads cannot overwrite newer state; navigation is single flight", async () => {
  const pending: Array<{
    before: number | null;
    signal: AbortSignal;
    resolve: (page: RecordPage<number>) => void;
  }> = [];
  const pager = new RecordPager<number>(
    (before, signal) =>
      new Promise((resolve) => pending.push({ before, signal, resolve })),
  );
  const old = pager.start();
  await pager.latest();
  assert.equal(pending.length, 1);
  pager.stop();
  assert.equal(pending[0].signal.aborted, true);
  const fresh = pager.start();
  pending[1].resolve(result(null, [20, 19], 19));
  await fresh;
  pending[0].resolve(result(null, [10, 9], 9));
  await old;
  assert.deepEqual(pager.getSnapshot().page?.records, [20, 19]);
  const older = pager.older();
  await pager.older();
  assert.equal(pending.length, 3);
  pending[2].resolve(result(19, [18], null));
  await older;
  assert.deepEqual(pager.getSnapshot().page?.records, [18]);
  assert.deepEqual(pager.getSnapshot().trail, [null]);
  pager.stop();
});

test("deep navigation retains one page and a failed return cannot commit a different cursor trail", async () => {
  let failLatest = false;
  const pager = new RecordPager<number>(async (before) => {
    if (before === null && failLatest) throw new Error("offline");
    return before === null
      ? result(null, [40, 30], 30)
      : before === 30
        ? result(30, [29, 20], 20)
        : result(20, [19, 10], null);
  });
  await pager.start();
  await pager.older();
  await pager.older();
  assert.deepEqual(pager.getSnapshot().trail, [null, 30]);
  assert.deepEqual(pager.getSnapshot().page?.records, [19, 10]);
  failLatest = true;
  await pager.latest();
  assert.deepEqual(pager.getSnapshot().trail, [null, 30]);
  assert.deepEqual(pager.getSnapshot().page?.records, [19, 10]);
  await pager.newer();
  assert.deepEqual(pager.getSnapshot().trail, [null]);
  assert.deepEqual(pager.getSnapshot().page?.records, [29, 20]);
  failLatest = false;
  await pager.latest();
  assert.deepEqual(pager.getSnapshot().trail, []);
  assert.deepEqual(pager.getSnapshot().page?.records, [40, 30]);
  pager.stop();
});
