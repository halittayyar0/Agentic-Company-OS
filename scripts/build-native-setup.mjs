import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "../artifacts/api-server/node_modules/esbuild/lib/main.js";
import {
  nodeArchiveDownloadUrl,
  postgresSourceDownloadUrl,
} from "./native-runtime-download.mjs";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const helper = path.join(root, "scripts/native-package-archive.py");
const python = process.env.PYTHON ?? "python";
const target = `${process.platform}-${process.arch}`;
const values = new Map();
let development = false;
for (let index = 2; index < process.argv.length; index++) {
  const flag = process.argv[index];
  if (flag === "--development" && !development) {
    development = true;
    continue;
  }
  if (
    !["--commit", "--out", "--postgres"].includes(flag) ||
    values.has(flag) ||
    !process.argv[index + 1]
  )
    throw new Error(
      "Usage: node scripts/build-native-setup.mjs --commit SHA --out NEW_DIRECTORY --postgres ABSOLUTE_BUILT_PREFIX [--development]",
    );
  values.set(flag, process.argv[++index]);
}
const commit = values.get("--commit");
const output = values.get("--out");
const postgres = values.get("--postgres");
if (
  !/^[a-f0-9]{40}$/u.test(commit ?? "") ||
  !output ||
  !postgres ||
  !path.isAbsolute(postgres)
)
  throw new Error(
    "Exact commit, fresh output and absolute PostgreSQL prefix required",
  );
const pins = JSON.parse(
  await readFile(path.join(root, "deploy/native-runtimes.json"), "utf8"),
);
const node = pins.targets?.[target]?.node;
if (
  !node ||
  !/^24\.\d+\.\d+$/u.test(node.version) ||
  !/^[a-f0-9]{64}$/u.test(node.sha256) ||
  !node.url.startsWith("https://nodejs.org/dist/") ||
  !/^17\.\d+$/u.test(pins.postgres?.version)
)
  throw new Error("Unsupported host or invalid pinned runtime inputs");
const nodeDownloadUrl = nodeArchiveDownloadUrl(target, node);
postgresSourceDownloadUrl(pins.postgres);
const head = (
  await execute("git", ["rev-parse", "HEAD"], { cwd: root })
).stdout.trim();
if (head !== commit) throw new Error("Build revision does not match HEAD");
const dirty = Boolean(
  (
    await execute(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=normal"],
      { cwd: root },
    )
  ).stdout.trim(),
);
if (dirty && !development)
  throw new Error("Release builds require a clean checkout");
const directory = path.resolve(output);
const archive = directory + (process.platform === "win32" ? ".zip" : ".tar.gz");
for (const candidate of [directory, archive, directory + ".provenance.json"]) {
  try {
    await lstat(candidate);
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  throw new Error("Package output must be new");
}

// Dereference only within an explicit trusted tree; never preserve symlinks.
async function copyTree(
  source,
  destination,
  boundary = undefined,
  ancestors = new Set(),
) {
  const actual = await realpath(source);
  boundary ??= actual;
  const relative = path.relative(boundary, actual);
  if (
    relative.startsWith(".." + path.sep) ||
    relative === ".." ||
    path.isAbsolute(relative) ||
    ancestors.has(actual)
  )
    throw new Error("Dependency link escapes its tree or forms a cycle");
  const info = await stat(actual);
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true });
    const next = new Set(ancestors).add(actual);
    for (const name of await readdir(actual))
      await copyTree(
        path.join(actual, name),
        path.join(destination, name),
        boundary,
        next,
      );
  } else if (info.isFile()) {
    if (info.size > 128 * 1024 * 1024)
      throw new Error("Runtime file exceeds manifest limit");
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(actual, destination);
    await chmod(destination, info.mode & 0o777);
  } else throw new Error("Runtime contains a special file");
}
async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function inventory(base, prefix = "") {
  const files = [];
  for (const name of (await readdir(path.join(base, prefix))).sort()) {
    const relative = prefix ? `${prefix}/${name}` : name;
    if (
      /[\\:\u0000-\u001f\u007f]/u.test(relative) ||
      relative
        .split("/")
        .some(
          (part) =>
            /[. ]$/u.test(part) ||
            /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
        )
    )
      throw new Error("Unsafe package filename");
    const file = path.join(base, relative),
      info = await lstat(file);
    if (info.isDirectory()) files.push(...(await inventory(base, relative)));
    else if (info.isFile() && info.nlink === 1)
      files.push({
        path: relative,
        bytes: info.size,
        sha256: await hashFile(file),
      });
    else throw new Error("Package must contain regular unlinked files only");
  }
  return files;
}

