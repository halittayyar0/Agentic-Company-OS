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
process.env.NODE_ENV = "test";
const root = await fsp.mkdtemp(path.join(os.tmpdir(), "acos-file-locales-"));
process.env.AGENT_SANDBOX_ROOT = root;
const { db, dbReady, agentsTable, activityEventsTable, closeDatabase } =
  await import("@workspace/db");
const { executeTool } = await import("./execute-tool");
const { getToolCopy, toolMessage } = await import("./tool-localization");
const { setEmergencyStop } = await import("./runtime-emergency-stop");
const { specialistPermissionsPreset } = await import("./permission-presets");
const { getTerminalCopy, terminalMessage } =
  await import("../vm/terminal-localization");
const { readTextFile, writeTextFile, getSandboxRoot, safeResolve } =
  await import("../vm/sandbox");

test.after(async () => {
  await closeDatabase();
  await fsp.rm(root, { recursive: true, force: true });
});

const expected: Record<
  WorkspaceLocale,
  {
    empty: string;
    written: string;
    observation: string;
  }
> = {
  en: {
    empty: "Directory is empty: /",
    written: "File written:",
    observation: "COMPUTER STATUS",
  },
  de: {
    empty: "Verzeichnis ist leer: /",
    written: "Datei geschrieben:",
    observation: "COMPUTERSTATUS",
  },
  ru: {
    empty: "Каталог пуст: /",
    written: "Файл записан:",
    observation: "СОСТОЯНИЕ КОМПЬЮТЕРА",
  },
  "zh-CN": {
    empty: "目录为空：/",
    written: "文件已写入：",
    observation: "计算机状态",
  },
  "zh-TW": {
    empty: "目錄為空：/",
    written: "檔案已寫入：",
    observation: "電腦狀態",
  },
  ar: {
    empty: "المجلد فارغ: /",
    written: "كُتب الملف:",
    observation: "حالة الحاسوب",
  },
  tr: {
    empty: "Dizin boş: /",
    written: "Dosya yazıldı:",
    observation: "BİLGİSAYAR DURUMU",
  },
};
const locales = Object.keys(expected) as WorkspaceLocale[];

async function context(locale: WorkspaceLocale, canUseTerminal = true) {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Literal 原文 {name} $&",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      permissions: {
        ...specialistPermissionsPreset,
        canBrowse: false,
        canUseTerminal,
      },
    })
    .returning();
  return { agent, taskId: null, locale } as ToolRuntimeContext & {
    locale: WorkspaceLocale;
  };
}

test("file list, write and read use all seven languages while preserving exact source", async () => {
  const filename = "原文 {path} $&.txt";
  const source = "  原文 $& {bytes}\n\nمتن عربي\n  ";
  for (const locale of locales) {
    const ctx = await context(locale);
    const empty = await executeTool(ctx, "vm_list_files", "{}");
    assert.equal(empty.toolOutcome, "succeeded");
    assert.ok(
      empty.content.includes(expected[locale].empty),
      `${locale}: ${empty.content}`,
    );
    const write = await executeTool(
      ctx,
      "vm_write_file",
      JSON.stringify({ path: filename, content: source }),
    );
    assert.equal(write.toolOutcome, "succeeded");
    assert.ok(
      write.content.includes(expected[locale].written),
      `${locale}: ${write.content}`,
    );
    assert.ok(write.content.includes(filename));
    assert.equal((await readTextFile(ctx.agent.id, filename)).content, source);
    const read = await executeTool(
      ctx,
      "vm_read_file",
      JSON.stringify({ path: filename }),
    );
    assert.equal(read.toolOutcome, "succeeded");
    assert.equal(read.content.split("\n").slice(1).join("\n"), source);
    const list = await executeTool(ctx, "vm_list_files", "{}");
    assert.equal(list.toolOutcome, "succeeded");
    assert.ok(list.content.includes(`[FILE] ${filename}`));
    const events = await db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.agentId, ctx.agent.id));
    assert.ok(
      events.some(
        (event) =>
          event.summary ===
          toolMessage(locale, "fileWritten", {
            name: ctx.agent.name,
            path: filename,
            bytes: Buffer.byteLength(source, "utf8"),
          }),
      ),
      `${locale}: localized completed activity`,
    );
  }
});

