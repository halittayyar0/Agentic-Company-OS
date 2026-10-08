import {
  readLinuxCodingMode,
  MANAGED_CODING_COMMAND_PATH,
  MANAGED_CODEX_EXECUTABLE,
} from "./vm/linux-managed-coding-toolchain";
import {
  execFile,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { OwnerPrivateStorage } from "@workspace/ai-server/owner-private-storage";
import type { CodexTaskAuthority } from "./codex-task-authority";
import type { OwnedCodexTaskSession } from "./codex-task-session";
import {
  CodexTaskError,
  type CodexTaskBinding,
  type CodexTaskPorts,
  type PreparedCodexTask,
} from "./codex-task-adapter";
import { buildCodexTaskConfiguration } from "./codex-task-configuration";
import {
  compileWindowsOwnedJob,
  launchWindowsOwnedJob,
} from "./vm/windows-owned-job";
import {
  prepareLinuxOwnedNamespace,
  launchLinuxOwnedNamespace,
} from "./vm/linux-owned-namespace";

const executeFile = promisify(execFile);
function unsupported(): never {
  throw new CodexTaskError("unsupported_capability");
}
const identity = (value: string) =>
  process.platform === "win32"
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);
const canonical = (value: string) =>
  typeof value === "string" &&
  value.length <= 4096 &&
  !/[\u0000-\u001f\u007f]/u.test(value) &&
  path.isAbsolute(value) &&
  path.normalize(value) === value;
const keys = [
  "taskId",
  "attemptId",
  "leaseOwner",
  "policyRevision",
  "registrationId",
  "registrationRevision",
  "accountId",
  "admissionVersion",
] as const;
const sameBinding = (left: CodexTaskBinding, right: CodexTaskBinding) =>
  keys.every((key) => left[key] === right[key]);
function disjoint(left: string, right: string) {
  return [path.relative(left, right), path.relative(right, left)].every(
    (value) => value.startsWith(`..${path.sep}`) || path.isAbsolute(value),
  );
}
async function exact(value: string, directory: boolean) {
  if (!canonical(value)) unsupported();
  const stat = await lstat(value);
  if (
    stat.isSymbolicLink() ||
    (directory ? !stat.isDirectory() : !stat.isFile()) ||
    identity(await realpath(value)) !== identity(value)
  )
    unsupported();
  return stat;
}
export async function readCodexTaskExecutableDigest(executable: string) {
  const before = await exact(executable, false);
  if (before.size <= 0 || before.size > 512 * 1024 * 1024) unsupported();
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(executable)) hash.update(chunk);
  const after = await exact(executable, false);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
    unsupported();
  return hash.digest("hex");
}
const fingerprint = readCodexTaskExecutableDigest;
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
interface LaunchInput {
  executable: string;
  cwd: string;
  workspace: string;
  controlDirectory: string;
  environment: NodeJS.ProcessEnv;
  assertOwned(): Promise<void>;
  handle: unknown;
}
/** Internal backend seam. A platform launcher must own the complete process
 * tree and return a stop promise that verifies cleanup; a raw spawn is invalid. */
