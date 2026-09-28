import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { redactAuditText } from "./audit-redaction";

test(
  "PostgreSQL operator identity admits one process and fences stop and expiry across connections",
  { timeout: 60000 },
  async (t) => {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) {
      if (process.env.POSTGRES_RACE_TEST_FAIL_IF_SKIPPED === "1")
        assert.fail(
          "DATABASE_URL is required for the enforced operator race gate",
        );
      t.skip(
        "DATABASE_URL is absent; native PostgreSQL operator process race proof is environment-blocked",
      );
      return;
    }
    assert.equal(process.env.POSTGRES_RACE_TEST_DISPOSABLE, "1");
    const parsed = new URL(url);
    assert.ok(["postgres:", "postgresql:"].includes(parsed.protocol));
    assert.ok(
      ["agentic_os_ci", "agentic_os_task5_test"].includes(
        decodeURIComponent(parsed.pathname.slice(1)),
      ),
      "only the dedicated disposable PostgreSQL database is allowed",
    );
    const previous = process.env.RUNTIME_CONTROL_KEY;
    const previousPool = process.env.DATABASE_POOL_MAX;
    const previousRoot = process.env.AGENT_SANDBOX_ROOT;
    const sandboxRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), "acos-native-operator-"),
    );
    process.env.DATABASE_POOL_MAX = "1";
    process.env.AGENT_SANDBOX_ROOT = sandboxRoot;
    process.env.RUNTIME_CONTROL_KEY = "operator-native-test-key-32-characters";
    const {
      db,
      dbReady,
      closeDatabase,
      agentsTable,
      operatorRequestsTable,
      runtimeControlsTable,
    } = await import("@workspace/db");
    const {
      reserveOperatorRequest,
      beforeOperatorEffect,
      operatorEffectGuard,
      completeOperatorRequest,
      readOperatorRequest,
      failOperatorRequest,
      OperatorRequestError,
    } = await import("./operator-requests");
    await dbReady;
    const [agent] = await db
      .insert(agentsTable)
      .values({
        name: randomUUID(),
        role: "Operator native test",
        systemPrompt: "Fixture",
      })
      .returning();
    const [{ default: pg }] = await Promise.all([import("pg")]);
    const pool = new pg.Pool({ connectionString: url, max: 1 });
    const children: ReturnType<typeof spawn>[] = [];
    t.after(async () => {
      for (const child of children) if (child.exitCode === null) child.kill();
      await db
        .delete(operatorRequestsTable)
        .where(eq(operatorRequestsTable.agentId, agent.id));
      await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
      await pool.end();
      await closeDatabase();
      if (previous === undefined) delete process.env.RUNTIME_CONTROL_KEY;
      else process.env.RUNTIME_CONTROL_KEY = previous;
      if (previousPool === undefined) delete process.env.DATABASE_POOL_MAX;
      else process.env.DATABASE_POOL_MAX = previousPool;
      if (previousRoot === undefined) delete process.env.AGENT_SANDBOX_ROOT;
      else process.env.AGENT_SANDBOX_ROOT = previousRoot;
      assert.ok(
        path
          .resolve(sandboxRoot)
          .startsWith(path.resolve(os.tmpdir()) + path.sep),
      );
      await fsp.rm(sandboxRoot, { recursive: true, force: true });
    });
    const request = {
      requestId: randomUUID(),
      agentId: agent.id,
      kind: "terminal_sandbox" as const,
      input: { command: "controlled-native-fixture", as: "sandbox" },
    };
    const serviceUrl = new URL("./operator-requests.ts", import.meta.url).href;
    const dbUrl = new URL("../../../../lib/db/src/index.ts", import.meta.url)
      .href;
    const source = `
    const {dbReady, closeDatabase} = await import(${JSON.stringify(dbUrl)});
    const {reserveOperatorRequest, beforeOperatorEffect, completeOperatorRequest} = await import(${JSON.stringify(serviceUrl)});
    await dbReady;
    process.stdout.write('READY\\n');
    await new Promise(resolve => process.stdin.once('data', resolve));
    const claim = await reserveOperatorRequest(${JSON.stringify(request)});
    if (claim.admitted) {
      await beforeOperatorEffect(claim.owner);
      await completeOperatorRequest(claim.owner, {ok:true, exitCode:0, stdout:'native fixture', stderr:'', durationMs:1, note:null, cwd:null});
    }
    process.stdout.write('RESULT:' + JSON.stringify({admitted:claim.admitted}) + '\\n');
    await closeDatabase();
    process.stdin.destroy();
  `;
    // A real module entry avoids passing --input-type into database worker threads.
    const participantPath = path.join(sandboxRoot, "operator-participant.mjs");
    await fsp.writeFile(participantPath, source);
    function participant() {
      const child = spawn(
        process.execPath,
        ["--import", import.meta.resolve("tsx"), participantPath],
        {
          env: { ...process.env, NODE_ENV: "test" },
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      children.push(child);
      let ready!: () => void,
        finish!: (value: boolean) => void,
        fail!: (error: Error) => void;
      const started = new Promise<void>((resolve) => (ready = resolve));
      const result = new Promise<boolean>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
      let output = "",
        admitted: boolean | undefined;
      child.stdout.on("data", (part) => {
        output += String(part);
        if (output.includes("READY\n")) ready();
        const match = output.match(/RESULT:(\{[^\n]+\})/);
        if (match)
          admitted = (JSON.parse(match[1]) as { admitted: boolean }).admitted;
      });
      let diagnostic = "";
      child.stderr.on("data", (part) => {
        diagnostic = (diagnostic + String(part)).slice(-8000);
      });
      child.stdin.on("error", (error) => {
        ready();
        fail(error);
      });
      child.once("error", (error) => {
        ready();
        fail(error);
      });
      child.once("close", (code) => {
        ready();
        if (code === 0 && typeof admitted === "boolean") finish(admitted);
        else
          fail(
            Error(
              `isolated operator participant did not finish (exit ${code}): ${redactAuditText(diagnostic.replaceAll(url!, "[DATABASE_URL]"), 4000)}`,
            ),
          );
      });
      void result.catch(() => undefined);
      return { child, started, result };
    }
    const participants = [participant(), participant()];
    await Promise.all(participants.map((entry) => entry.started));
    for (const entry of participants)
      if (entry.child.exitCode !== null) await entry.result;
    for (const entry of participants) entry.child.stdin.write("go\n");
    const results = await Promise.all(
      participants.map((entry) => entry.result),
    );
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(
      (await readOperatorRequest(agent.id, request.requestId))!.result?.stdout,
      "native fixture",
    );

    // Real filesystem revalidation must reuse the advisory-lock transaction:
    // requesting another database connection would deadlock a one-slot pool.
    const sandbox = await import("./vm/sandbox");
    const write = await reserveOperatorRequest({
      ...request,
      requestId: randomUUID(),
    });
    if (!write.admitted) throw Error("missing filesystem owner");
    await sandbox.writeTextFile(
      agent.id,
      "guarded.txt",
      "original",
      undefined,
      operatorEffectGuard(write.owner),
    );
    await completeOperatorRequest(write.owner, {
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
      note: null,
      cwd: "/",
    });
    assert.equal(
      await fsp.readFile(
        path.join(sandbox.getSandboxRoot(agent.id), "guarded.txt"),
        "utf8",
      ),
      "original",
    );

    const lateWrite = await reserveOperatorRequest({
      ...request,
      requestId: randomUUID(),
    });
    if (!lateWrite.admitted) throw Error("missing delayed filesystem owner");
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock($1, $2)", [
        0x41434f46,
        agent.id,
      ]);
      let entered!: () => void;
      const initial = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const effect = operatorEffectGuard(lateWrite.owner);
      const guarded = Object.assign(
        async () => {
          await effect();
          entered();
        },
        { revalidate: effect.revalidate },
      );
      const result = sandbox
        .writeTextFile(
          agent.id,
          "guarded.txt",
          "replacement",
          undefined,
          guarded,
        )
        .then(
          () => null,
          (error) => error,
        );
      await initial;
      await blocker.query(
        "UPDATE operator_requests SET expires_at = clock_timestamp() - interval '1 second' WHERE request_id = $1",
        [lateWrite.owner.requestId],
      );
      await blocker.query("COMMIT");
      assert.ok((await result) instanceof OperatorRequestError);
      assert.equal(
        await fsp.readFile(
          path.join(sandbox.getSandboxRoot(agent.id), "guarded.txt"),
          "utf8",
        ),
        "original",
      );
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }

    const pending = await reserveOperatorRequest({
      ...request,
      requestId: randomUUID(),
    });
    if (!pending.admitted) throw Error("missing owner");
    const connection = await pool.connect();
    try {
      await connection.query("BEGIN");
      await connection.query(
        "SELECT id FROM runtime_controls WHERE id = 1 FOR UPDATE",
      );
      const refused = assert.rejects(
        beforeOperatorEffect(pending.owner),
        (error: unknown) =>
          error instanceof OperatorRequestError &&
          error.code === "execution_blocked",
      );
      await connection.query(
        "UPDATE runtime_controls SET version = version + 2 WHERE id = 1",
      );
      await connection.query("COMMIT");
      await refused;
    } finally {
      await connection.query("ROLLBACK");
      connection.release();
    }
    await failOperatorRequest(pending.owner, "execution_blocked");
    const expired = await reserveOperatorRequest({
      ...request,
      requestId: randomUUID(),
    });
    if (!expired.admitted) throw Error("missing owner");
    await db
      .update(operatorRequestsTable)
      .set({ expiresAt: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(operatorRequestsTable.requestId, expired.owner.requestId));
    await assert.rejects(
      beforeOperatorEffect(expired.owner),
      (error: unknown) =>
        error instanceof OperatorRequestError &&
        error.code === "ownership_lost",
    );
    assert.equal(
      (await readOperatorRequest(agent.id, expired.owner.requestId))!.state,
      "not_dispatched",
    );
    assert.ok((await db.select().from(runtimeControlsTable)).length > 0);
  },
);
