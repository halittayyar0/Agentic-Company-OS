/** Actual Windows ACL/identity conformance on synthetic, owned fixtures only.
 * PowerShell is the fixture/oracle; the production checker never launches it. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

assert.equal(process.platform, "win32");
assert.equal(process.arch, "x64");
assert.equal(
  process.argv.length,
  4,
  "Provide a build directory and fresh report file",
);
const directory = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
const build = JSON.parse(
  await readFile(path.join(directory, "build.json"), "utf8"),
);
const helper = path.join(directory, "windows-private-helper.exe");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
assert.equal(
  build.sourceSha256,
  sha(
    await readFile(
      new URL(
        "../lib/ai-server/native/windows-private-helper.c",
        import.meta.url,
      ),
    ),
  ),
);
assert.equal(build.executableSha256, sha(await readFile(helper)));
const execute = promisify(execFile);
const powershell = path.join(
  process.env.SystemRoot,
  "System32/WindowsPowerShell/v1.0/powershell.exe",
);
const temporaryRoot = await realpath(tmpdir());
const base = await mkdtemp(path.join(temporaryRoot, "acos-checker-security-"));
assert.equal(await realpath(base), base);
console.log(
  JSON.stringify({
    fixtureRootCanonical: true,
    temporaryAliasResolved:
      path.normalize(tmpdir()).toLowerCase() !== temporaryRoot.toLowerCase(),
  }),
);
const files = [],
  directories = [],
  checks = [];
const record = (name) => {
  checks.push(name);
  console.log(JSON.stringify({ check: name, passed: true }));
};
const fixtureSource = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::Error.WriteLine('FIXTURE_STARTED')
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FixtureAcl {
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode)]
  public static extern uint SetNamedSecurityInfo(string name, int type, uint information, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
}
'@
[Console]::Error.WriteLine('FIXTURE_COMPILED')
$target = $env:ACOS_TEST_TARGET
$kind = $env:ACOS_TEST_KIND
$owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$everyone = [System.Security.Principal.SecurityIdentifier]::new('S-1-1-0')
$sections = [System.Security.AccessControl.AccessControlSections]::Access -bor [System.Security.AccessControl.AccessControlSections]::Owner
if ($kind -ne 'read') {
  $acl = [System.Security.AccessControl.RawAcl]::new(4, 4)
  $rights = 2032127
  if ($kind -eq 'incomplete') { $rights = 1245631 }
  $flags = [System.Security.AccessControl.AceFlags]::None
  if ($kind -eq 'inherit-only') { $flags = [System.Security.AccessControl.AceFlags]11 } # OI | CI | INHERIT_ONLY
  $ownerAce = [System.Security.AccessControl.CommonAce]::new($flags, [System.Security.AccessControl.AceQualifier]::AccessAllowed, $rights, $owner, $false, $null)
  if ($kind -eq 'callback') {
    $ownerAce = [System.Security.AccessControl.CommonAce]::new($flags, [System.Security.AccessControl.AceQualifier]::AccessAllowed, $rights, $owner, $true, $null)
  }
  if ($kind -eq 'object') {
    $ownerAce = [System.Security.AccessControl.ObjectAce]::new($flags, [System.Security.AccessControl.AceQualifier]::AccessAllowed, $rights, $owner, [System.Security.AccessControl.ObjectAceFlags]::None, [Guid]::Empty, [Guid]::Empty, $false, $null)
  }
  if ($kind -eq 'deny') {
    $acl.InsertAce($acl.Count, [System.Security.AccessControl.CommonAce]::new([System.Security.AccessControl.AceFlags]::None, [System.Security.AccessControl.AceQualifier]::AccessDenied, 1, $system, $false, $null))
  }
  if ($kind -ne 'empty' -and $kind -ne 'null') {
    $acl.InsertAce($acl.Count, $ownerAce)
    $acl.InsertAce($acl.Count, [System.Security.AccessControl.CommonAce]::new([System.Security.AccessControl.AceFlags]::None, [System.Security.AccessControl.AceQualifier]::AccessAllowed, 2032127, $system, $false, $null))
  }
  if ($kind -eq 'public' -or $kind -eq 'inherited-public') {
    $aceFlags = [System.Security.AccessControl.AceFlags]::None
    if ($kind -eq 'inherited-public') { $aceFlags = [System.Security.AccessControl.AceFlags]::Inherited }
    $acl.InsertAce($acl.Count, [System.Security.AccessControl.CommonAce]::new($aceFlags, [System.Security.AccessControl.AceQualifier]::AccessAllowed, 1179785, $everyone, $false, $null))
  }
  $memory = [IntPtr]::Zero
  try {
    if ($kind -ne 'null') {
      $bytes = [byte[]]::new($acl.BinaryLength)
      $acl.GetBinaryForm($bytes, 0)
      $memory = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
      [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $memory, $bytes.Length)
    }
    $information = [uint32]2147483652
    if ($kind -eq 'unprotected') { $information = [uint32]536870916 }
    $code = [FixtureAcl]::SetNamedSecurityInfo($target, 1, $information, [IntPtr]::Zero, [IntPtr]::Zero, $memory, [IntPtr]::Zero)
    if ($code -ne 0) { throw 'fixture ACL construction failed' }
  } finally {
    if ($memory -ne [IntPtr]::Zero) { [System.Runtime.InteropServices.Marshal]::FreeHGlobal($memory) }
  }
}
if ([System.IO.Directory]::Exists($target)) {
  $security = [System.IO.Directory]::GetAccessControl($target, $sections)
} else { $security = [System.IO.File]::GetAccessControl($target, $sections) }
[Console]::Write([Convert]::ToBase64String($security.GetSecurityDescriptorBinaryForm()))
[Console]::Error.WriteLine('FIXTURE_COMPLETE')
`;
async function acl(target, kind) {
  // The fixture compiler uses the host's normal Windows/.NET tool locations.
  // Keep credentials out; production native invocations still inherit none.
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) =>
      [
        "systemroot",
        "windir",
        "systemdrive",
        "comspec",
        "path",
        "pathext",
        "userprofile",
        "home",
        "homedrive",
        "homepath",
        "temp",
        "tmp",
        "localappdata",
        "appdata",
        "psmodulepath",
        "programfiles",
        "programfiles(x86)",
        "programw6432",
        "number_of_processors",
        "processor_architecture",
        "username",
        "userdomain",
      ].includes(name.toLowerCase()),
    ),
  );
  let result;
  try {
    result = await execute(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(fixtureSource, "utf16le").toString("base64"),
      ],
      {
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 16_384,
        env: {
          ...environment,
          ACOS_TEST_TARGET: target,
          ACOS_TEST_KIND: kind,
        },
      },
    );
  } catch (error) {
    const markers =
      String(error.stderr ?? "").match(
        /FIXTURE_(?:STARTED|COMPILED|COMPLETE)/gu,
      ) ?? [];
    throw new Error(
      `Windows ACL fixture ${kind} failed: killed=${error.killed === true}; exit=${error.code ?? "none"}; phase=${markers.at(-1) ?? "before-script"}`,
    );
  }
  assert.equal(
    result.stderr.replaceAll("\r\n", "\n"),
    "FIXTURE_STARTED\nFIXTURE_COMPILED\nFIXTURE_COMPLETE\n",
  );
  return sha(Buffer.from(result.stdout, "base64"));
}
async function initialize(target) {
  const pending = execute(helper, ["--initialize-directory"], {
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 16_384,
    env: {
      ACOS_PRIVATE_STORAGE_TARGET: target,
      ACOS_PRIVATE_STORAGE_EXCLUSIVE: "1",
    },
  });
  pending.child.stdin.on("error", () => {});
  pending.child.stdin.end("COMMIT\n");
  await pending;
  directories.push(target);
}
async function check(
  target,
  isDirectory,
  create = false,
  identity = undefined,
) {
  identity ??= await lstat(target, { bigint: true });
  return execute(helper, ["--check"], {
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 16_384,
    env: {
      ACOS_PRIVATE_STORAGE_TARGET: target,
      ACOS_PRIVATE_STORAGE_DIRECTORY: isDirectory ? "1" : "0",
      ACOS_PRIVATE_STORAGE_CREATE: create ? "1" : "0",
      ...(identity
        ? {
            ACOS_PRIVATE_STORAGE_DEVICE: identity.dev.toString(),
            ACOS_PRIVATE_STORAGE_INODE: identity.ino.toString(),
          }
        : {}),
    },
  });
}
async function rejected(operation) {
  await assert.rejects(operation, (error) => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, "");
    assert.equal(
      error.stderr,
      "ACOS_PRIVATE_STORAGE_STARTEDPRIVATE_STORAGE_FAILED",
    );
    return true;
  });
}
try {
  for (const kind of [
    "public",
    "null",
    "empty",
    "deny",
    "callback",
    "object",
    "inherit-only",
    "incomplete",
    "unprotected",
    "inherited-public",
  ]) {
    const target = path.join(base, kind);
    await initialize(target);
    const identity = await lstat(target, { bigint: true });
    assert.equal(
      (await check(target, true, false, identity)).stdout,
      "PRIVATE_OK",
    );
    try {
      const before = await acl(target, kind);
      await rejected(check(target, true, false, identity));
      assert.equal(await acl(target, "read"), before);
      record(`${kind} ACL rejected without mutation`);
    } finally {
      await acl(target, "restore");
    }
  }
  const good = path.join(base, "private");
  await initialize(good);
  const before = await acl(good, "read");
  assert.equal((await check(good, true)).stdout, "PRIVATE_OK");
  await rejected(check(good, true, true));
  await rejected(check(good, false));
  assert.equal(await acl(good, "read"), before);
  record(
    "directory create-flag misuse and file-type mismatch leave the descriptor unchanged",
  );
  const file = path.join(base, "empty-file");
  const fileHandle = await open(file, "wx+");
  files.push(file);
  try {
    const info = await fileHandle.stat({ bigint: true });
    const inherited = await acl(file, "read");
    await rejected(
      check(file, false, true, { dev: info.dev, ino: info.ino + 1n }),
    );
    assert.equal(await acl(file, "read"), inherited);
    await check(file, false, true, info);
    await check(file, false);
    const secured = await acl(file, "read");
    const content = "synthetic-retained-content";
    await fileHandle.writeFile(content);
    await rejected(check(file, false, true, info));
    await rejected(check(file, true));
    assert.equal(await acl(file, "read"), secured);
    const bytes = Buffer.alloc(Buffer.byteLength(content));
    const { bytesRead } = await fileHandle.read(bytes, 0, bytes.length, 0);
    assert.equal(bytesRead, bytes.length);
    assert.equal(bytes.toString("utf8"), content);
  } finally {
    await fileHandle.close();
  }
  record(
    "stale file identity, nonempty creation and type mismatch cannot mutate security or contents",
  );
  let parent = base;
  for (let index = 0; index < 12; index++) {
    parent = path.join(parent, `私人 çalışma ${index} long directory`);
    await mkdir(parent);
    directories.push(parent);
  }
  const long = path.join(parent, "private-vault");
  assert.ok(long.length > 260);
  await initialize(long);
  await check(long, true);
  record(
    "canonical UTF16 directory longer than MAX_PATH can be created and checked",
  );
} finally {
  for (const file of files.reverse()) {
    assert.ok(
      path.relative(base, file) && !path.relative(base, file).startsWith(".."),
    );
    await unlink(file);
  }
  for (const target of directories.reverse()) {
    assert.ok(
      path.relative(base, target) &&
        !path.relative(base, target).startsWith(".."),
    );
    await rmdir(target);
  }
  await rmdir(base);
}
const report = {
  schema: "agentic-company-os/windows-private-helper-security@1",
  sourceSha256: build.sourceSha256,
  executableSha256: build.executableSha256,
  checks,
  passed: true,
  cleanupVerified: true,
  fixtureRootCanonical: true,
  applicationOrModelStarted: false,
  privilegesChanged: false,
  actualMainOrReleaseAccepted: false,
  untested: [
    "foreign-owner fixture requiring another account or ownership privilege",
    "UNC network share",
  ],
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(
  JSON.stringify({ passed: true, checks: checks.length, report: output }),
);
