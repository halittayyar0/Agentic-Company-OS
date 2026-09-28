import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  runtimeControlsTable,
  db,
  dbReady,
  closeDatabase,
} from "@workspace/db";
import vmRouter from "./vm";
import { readTextFile, writeBinaryFile } from "../lib/vm/sandbox";

test("operator file API requires an exact reviewed revision and missing-only creation", async (t) => {
  await dbReady;
  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), "acos-vm-files-http-"),
  );
  process.env.AGENT_SANDBOX_ROOT = directory;
  const [agent] = await db
    .insert(agentsTable)
    .values({ name: randomUUID(), role: "File test", systemPrompt: "Test" })
    .returning();
  const app = express();
  app.use(express.json());
  app.use("/api", vmRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api/agents/${agent.id}/vm`;
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));
    await closeDatabase();
    await fsp.rm(directory, { recursive: true, force: true });
  });
  async function call(route: string, body: unknown, method = "PUT") {
    const response = await fetch(`${base}/${route}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, any>,
    };
  }
  for (const input of [
    { path: "record.txt", content: "bad" },
    { path: "record.txt", content: "bad", expectedVersion: "wrong" },
    {
      path: "record.txt",
      content: "bad",
      expectedVersion: "missing",
      force: true,
    },
  ])
    assert.equal((await call("file-write", input)).status, 400);
  const created = await call("file-write", {
    path: "record.txt",
    content: "Original 原文",
    expectedVersion: "missing",
  });
  assert.equal(created.status, 200);
  assert.match(created.body.version, /^[a-f0-9]{64}$/);
  assert.equal(
    (
      await call("file-write", {
        path: "record.txt",
        content: "",
        expectedVersion: "missing",
      })
    ).status,
    409,
  );
  const read = await call("file-read", { path: "record.txt" }, "POST");
  const absent = await call("file-read", { path: "absent.txt" }, "POST");
  assert.equal(absent.status, 404);
  assert.equal(absent.body.code, "VM_FILE_MISSING");
  const listing = await call("files-list", { path: "" }, "POST");
  assert.equal(listing.status, 200);
  assert.equal(listing.body.truncated, false);
  assert.equal(listing.body.skipped, 0);
  assert.equal(read.body.content, "Original 原文");
  assert.equal(read.body.editable, true);
  assert.equal(read.body.version, created.body.version);
  const contenders = await Promise.all(
    ["New A", "New B"].map((content) =>
      call("file-write", {
        path: "record.txt",
        content,
        expectedVersion: read.body.version,
      }),
    ),
  );
  assert.deepEqual(contenders.map((value) => value.status).sort(), [200, 409]);
  const stored = await readTextFile(agent.id, "record.txt");
  assert.ok(["New A", "New B"].includes(stored.content));
  assert.equal(
    stored.version,
    createHash("sha256").update(stored.content).digest("hex"),
  );
  await writeBinaryFile(
    agent.id,
    "preview.txt",
    Buffer.from("x".repeat(140000)),
  );
  const preview = await call("file-read", { path: "preview.txt" }, "POST");
  assert.equal(preview.body.truncated, true);
  assert.equal(preview.body.editable, false);
  assert.equal(
    (
      await call("file-write", {
        path: "preview.txt",
        content: "short",
        expectedVersion: preview.body.version,
      })
    ).status,
    422,
  );
  assert.equal((await readTextFile(agent.id, "preview.txt")).sizeBytes, 140000);

  // Deleting requires a complete current scope, including binary children.
  await call("file-write", {
    path: "folder/keep.txt",
    content: "keep",
    expectedVersion: "missing",
  });
  for (const body of [
    { path: "folder" },
    { path: "folder", expectedVersion: "missing" },
    { path: "folder", expectedVersion: "a".repeat(64), force: true },
  ])
    assert.equal((await call("file-delete", body, "DELETE")).status, 400);
  const scope = await call("file-delete-preview", { path: "folder" }, "POST");
  assert.equal(scope.status, 200);
  assert.equal(scope.body.entryCount, 2);
  assert.equal(scope.body.totalBytes, 4);
  assert.equal(
    (await call("file-delete-preview", { path: "." }, "POST")).status,
    422,
  );
  assert.equal(
    (await call("file-delete-preview", { path: "missing" }, "POST")).status,
    404,
  );
  assert.equal(
    (await call("file-delete-preview", { path: "folder", force: true }, "POST"))
      .status,
    400,
  );
  await call("file-write", {
    path: "folder/new.txt",
    content: "new",
    expectedVersion: "missing",
  });
  const stale = await call(
    "file-delete",
    { path: "folder", expectedVersion: scope.body.version },
    "DELETE",
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "VM_DELETE_CHANGED");
  assert.equal((await readTextFile(agent.id, "folder/new.txt")).content, "new");
  const fresh = await call("file-delete-preview", { path: "folder" }, "POST");
  // Persisted stop in another replica must block file effects even without
  // this API process receiving its local epoch update yet. Reads stay usable.
  await db
    .update(runtimeControlsTable)
    .set({ emergencyStopEnabled: true })
    .where(eq(runtimeControlsTable.id, 1));
  try {
    assert.equal(
      (await call("file-delete-preview", { path: "folder" }, "POST")).status,
      200,
    );
    assert.equal(
      (
        await call(
          "file-delete",
          { path: "folder", expectedVersion: fresh.body.version },
          "DELETE",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call("file-write", {
          path: "blocked.txt",
          content: "blocked",
          expectedVersion: "missing",
        })
      ).status,
      403,
    );
    assert.equal(
      (await readTextFile(agent.id, "folder/new.txt")).content,
      "new",
    );
  } finally {
    await db
      .update(runtimeControlsTable)
      .set({ emergencyStopEnabled: false })
      .where(eq(runtimeControlsTable.id, 1));
  }
  const removed = await call(
    "file-delete",
    { path: "folder", expectedVersion: fresh.body.version },
    "DELETE",
  );
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body, { path: "folder", deleted: true });
  assert.equal(
    (
      await call(
        "file-delete",
        { path: "folder", expectedVersion: fresh.body.version },
        "DELETE",
      )
    ).status,
    404,
  );
});