interface NativeLauncher {
  systemConfigDirectories(): Promise<string[]>;
  version(
    executable: string,
    cwd: string,
    environment: NodeJS.ProcessEnv,
  ): Promise<string>;
  prepare(home: string): Promise<unknown>;
  launch(
    input: LaunchInput,
  ): Promise<{ child: ChildProcessWithoutNullStreams; stop(): Promise<void> }>;
}
function windowsEnvironment(home: string): NodeJS.ProcessEnv {
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !canonical(systemRoot)) unsupported();
  return {
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    PATH: path.join(systemRoot, "System32"),
    HOME: home,
    USERPROFILE: home,
  };
}
function defaultNative(): NativeLauncher {
  if (process.platform === "linux")
    return {
      systemConfigDirectories: async () => ["/etc/codex"],
      version: async (executable, cwd, environment) => {
        const { stdout } = await executeFile(executable, ["--version"], {
          cwd,
          env: environment,
          timeout: 5000,
          maxBuffer: 8192,
        });
        return stdout;
      },
      prepare: (home) =>
        prepareLinuxOwnedNamespace(path.join(home, "owned-namespace-helper")),
      launch: (input) =>
        launchLinuxOwnedNamespace({
          ...input,
          args: ["app-server"],
          helper: input.handle as Awaited<
            ReturnType<typeof prepareLinuxOwnedNamespace>
          >,
        }),
    };
  // Other native platforms require a controller with equally strong lifetime
  // ownership. Do not substitute a detached process group or raw host spawn.
  if (process.platform !== "win32") unsupported();
  return {
    systemConfigDirectories: async () => {
      const environment = windowsEnvironment(path.dirname(process.execPath));
      const { stdout } = await executeFile(
        path.join(
          environment.SystemRoot!,
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        ),
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(
            "[Console]::Write([Environment]::GetFolderPath('CommonApplicationData'))",
            "utf16le",
          ).toString("base64"),
        ],
        { env: environment, windowsHide: true, timeout: 5000, maxBuffer: 8192 },
      );
      const programData = stdout.trim();
      if (!canonical(programData)) unsupported();
      return [path.join(programData, "OpenAI", "Codex")];
    },
    version: async (executable, cwd, environment) => {
      const { stdout } = await executeFile(executable, ["--version"], {
        cwd,
        env: environment,
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 8192,
      });
      return stdout;
    },
    prepare: (home) =>
      compileWindowsOwnedJob(path.join(home, "owned-job-binary")),
    launch: (input) =>
      launchWindowsOwnedJob({
        ...input,
        helper: input.handle as Awaited<
          ReturnType<typeof compileWindowsOwnedJob>
        >,
      }),
  };
}
interface Input {
  authority: CodexTaskAuthority;
  /** All paths are resolved by the backend, never from model tool arguments. */
  workspace: string;
  storageDirectory: string;
  executable: string;
  processExecEnabled: boolean;
  /** An exclusively claimed backend session, never a model-supplied home. */
  session?: OwnedCodexTaskSession;
}
interface State {
  prepared: PreparedCodexTask;
  home: string;
  storage: OwnerPrivateStorage;
  config: string;
  executableFingerprint: string;
  native: NativeLauncher;
  handle: unknown;
  controlDirectory: string;
  linuxMode: "native" | "managed";
  launched: boolean;
}
/** A real production prepare/launch boundary. The isolated owner-only home is
 * also the startup cwd and denied to model commands. Version/helper setup has
 * no credential; only the final owned app-server process receives accessToken.
 * Named-profile/effective-config/OS checks remain mandatory in the driver. */
