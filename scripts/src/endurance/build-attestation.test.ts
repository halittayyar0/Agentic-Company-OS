import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  prepareWallClockBuildAttestation,
  verifyWallClockBuildAttestation,
} from "./build-attestation";

async function createWorkspace(): Promise<{
  root: string;
  commitSha: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "agentic-build-attestation-"));
  await Promise.all([
    mkdir(path.join(root, "artifacts", "api-server", "dist"), {
      recursive: true,
    }),
    mkdir(
      path.join(
        root,
        "artifacts",
        "api-server",
        "node_modules",
        "@electric-sql",
        "pglite",
      ),
      { recursive: true },
    ),
    mkdir(
      path.join(
        root,
        "artifacts",
        "api-server",
        "node_modules",
        "playwright-core",
      ),
      { recursive: true },
    ),
    mkdir(
      path.join(root, "artifacts", "agentic-company-os", "dist", "public"),
      { recursive: true },
    ),
  ]);
  await Promise.all([
    writeFile(
      path.join(root, ".gitignore"),
      "dist\n**/dist\nnode_modules\n",
      "utf8",
    ),
    writeFile(path.join(root, ".dockerignore"), "**/dist\n", "utf8"),
    writeFile(path.join(root, "Dockerfile"), "FROM scratch\n", "utf8"),
    writeFile(path.join(root, "compose.yaml"), "services: {}\n", "utf8"),
    writeFile(path.join(root, "compose.soak.yaml"), "services: {}\n", "utf8"),
    writeFile(path.join(root, "source.ts"), "export const value = 1;\n"),
    writeFile(
      path.join(root, "artifacts", "api-server", "start.mjs"),
      "await import('./dist/index.mjs');\n",
    ),
    writeFile(
      path.join(root, "artifacts", "api-server", "start-worker.mjs"),
      "await import('./dist/worker-entry.mjs');\n",
    ),
    writeFile(
      path.join(root, "artifacts", "api-server", "load-workspace-env.mjs"),
      "export const loadWorkspaceEnv = () => {};\n",
    ),
    writeFile(
      path.join(root, "artifacts", "api-server", "load-secret-env.mjs"),
      "export const loadSecretEnvironment = () => {};\n",
    ),
    writeFile(
      path.join(root, "artifacts", "api-server", "dist", "index.mjs"),
      "export const api = true;\n",
    ),
    writeFile(
      path.join(root, "artifacts", "api-server", "dist", "worker-entry.mjs"),
      "export const worker = true;\n",
    ),
    writeFile(
      path.join(
        root,
        "artifacts",
        "api-server",
        "node_modules",
        "@electric-sql",
        "pglite",
        "package.json",
      ),
      `${JSON.stringify({ name: "@electric-sql/pglite", version: "0.5.8" })}\n`,
    ),
    writeFile(
      path.join(
        root,
        "artifacts",
        "api-server",
        "node_modules",
        "@electric-sql",
        "pglite",
        "index.js",
      ),
      "export const pglite = 'isolated';\n",
    ),
    writeFile(
      path.join(
        root,
        "artifacts",
        "api-server",
        "node_modules",
        "playwright-core",
        "package.json",
      ),
      `${JSON.stringify({ name: "playwright-core", version: "1.62.1" })}\n`,
    ),
    writeFile(
      path.join(
        root,
        "artifacts",
        "api-server",
        "node_modules",
        "playwright-core",
        "index.js",
      ),
      "export const playwright = 'isolated';\n",
    ),
    writeFile(
      path.join(
        root,
        "artifacts",
        "agentic-company-os",
        "dist",
        "public",
        "index.html",
      ),
      "<main>built</main>\n",
    ),
  ]);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.name", "Attestation Test"], {
    cwd: root,
  });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"], {
    cwd: root,
  });
  const commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  return { root, commitSha };
}

