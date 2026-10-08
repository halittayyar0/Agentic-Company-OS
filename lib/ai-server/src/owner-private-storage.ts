import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const MAX_RECORD_BYTES = 128 * 1024;

export function windowsOwnerSid(identity: string): string {
  const sid = identity
    .trim()
    .match(/^"(?:[^"\r\n]|"")*","(S-1-\d+(?:-\d+){1,15})"$/u)?.[1];
  if (!sid) throw new Error("Cannot establish installation owner");
  return sid;
}

export function assertPrivateUnixMetadata(
  metadata: {
    uid: number;
    mode: number;
    isDirectory: boolean;
    isFile: boolean;
    isSymbolicLink: boolean;
  },
  owner: number,
  directory: boolean,
): void {
  if (
    metadata.uid !== owner ||
    metadata.isSymbolicLink ||
    (directory ? !metadata.isDirectory : !metadata.isFile) ||
    (metadata.mode & 0o777) !== (directory ? 0o700 : 0o600)
  ) {
    throw new Error("private_storage_protection_invalid");
  }
}

// Paths travel only through a child environment variable, never interpolated
// PowerShell source. Build a fresh ACL only for a newly created, empty directory
// or an exclusively created empty file, before writing any protected contents.
// Existing files/directories must already satisfy the postcondition; a broad
// explicit ACE must not survive an inheritance-only change.
const WINDOWS_PROTECTION_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:ACOS_PRIVATE_STORAGE_TARGET
$directory = $env:ACOS_PRIVATE_STORAGE_DIRECTORY -eq '1'
$owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
if ($env:ACOS_PRIVATE_STORAGE_CREATE -eq '1') {
  $acl = if ($directory) { [System.Security.AccessControl.DirectorySecurity]::new() } else { [System.Security.AccessControl.FileSecurity]::new() }
  $acl.SetOwner($owner)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($sid in @($owner, $system)) {
    $rule = if ($directory) { [System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow') } else { [System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'Allow') }
    $acl.AddAccessRule($rule)
  }
  if ($directory) { [System.IO.Directory]::SetAccessControl($target, $acl) } else { [System.IO.File]::SetAccessControl($target, $acl) }
}
$acl = if ($env:ACOS_PRIVATE_STORAGE_DIRECTORY -eq '1') { [System.IO.Directory]::GetAccessControl($target) } else { [System.IO.File]::GetAccessControl($target) }
if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $owner.Value) { throw 'owner' }
if ($env:ACOS_PRIVATE_STORAGE_DIRECTORY -eq '1' -and -not $acl.AreAccessRulesProtected) { throw 'inheritance' }
$ownerFull = $false
foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
  if ($rule.IdentityReference.Value -notin @($owner.Value, $system.Value) -or $rule.AccessControlType -ne 'Allow') { throw 'grant' }
  if ($rule.IdentityReference.Value -eq $owner.Value -and ($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl -and $rule.PropagationFlags -ne 'InheritOnly') { $ownerFull = $true }
}
if (-not $ownerFull) { throw 'rights' }
[Console]::Write('PRIVATE_OK')
`;

async function windowsProtection(
  target: string,
  directory: boolean,
  create = false,
): Promise<void> {
  try {
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot || !path.isAbsolute(systemRoot))
      throw new Error("system_root");
    const executable = path.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const { stdout } = await executeFile(
      executable,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(WINDOWS_PROTECTION_SCRIPT, "utf16le").toString("base64"),
      ],
      {
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 16_384,
        env: {
          ...process.env,
          ACOS_PRIVATE_STORAGE_TARGET: target,
          ACOS_PRIVATE_STORAGE_DIRECTORY: directory ? "1" : "0",
          ACOS_PRIVATE_STORAGE_CREATE: create ? "1" : "0",
        },
      },
    );
    if (stdout.trim() !== "PRIVATE_OK") throw new Error("postcondition");
  } catch {
    throw new Error("private_storage_protection_invalid");
  }
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

/** Owner-private, bounded records. No caller may downgrade its protection. */
export class OwnerPrivateStorage {
  readonly directory: string;
  constructor(directory: string) {
    if (!path.isAbsolute(directory))
      throw new Error("private_storage_absolute_path_required");
    this.directory = path.resolve(directory);
  }

  private recordPath(name: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/u.test(name))
      throw new Error("private_storage_record_name_invalid");
    return path.join(this.directory, name);
  }

  private async assertProtected(
    target: string,
    directory: boolean,
  ): Promise<void> {
    const stat = await lstat(target);
    if (
      stat.isSymbolicLink() ||
      (directory ? !stat.isDirectory() : !stat.isFile()) ||
      !samePath(await realpath(target), target)
    )
      throw new Error("private_storage_path_invalid");
    if (process.platform === "win32") {
      await windowsProtection(target, directory);
    } else {
      if (!process.getuid) throw new Error("private_storage_owner_unavailable");
      assertPrivateUnixMetadata(
        {
          uid: stat.uid,
          mode: stat.mode,
          isDirectory: stat.isDirectory(),
          isFile: stat.isFile(),
          isSymbolicLink: stat.isSymbolicLink(),
        },
        process.getuid(),
        directory,
      );
    }
  }

  async initialize(exclusive = false): Promise<void> {
    const parent = path.dirname(this.directory);
    if (!samePath(await realpath(parent), parent))
      throw new Error("private_storage_parent_redirected");
    let created = false;
    try {
      await mkdir(this.directory, { mode: 0o700 });
      created = true;
    } catch (error) {
      if (exclusive || (error as NodeJS.ErrnoException).code !== "EEXIST")
        throw error;
    }
    if (created && process.platform === "win32")
      await windowsProtection(this.directory, true, true);
    await this.assertProtected(this.directory, true);
  }

  async read(name: string): Promise<string | null> {
    await this.assertProtected(this.directory, true);
    const target = this.recordPath(name);
    try {
      await this.assertProtected(target, false);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const handle = await open(target, "r");
    try {
      if ((await handle.stat()).size > MAX_RECORD_BYTES)
        throw new Error("private_storage_record_too_large");
      return await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  }

  async write(name: string, value: string): Promise<void> {
    if (Buffer.byteLength(value, "utf8") > MAX_RECORD_BYTES)
      throw new Error("private_storage_record_too_large");
    await this.assertProtected(this.directory, true);
    const target = this.recordPath(name);
    try {
      await this.assertProtected(target, false);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const temporary = this.recordPath(`tmp-${randomUUID()}`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      // Elevated Windows tokens can create files owned by Administrators.
      // Protect only this new empty file before any secret bytes are written.
      if (process.platform === "win32")
        await windowsProtection(temporary, false, true);
      await this.assertProtected(temporary, false);
      await handle.writeFile(value, "utf8");
      await handle.sync();
      await handle.close();
      await this.assertProtected(this.directory, true);
      await rename(temporary, target);
      if (process.platform !== "win32") {
        const directory = await open(this.directory, "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } finally {
      await handle.close();
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }

  /** O_EXCL is the cross-process authority; a stale lock never expires by time. */
  async withLock<T>(
    action: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const deadline = Date.now() + 30_000;
    const target = this.recordPath("registration.lock");
    let handle;
    while (!handle) {
      signal?.throwIfAborted();
      await this.assertProtected(this.directory, true);
      try {
        handle = await open(target, "wx", 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        // The owner may release the lock between EEXIST and observation.
        // Never run a slow ACL subprocess against this disappearing marker;
        // no contents are read. The containing directory is already protected.
        try {
          const marker = await lstat(target);
          if (!marker.isFile() || marker.isSymbolicLink())
            throw new Error("private_storage_lock_invalid");
        } catch (observationError) {
          if ((observationError as NodeJS.ErrnoException).code === "ENOENT")
            continue;
          throw observationError;
        }
        if (Date.now() >= deadline)
          throw new Error("private_storage_lock_unavailable");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    try {
      if (process.platform === "win32")
        await windowsProtection(target, false, true);
      await this.assertProtected(target, false);
      return await action();
    } finally {
      await handle.close();
      await unlink(target);
    }
  }
}
