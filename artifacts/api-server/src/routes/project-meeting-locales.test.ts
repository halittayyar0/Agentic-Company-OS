import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import {
  agentsTable,
  db,
  dbReady,
  projectMeetingTranscriptTable,
  tasksTable,
} from "@workspace/db";
import {
  WORKSPACE_LOCALES,
  writeWorkspaceLocale,
  type WorkspaceLocale,
} from "../lib/workspace-locale";
import { setProjectMeetingCompletionRunnerForTests } from "../lib/orchestrator/run-project-meeting";
import { createProjectMeetingsRouter } from "./project-meetings";

const labels: Record<WorkspaceLocale, string> = {
  tr: "Proje toplantısında yanıt hazırlıyor: ",
  en: "Preparing a project meeting reply: ",
  de: "Antwort für die Projektbesprechung wird vorbereitet: ",
  ru: "Подготовка ответа на встрече по проекту: ",
  "zh-CN": "正在准备项目会议回复：",
  "zh-TW": "正在準備專案會議回覆：",
  ar: "جارٍ إعداد رد لاجتماع المشروع: ",
};

test("project meeting status uses its selected language and replay preserves the original transcript", async (t) => {
  const originalDirectory = process.cwd();
  const temporaryRoot = await realpath(os.tmpdir());
  const directory = await mkdtemp(
    path.join(temporaryRoot, "acos-meeting-locales-"),
  );
  await writeFile(
    path.join(directory, "pnpm-workspace.yaml"),
    "packages: []\n",
  );
  process.chdir(directory);
  t.after(async () => {
    process.chdir(originalDirectory);
    const resolved = await realpath(directory);
    assert.equal(path.dirname(resolved), temporaryRoot);
    assert.ok(path.basename(resolved).startsWith("acos-meeting-locales-"));
    await rm(resolved, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });
  await dbReady;
  const app = express();
  app.use(express.json());
  app.use("/api", createProjectMeetingsRouter());
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(async () => {
    setProjectMeetingCompletionRunnerForTests(null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api`;
  const send = (route: string, body: unknown) =>
    fetch(base + route, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  for (const locale of WORKSPACE_LOCALES) {
    await t.test(locale, async () => {
      await writeWorkspaceLocale(locale);
      const [agent] = await db
        .insert(agentsTable)
        .values({
          name: `Meeting locale ${locale}`,
          role: "Test",
          systemPrompt: "Fixture only; no live provider",
          createdByUser: true,
        })
        .returning();
      const [project] = await db
        .insert(tasksTable)
        .values({
          title: "Literal project",
          brief: "Preserve transcript evidence",
          ownerAgentId: agent.id,
          createdByUser: true,
        })
        .returning();
      const prefix = `/projects/${project.id}/meetings`;
      const title = `  原文 $& {title} ${locale}`.trim();
      const created = await send(prefix, {
        requestId: randomUUID(),
        title,
        agenda: "Literal agenda",
        participantAgentIds: [agent.id],
      });
      assert.equal(created.status, 201);
      const createdBody = (await created.json()) as Record<string, unknown>;
      const meetingId = createdBody.meetingId;
      assert.ok(
        typeof meetingId === "number" && Number.isSafeInteger(meetingId),
      );
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let calls = 0;
      let capturedSystemPrompt = "";
      const reply = `Original ${locale} reply 原文 {title}`;
      setProjectMeetingCompletionRunnerForTests(async ({ messages }) => {
        calls += 1;
        capturedSystemPrompt =
          messages.find((message) => message.role === "system")?.content ?? "";
        enter();
        await held;
        return { content: reply, modelId: "fixture:no-provider" };
      });
      const input = { requestId: randomUUID(), prompt: "One bounded reply" };
      const pending = send(`${prefix}/${meetingId}/start`, input);
      // A route error must fail this assertion instead of leaving a provider wait hanging.
      await Promise.race([
        entered,
        pending.then((response) => {
          throw new Error(
            `Turn returned ${response.status} before the provider fixture`,
          );
        }),
      ]);
      let response: Response;
      try {
        const [running] = await db
          .select()
          .from(agentsTable)
          .where(eq(agentsTable.id, agent.id));
        assert.equal(running.currentAction, labels[locale] + title);
        assert.equal(running.status, "working");
        assert.ok(running.runLeaseOwner);
        assert.ok(
          capturedSystemPrompt.includes(
            `<workspace_language locale="${locale}">`,
          ),
        );
        await writeWorkspaceLocale(locale === "en" ? "ar" : "en");
      } finally {
        release();
        response = await pending;
      }
      assert.equal(response.status, 200);
      const originalResponse: unknown = await response.json();
      const rows = await db
        .select()
        .from(projectMeetingTranscriptTable)
        .where(eq(projectMeetingTranscriptTable.meetingId, meetingId));
      assert.equal(rows.filter((row) => row.speakerType === "agent").length, 1);
      assert.equal(
        rows.find((row) => row.speakerType === "agent")?.content,
        reply,
      );
      const replay = await send(`${prefix}/${meetingId}/start`, input);
      assert.equal(replay.status, 200);
      assert.deepEqual(await replay.json(), originalResponse);
      assert.equal(calls, 1);
      const after = await db
        .select()
        .from(projectMeetingTranscriptTable)
        .where(eq(projectMeetingTranscriptTable.meetingId, meetingId));
      assert.deepEqual(after, rows);
      const [idle] = await db
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.id, agent.id));
      assert.equal(idle.status, "idle");
      assert.equal(idle.currentAction, null);
      assert.equal(idle.runLeaseOwner, null);
    });
  }
});