async function writeNativeBuildOutputs(
  root: string,
  apiSource: string,
): Promise<void> {
  await Promise.all([
    mkdir(path.join(root, "artifacts", "api-server", "dist"), {
      recursive: true,
    }),
    mkdir(
      path.join(
        root,
        "artifacts",
        "api-server",
        "node_modules",
        "@electric-sql",
        "pglite",
      ),
      { recursive: true },
    ),
    mkdir(
      path.join(
        root,
        "artifacts",
        "api-server",
        "node_modules",
        "playwright-core",
      ),
      { recursive: true },
    ),
    mkdir(
      path.join(root, "artifacts", "agentic-company-os", "dist", "public"),
      { recursive: true },
    ),
  ]);
  await Promise.all([
    writeFile(
      path.join(root, "artifacts", "api-server", "dist", "index.mjs"),
      apiSource,
    ),
    writeFile(
      path.join(root, "artifacts", "api-server", "dist", "worker-entry.mjs"),
      "export const worker = true;\n",
    ),
    writeFile(
      path.join(
        root,
        "artifacts",
        "api-server",
        "node_modules",
        "@electric-sql",
        "pglite",
        "package.json",
      ),
      `${JSON.stringify({ name: "@electric-sql/pglite", version: "0.5.8" })}\n`,
    ),
    writeFile(
      path.join(
        root,
        "artifacts",
        "api-server",
        "node_modules",
        "@electric-sql",
        "pglite",
        "index.js",
      ),
      "export const pglite = 'isolated';\n",
    ),
    writeFile(
      path.join(
        root,
        "artifacts",
        "api-server",
        "node_modules",
        "playwright-core",
        "package.json",
      ),
      `${JSON.stringify({ name: "playwright-core", version: "1.62.1" })}\n`,
    ),
    writeFile(
      path.join(
        root,
        "artifacts",
        "api-server",
        "node_modules",
        "playwright-core",
        "index.js",
      ),
      "export const playwright = 'isolated';\n",
    ),
    writeFile(
      path.join(
        root,
        "artifacts",
        "agentic-company-os",
        "dist",
        "public",
        "index.html",
      ),
      "<main>built</main>\n",
    ),
  ]);
}

test("native isolated builds canonicalize the OS temp alias without allowing external dependencies", async () => {
  const workspace = await createWorkspace();
  const temporaryRoot = await mkdtemp(
    path.join(await realpath(tmpdir()), "native-build-temp-alias-"),
  );
  const actualTemp = path.join(temporaryRoot, "actual");
  const aliasTemp = path.join(temporaryRoot, "alias");
  const saved = {
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    TMPDIR: process.env.TMPDIR,
  };
  try {
    await mkdir(actualTemp);
    await symlink(
      actualTemp,
      aliasTemp,
      process.platform === "win32" ? "junction" : "dir",
    );
    process.env.TEMP = process.env.TMP = process.env.TMPDIR = aliasTemp;
    const result = await prepareWallClockBuildAttestation({
      workspaceRoot: workspace.root,
      runtime: "native-postgres",
      expectedCommitSha: workspace.commitSha,
      runNativeBuild: async (isolated) => {
        assert.equal(isolated, await realpath(isolated));
        await writeNativeBuildOutputs(isolated, "export const api = true;\n");
      },
    });
    assert.equal(result.sourceCommitSha, workspace.commitSha);
    await assert.rejects(
      prepareWallClockBuildAttestation({
        workspaceRoot: workspace.root,
        runtime: "native-postgres",
        expectedCommitSha: workspace.commitSha,
        runNativeBuild: async (isolated) => {
          await writeNativeBuildOutputs(isolated, "export const api = true;\n");
          const requested = path.join(
            isolated,
            "artifacts/api-server/node_modules/@electric-sql/pglite",
          );
          const outside = path.join(temporaryRoot, "external-package");
          await rename(requested, outside);
          await symlink(
            outside,
            requested,
            process.platform === "win32" ? "junction" : "dir",
          );
        },
      }),
      /escaped the isolated frozen install/,
    );
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(temporaryRoot, { recursive: true, force: true });
    await rm(workspace.root, { recursive: true, force: true });
  }
});