test("file permission and typed missing-file errors remain explicitly rejected in every language", async () => {
  for (const locale of locales) {
    const ctx = await context(locale, false);
    for (const tool of ["vm_list_files", "vm_read_file", "vm_write_file"]) {
      const result = await executeTool(
        ctx,
        tool,
        '{"path":"denied.txt","content":"never"}',
      );
      assert.equal(result.toolOutcome, "rejected");
      assert.equal(
        result.content,
        getTerminalCopy(locale).terminalPermissionDenied,
      );
    }
    await db
      .update(agentsTable)
      .set({ permissions: { ...ctx.agent.permissions, canUseTerminal: true } })
      .where(eq(agentsTable.id, ctx.agent.id));
    const missing = await executeTool(
      ctx,
      "vm_read_file",
      '{"path":"missing.txt"}',
    );
    assert.equal(missing.toolOutcome, "rejected");
    assert.ok(
      missing.content.includes(
        terminalMessage(locale, "fileMissing", { path: "missing.txt" }),
      ),
    );
    await assert.rejects(readTextFile(ctx.agent.id, "denied.txt"));
  }
});

test("malformed file content cannot silently overwrite an existing file with empty data", async () => {
  for (const locale of locales) {
    const ctx = await context(locale);
    await writeTextFile(ctx.agent.id, "keep.txt", "original");
    for (const content of [
      null,
      false,
      42,
      ["replacement"],
      { value: "replacement" },
      undefined,
    ]) {
      const result = await executeTool(
        ctx,
        "vm_write_file",
        JSON.stringify({ path: "keep.txt", content }),
      );
      assert.equal(
        (await readTextFile(ctx.agent.id, "keep.txt")).content,
        "original",
        `${locale}: invalid content must not erase source`,
      );
      assert.equal(result.toolOutcome, "rejected");
    }
    const empty = await executeTool(
      ctx,
      "vm_write_file",
      '{"path":"keep.txt","content":""}',
    );
    assert.equal(
      empty.toolOutcome,
      "succeeded",
      "an explicitly empty string is a valid file",
    );
    assert.equal((await readTextFile(ctx.agent.id, "keep.txt")).content, "");
  }
});

test("non-string file paths cannot be coerced into reads, listings or writes", async () => {
  for (const locale of locales) {
    const ctx = await context(locale);
    await writeTextFile(ctx.agent.id, "keep.txt", "original");
    for (const invalid of [["keep.txt"], { toString: 1 }, 0, true, null]) {
      for (const tool of ["vm_write_file", "vm_read_file", "vm_list_files"]) {
        const result = await executeTool(
          ctx,
          tool,
          JSON.stringify({ path: invalid, content: "unauthorized" }),
        );
        assert.equal(
          (await readTextFile(ctx.agent.id, "keep.txt")).content,
          "original",
        );
        assert.equal(
          result.toolOutcome,
          "rejected",
          `${locale}: ${tool} must reject invalid paths`,
        );
        assert.ok(!result.content.includes("original"));
      }
    }
  }
});

test("computer observations use the captured language and retain literal machine fields and file names", async () => {
  for (const locale of locales) {
    const ctx = await context(locale);
    await writeTextFile(ctx.agent.id, "原文 {path}.txt", "source");
    const result = await executeTool(ctx, "computer_observe", "{}");
    assert.equal(result.toolOutcome, "succeeded");
    assert.ok(
      result.content.includes(expected[locale].observation),
      `${locale}: ${result.content}`,
    );
    assert.ok(result.content.includes("session: computer:"));
    assert.ok(result.content.includes("原文 {path}.txt"));
  }
});

test("file execution captures locale before asynchronous live permission checks", async () => {
  const ctx = await context("en");
  const pending = executeTool(
    ctx,
    "vm_write_file",
    '{"path":"captured.txt","content":"source"}',
  );
  ctx.locale = "ar";
  const result = await pending;
  assert.equal(result.toolOutcome, "succeeded");
  assert.ok(result.content.includes(expected.en.written), result.content);
});

test("invalid execution locale cannot cause a file effect", async () => {
  const ctx = await context("en");
  ctx.locale = "invalid" as WorkspaceLocale;
  await assert.rejects(
    executeTool(
      ctx,
      "vm_write_file",
      '{"path":"invalid-locale.txt","content":"never"}',
    ),
  );
  await assert.rejects(readTextFile(ctx.agent.id, "invalid-locale.txt"));
});