export function createCodexTaskProcessPorts(
  input: Input,
  injectedNative?: NativeLauncher,
): Pick<CodexTaskPorts, "readBinding" | "prepare" | "launch" | "readSession"> {
  const {
    authority,
    workspace,
    storageDirectory,
    executable,
    processExecEnabled,
    session,
  } = input;
  const binding = Object.freeze({ ...authority.binding });
  let preparing: Promise<State> | undefined;
  async function assertOwned(selected: CodexTaskBinding = binding) {
    try {
      const current = await authority.readBinding();
      if (
        !sameBinding(binding, selected) ||
        !current ||
        !sameBinding(binding, current)
      )
        throw new Error();
      await session?.assertCurrent(selected);
    } catch {
      throw new CodexTaskError("ownership_lost");
    }
  }
  async function systemPreflight(native: NativeLauncher) {
    const directories = await native.systemConfigDirectories();
    if (
      !Array.isArray(directories) ||
      directories.length === 0 ||
      directories.length > 8
    )
      unsupported();
    for (const directory of directories) {
      if (!canonical(directory)) unsupported();
      // Native CLI has no release flag to ignore system config. An empty user
      // override would still merge foreign MCP/hooks. Refuse this optional
      // capability before launching anything that could load those layers.
      try {
        await lstat(directory);
        unsupported();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  async function prepare(): Promise<State> {
    const executableRelative = path.relative(workspace, executable);
    if (
      !processExecEnabled ||
      ![workspace, storageDirectory, executable].every(canonical) ||
      !disjoint(workspace, storageDirectory) ||
      !(
        executableRelative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(executableRelative)
      )
    )
      unsupported();
    await assertOwned();
    await exact(workspace, true);
    const native = injectedNative ?? defaultNative();
    await systemPreflight(native);
    const linuxMode =
      process.platform === "linux" ? await readLinuxCodingMode() : "native";
    if (linuxMode === "managed" && executable !== MANAGED_CODEX_EXECUTABLE)
      unsupported();
    const executableFingerprint = await fingerprint(executable);
    const base = new OwnerPrivateStorage(storageDirectory);
    await base.initialize();
    const previous = session ? await session.readSession() : null;
    const home = session
      ? await session.readRuntimeHome({
          binding,
          workspace,
          storageDirectory,
          model: authority.model,
          executableDigest: executableFingerprint,
        })
      : path.join(storageDirectory, randomUUID());
    if (!canonical(home) || path.dirname(home) !== storageDirectory)
      unsupported();
    // A durable ID without its actual protected history is not resumable.
    if (previous) await exact(home, true);
    const storage = new OwnerPrivateStorage(home);
    await storage.initialize(!session);
    for (const directory of ["tmp", "appdata", "local-appdata"])
      await new OwnerPrivateStorage(path.join(home, directory)).initialize(
        !session,
      );
    const context = await authority.readLaunchContext();
    if (
      !context.registration.credentials ||
      context.policy.revision !== binding.policyRevision
    )
      throw new CodexTaskError("ownership_lost");
    const built = buildCodexTaskConfiguration({
      cwd: workspace,
      home,
      executable,
      model: authority.model,
      policy: context.policy as Parameters<
        typeof buildCodexTaskConfiguration
      >[0]["policy"],
      canUseTerminal: true,
      processExecEnabled,
      managedLinux: linuxMode === "managed",
    });
    if (previous && (await storage.read("config.toml")) !== built.toml)
      unsupported();
    await storage.write("config.toml", built.toml);
    const environment = processEnvironment(home, linuxMode);
    if (
      (await native.version(executable, home, { ...environment })).trim() !==
      "codex-cli 0.159.2"
    )
      unsupported();
    if ((await fingerprint(executable)) !== executableFingerprint)
      unsupported();
    await assertOwned();
    // Each child gets separate controller/compiler records. The stable home
    // contains private Codex history; no old ready/stop receipt is reused.
    const runtimeDirectory = path.join(home, "owned-launch-" + randomUUID());
    await new OwnerPrivateStorage(runtimeDirectory).initialize(true);
    const handle = await native.prepare(runtimeDirectory);
    await assertOwned();
    const prepared: PreparedCodexTask = freeze({
      cwd: workspace,
      model: authority.model,
      approvalPolicy: built.approvalPolicy,
      permissions: built.permissions,
      config: {},
      secrets: [
        context.registration.credentials.accessToken,
        context.registration.credentials.idToken,
        context.registration.credentials.refreshToken,
      ].filter((value): value is string => !!value),
    });
    return {
      prepared,
      home,
      storage,
      config: built.toml,
      executableFingerprint,
      native,
      handle,
      controlDirectory: path.join(runtimeDirectory, "owned-job-control"),
      linuxMode,
      launched: false,
    };
  }
  function processEnvironment(
    home: string,
    linuxMode: "native" | "managed",
  ): NodeJS.ProcessEnv {
    const environment =
      process.platform === "win32"
        ? windowsEnvironment(home)
        : {
            PATH:
              linuxMode === "managed"
                ? MANAGED_CODING_COMMAND_PATH
                : "/usr/bin:/bin",
            HOME: home,
            USERPROFILE: home,
          };
    return {
      ...environment,
      CODEX_HOME: home,
      CODEX_SQLITE_HOME: home,
      APPDATA: path.join(home, "appdata"),
      LOCALAPPDATA: path.join(home, "local-appdata"),
      XDG_CONFIG_HOME: home,
      TEMP: path.join(home, "tmp"),
      TMP: path.join(home, "tmp"),
      TMPDIR: path.join(home, "tmp"),
      NO_COLOR: "1",
      CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: "1",
    };
  }
  return {
    ...(session ? { readSession: () => session.readSession() } : {}),
    readBinding: async () => {
      try {
        await assertOwned();
        return binding;
      } catch {
        return null;
      }
    },
    prepare: async (selected) => {
      await assertOwned(selected);
      try {
        preparing ??= prepare();
        return (await preparing).prepared;
      } catch (error) {
        if (error instanceof CodexTaskError) throw error;
        return unsupported();
      }
    },
    launch: async (prepared, selected) => {
      await assertOwned(selected);
      let state: State;
      try {
        if (!preparing) unsupported();
        state = await preparing;
        if (state.prepared !== prepared || state.launched) unsupported();
        // Reserve synchronously before any remaining asynchronous checks.
        // A failed/uncertain start is never replayed by this process factory.
        state.launched = true;
        await exact(workspace, true);
        await systemPreflight(state.native);
        if (
          process.platform === "linux" &&
          (await readLinuxCodingMode()) !== state.linuxMode
        )
          unsupported();
        if (
          (await state.storage.read("config.toml")) !== state.config ||
          (await fingerprint(executable)) !== state.executableFingerprint
        )
          unsupported();
      } catch (error) {
        if (error instanceof CodexTaskError) throw error;
        return unsupported();
      }
      const context = await authority.readLaunchContext().catch(() => {
        throw new CodexTaskError("ownership_lost");
      });
      if (
        !context.registration.credentials ||
        context.registration.revision !== binding.registrationRevision ||
        context.registration.id !== binding.registrationId ||
        context.policy.revision !== binding.policyRevision
      )
        throw new CodexTaskError("ownership_lost");
      await assertOwned();
      const running = await state.native.launch({
        handle: state.handle,
        executable,
        cwd: state.home,
        workspace,
        controlDirectory: state.controlDirectory,
        environment: {
          ...processEnvironment(state.home, state.linuxMode),
          ACOS_CODEX_ACCESS_TOKEN: context.registration.credentials.accessToken,
        },
        assertOwned,
      });
      try {
        await assertOwned();
        return running;
      } catch {
        try {
          await running.stop();
        } catch {
          throw new CodexTaskError("cleanup_failed");
        }
        throw new CodexTaskError("ownership_lost");
      }
    },
  };
}