test("native attestation builds first and binds exact runtime artifact bytes", async () => {
  const workspace = await createWorkspace();
  let builds = 0;
  try {
    await mkdir(path.join(workspace.root, "node_modules"), { recursive: true });
    await writeFile(
      path.join(workspace.root, "node_modules", "tampered-local-dependency.js"),
      "throw new Error('must not enter isolated build');\n",
    );
    const attestation = await prepareWallClockBuildAttestation({
      workspaceRoot: workspace.root,
      runtime: "native-postgres",
      expectedCommitSha: workspace.commitSha,
      runNativeBuild: async (isolatedWorkspaceRoot?: string) => {
        builds += 1;
        assert.ok(isolatedWorkspaceRoot);
        assert.notEqual(
          path.resolve(isolatedWorkspaceRoot),
          path.resolve(workspace.root),
        );
        await assert.rejects(
          lstat(
            path.join(
              isolatedWorkspaceRoot,
              "node_modules",
              "tampered-local-dependency.js",
            ),
          ),
        );
        await writeNativeBuildOutputs(
          isolatedWorkspaceRoot,
          "export const api = 'fresh-build';\n",
        );
        // pnpm installs package-directory links, including junctions on Windows.
        const requested = path.join(
          isolatedWorkspaceRoot,
          "artifacts/api-server/node_modules/@electric-sql/pglite",
        );
        const packageStore = path.join(
          isolatedWorkspaceRoot,
          "node_modules/.pnpm/pglite-fixture",
        );
        for (const candidate of [requested, packageStore])
          assert.ok(
            !path.relative(isolatedWorkspaceRoot, candidate).startsWith(".."),
          );
        await mkdir(path.dirname(packageStore), { recursive: true });
        await rename(requested, packageStore);
        await symlink(
          packageStore,
          requested,
          process.platform === "win32" ? "junction" : "dir",
        );
      },
    });
    assert.equal(builds, 1);
    assert.equal(attestation.cleanTree, true);
    assert.equal(attestation.sourceCommitSha, workspace.commitSha);
    assert.equal(attestation.runtime, "native-postgres");
    assert.equal(attestation.subject, "native-runtime-artifacts");
    assert.match(attestation.nodeVersion, /^v24\./u);
    assert.match(attestation.sourceTreeSha256, /^[a-f0-9]{64}$/u);
    assert.match(attestation.runtimeArtifactSha256, /^[a-f0-9]{64}$/u);
    assert.equal(attestation.runtimeArtifactFileCount >= 7, true);
    assert.deepEqual(
      attestation.nativeRuntimeDependencies?.map((dependency) => ({
        name: dependency.name,
        version: dependency.version,
        path: dependency.path,
        digestIsSha256: /^[a-f0-9]{64}$/u.test(dependency.sha256),
        hasFiles: dependency.fileCount >= 2,
      })),
      [
        {
          name: "@electric-sql/pglite",
          version: "0.5.8",
          path: "artifacts/api-server/dist/node_modules/@electric-sql/pglite",
          digestIsSha256: true,
          hasFiles: true,
        },
        {
          name: "playwright-core",
          version: "1.62.1",
          path: "artifacts/api-server/dist/node_modules/playwright-core",
          digestIsSha256: true,
          hasFiles: true,
        },
      ],
    );
    assert.equal(
      await readFile(
        path.join(
          workspace.root,
          "artifacts",
          "api-server",
          "dist",
          "index.mjs",
        ),
        "utf8",
      ),
      "export const api = 'fresh-build';\n",
    );
    await verifyWallClockBuildAttestation({
      workspaceRoot: workspace.root,
      expectedCommitSha: workspace.commitSha,
      expectedRuntime: "native-postgres",
      attestation,
      runNativeBuild: async (isolatedWorkspaceRoot?: string) => {
        builds += 1;
        assert.ok(isolatedWorkspaceRoot);
        await writeNativeBuildOutputs(
          isolatedWorkspaceRoot,
          "export const api = 'fresh-build';\n",
        );
      },
    });
    assert.equal(builds, 2);

    await writeFile(
      path.join(
        workspace.root,
        "artifacts",
        "api-server",
        "dist",
        "node_modules",
        "playwright-core",
        "index.js",
      ),
      "export const playwright = 'tampered-after-run';\n",
    );
    await assert.rejects(
      verifyWallClockBuildAttestation({
        workspaceRoot: workspace.root,
        expectedCommitSha: workspace.commitSha,
        expectedRuntime: "native-postgres",
        attestation,
        runNativeBuild: async () => undefined,
      }),
      /artifact.*digest|attestation.*artifact/iu,
    );
  } finally {
    await rm(workspace.root, { recursive: true, force: true });
  }
});

