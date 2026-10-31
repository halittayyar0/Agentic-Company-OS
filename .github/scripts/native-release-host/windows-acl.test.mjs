import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

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

test("denied write-open cannot create a rollback record; uncertain set failure keeps its journal and closes the same handle", async () => {
  const parent = await realpath(tmpdir()),
    root = await mkdtemp(path.join(parent, "acos-acl-transaction-unit-"));
  try {
    const helper = (
      await readFile(new URL("./windows-acl.ps1", import.meta.url), "utf8")
    ).replaceAll("\r\n", "\n");
    const unit = `
public static class NativeAclTransactionUnit {
 public static string Run() {
  int journal=0,closed=0;
  bool skipped=NativeReleaseReadonlyAcl.MutateOne(true,()=>{throw new System.ComponentModel.Win32Exception(5);},h=>{journal++;},h=>{closed++;});
  if(skipped||journal!=0||closed!=0)throw new System.Exception("ancestor_open_denial_was_journalled");
  bool rejected=false;
  try{NativeReleaseReadonlyAcl.MutateOne(false,()=>{throw new System.ComponentModel.Win32Exception(5);},h=>{journal++;},h=>{closed++;});}catch(System.ComponentModel.Win32Exception error){rejected=error.NativeErrorCode==5;}
  if(!rejected||journal!=0||closed!=0)throw new System.Exception("control_open_denial_was_waived_or_journalled");
  rejected=false;
  try{NativeReleaseReadonlyAcl.MutateOne(false,()=>new System.IntPtr(17),h=>{if(h.ToInt32()!=17)throw new System.Exception("wrong_handle");journal++;throw new System.ComponentModel.Win32Exception(5);},h=>{if(h.ToInt32()!=17)throw new System.Exception("wrong_handle");closed++;});}catch(System.ComponentModel.Win32Exception error){rejected=error.NativeErrorCode==5;}
  if(!rejected||journal!=1||closed!=1)throw new System.Exception("uncertain_set_lost_rollback_or_handle");
  return "in_memory_acl_journal_order_passed";
 }
}
`;
    assert.equal(helper.split("\n'@\n}").length, 2);
    const file = path.join(root, "fake-transaction.ps1");
    await writeFile(file, helper.replace("\n'@\n}", unit + "\n'@\n}"), {
      flag: "wx",
    });
    const shell = path.join(
      process.env.SystemRoot,
      "System32/WindowsPowerShell/v1.0/powershell.exe",
    );
    const command =
      "$ErrorActionPreference='Stop';. ([scriptblock]::Create([IO.File]::ReadAllText($env:ACOS_ACL_UNIT_HELPER)));[Console]::WriteLine([NativeAclTransactionUnit]::Run())";
    const result = await promisify(execFile)(
      shell,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      {
        env: {
          ...process.env,
          ACOS_ACL_UNIT_HELPER: file,
          GITHUB_ACTIONS: "false",
        },
        encoding: "utf8",
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 1048576,
      },
    );
    assert.equal(result.stdout.trim(), "in_memory_acl_journal_order_passed");
  } finally {
    const owned = await realpath(root);
    assert.equal(path.dirname(owned), parent);
    assert.ok(path.basename(owned).startsWith("acos-acl-transaction-unit-"));
    await rm(owned, { recursive: true });
  }
});
