import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { deriveOrdinaryWindowsWrapper } from "./windows-wrapper.mjs";

const original = await readFile(
  new URL("../../scripts/test-native-package-windows.ps1", import.meta.url),
  "utf8",
);
test("only inspected ordinary-user wrapper can be extended for the two genuine release cases", () => {
  const derived = deriveOrdinaryWindowsWrapper(original);
  assert.equal(
    derived.inputSha256,
    "4a7d165fe7391ba08d597dabd23e0320fa42bf53c562f6dabdfd680c7b32d595",
  );
  assert.throws(
    () => deriveOrdinaryWindowsWrapper(original + "\n# changed\n"),
    /inspected_windows_wrapper_required/,
  );
  assert.ok(derived.source.includes("Get-FixtureProcesses $account.SID"));
  assert.ok(derived.source.includes("Remove-LocalUser -SID $account.SID"));
  assert.ok(derived.source.includes("-WindowStyle Hidden"));
  assert.ok(derived.source.includes("170 * 60 * 1000"));
  assert.ok(derived.source.includes(".tmp/native-release-host/run.mts"));
  const child = derived.source.split("$childScript = @'\n")[1].split("\n'@")[0];
  assert.ok(
    child.includes("[Environment]::SetEnvironmentVariable($key, $null)"),
  );
  assert.equal(
    /GH_TOKEN|ACTIONS_RUNTIME_TOKEN|OPENAI_API_KEY/u.test(child),
    false,
  );
});

test("generated actual Windows fixture parses without creating an account or executing fixture code", async () => {
  assert.equal(process.platform, "win32");
  const parent = await realpath(tmpdir()),
    root = await mkdtemp(path.join(parent, "acos-wrapper-parse-unit-"));
  try {
    const file = path.join(root, "fixture.ps1");
    await writeFile(file, deriveOrdinaryWindowsWrapper(original).source, {
      flag: "wx",
    });
    const parser = path.join(
      process.env.SystemRoot,
      "System32/WindowsPowerShell/v1.0/powershell.exe",
    );
    const command =
      "$tokens=$null;$errors=$null;[Management.Automation.Language.Parser]::ParseFile($env:ACOS_PARSE_SCRIPT,[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count-ne0){[Console]::WriteLine('derived_fixture_parse_failed');exit 1};[Console]::WriteLine('derived_fixture_parse_passed')";
    const result = await promisify(execFile)(
      parser,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      {
        env: { ...process.env, ACOS_PARSE_SCRIPT: file },
        windowsHide: true,
        timeout: 30000,
        encoding: "utf8",
      },
    );
    assert.equal(result.stdout.trim(), "derived_fixture_parse_passed");
  } finally {
    const checked = await realpath(root);
    assert.equal(path.dirname(checked), parent);
    assert.ok(path.basename(checked).startsWith("acos-wrapper-parse-unit-"));
    await rm(checked, { recursive: true });
  }
});