test("native deployment rejects an ignored ancestor redirected through a junction before any external mutation", async (context) => {
  const workspace = await createWorkspace();
  const external = await mkdtemp(
    path.join(tmpdir(), "agentic-build-attestation-external-"),
  );
  const redirected = path.join(
    workspace.root,
    "artifacts",
    "agentic-company-os",
    "dist",
  );
  await rm(redirected, { recursive: true, force: true });
  await writeFile(path.join(external, "sentinel.txt"), "unchanged\n");
  try {
    try {
      await symlink(
        external,
        redirected,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["EPERM", "EACCES", "ENOTSUP"].includes(String(error.code))
      ) {
        context.skip(`symlink creation is unavailable: ${String(error.code)}`);
        return;
      }
      throw error;
    }
    await assert.rejects(
      prepareWallClockBuildAttestation({
        workspaceRoot: workspace.root,
        runtime: "native-postgres",
        expectedCommitSha: workspace.commitSha,
        runNativeBuild: async (isolatedWorkspaceRoot) => {
          await writeNativeBuildOutputs(
            isolatedWorkspaceRoot,
            "export const api = 'fresh-build';\n",
          );
        },
      }),
      /redirected|symbolic link|real director|junction/iu,
    );
    assert.equal(
      await readFile(path.join(external, "sentinel.txt"), "utf8"),
      "unchanged\n",
    );
    assert.deepEqual((await readdir(external)).sort(), ["sentinel.txt"]);
  } finally {
    await Promise.all([
      rm(workspace.root, { recursive: true, force: true }),
      rm(external, { recursive: true, force: true }),
    ]);
  }
});

test("wall-clock build attestation rejects Node versions outside 24.x before touching the workspace", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "version");
  assert.ok(descriptor?.configurable);
  Object.defineProperty(process, "version", {
    ...descriptor,
    value: "v23.11.0",
  });
  try {
    await assert.rejects(
      prepareWallClockBuildAttestation({
        workspaceRoot: path.join(tmpdir(), "must-not-be-read"),
        runtime: "native-postgres",
        expectedCommitSha: "0".repeat(40),
      }),
      /Node(?:\.js)? 24/iu,
    );
  } finally {
    Object.defineProperty(process, "version", descriptor);
  }
});

test("attestation rejects dirty tracked and untracked source before launch", async () => {
  const workspace = await createWorkspace();
  try {
    await writeFile(path.join(workspace.root, "source.ts"), "dirty\n");
    await assert.rejects(
      prepareWallClockBuildAttestation({
        workspaceRoot: workspace.root,
        runtime: "docker-compose",
        expectedCommitSha: workspace.commitSha,
      }),
      /clean.*tree|working tree/iu,
    );
    execFileSync("git", ["checkout", "--", "source.ts"], {
      cwd: workspace.root,
    });
    await writeFile(path.join(workspace.root, "untracked.ts"), "dirty\n");
    await assert.rejects(
      prepareWallClockBuildAttestation({
        workspaceRoot: workspace.root,
        runtime: "docker-compose",
        expectedCommitSha: workspace.commitSha,
      }),
      /clean.*tree|working tree/iu,
    );
  } finally {
    await rm(workspace.root, { recursive: true, force: true });
  }
});

test("docker attestation binds the exact clean commit and build context", async () => {
  const workspace = await createWorkspace();
  try {
    const attestation = await prepareWallClockBuildAttestation({
      workspaceRoot: workspace.root,
      runtime: "docker-compose",
      expectedCommitSha: workspace.commitSha,
    });
    assert.equal(attestation.subject, "docker-build-context");
    assert.equal(attestation.runtimeArtifactFileCount, 4);
    await assert.rejects(
      verifyWallClockBuildAttestation({
        workspaceRoot: workspace.root,
        expectedCommitSha: workspace.commitSha,
        expectedRuntime: "native-postgres",
        attestation,
      }),
      /runtime.*mismatch/iu,
    );
  } finally {
    await rm(workspace.root, { recursive: true, force: true });
  }
});