const suffix = process.platform === "win32" ? ".exe" : "";
const pgPrefix = await realpath(postgres);
const pgProvenance = JSON.parse(
  await readFile(path.join(pgPrefix, "native-build-provenance.json"), "utf8"),
);
if (
  pgProvenance.schemaVersion !== 1 ||
  pgProvenance.target !== target ||
  JSON.stringify(pgProvenance.postgres) !== JSON.stringify(pins.postgres) ||
  JSON.stringify(pgProvenance.zlib) !== JSON.stringify(pins.zlib) ||
  JSON.stringify(pgProvenance.staticDependencies) !==
    JSON.stringify(["zlib"]) ||
  JSON.stringify(pgProvenance.privateSharedDependencies) !==
    JSON.stringify(["libpq"]) ||
  (process.platform === "win32" &&
    pgProvenance.windowsProcessCodePage !== "UTF-8") ||
  !Array.isArray(pgProvenance.files) ||
  pgProvenance.files.length < 1
)
  throw new Error(
    "PostgreSQL source-build provenance does not match pinned inputs",
  );
for (const row of pgProvenance.files) {
  if (
    typeof row.path !== "string" ||
    !/^(?:bin|lib|share)\//u.test(row.path) ||
    row.path.includes("\\") ||
    row.path.includes(":") ||
    row.path.split("/").some((part) => ["", ".", ".."].includes(part))
  )
    throw new Error("Invalid PostgreSQL provenance path");
  const actual = await realpath(path.join(pgPrefix, row.path));
  if (
    path.relative(pgPrefix, actual).startsWith("..") ||
    (await stat(actual)).size !== row.bytes ||
    (await hashFile(actual)) !== row.sha256
  )
    throw new Error("PostgreSQL source-build output changed");
}
const pgVersion = (
  await execute(
    path.join(pgPrefix, "bin", `postgres${suffix}`),
    ["--version"],
    { timeout: 30_000 },
  )
).stdout.trim();
if (!pgVersion.endsWith(` ${pins.postgres.version}`))
  throw new Error("Built PostgreSQL version does not match pin");
for (const name of ["bin", "lib", "share"])
  if (!(await stat(path.join(pgPrefix, name))).isDirectory())
    throw new Error("Incomplete PostgreSQL prefix");
