import assert from "node:assert/strict";
import test from "node:test";
import { terminalTaskToolDisposition } from "./step-task";

test("terminal task tools only stop a step after a durable lifecycle mutation", () => {
  assert.equal(
    terminalTaskToolDisposition("complete_task", undefined),
    "rejected",
  );
  assert.equal(
    terminalTaskToolDisposition("request_approval", "suspended"),
    "persisted",
  );
  assert.equal(
    terminalTaskToolDisposition("complete_task", "completed"),
    "persisted",
  );
  assert.equal(
    terminalTaskToolDisposition("vm_write_file", undefined),
    "not_terminal",
  );
});
