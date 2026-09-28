import assert from "node:assert/strict";
import test from "node:test";
import { WORKSPACE_LOCALES, type WorkspaceLocale } from "../workspace-locale";
import { terminalTr, type TerminalMessageKey } from "./terminal-copy";
import { getTerminalCopy, terminalMessage } from "./terminal-localization";

const placeholders = (value: string) =>
  [...value.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)]
    .map((match) => match[1])
    .sort();
test("all Terminal catalogs preserve complete keys and parameter multiplicities", () => {
  for (const locale of WORKSPACE_LOCALES) {
    const copy = getTerminalCopy(locale);
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(terminalTr).sort());
    for (const key of Object.keys(terminalTr) as TerminalMessageKey[]) {
      assert.ok(copy[key].trim(), `${locale}.${key} is empty`);
      assert.deepEqual(
        placeholders(copy[key]),
        placeholders(terminalTr[key]),
        `${locale}.${key}`,
      );
    }
    for (const key of ["helpProcessesDisabled", "processDisabled"] as const) {
      assert.match(copy[key], /ALLOW_AGENT_PROCESS_EXEC=true/);
    }
    assert.match(copy.sudoApprovalRequired, /toolName=vm_run_sudo_command/);
    assert.match(copy.sudoApprovalRequired, /request_approval/);
    assert.match(copy.sudoApprovalRequired, /toolArgs/);
    assert.match(copy.sudoApprovalRequired, /command/);
  }
});

test("message interpolation preserves literal parameter bytes and rejects unknown identities", () => {
  const path = "  原文/{bytes}/$&/متن.txt  ";
  for (const locale of WORKSPACE_LOCALES) {
    const rendered = terminalMessage(locale, "written", { path, bytes: 71 });
    assert.ok(rendered.includes(path));
    assert.ok(rendered.includes("71"));
    assert.throws(
      () => terminalMessage(locale, "written", { path }),
      /Missing Terminal parameter/,
    );
  }
  assert.throws(
    () => getTerminalCopy("constructor" as WorkspaceLocale),
    /Invalid Terminal locale/,
  );
  assert.throws(
    () => terminalMessage("en", "constructor" as TerminalMessageKey),
    /Invalid Terminal message key/,
  );
});
