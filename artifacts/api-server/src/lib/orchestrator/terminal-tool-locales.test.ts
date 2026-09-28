import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import type { ToolRuntimeContext } from "./execute-tool";
import type { WorkspaceLocale } from "../workspace-locale";

delete process.env.DATABASE_URL;
delete process.env.RUNTIME_ROLE;
delete process.env.ALLOW_AGENT_PROCESS_EXEC;
delete process.env.ALLOW_AGENT_SUDO;
process.env.NODE_ENV = "test";
const root = await fsp.mkdtemp(path.join(os.tmpdir(), "acos-terminal-tool-"));
process.env.AGENT_SANDBOX_ROOT = root;
const {
  db,
  dbReady,
  agentsTable,
  tasksTable,
  activityEventsTable,
  closeDatabase,
} = await import("@workspace/db");
const { executeTool } = await import("./execute-tool");
const { specialistPermissionsPreset } = await import("./permission-presets");
const { WORKSPACE_LOCALES } = await import("../workspace-locale");
const { getTerminalCopy, terminalMessage } =
  await import("../vm/terminal-localization");
const { writeTextFile, readTextFile } = await import("../vm/sandbox");
const { setEmergencyStop } = await import("./runtime-emergency-stop");
const { evaluateExclusiveToolCall, exclusiveToolBlockedMessage } =
  await import("./exclusive-turn-policy");
test.after(async () => {
  await closeDatabase();
  await fsp.rm(root, { recursive: true, force: true });
});

async function context(locale: WorkspaceLocale, canUseTerminal = true) {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Literal 原文 {name}",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      permissions: {
        ...specialistPermissionsPreset,
        canDelete: true,
        canUseTerminal,
      },
    })
    .returning();
  return { agent, taskId: null, locale } as ToolRuntimeContext & {
    locale: WorkspaceLocale;
  };
}

test("seven languages reach real autonomous help and preserve exact file text within output limits", async () => {
  const source = "  原文 $& {code}\n\nعربي\n  ";
  for (const locale of WORKSPACE_LOCALES) {
    const ctx = await context(locale);
    const copy = getTerminalCopy(locale);
    const help = await executeTool(
      ctx,
      "vm_run_command",
      JSON.stringify({ command: "help" }),
    );
    assert.equal(help.toolOutcome, "succeeded");
    assert.ok(
      help.content.includes(copy.helpBuiltins),
      `${locale} help language`,
    );
    assert.ok(
      help.content.includes(terminalMessage(locale, "exitCode", { code: 0 })),
    );
    await writeTextFile(ctx.agent.id, "source.txt", source);
    const result = await executeTool(
      ctx,
      "vm_run_command",
      JSON.stringify({ command: "cat source.txt" }),
    );
    assert.ok(
      result.content.includes(`STDOUT:\n${source}\n`),
      `${locale} source whitespace`,
    );
    const events = await db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.agentId, ctx.agent.id));
    assert.ok(
      events.some(
        (event) =>
          event.summary ===
          terminalMessage(locale, "terminalExecuted", {
            name: ctx.agent.name,
            command: "cat",
          }),
      ),
    );
  }
});

test("localized permission and command failures remain explicitly rejected", async () => {
  for (const locale of WORKSPACE_LOCALES) {
    const ctx = await context(locale, false);
    const denied = await executeTool(
      ctx,
      "vm_run_command",
      '{"command":"touch denied.txt"}',
    );
    assert.equal(
      denied.content,
      getTerminalCopy(locale).terminalPermissionDenied,
    );
    assert.equal(denied.toolOutcome, "rejected");
    await db
      .update(agentsTable)
      .set({ permissions: { ...ctx.agent.permissions, canUseTerminal: true } })
      .where(eq(agentsTable.id, ctx.agent.id));
    const missing = await executeTool(ctx, "vm_run_command", "{}");
    assert.equal(
      missing.content,
      terminalMessage(locale, "errorPrefix", {
        message: getTerminalCopy(locale).commandRequired,
      }),
    );
    assert.equal(missing.toolOutcome, "rejected");
    await assert.rejects(readTextFile(ctx.agent.id, "denied.txt"));
  }
});

