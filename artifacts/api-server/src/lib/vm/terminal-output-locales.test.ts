import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { WorkspaceLocale } from "../workspace-locale";

delete process.env.DATABASE_URL;
delete process.env.RUNTIME_ROLE;
delete process.env.ALLOW_AGENT_PROCESS_EXEC;
delete process.env.ALLOW_AGENT_SUDO;
delete process.env.ALLOW_FOUNDER_SHELL;
process.env.NODE_ENV = "test";
const root = await fsp.mkdtemp(path.join(os.tmpdir(), "acos-terminal-locale-"));
process.env.AGENT_SANDBOX_ROOT = root;
const {
  execInSandbox,
  execFounderShell,
  execAgentSudo,
  validateAgentSudoCommand,
  writeTextFile,
  safeResolve,
  stopAllAgentProcesses,
} = await import("./sandbox");
const { deactivateLocalEmergencyStop } =
  await import("../orchestrator/local-emergency-epoch");
const { closeDatabase } = await import("@workspace/db");
const { getTerminalCopy, terminalMessage } =
  await import("./terminal-localization");
test.after(async () => {
  await closeDatabase();
  await fsp.rm(root, { recursive: true, force: true });
});

const helpWords: Record<WorkspaceLocale, RegExp> = {
  tr: /komutlar/i,
  en: /commands/i,
  de: /Befehle/,
  ru: /команд/i,
  "zh-CN": /命令/,
  "zh-TW": /指令/,
  ar: /أوامر|الأوامر/,
};

test("all seven execution locales cover help, usage, policy and exact file source", async () => {
  const seen = new Set<string>();
  let agentId = 500;
  for (const [language, helpWord] of Object.entries(helpWords)) {
    const locale = language as WorkspaceLocale;
    agentId += 1;
    const run = (command: string) =>
      execInSandbox(agentId, command, undefined, undefined, locale);
    const help = await run("help");
    assert.equal(help.ok, true);
    assert.match(
      help.stdout,
      helpWord,
      `${locale} help must use the execution language`,
    );
    assert.match(help.stdout, /ALLOW_AGENT_PROCESS_EXEC=true/);
    assert.match(help.stdout, /cat/);
    seen.add(help.stdout);
    const copy = getTerminalCopy(locale);
    assert.equal((await run("ls")).stdout, `${copy.emptyDirectory}\n`);
    assert.equal((await run(" ")).stderr, copy.emptyCommand);
    for (const [command, key] of [
      ["cat", "usageCat"],
      ["mkdir", "usageMkdir"],
      ["touch", "usageTouch"],
      ["write", "usageWrite"],
      ["rm", "usageRemove"],
    ] as const) {
      const outcome = await run(command);
      assert.equal(outcome.ok, false);
      assert.equal(outcome.stderr, `${copy[key]}\n`);
    }
    const usage = await run("cat");
    assert.equal(usage.ok, false);
    assert.equal(usage.exitCode, 1);
    assert.match(usage.stderr, /cat/);
    const source = "  原文\r\nمتن\t{path}\n";
    await writeTextFile(agentId, "原文.txt", source);
    const read = await run("cat 原文.txt");
    assert.equal(
      read.stdout,
      source,
      "file contents are not translated, interpolated or trimmed",
    );
    const echo = await run("echo 原文 متن");
    assert.equal(echo.stdout, "原文 متن\n");
    const written = await run("write 日本語.txt متن");
    assert.equal(written.ok, true);
    assert.equal(
      written.stdout,
      `${terminalMessage(locale, "written", { path: "日本語.txt", bytes: Buffer.byteLength("متن") })}\n`,
    );
    const deletion = await run("rm 日本語.txt");
    assert.equal(deletion.ok, true);
    assert.equal(
      deletion.stdout,
      `${terminalMessage(locale, "removed", { path: "日本語.txt" })}\n`,
    );
    assert.equal((await run("cat 日本語.txt")).ok, false);
    const missing = await run("cat absent.txt");
    assert.equal(
      missing.stderr,
      terminalMessage(locale, "fileMissing", { path: "absent.txt" }),
    );
    const forbidden = await run("echo a;echo b");
    assert.equal(forbidden.ok, false);
    assert.equal(forbidden.note, "forbidden-chars");
    assert.equal(forbidden.stderr, copy.forbiddenCommand);
    const rejected = await run("cat ../../outside.txt");
    assert.equal(rejected.ok, false);
    assert.equal(rejected.note, "path-policy");
    assert.ok(rejected.stderr.includes("../../outside.txt"));
    const processDenied = await run("node harmless.js");
    assert.equal(processDenied.ok, false);
    assert.equal(processDenied.note, "process-exec-disabled");
    assert.match(processDenied.stderr, /ALLOW_AGENT_PROCESS_EXEC=true/);
    if (locale !== "tr") {
      assert.doesNotMatch(usage.stderr, /kullanim/);
      assert.doesNotMatch(rejected.stderr, /Guvensiz yol/);
      assert.doesNotMatch(processDenied.stderr, /Harici program/);
    }
  }
  assert.equal(
    seen.size,
    7,
    "each authored help is distinct, including both Chinese scripts",
  );
});

