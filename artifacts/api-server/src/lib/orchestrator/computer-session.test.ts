import assert from "node:assert/strict";
import test from "node:test";
import {
  beginComputerStep,
  computerStepDetail,
  finishComputerStep,
  formatComputerStep,
  getComputerSessionSnapshot,
  recordComputerDecision,
  resetComputerSessionsForTests,
} from "./computer-session";
import {
  computerSurfaceForTool,
  deferredComputerToolMessage,
  isComputerTool,
  resolveMaxToolRounds,
  resolveMaxToolCallsPerRound,
  shouldDeferComputerTool,
} from "./tool-loop-policy";

test("computer session records coherent cross-surface transitions", () => {
  resetComputerSessionsForTests();
  const terminal = finishComputerStep(
    42,
    beginComputerStep(
      42,
      "terminal",
      "vm_run_command",
      undefined,
      true,
      "run-1",
    ),
    "succeeded",
    "exitCode=0",
  );
  const browser = finishComputerStep(
    42,
    beginComputerStep(42, "browser", "browser_open", undefined, true, "run-1"),
    "succeeded",
    "https://example.com",
  );
  const observation = finishComputerStep(
    42,
    beginComputerStep(
      42,
      "computer",
      "computer_observe",
      undefined,
      true,
      "run-1",
    ),
    "succeeded",
    "browser and workspace inspected",
  );

  assert.equal(terminal.transition, false);
  assert.equal(browser.transition, true);
  assert.equal(browser.previousSurface, "terminal");
  assert.equal(observation.transition, false);
  assert.equal(observation.phase, "verify");

  const snapshot = getComputerSessionSnapshot(42);
  assert.equal(snapshot.activeSurface, "browser");
  assert.equal(snapshot.sequence, 3);
  assert.equal(snapshot.recentSteps.length, 3);
  assert.match(formatComputerStep(browser, "done"), /terminal → browser/);
  assert.deepEqual(
    computerStepDetail(browser, { url: "https://example.com" }),
    {
      sessionId: browser.sessionId,
      sequence: 2,
      actor: "agent",
      owner: "agent",
      surface: "browser",
      previousSurface: "terminal",
      transition: true,
      phase: "act",
      lifecyclePhase: "completed",
      tool: "browser_open",
      status: "succeeded",
      durationMs: browser.durationMs,
      url: "https://example.com",
    },
  );
});

test("computer trace is bounded and evidence strips control characters", () => {
  resetComputerSessionsForTests();
  for (let index = 0; index < 20; index++) {
    const step = beginComputerStep(7, "files", "vm_read_file");
    finishComputerStep(7, step, "succeeded", `file-${index}\u0000\nready`);
  }
  const snapshot = getComputerSessionSnapshot(7);
  assert.equal(snapshot.recentSteps.length, 12);
  assert.equal(snapshot.recentSteps[0]?.sequence, 9);
  assert.equal(snapshot.recentSteps.at(-1)?.evidence, "file-19 ready");
});

test("decision is real telemetry but does not switch surface or hide verification", () => {
  resetComputerSessionsForTests();
  finishComputerStep(
    8,
    beginComputerStep(
      8,
      "terminal",
      "vm_run_command",
      undefined,
      true,
      "run-2",
    ),
    "succeeded",
    "exitCode=0",
  );
  finishComputerStep(
    8,
    beginComputerStep(8, "browser", "browser_click", undefined, true, "run-2"),
    "succeeded",
    "clicked",
  );
  const decision = recordComputerDecision(8, "files", "vm_read_file");
  assert.equal(getComputerSessionSnapshot(8).activeSurface, "browser");
  const verify = finishComputerStep(
    8,
    beginComputerStep(
      8,
      "browser",
      "browser_snapshot",
      undefined,
      true,
      "run-2",
    ),
    "succeeded",
    "verified",
  );
  assert.equal(decision.phase, "decide");
  assert.equal(getComputerSessionSnapshot(8).activeSurface, "browser");
  assert.equal(verify.phase, "verify");
  assert.equal(verify.previousSurface, "browser");
});

test("verification is scoped to the same run and action surface", () => {
  resetComputerSessionsForTests();
  finishComputerStep(
    9,
    beginComputerStep(9, "browser", "browser_click", undefined, true, "run-a"),
    "succeeded",
    "clicked",
  );
  const unrelatedSurface = beginComputerStep(
    9,
    "files",
    "vm_read_file",
    undefined,
    true,
    "run-a",
  );
  assert.equal(unrelatedSurface.phase, "observe");
  finishComputerStep(9, unrelatedSurface, "succeeded", "read");
  const laterRun = beginComputerStep(
    9,
    "browser",
    "browser_snapshot",
    undefined,
    true,
    "run-b",
  );
  assert.equal(laterRun.phase, "observe");
});

test("computer loop policy serializes stateful calls and stays bounded", () => {
  assert.equal(isComputerTool("browser_snapshot"), true);
  assert.equal(isComputerTool("vm_read_file"), true);
  assert.equal(isComputerTool("log_note"), false);
  assert.equal(computerSurfaceForTool("browser_click"), "browser");
  assert.equal(computerSurfaceForTool("vm_read_file"), "files");
  assert.equal(shouldDeferComputerTool("browser_click", true), true);
  assert.equal(shouldDeferComputerTool("log_note", true), false);
  assert.match(deferredComputerToolMessage("browser_click"), /ERTELENDI/);

  assert.equal(
    resolveMaxToolRounds("task", ["browser_open", "vm_run_command"], ""),
    9,
  );
  assert.equal(resolveMaxToolRounds("chat", ["browser_open"], ""), 8);
  assert.equal(resolveMaxToolRounds("task", [], "99"), 16);
  assert.equal(resolveMaxToolRounds("task", [], "2"), 4);
  assert.equal(resolveMaxToolCallsPerRound(""), 8);
  assert.equal(resolveMaxToolCallsPerRound("999"), 32);
  assert.equal(resolveMaxToolCallsPerRound("0"), 8);
});