test("translated deletion approval guidance preserves exact capability arguments and has no effect", async () => {
  for (const locale of WORKSPACE_LOCALES) {
    const ctx = await context(locale);
    await writeTextFile(ctx.agent.id, "keep.txt", "source");
    const args = { command: "rm keep.txt" };
    const result = await executeTool(
      ctx,
      "vm_run_command",
      JSON.stringify(args),
    );
    assert.equal(result.toolOutcome, "rejected");
    assert.equal(
      result.content,
      terminalMessage(locale, "approvalRequired", {
        toolName: "vm_run_command",
        category: "delete",
        args: JSON.stringify(args),
      }),
    );
    assert.equal(
      (await readTextFile(ctx.agent.id, "keep.txt")).content,
      "source",
    );
  }
});

test("non-string autonomous commands are rejected in all locales before any activity or effect", async () => {
  for (const locale of WORKSPACE_LOCALES) {
    const ctx = await context(locale);
    for (const command of [
      ["touch invalid-command.txt"],
      { toString: 1 },
      3,
      true,
      null,
    ]) {
      const result = await executeTool(
        ctx,
        "vm_run_command",
        JSON.stringify({ command }),
      );
      assert.equal(result.toolOutcome, "rejected", JSON.stringify(command));
      assert.equal(
        result.content,
        terminalMessage(locale, "errorPrefix", {
          message: getTerminalCopy(locale).commandRequired,
        }),
      );
      const events = await db
        .select()
        .from(activityEventsTable)
        .where(eq(activityEventsTable.agentId, ctx.agent.id));
      assert.equal(events.length, 0);
      await assert.rejects(readTextFile(ctx.agent.id, "invalid-command.txt"));
    }
  }
});

test("tool entry captures one language even when the caller changes its context during awaits", async () => {
  const ctx = await context("en");
  const pending = executeTool(ctx, "vm_run_command", '{"command":"help"}');
  ctx.locale = "ar";
  const result = await pending;
  assert.ok(result.content.includes(getTerminalCopy("en").helpBuiltins));
  assert.ok(!result.content.includes(getTerminalCopy("ar").helpBuiltins));
});

test("non-root sudo rejection uses the selected language and never executes", async () => {
  for (const locale of WORKSPACE_LOCALES) {
    const ctx = await context(locale);
    const result = await executeTool(
      ctx,
      "vm_run_sudo_command",
      '{"command":"echo must-not-run"}',
    );
    assert.equal(result.toolOutcome, "rejected");
    assert.equal(result.content, getTerminalCopy(locale).sudoRootOnly);
  }
});

test("shared Terminal entry denials use all seven locales without creating computer activity", async () => {
  for (const locale of WORKSPACE_LOCALES) {
    const ctx = await context(locale);
    const copy = getTerminalCopy(locale);
    const reject = async (
      context: ToolRuntimeContext,
      raw: string,
      expected: string,
      tool = "vm_run_command",
    ) => {
      const result = await executeTool(context, tool, raw);
      assert.equal(result.content, expected);
      assert.equal(result.toolOutcome, "rejected");
    };
    await reject(ctx, "{", copy.invalidToolJson);
    for (const raw of ["[]", "null", '"string"'])
      await reject(ctx, raw, copy.invalidToolObject);
    const policy = {
      source: "explicit_user_exclusivity" as const,
      families: ["browser" as const],
      allowedTools: ["browser_snapshot"],
    };
    await reject(
      { ...ctx, exclusiveTurnPolicy: policy },
      '{"command":"help"}',
      terminalMessage(locale, "exclusiveTools", {
        toolName: "vm_run_command",
        tools: "browser_snapshot",
      }),
    );
    await reject(
      {
        ...ctx,
        exclusiveTurnPolicy: {
          ...policy,
          families: ["sudo_approval"],
          allowedTools: ["vm_run_sudo_command"],
          exactSudoCommand: "echo exact",
        },
      },
      '{"command":"echo changed"}',
      copy.exclusiveSudoMismatch,
      "vm_run_sudo_command",
    );
    const [task] = await db
      .insert(tasksTable)
      .values({
        title: "Denied lease",
        brief: "Test only",
        ownerAgentId: ctx.agent.id,
        createdByUser: true,
      })
      .returning();
    await reject(
      { ...ctx, taskId: task.id },
      '{"command":"help"}',
      copy.taskLeaseMissing,
    );
    await reject(
      { ...ctx, taskId: task.id, taskLeaseOwner: "not-owned" },
      '{"command":"help"}',
      copy.taskLeaseLost,
    );
    await reject(
      {
        ...ctx,
        preapprovedAction: {
          approvalId: 1,
          toolName: "vm_run_command",
          argsHash: "unusable",
          leaseOwner: "not-owned",
          category: "spend",
        },
      },
      '{"command":"help"}',
      copy.categoryRevoked,
    );
    await setEmergencyStop({ enabled: true, reason: "test fixture" });
    try {
      await reject(ctx, '{"command":"help"}', copy.emergencyBlocked);
    } finally {
      await setEmergencyStop({ enabled: false, reason: null });
    }
    await db
      .update(agentsTable)
      .set({ isActive: false })
      .where(eq(agentsTable.id, ctx.agent.id));
    await reject(ctx, '{"command":"help"}', copy.agentInactive);
    const events = await db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.agentId, ctx.agent.id));
    assert.equal(events.length, 0);
  }
});