await mkdir(directory);
const temporary = await mkdtemp(path.join(tmpdir(), "acos-native-build-"));
try {
  const downloaded = path.join(temporary, "node.archive");
  const response = await fetch(nodeDownloadUrl, {
    signal: AbortSignal.timeout(120_000),
    redirect: "error",
  });
  if (!response.ok || !response.body)
    throw new Error("Pinned Node download failed");
  let received = 0;
  await pipeline(
    response.body,
    new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        callback(
          received > 150 * 1024 * 1024
            ? new Error("Node download exceeds limit")
            : null,
          chunk,
        );
      },
    }),
    createWriteStream(downloaded, { flags: "wx" }),
  );
  if ((await hashFile(downloaded)) !== node.sha256)
    throw new Error("Node archive checksum mismatch");
  await execute(python, [
    helper,
    "extract-node",
    downloaded,
    path.join(directory, "runtime/node"),
    target,
    node.version,
    node.sha256,
  ]);
  const archiveNodeLicense = await readFile(
    path.join(directory, "runtime/node/LICENSE"),
    "utf8",
  );
  const auditedNodeLicense = await readFile(
    path.join(root, "deploy/native-attribution/NODE-LICENSE.txt"),
    "utf8",
  );
  // The official Windows ZIP uses CRLF; the upstream tag uses LF. Preserve the
  // authoritative archive bytes and permit only this reviewed text difference.
  if (
    archiveNodeLicense.replaceAll("\r\n", "\n") !==
    auditedNodeLicense.replaceAll("\r\n", "\n")
  )
    throw new Error(
      "Authoritative Node archive license differs from the audited tag notice",
    );
  const executable = path.join(
    directory,
    process.platform === "win32"
      ? "runtime/node/node.exe"
      : "runtime/node/bin/node",
  );
  if (
    (await execute(executable, ["--version"])).stdout.trim() !==
    `v${node.version}`
  )
    throw new Error("Bundled Node version mismatch");
  await execute(
    executable,
    [path.join(root, "scripts/test-runtime-security.mjs")],
    {
      timeout: 10000,
      windowsHide: true,
    },
  );
  for (const row of pgProvenance.files)
    await copyTree(
      path.join(pgPrefix, row.path),
      path.join(directory, "runtime/postgres", row.path),
      pgPrefix,
    );
  await copyFile(
    path.join(pgPrefix, "native-build-provenance.json"),
    path.join(directory, "runtime/postgres/native-build-provenance.json"),
  );
  await copyTree(
    path.join(root, "artifacts/api-server/dist"),
    path.join(directory, "artifacts/api-server/dist"),
  );
  for (const name of [
    "start.mjs",
    "start-worker.mjs",
    "load-workspace-env.mjs",
    "load-secret-env.mjs",
  ])
    await copyFile(
      path.join(root, "artifacts/api-server", name),
      path.join(directory, "artifacts/api-server", name),
    );
  await copyTree(
    path.join(root, "artifacts/agentic-company-os/dist/public"),
    path.join(directory, "artifacts/agentic-company-os/dist/public"),
  );
  const notices = [];
  for (const name of ["@electric-sql/pglite", "playwright-core"]) {
    const source = await realpath(
      path.join(root, "artifacts/api-server/node_modules", name),
    );
    await copyTree(
      source,
      path.join(directory, "artifacts/api-server/node_modules", name),
    );
    const metadata = JSON.parse(
      await readFile(path.join(source, "package.json"), "utf8"),
    );
    notices.push({
      name,
      version: metadata.version,
      license: metadata.license ?? null,
      files: (await readdir(source))
        .filter((file) =>
          /^(?:licen[sc]e|notice|copying)(?:[.-]|$)/iu.test(file),
        )
        .map((file) => `artifacts/api-server/node_modules/${name}/${file}`),
    });
  }
  // Include installed dependency notices for bundled code as well as externals.
  const store = path.join(root, "node_modules/.pnpm");
  let noticeIndex = 0;
  for (const entry of (await readdir(store)).sort()) {
    if (
      entry === "node_modules" ||
      !(await lstat(path.join(store, entry))).isDirectory()
    )
      continue;
    const modules = path.join(store, entry, "node_modules");
    for (const child of await readdir(modules)) {
      if (child.startsWith(".")) continue;
      const candidates = child.startsWith("@")
        ? (await readdir(path.join(modules, child))).map(
            (item) => `${child}/${item}`,
          )
        : [child];
      for (const name of candidates) {
        const source = path.join(modules, name);
        if (!(await lstat(source)).isDirectory()) continue;
        const metadata = JSON.parse(
          await readFile(path.join(source, "package.json"), "utf8"),
        );
        const files = [];
        for (const file of await readdir(source)) {
          if (
            !/^(?:licen[sc]e|notice|copying)(?:[.-]|$)/iu.test(file) ||
            !(await lstat(path.join(source, file))).isFile()
          )
            continue;
          const destination = `licenses/npm/${++noticeIndex}-${file}`;
          await copyTree(
            path.join(source, file),
            path.join(directory, destination),
          );
          files.push(destination);
        }
        notices.push({
          name: metadata.name,
          version: metadata.version,
          license: metadata.license ?? null,
          files,
        });
      }
    }
  }
  await mkdir(path.join(directory, "licenses"), { recursive: true });
  await writeFile(
    path.join(directory, "licenses/npm-inventory.json"),
    JSON.stringify(
      {
        scope:
          "Installed dependency license notices, including build dependencies. This inventory is not a complete license compliance certification.",
        packages: notices,
      },
      null,
      2,
    ) + "\n",
  );
  await copyFile(path.join(root, "LICENSE"), path.join(directory, "LICENSE"));
  await copyTree(
    path.join(root, "deploy/native-attribution"),
    path.join(directory, "licenses/native"),
  );
  const setup = path.join(directory, "scripts/src/setup");
  await mkdir(setup, { recursive: true });
  for (const [entry, output] of [
    ["scripts/src/setup/bootstrap.ts", "bootstrap.mjs"],
    ["scripts/src/setup/stage-postgres.ts", "stage-postgres.mjs"],
    ["scripts/src/verify-evidence.ts", "verify-evidence.mjs"],
  ])
    await build({
      entryPoints: [path.join(root, entry)],
      outfile: path.join(setup, output),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      logLevel: "warning",
    });
  for (const file of ["setup-client.js", "setup-upgrade-client.js"])
    await copyFile(
      path.join(root, "scripts/src/setup", file),
      path.join(setup, file),
    );
  const launchers = [
    ["START", "bootstrap.mjs"],
    ["VERIFY-EVIDENCE", "verify-evidence.mjs"],
  ];
  for (const [name, entry] of launchers) {
    if (process.platform === "win32")
      await writeFile(
        path.join(directory, `${name}.cmd`),
        `@echo off\r\n"%~dp0runtime\\node\\node.exe" "%~dp0scripts\\src\\setup\\${entry}" %*\r\nexit /b %errorlevel%\r\n`,
      );
    else
      await writeFile(
        path.join(directory, `${name}.command`),
        `#!/bin/sh\nset -eu\ncd "$(dirname "$0")"\nexec "./runtime/node/bin/node" "./scripts/src/setup/${entry}" "$@"\n`,
        { mode: 0o755 },
      );
  }
  await writeFile(
    path.join(directory, "START-HERE.txt"),
    `Agentic Company OS\n\nRun ${process.platform === "win32" ? "START.cmd" : "START.command"} to open local setup. Node.js, PostgreSQL and the application are included; no separate infrastructure installation is needed. Run as an ordinary user. Keep the whole extracted folder together.\n\nChoose your language, agent permissions and model connection. AI model weights and provider credentials are not included. Provider charges belong to your account; Ollama needs a configured model and suitable memory.\n\nData and credentials stay in a private installation directory outside this package. Close the launcher with Ctrl+C to stop the application and its database. Start again to resume. For headless use: ${process.platform === "win32" ? "START.cmd" : "./START.command"} --no-browser\nIf your operating system shows an unsigned-app trust prompt, review the source and checksum; do not disable system security.\n\nUpdating an existing workspace: extract a compatible new package into a separate folder. Stop the old START with Ctrl+C. Open the new START, review the versions and data folder, and choose Update workspace. Keep the launcher open. Your data and settings are retained; agent work stays paused until you review and resume it. For a custom data parent use the same --data-dir argument. If interrupted, run the new START again to review recovery. Keep independent backups and the original package. Never replace running package files or edit ownership records.\n\nTo reopen setup, use the original private link printed in this launcher. If the link expired, restart START for a new link.\n\nAdvanced Docker/source installation: https://github.com/halittayyar0/Agentic-Company-OS/blob/main/docs/self-hosting.md\nSource revision: ${commit}\nTarget: ${target}\n`,
  );
  // Keep release identity inside the hashed inventory while retaining the
  // original manifest schema for packages that predate guided upgrades.
  const releaseValidator = path.join(temporary, "native-release.mjs");
  await build({
    entryPoints: [path.join(root, "scripts/src/setup/native-release.ts")],
    outfile: releaseValidator,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    logLevel: "warning",
  });
  const { createNativeRelease } = await import(
    pathToFileURL(releaseValidator).href
  );
  const packageMetadata = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  await writeFile(
    path.join(directory, "native-release.json"),
    JSON.stringify(
      createNativeRelease(packageMetadata.version, commit),
      null,
      2,
    ) + "\n",
  );
  const files = await inventory(directory);
  if (
    files.length > 20_000 ||
    files.some((file) => file.bytes > 128 * 1024 * 1024) ||
    files.reduce((sum, file) => sum + file.bytes, 0) > 2 * 1024 * 1024 * 1024
  )
    throw new Error("Package exceeds native manifest bounds");
  await writeFile(
    path.join(directory, "native-distribution.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        commit,
        target,
        nodeVersion: node.version,
        postgresVersion: pins.postgres.version,
        files,
      },
      null,
      2,
    ) + "\n",
  );
  const validator = path.join(temporary, "validate-native.mjs");
  await build({
    entryPoints: [path.join(root, "scripts/src/setup/native-distribution.ts")],
    outfile: validator,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    logLevel: "warning",
  });
  await (
    await import(pathToFileURL(validator).href)
  ).readNativeDistribution(directory);
  await execute(python, [helper, "archive", directory, archive], {
    timeout: 10 * 60_000,
  });
  await writeFile(
    directory + ".provenance.json",
    JSON.stringify(
      {
        schemaVersion: 1,
        commit,
        target,
        development,
        dirty,
        node,
        nodeLicenseSha256: await hashFile(
          path.join(directory, "runtime/node/LICENSE"),
        ),
        postgres: pins.postgres,
        ...(pins.zlib ? { zlib: pins.zlib } : {}),
        archive: path.basename(archive),
        sha256: await hashFile(archive),
        files: files.length,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({ directory, archive, target, commit, files: files.length }),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