test("queued execution keeps its captured language and source data", async () => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const first = execInSandbox(
    601,
    "write first.txt first",
    undefined,
    async () => {
      entered();
      await waiting;
    },
    "en",
  );
  await started;
  const german = execInSandbox(601, "help", undefined, undefined, "de");
  const arabic = execInSandbox(601, "help", undefined, undefined, "ar");
  release();
  assert.equal((await first).ok, true);
  assert.match((await german).stdout, helpWords.de);
  assert.match((await arabic).stdout, helpWords.ar);
  assert.equal(
    (await execInSandbox(601, "cat first.txt", undefined, undefined, "ru"))
      .stdout,
    "first",
  );
});

test("queued cancellation uses that command's language and preserves its machine state", async () => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const first = execInSandbox(
    602,
    "write stopped.txt no",
    undefined,
    async () => {
      entered();
      await waiting;
    },
    "en",
  ).catch((error: unknown) => error);
  await started;
  const pending = execInSandbox(
    602,
    "write pending.txt no",
    undefined,
    undefined,
    "en",
  );
  try {
    stopAllAgentProcesses();
    release();
    await first;
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.note, "emergency-stop");
    assert.match(result.stderr, /emergency stop/i);
    await assert.rejects(
      fsp.access(path.join(root, "agent-602", "pending.txt")),
    );
  } finally {
    release();
    deactivateLocalEmergencyStop();
  }
});

test("selected-language host and sudo denials never cross an effect boundary", async () => {
  let effects = 0;
  const beforeEffect = async () => {
    effects += 1;
  };
  const founder = await execFounderShell("echo no", root, beforeEffect, "en");
  assert.equal(founder.note, "disabled");
  assert.match(founder.stderr, /disabled/i);
  const sudo = await execAgentSudo({
    agentId: 603,
    command: "echo no",
    approvalId: 1,
    leaseOwner: "none",
    argsHash: "none",
    beforeEffect,
    locale: "de",
  });
  assert.equal(sudo.note, "disabled");
  assert.match(sudo.stderr, /deaktiviert/i);
  assert.equal(effects, 0);
  const invalid = validateAgentSudoCommand("", "en");
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.match(invalid.error, /required/i);
  const command = "  echo 原文  ";
  assert.deepEqual(validateAgentSudoCommand(command, "ar"), {
    ok: true,
    command,
  });
});

test("legacy filesystem exception messages and classes stay compatible", () => {
  assert.throws(() => safeResolve(7, "../../outside.txt"), /Guvensiz yol/);
});

test("locale validation precedes queueing and filesystem effects", async () => {
  let effects = 0;
  await assert.rejects(
    execInSandbox(
      604,
      "write forbidden.txt no",
      undefined,
      async () => {
        effects += 1;
      },
      "constructor" as WorkspaceLocale,
    ),
    /Invalid Terminal locale/,
  );
  assert.equal(effects, 0);
  await assert.rejects(fsp.access(path.join(root, "agent-604")));
});

test("enabled fixture processes retain exact external stdout and stderr in every locale", async () => {
  // Opt in for this isolated test child only; the fixture only writes known
  // strings to its streams and cannot reach user data or external services.
  process.env.ALLOW_AGENT_PROCESS_EXEC = "true";
  const source = "  原文\r\nمتن {bytes}\t\n";
  const error = "  external error\r\n";
  await writeTextFile(
    605,
    "source-output.cjs",
    `process.stdout.write(${JSON.stringify(source)});process.stderr.write(${JSON.stringify(error)});`,
  );
  try {
    for (const locale of Object.keys(helpWords) as WorkspaceLocale[]) {
      const result = await execInSandbox(
        605,
        "node source-output.cjs",
        undefined,
        undefined,
        locale,
      );
      assert.equal(result.ok, true);
      assert.equal(result.stdout, source);
      assert.equal(result.stderr, error);
      assert.equal(result.note, null);
      const help = await execInSandbox(
        605,
        "help",
        undefined,
        undefined,
        locale,
      );
      assert.ok(
        help.stdout.includes(
          getTerminalCopy(locale).helpProcessesEnabled.split("{commands}")[0],
        ),
      );
    }
  } finally {
    delete process.env.ALLOW_AGENT_PROCESS_EXEC;
  }
});

for (const mode of ["sandbox", "founder"] as const) {
  test(`${mode} preserves UTF-8 characters split across process output chunks`, async () => {
    process.env.ALLOW_AGENT_PROCESS_EXEC = "true";
    process.env.ALLOW_FOUNDER_SHELL = "true";
    const source = "原文/متن/🧭\r\n";
    await writeTextFile(
      606,
      "split-output.cjs",
      `
      const bytes = Buffer.from(${JSON.stringify(source)});
      let i = 0;
      const timer = setInterval(() => {
        if (i === bytes.length) return clearInterval(timer);
        process.stdout.write(bytes.subarray(i, i + 1));
        process.stderr.write(bytes.subarray(i, ++i));
      }, 15);
    `,
    );
    try {
      const result =
        mode === "sandbox"
          ? await execInSandbox(
              606,
              "node split-output.cjs",
              undefined,
              undefined,
              "zh-TW",
            )
          : await execFounderShell(
              "node split-output.cjs",
              path.join(root, "agent-606"),
              undefined,
              "ar",
            );
      assert.equal(result.ok, true);
      assert.equal(result.stdout, source);
      assert.equal(result.stderr, source);
    } finally {
      delete process.env.ALLOW_AGENT_PROCESS_EXEC;
      delete process.env.ALLOW_FOUNDER_SHELL;
    }
  });
}
