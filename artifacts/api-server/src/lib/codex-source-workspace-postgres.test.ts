import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import type { CodexTaskAuthority } from "./codex-task-authority";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test(
  "PostgreSQL serializes both orders of real source-check and native-session admission without modifying the original",
  { timeout: 60000 },
  async (t) => {
    const url = process.env.DATABASE_URL;
    if (!url) {
      if (process.env.POSTGRES_RACE_TEST_FAIL_IF_SKIPPED === "1")
        throw new Error(
          "Disposable PostgreSQL is required for the source-workspace race gate",
        );
      t.skip(
        "Actual PostgreSQL row-lock proof requires the disposable native gate",
      );
      return;
    }
    assert.equal(process.env.POSTGRES_RACE_TEST_DISPOSABLE, "1");
    const name = decodeURIComponent(new URL(url).pathname.slice(1));
    assert.ok(
      ["agentic_os_ci", "agentic_os_task4_test"].includes(name),
      "Refusing a database outside the dedicated disposable race fixtures",
    );
    // Keep every database-owning import below the guard: module loading starts
    // migrations and must never touch an arbitrary inherited database URL.
    const {
      db,
      dbReady,
      closeDatabase,
      agentsTable,
      sourceChangesTable,
      codexTaskSessionsTable,
      executionPolicyTable,
    } = await import("@workspace/db");
    await dbReady;
    const { prepareSourceChange, checkSourceChange } =
      await import("./source-workspaces");
    const { claimCodexTaskSession } = await import("./codex-task-session");
    const { getSandboxRoot } = await import("./vm/sandbox");
    const { Client } = await import("pg");
    const observer = new Client({
      connectionString: url,
      statement_timeout: 10000,
    });
    const temp = await realpath(tmpdir());
    const root = await realpath(
      await mkdtemp(path.join(temp, "acos-source-admission-race-")),
    );
    const priorRoot = process.env.AGENT_SANDBOX_ROOT;
    const priorExec = process.env.ALLOW_AGENT_PROCESS_EXEC;
    process.env.AGENT_SANDBOX_ROOT = path.join(root, "sandboxes");
    process.env.ALLOW_AGENT_PROCESS_EXEC = "true";
    const run = promisify(execFile);
    const emptyHooks = path.join(root, "empty-git-configuration");
    await mkdir(emptyHooks);
    try {
      await observer.connect();
      const [policy] = await db.select().from(executionPolicyTable);
      for (const first of ["native", "source"] as const) {
        const [agent] = await db
          .insert(agentsTable)
          .values({
            name: `Source race ${first}`,
            role: "Engineer",
            systemPrompt: "Fixture",
          })
          .returning();
        const original = path.join(root, `original-${first}`);
        await mkdir(original);
        const git = (...args: string[]) =>
          run(
            "git",
            [
              "-c",
              `core.hooksPath=${emptyHooks}`,
              "-c",
              `init.templateDir=${emptyHooks}`,
              "-c",
              "commit.gpgsign=false",
              "-c",
              "core.fsmonitor=false",
              "-C",
              original,
              ...args,
            ],
            { windowsHide: true },
          );
        await git("init");
        await writeFile(
          path.join(original, "answer.mjs"),
          "export const answer = 1;\n",
        );
        await git("add", ".");
        await git(
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@localhost",
          "commit",
          "-m",
          "Initial fixture",
        );
        const row = await prepareSourceChange({
          id: randomUUID(),
          agentId: agent.id,
          sourcePath: original,
          request: "Change the answer",
        });
        assert.ok(row.taskId);
        const workspace = path.join(
          getSandboxRoot(agent.id),
          "source-changes",
          row.id,
        );
        await writeFile(
          path.join(workspace, "answer.mjs"),
          "export const answer = 2;\n",
        );
        const binding = {
          taskId: row.taskId,
          attemptId: randomUUID(),
          leaseOwner: randomUUID(),
          policyRevision: policy.revision,
          registrationId: randomUUID(),
          registrationRevision: 1,
          admissionVersion: 0,
          accountId: "fixture-account",
        };
        // This seam admits metadata only, not a child or inference. Separate
        // governed-service tests exercise real lease/account/approval fences.
        const authority: CodexTaskAuthority = {
          binding,
          model: "fixture-model",
          sourceChange: { id: row.id, revision: row.revision },
          readBinding: async () => binding,
          readLaunchContext: async () => ({
            policy,
            registration: {
              id: binding.registrationId,
              revision: 1,
              updatedAt: Date.now(),
              hostId: "fixture-host",
              clientId: "fixture-client",
              subject: "fixture-subject",
              accountId: binding.accountId,
              credentials: null,
            },
          }),
        };
        const locked = deferred(),
          release = deferred();
        const holder = db.transaction(async (tx) => {
          await tx
            .select({ id: sourceChangesTable.id })
            .from(sourceChangesTable)
            .where(eq(sourceChangesTable.id, row.id))
            .for("update");
          locked.resolve();
          await release.promise;
        });
        void holder.catch(() => locked.resolve());
        await locked.promise;
        const waiting = async (minimum: number) => {
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            const result = await observer.query<{ count: number }>(
              "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid() AND state='active' AND wait_event_type='Lock' AND query LIKE '%source_changes%'",
              [name],
            );
            if (result.rows[0].count >= minimum) return;
            await new Promise((done) => setTimeout(done, 25));
          }
          throw new Error(
            "Actual PostgreSQL source lock wait was not observed",
          );
        };
        const native = () =>
          claimCodexTaskSession({
            authority,
            agentId: agent.id,
            workspace,
            storageDirectory: path.join(root, `private-${first}`),
            executableDigest: "a".repeat(64),
          });
        const check = () =>
          checkSourceChange(row.id, row.revision, [
            "node",
            "--check",
            "{workspace}/answer.mjs",
          ]);
        let nativeRun: ReturnType<typeof native> | undefined;
        let sourceRun: ReturnType<typeof check> | undefined;
        try {
          if (first === "native") nativeRun = native();
          else sourceRun = check();
          void nativeRun?.catch(() => {});
          void sourceRun?.catch(() => {});
          await waiting(1);
          if (first === "native") sourceRun = check();
          else nativeRun = native();
          void nativeRun?.catch(() => {});
          void sourceRun?.catch(() => {});
          await waiting(2);
          release.resolve();
          await holder;
          assert.ok(nativeRun && sourceRun);
          const [nativeResult, sourceResult] = await Promise.allSettled([
            nativeRun,
            sourceRun,
          ]);
          if (first === "native") {
            assert.equal(nativeResult.status, "fulfilled");
            assert.equal(sourceResult.status, "rejected");
            if (sourceResult.status === "rejected")
              assert.match(String(sourceResult.reason), /SOURCE_CODING_ACTIVE/);
            if (nativeResult.status === "fulfilled") {
              const [current] = await db
                .select()
                .from(sourceChangesTable)
                .where(eq(sourceChangesTable.id, row.id));
              assert.equal(current.revision, row.revision);
              assert.equal(current.state, "draft");
              await nativeResult.value.uncertain("not_launched");
            }
          } else {
            assert.equal(sourceResult.status, "fulfilled");
            assert.equal(nativeResult.status, "rejected");
            if (nativeResult.status === "rejected")
              assert.equal(nativeResult.reason.kind, "ownership_lost");
            if (sourceResult.status === "fulfilled")
              assert.equal(sourceResult.value.state, "verified");
            assert.equal(
              (
                await db
                  .select()
                  .from(codexTaskSessionsTable)
                  .where(eq(codexTaskSessionsTable.taskId, row.taskId))
              ).length,
              0,
            );
          }
          assert.equal(
            await readFile(path.join(original, "answer.mjs"), "utf8"),
            "export const answer = 1;\n",
          );
          assert.equal(
            (await git("rev-parse", "HEAD")).stdout.trim(),
            row.baseCommit,
          );
          t.diagnostic(
            `${first} admission wins after two independently observed PostgreSQL source-row lock waits; original commit unchanged`,
          );
        } finally {
          release.resolve();
          await holder;
          await Promise.allSettled(
            [nativeRun, sourceRun].filter((item) => item !== undefined),
          );
        }
      }
    } finally {
      await observer.end();
      await closeDatabase();
      if (priorRoot === undefined) delete process.env.AGENT_SANDBOX_ROOT;
      else process.env.AGENT_SANDBOX_ROOT = priorRoot;
      if (priorExec === undefined) delete process.env.ALLOW_AGENT_PROCESS_EXEC;
      else process.env.ALLOW_AGENT_PROCESS_EXEC = priorExec;
      assert.equal(path.dirname(root), temp);
      assert.equal(await realpath(root), root);
      await rm(root, { recursive: true, force: true });
    }
  },
);
