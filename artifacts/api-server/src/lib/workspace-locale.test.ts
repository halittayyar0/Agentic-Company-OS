import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  isWorkspaceLocale,
  readWorkspaceLocale,
  writeWorkspaceLocale,
  workspaceLanguageContract,
} from "./workspace-locale";

test("workspace locale supports all seven requested languages and survives restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "acos-locale-"));
  const filePath = path.join(directory, "workspace-locale.json");
  try {
    assert.equal(await readWorkspaceLocale(filePath), "tr");
    for (const locale of [
      "tr",
      "en",
      "de",
      "ru",
      "zh-CN",
      "zh-TW",
      "ar",
    ] as const) {
      assert.equal(isWorkspaceLocale(locale), true);
      await writeWorkspaceLocale(locale, filePath);
      assert.equal(await readWorkspaceLocale(filePath), locale);
      assert.match(
        workspaceLanguageContract(locale),
        new RegExp(`locale="${locale}"`),
      );
    }
    assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), {
      locale: "ar",
    });
    await writeFile(filePath, '{"locale":"unsupported"}');
    await assert.rejects(readWorkspaceLocale(filePath), /invalid/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