test("shared JSON and emergency denials use the chosen language without starting a file effect", async () => {
  for (const locale of locales) {
    const ctx = await context(locale);
    for (const name of [
      "vm_list_files",
      "vm_read_file",
      "vm_write_file",
      "computer_observe",
    ]) {
      const malformed = await executeTool(ctx, name, "{");
      assert.equal(malformed.toolOutcome, "rejected");
      assert.equal(malformed.content, getTerminalCopy(locale).invalidToolJson);
      const array = await executeTool(ctx, name, "[]");
      assert.equal(array.toolOutcome, "rejected");
      assert.equal(array.content, getTerminalCopy(locale).invalidToolObject);
    }
    await setEmergencyStop({ enabled: true, reason: "file locale test" });
    try {
      const result = await executeTool(
        ctx,
        "vm_write_file",
        '{"path":"stopped.txt","content":"never"}',
      );
      assert.equal(result.toolOutcome, "rejected");
      assert.equal(result.content, getToolCopy(locale).emergencyBlocked);
    } finally {
      await setEmergencyStop({ enabled: false, reason: null });
    }
    await assert.rejects(readTextFile(ctx.agent.id, "stopped.txt"));
  }
});

test("review: boundary whitespace paths never alias another file through executor or sandbox", async () => {
  for (const locale of locales) {
    const ctx = await context(locale);
    await writeTextFile(ctx.agent.id, "report.txt", "original source");
    for (const padded of [
      " report.txt",
      "report.txt ",
      "\treport.txt",
      "report.txt\n",
    ]) {
      const result = await executeTool(
        ctx,
        "vm_write_file",
        JSON.stringify({ path: padded, content: "wrong target" }),
      );
      assert.equal(
        (await readTextFile(ctx.agent.id, "report.txt")).content,
        "original source",
      );
      assert.equal(result.toolOutcome, "rejected");
      for (const tool of ["vm_read_file", "vm_list_files"]) {
        const read = await executeTool(
          ctx,
          tool,
          JSON.stringify({ path: padded }),
        );
        assert.equal(read.toolOutcome, "rejected");
        assert.ok(!read.content.includes("original source"));
      }
      assert.throws(() => safeResolve(ctx.agent.id, padded));
      await assert.rejects(writeTextFile(ctx.agent.id, padded, "direct alias"));
      assert.equal(
        (await readTextFile(ctx.agent.id, "report.txt")).content,
        "original source",
      );
    }
    const events = await db
      .select()
      .from(activityEventsTable)
      .where(eq(activityEventsTable.agentId, ctx.agent.id));
    assert.equal(
      events.length,
      0,
      "invalid paths must be rejected before computer activity",
    );
  }
});

test("review: skipped-only directory observation is never described as empty", async () => {
  const ctx = await context("en");
  const directory = getSandboxRoot(ctx.agent.id);
  await fsp.mkdir(directory, { recursive: true });
  // Leading whitespace is valid on the fixture filesystem but unsupported by
  // the app's canonical path policy, so this is a real skipped entry.
  await fsp.writeFile(path.join(directory, " skipped.txt"), "original");
  for (const locale of locales) {
    ctx.locale = locale;
    const result = await executeTool(ctx, "vm_list_files", "{}");
    assert.equal(result.toolOutcome, "succeeded");
    assert.ok(!result.content.includes(expected[locale].empty), result.content);
    assert.ok(
      result.content.includes(
        toolMessage(locale, "directoryEntriesSkipped", { count: 1 }),
      ),
      result.content,
    );
  }
  const events = await db
    .select()
    .from(activityEventsTable)
    .where(eq(activityEventsTable.agentId, ctx.agent.id));
  const completed = events.at(-1)!;
  assert.equal(completed.detail?.skipped, 1);
  assert.equal(completed.detail?.truncated, false);
});

test("review: bounded directory scan distinguishes displayed and observed entries", async () => {
  const ctx = await context("en");
  const directory = getSandboxRoot(ctx.agent.id);
  await fsp.mkdir(directory, { recursive: true });
  for (let offset = 0; offset < 2001; offset += 50) {
    await Promise.all(
      Array.from({ length: Math.min(50, 2001 - offset) }, (_, i) =>
        fsp.writeFile(
          path.join(
            directory,
            `entry-${String(offset + i).padStart(4, "0")}.txt`,
          ),
          "source",
        ),
      ),
    );
  }
  for (const locale of locales) {
    ctx.locale = locale;
    const result = await executeTool(ctx, "vm_list_files", "{}");
    assert.equal(result.toolOutcome, "succeeded");
    assert.ok(
      result.content.includes(
        toolMessage(locale, "directoryObserved", { shown: 100, count: 2000 }),
      ),
      result.content,
    );
    assert.ok(
      result.content.includes(getToolCopy(locale).directoryScanLimited),
      result.content,
    );
  }
  const events = await db
    .select()
    .from(activityEventsTable)
    .where(eq(activityEventsTable.agentId, ctx.agent.id));
  const completed = events.at(-1)!;
  assert.equal(completed.detail?.truncated, true);
  assert.equal(completed.detail?.shown, 100);
  assert.equal(completed.detail?.count, 2000);
});
