import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  WORKSPACE_LOCALES,
  writeWorkspaceLocale,
} from "../lib/workspace-locale";
import { getLocalizedAgentTemplate } from "../lib/agent-template-localization";
import {
  CreateAgentResponse,
  ListAgentTemplatesResponse,
} from "@workspace/api-zod";

delete process.env.DATABASE_URL;
process.env.NODE_ENV = "test";
const { db, dbReady, closeDatabase, agentsTable, tasksTable } =
  await import("@workspace/db");
const { default: agentsRouter } = await import("./agents");
const { seedDefaultOrg } = await import("../lib/seed");
const { buildChatSystemPrompt, buildTaskStepSystemPrompt } =
  await import("../lib/orchestrator/system-prompt");
const { AGENT_TEMPLATES } = await import("../lib/agent-templates");

test(
  "authored locale flows preserve custom instructions, identities and authority",
  { timeout: 45000 },
  async (t) => {
    await dbReady;
    await seedDefaultOrg();
    const [root] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.isRootCeo, true));
    const app = express();
    app.use(express.json());
    app.use("/api", agentsRouter);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}/api`;
    t.after(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeDatabase();
    });
    async function create(body: object) {
      const response = await fetch(`${base}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Source 名",
          role: "Source role",
          parentAgentId: root.id,
          templateKey: "research_director",
          ...body,
        }),
      });
      const responseBody: unknown = await response.json();
      return {
        status: response.status,
        body:
          response.status === 201
            ? CreateAgentResponse.parse(responseBody)
            : null,
      };
    }
    await t.test(
      "catalog selection honors language and omitted locale preserves original bytes",
      async () => {
        const original = ListAgentTemplatesResponse.parse(
          await (await fetch(`${base}/agent-templates`)).json(),
        );
        assert.deepEqual(original, AGENT_TEMPLATES);
        const english = ListAgentTemplatesResponse.parse(
          await (await fetch(`${base}/agent-templates?locale=en`)).json(),
        );
        assert.notEqual(
          english[0].defaultSystemPrompt,
          original[0].defaultSystemPrompt,
        );
        assert.deepEqual(
          english.map((entry) => entry.defaultPermissions),
          original.map((entry) => entry.defaultPermissions),
        );
      },
    );
    await t.test(
      "invalid catalog and creation languages fail closed",
      async () => {
        assert.equal(
          (await fetch(`${base}/agent-templates?locale=fr`)).status,
          400,
        );
        assert.equal((await create({ locale: "fr" })).status, 400);
      },
    );
    await t.test(
      "template creation uses the exact selected catalog",
      async () => {
        const result = await create({ locale: "en" });
        assert.equal(result.status, 201);
        assert.ok(result.body);
        assert.equal(result.body.isCustomPrompt, false);
        assert.ok(!result.body.systemPrompt.includes("Misyonun:"));
        assert.equal(result.body.name, "Source 名");
        assert.equal(result.body.isRootCeo, false);
        assert.equal(result.body.permissions.canUseSudo, false);
      },
    );
    await t.test(
      "explicit custom text remains custom with a template key across startup",
      async () => {
        const prompt =
          "  Preserve original instructions 原文 العربية\n\n  exact whitespace  ";
        const result = await create({ locale: "de", systemPrompt: prompt });
        assert.equal(result.status, 201);
        assert.ok(result.body);
        await seedDefaultOrg("de");
        const [saved] = await db
          .select()
          .from(agentsTable)
          .where(eq(agentsTable.id, result.body.id));
        assert.equal(
          saved.systemPrompt,
          prompt,
          "startup must not overwrite explicitly supplied text",
        );
        assert.equal(saved.isCustomPrompt, true);
      },
    );
    await t.test(
      "first-run language reaches future managed turns without renaming or rewriting custom agents",
      async () => {
        const english = await buildChatSystemPrompt(root, undefined, "en");
        const role = english.match(
          /<role_playbook[^>]*>([\s\S]*?)<\/role_playbook>/,
        )?.[1];
        assert.ok(role && !role.includes("Misyonun:"));
        const custom = {
          ...root,
          isCustomPrompt: true,
          systemPrompt: "Keep custom 原文 instructions exactly.",
        };
        const customTurn = await buildChatSystemPrompt(custom, undefined, "de");
        assert.ok(customTurn.includes(custom.systemPrompt));
        const [unchanged] = await db
          .select()
          .from(agentsTable)
          .where(eq(agentsTable.id, root.id));
        assert.equal(unchanged.name, root.name);
        assert.deepEqual(unchanged.permissions, root.permissions);
      },
    );
    await t.test(
      "persisted first-run preference reaches chat and task turns in all seven languages after seeding",
      async () => {
        const scratch = await fs.mkdtemp(
          path.join(os.tmpdir(), "acos-authored-locale-"),
        );
        const previousDirectory = process.cwd();
        await fs.writeFile(
          path.join(scratch, "pnpm-workspace.yaml"),
          "packages: []\n",
        );
        const [task] = await db
          .insert(tasksTable)
          .values({
            title: "Locale acceptance",
            brief: "Keep source brief 原文",
            ownerAgentId: root.id,
          })
          .returning();
        function rolePlaybook(prompt: string) {
          const role = prompt.match(
            /<role_playbook[^>]*>([\s\S]*?)<\/role_playbook>/,
          )?.[1];
          assert.ok(role);
          return role
            .replace(/&apos;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&gt;/g, ">")
            .replace(/&lt;/g, "<")
            .replace(/&amp;/g, "&");
        }
        try {
          process.chdir(scratch);
          for (const locale of WORKSPACE_LOCALES) {
            await writeWorkspaceLocale(locale);
            const expected = getLocalizedAgentTemplate(
              "ceo",
              locale,
            )!.defaultSystemPrompt;
            assert.equal(
              rolePlaybook(await buildChatSystemPrompt(root)),
              expected,
            );
            assert.equal(
              rolePlaybook(await buildTaskStepSystemPrompt(root, task)),
              expected,
            );
            const custom = {
              ...root,
              isCustomPrompt: true,
              systemPrompt: "  Custom source <原文> & unchanged.  ",
            };
            assert.equal(
              rolePlaybook(await buildTaskStepSystemPrompt(custom, task)),
              custom.systemPrompt,
            );
          }
        } finally {
          process.chdir(previousDirectory);
          await db.delete(tasksTable).where(eq(tasksTable.id, task.id));
          await fs.rm(path.join(scratch, "data", "workspace-locale.json"), {
            force: true,
          });
          await fs.rm(path.join(scratch, "pnpm-workspace.yaml"), {
            force: true,
          });
          await fs.rmdir(path.join(scratch, "data"));
          await fs.rmdir(scratch);
        }
      },
    );
  },
);
