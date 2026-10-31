import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("effective Windows access detects writable group grants despite a user RX grant, then rejects explicit mutation denies", async () => {
  assert.equal(process.platform, "win32");
  const helper = fileURLToPath(new URL("./windows-acl.ps1", import.meta.url));
  const shell = path.join(
    process.env.SystemRoot,
    "System32/WindowsPowerShell/v1.0/powershell.exe",
  );
  // In-memory security descriptors and the existing token ONLY. No new account,
  // filesystem permissions, fixture, process identity or machine setting changes.
  const command = `$ErrorActionPreference='Stop'
 . ([scriptblock]::Create([IO.File]::ReadAllText($env:ACOS_ACL_UNIT_HELPER)))
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 $base='O:SYG:SYD:(A;;FA;;;AU)(A;;FRFX;;;'+$sid+')'
 if(-not [NativeReleaseReadonlyAcl]::HasMutation($base)){throw 'rx_allow_did_not_detect_writable_group'}
 $deny='O:SYG:SYD:(D;;0x000d0156;;;'+$sid+')(A;;FA;;;AU)(A;;FRFX;;;'+$sid+')'
 if([NativeReleaseReadonlyAcl]::HasMutation($deny)){throw 'mutation_deny_ineffective'}
 try { Assert-DisposableReadonlyAclHost; throw 'local_mutation_guard_missing' } catch { if($_.Exception.Message -cne 'readonly_acl_requires_original_disposable_host'){throw} }
 [Console]::WriteLine('in_memory_effective_access_passed_no_filesystem_mutation')`;
  const result = await promisify(execFile)(
    shell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    {
      env: {
        ...process.env,
        ACOS_ACL_UNIT_HELPER: helper,
        GITHUB_ACTIONS: "false",
      },
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 1048576,
    },
  );
  assert.equal(
    result.stdout.trim(),
    "in_memory_effective_access_passed_no_filesystem_mutation",
  );
});