test("outer Terminal scope messages retain reason and exact tool identifiers in seven languages", () => {
  for (const locale of WORKSPACE_LOCALES) {
    const policy = {
      source: "explicit_user_exclusivity" as const,
      families: ["sudo_approval" as const],
      allowedTools: ["vm_run_sudo_command"],
      exactSudoCommand: "echo Exact",
    };
    for (const [tool, raw, reason, expected] of [
      [
        "vm_run_command",
        "{}",
        "tool_not_allowed",
        terminalMessage(locale, "exclusiveTools", {
          toolName: "vm_run_command",
          tools: "vm_run_sudo_command",
        }),
      ],
      [
        "vm_read_file",
        "{}",
        "tool_not_allowed",
        terminalMessage(locale, "exclusiveTools", {
          toolName: "vm_read_file",
          tools: "vm_run_sudo_command",
        }),
      ],
      [
        "browser_snapshot",
        "{}",
        "tool_not_allowed",
        terminalMessage(locale, "exclusiveTools", {
          toolName: "browser_snapshot",
          tools: "vm_run_sudo_command",
        }),
      ],
      [
        "create_sub_agent",
        "{}",
        "tool_not_allowed",
        terminalMessage(locale, "exclusiveTools", {
          toolName: "create_sub_agent",
          tools: "vm_run_sudo_command",
        }),
      ],
      [
        "request_user_input",
        "{}",
        "tool_not_allowed",
        terminalMessage(locale, "exclusiveTools", {
          toolName: "request_user_input",
          tools: "vm_run_sudo_command",
        }),
      ],
      [
        "vm_run_sudo_command",
        "{",
        "invalid_arguments",
        getTerminalCopy(locale).invalidToolObject,
      ],
      [
        "vm_run_sudo_command",
        '{"command":"echo exact"}',
        "sudo_command_mismatch",
        getTerminalCopy(locale).exclusiveSudoMismatch,
      ],
    ] as const) {
      const decision = evaluateExclusiveToolCall(policy, tool, raw);
      assert.equal(decision.allowed, false);
      assert.equal(decision.reason, reason);
      assert.equal(
        exclusiveToolBlockedMessage(
          policy,
          tool,
          decision.explanation,
          locale,
          decision.reason,
        ),
        expected,
      );
    }
  }
});

test("pre-dispatch policy rejections never claim that a command ran or was interrupted", async () => {
  for (const locale of WORKSPACE_LOCALES) {
    for (const command of ["node harmless.js", "notAllowed", "echo a;echo b"]) {
      const ctx = await context(locale);
      const result = await executeTool(
        ctx,
        "vm_run_command",
        JSON.stringify({ command }),
      );
      assert.equal(result.toolOutcome, "rejected");
      assert.ok(
        result.content.includes(getTerminalCopy(locale).commandNotStarted),
      );
      assert.ok(!result.content.includes(getTerminalCopy(locale).interrupted));
      const events = await db
        .select()
        .from(activityEventsTable)
        .where(eq(activityEventsTable.agentId, ctx.agent.id));
      assert.equal(
        events.find((event) => event.type === "vm_command")?.summary,
        terminalMessage(locale, "terminalFailed", { name: ctx.agent.name }),
      );
    }
  }
});
