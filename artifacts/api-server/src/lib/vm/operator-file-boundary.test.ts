import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import test from "node:test";

delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
const root = await fsp.mkdtemp(
  path.join(os.tmpdir(), "acos-operator-file-fence-"),
);
process.env.AGENT_SANDBOX_ROOT = root;
const {
  db,
  dbReady,
  closeDatabase,
  agentsTable,
  operatorRequestsTable: receipts,
} = await import("@workspace/db");
const { reserveOperatorRequest, operatorEffectGuard, OperatorRequestError } =
  await import("../operator-requests");
const sandbox = await import("./sandbox");
const { withFileOperationLock } = await import("./file-operation-lock");

test(
  "operator filesystem mutations recheck durable authority after waiting for the workspace lock",
  { timeout: 45000 },
  async (t) => {
    await dbReady;
    t.after(async () => {
      await closeDatabase();
      assert.ok(
        path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep),
      );
      await fsp.rm(root, { recursive: true, force: true });
    });
    for (const operation of [
      "write",
      "binary",
      "delete",
      "mkdir",
      "touch",
    ] as const)
      await t.test(operation, async () => {
        const [agent] = await db
          .insert(agentsTable)
          .values({
            name: `Fence ${operation}`,
            role: "Fixture",
            systemPrompt: "Fixture",
          })
          .returning();
        const directory = await sandbox.ensureSandbox(agent.id);
        const target = path.join(
          directory,
          operation === "mkdir" ? "folder" : "target.txt",
        );
        if (["write", "binary", "delete", "touch"].includes(operation))
          await fsp.writeFile(target, "original");
        const before = await fsp.stat(target).catch(() => null);
        const admitted = await reserveOperatorRequest({
          requestId: randomUUID(),
          agentId: agent.id,
          kind: "terminal_sandbox",
          input: { command: operation, as: "sandbox" },
        });
        assert.equal(admitted.admitted, true);
        if (!admitted.admitted) throw Error("fixture admission missing");
        let unlock!: () => void, entered!: () => void, guarded!: () => void;
        const held = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const release = new Promise<void>((resolve) => {
          unlock = resolve;
        });
        const initialGuard = new Promise<void>((resolve) => {
          guarded = resolve;
        });
        const lock = withFileOperationLock(agent.id, async () => {
          entered();
          await release;
        });
        await held;
        const effect = operatorEffectGuard(admitted.owner);
        const guard = Object.assign(
          async () => {
            await effect();
            guarded();
          },
          {
            revalidate: effect.revalidate,
          },
        );
        const command =
          operation === "write"
            ? sandbox.writeTextFile(
                agent.id,
                "target.txt",
                "replacement",
                undefined,
                guard,
              )
            : operation === "binary"
              ? sandbox.writeBinaryFile(
                  agent.id,
                  "target.txt",
                  Buffer.from("replacement"),
                  undefined,
                  guard,
                )
              : operation === "delete"
                ? sandbox.deleteEntry(agent.id, "target.txt", undefined, guard)
                : sandbox.execInSandbox(
                    agent.id,
                    operation === "mkdir" ? "mkdir folder" : "touch target.txt",
                    undefined,
                    guard,
                  );
        const settled = command.then(
          (value) => ({ value, error: null }),
          (error) => ({ value: null, error }),
        );
        try {
          await initialGuard;
          await db
            .update(receipts)
            .set({ expiresAt: sql`clock_timestamp() - interval '1 second'` })
            .where(eq(receipts.requestId, admitted.owner.requestId));
        } finally {
          unlock();
        }
        await lock;
        const result = await settled;
        assert.ok(
          result.error instanceof OperatorRequestError,
          "expired owner must be rejected after lock acquisition",
        );
        const after = await fsp.stat(target).catch(() => null);
        if (!before) assert.equal(after, null);
        else {
          assert.equal(await fsp.readFile(target, "utf8"), "original");
          assert.equal(after?.mtimeMs, before.mtimeMs);
        }
      });
    for (const operation of ["command", "write", "binary", "delete"] as const)
      await t.test(
        `expired ${operation} cannot create a workspace`,
        async () => {
          const [agent] = await db
            .insert(agentsTable)
            .values({
              name: `Expired ${operation}`,
              role: "Fixture",
              systemPrompt: "Fixture",
            })
            .returning();
          const admitted = await reserveOperatorRequest({
            requestId: randomUUID(),
            agentId: agent.id,
            kind: "terminal_sandbox",
            input: { command: operation, as: "sandbox" },
          });
          if (!admitted.admitted) throw Error("fixture admission missing");
          await db
            .update(receipts)
            .set({ expiresAt: sql`clock_timestamp() - interval '1 second'` })
            .where(eq(receipts.requestId, admitted.owner.requestId));
          const guard = operatorEffectGuard(admitted.owner);
          const action =
            operation === "command"
              ? sandbox.execInSandbox(agent.id, "pwd", undefined, guard)
              : operation === "write"
                ? sandbox.writeTextFile(
                    agent.id,
                    "target.txt",
                    "replacement",
                    undefined,
                    guard,
                  )
                : operation === "binary"
                  ? sandbox.writeBinaryFile(
                      agent.id,
                      "target.txt",
                      Buffer.from("replacement"),
                      undefined,
                      guard,
                    )
                  : sandbox.deleteEntry(
                      agent.id,
                      "target.txt",
                      undefined,
                      guard,
                    );
          const result = await action.then(
            () => null,
            (error) => error,
          );
          assert.equal(
            await fsp.stat(sandbox.getSandboxRoot(agent.id)).catch(() => null),
            null,
            "expired request must not create even an empty workspace",
          );
          assert.ok(result instanceof OperatorRequestError);
        },
      );
  },
);
