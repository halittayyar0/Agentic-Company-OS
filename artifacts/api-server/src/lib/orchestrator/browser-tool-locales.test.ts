import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import test from "node:test";
import type { ToolRuntimeContext } from "./execute-tool";
import type { WorkspaceLocale } from "../workspace-locale";

delete process.env.DATABASE_URL;
delete process.env.RUNTIME_ROLE;
process.env.NODE_ENV = "test";
process.env.AGENT_BROWSER_ALLOW_PRIVATE_NETWORKS = "true";
process.env.AGENT_BROWSER_HEADLESS = "true";
const root = await fsp.mkdtemp(path.join(os.tmpdir(), "acos-browser-locales-"));
process.env.AGENT_SANDBOX_ROOT = root;
const { db, dbReady, agentsTable, closeDatabase } =
  await import("@workspace/db");
const { executeTool } = await import("./execute-tool");
const browser = await import("../vm/browser");
const { specialistPermissionsPreset } = await import("./permission-presets");
const { WORKSPACE_LOCALES } = await import("../workspace-locale");
const { getToolCopy, toolMessage } = await import("./tool-localization");
const { BrowserDiagnosticError, localizedBrowserDiagnostic } =
  await import("../vm/browser-diagnostics");
const tools = [
  "browser_open",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_scroll",
  "browser_extract_text",
  "browser_wait",
  "browser_save_screenshot",
];
const source = "  Original 文 $& {title}  \n\n  متن عربي  \n  ";
let requests = 0;
const server = createServer((request, response) => {
  requests++;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(
    `<!doctype html><title>原文 {title} $&</title><a href="/next">Safe link</a><button onclick="this.textContent='clicked'">Approval button</button><input aria-label="Plain input"><input type="password" aria-label="Password"><pre>${source.replaceAll("&", "&amp;")}</pre><div style="height:1800px"></div><p>End of source</p>`,
  );
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const url = `http://127.0.0.1:${address.port}/`;

test("raw operator text rejects invalid Unicode before opening a session and carries a translated diagnostic", async () => {
  for (const text of ["", "a".repeat(4097), "bad\0text", "\ud800"]) {
    await assert.rejects(
      browser.sendRawInput(
        999999,
        { action: "type_text", text },
        "missing-lease",
      ),
      (error: unknown) => {
        assert.ok(error instanceof BrowserDiagnosticError);
        assert.equal(error.toolMessage?.key, "browserInputTextInvalid");
        for (const locale of WORKSPACE_LOCALES) {
          const translated = localizedBrowserDiagnostic(error, locale);
          assert.ok(translated.includes("4096"));
          assert.ok(translated.includes("UTF-16"));
          if (locale !== "tr")
            assert.notEqual(
              translated,
              localizedBrowserDiagnostic(error, "tr"),
            );
        }
        return true;
      },
    );
    assert.equal(await browser.getExistingBrowserSessionIdentity(999999), null);
  }
});

test.after(async () => {
  await browser.closeAllSessions();
  await closeDatabase();
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await fsp.rm(root, { recursive: true, force: true });
});

async function context(locale: WorkspaceLocale = "en", canBrowse = true) {
  await dbReady;
  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: "Literal 原文 {name}",
      role: "Test",
      systemPrompt: "Test only",
      createdByUser: true,
      permissions: {
        ...specialistPermissionsPreset,
        canBrowse,
        canUseTerminal: false,
      },
    })
    .returning();
  return { agent, locale, taskId: null } as ToolRuntimeContext;
}

function refFor(text: string, label: string) {
  const line = text
    .split("\n")
    .find((value) => value.includes(label) && value.includes("[ref="));
  const ref = line?.match(/\[ref=(\d+)\]/)?.[1];
  assert.ok(ref, `missing ref for ${label}`);
  return Number(ref);
}

test("all browser permission and split-runtime denials use the execution language", async () => {
  const ctx = await context("en", false);
  for (const name of tools) {
    const result = await executeTool(
      ctx,
      name,
      JSON.stringify({
        url,
        ref: 1,
        text: "literal",
        direction: "down",
        milliseconds: 250,
      }),
    );
    assert.equal(result.toolOutcome, "rejected");
    assert.equal(
      result.content,
      "Error: this agent does not have browser permission (canBrowse).",
    );
  }
  process.env.RUNTIME_ROLE = "api";
  try {
    for (const name of tools) {
      const result = await executeTool(
        { locale: "en" } as ToolRuntimeContext,
        name,
        "{}",
      );
      assert.equal(result.toolOutcome, "rejected");
      assert.equal(
        result.content,
        "BLOCKED: the split API runtime cannot run browser tools locally; a worker runtime must execute this operation.",
      );
    }
  } finally {
    delete process.env.RUNTIME_ROLE;
  }
});

test("real browser tools localize snapshot, scroll, wait, screenshot and approval guidance", async () => {
  const ctx = await context();
  try {
    const opened = await executeTool(
      ctx,
      "browser_open",
      JSON.stringify({ url }),
    );
    assert.equal(opened.toolOutcome, "succeeded");
    assert.ok(opened.content.includes("PAGE: 原文 {title} $&"), opened.content);
    assert.ok(opened.content.includes("INTERACTIVE ELEMENT REFERENCES:"));
    const snapshot = await executeTool(ctx, "browser_snapshot", "{}");
    assert.ok(snapshot.content.includes("VISIBLE TEXT (first section):"));
    const extracted = await executeTool(ctx, "browser_extract_text", "{}");
    assert.ok(extracted.content.includes(source));
    const clicked = await executeTool(
      ctx,
      "browser_click",
      JSON.stringify({ ref: refFor(snapshot.content, "Approval button") }),
    );
    assert.equal(clicked.toolOutcome, "rejected");
    assert.ok(
      clicked.content.includes("BLOCKED: browser_click requires"),
      clicked.content,
    );
    assert.ok(
      (await browser.snapshotPage(ctx.agent.id)).lines
        .join("\n")
        .includes("Approval button"),
    );
    const fresh = await executeTool(ctx, "browser_snapshot", "{}");
    const typed = await executeTool(
      ctx,
      "browser_type",
      JSON.stringify({
        ref: refFor(fresh.content, "Plain input"),
        text: "  原文 {args} $&  ",
      }),
    );
    assert.equal(typed.toolOutcome, "rejected");
    assert.ok(
      typed.content.includes("BLOCKED: browser_type requires"),
      typed.content,
    );
    const scrolled = await executeTool(
      ctx,
      "browser_scroll",
      '{"direction":"down"}',
    );
    assert.equal(scrolled.toolOutcome, "succeeded");
    assert.ok(scrolled.content.includes("Scrolled down."), scrolled.content);
    const waited = await executeTool(
      ctx,
      "browser_wait",
      '{"milliseconds":250}',
    );
    assert.equal(waited.toolOutcome, "succeeded");
    assert.ok(waited.content.includes("Waited 250 ms."), waited.content);
    const saved = await executeTool(
      ctx,
      "browser_save_screenshot",
      '{"name":"literal.png"}',
    );
    assert.equal(saved.toolOutcome, "succeeded");
    assert.ok(saved.content.includes("PNG evidence saved:"), saved.content);
  } finally {
    await browser.closeSession(ctx.agent.id);
  }
});

test("snapshot source preserves original Unicode and whitespace instead of normalizing page text", async () => {
  const ctx = await context();
  try {
    await browser.navigateTo(ctx.agent.id, url);
    assert.ok(
      (await browser.extractText(ctx.agent.id)).includes(source),
      "fixture exposes literal source",
    );
    const result = await executeTool(ctx, "browser_snapshot", "{}");
    assert.ok(result.content.includes(source), result.content);
  } finally {
    await browser.closeSession(ctx.agent.id);
  }
});

test("malformed browser fields cannot be coerced into navigation, input or screenshot effects", async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["browser_open", { url: [url] }],
    ["browser_open", { url: { toString: 1 } }],
    ["browser_click", { ref: [1] }],
    ["browser_type", { ref: 1, text: { value: "literal" } }],
    ["browser_type", { ref: 1, text: "literal", submit: "false" }],
    ["browser_scroll", { direction: ["down"] }],
    ["browser_wait", { milliseconds: "250" }],
    ["browser_save_screenshot", { name: ["capture.png"] }],
  ];
  for (const [name, args] of cases) {
    const ctx = await context();
    const before = requests;
    try {
      const result = await executeTool(ctx, name, JSON.stringify(args));
      assert.equal(result.toolOutcome, "rejected", name);
      assert.equal(
        (await browser.inspectBrowserSession(ctx.agent.id)).active,
        false,
        name,
      );
      assert.equal(requests, before, name);
    } finally {
      await browser.closeSession(ctx.agent.id);
    }
  }
});

test("missing references and operator ownership are localized typed denials", async () => {
  const ctx = await context();
  let lease: string | null = null;
  try {
    await browser.navigateTo(ctx.agent.id, url);
    const missing = await executeTool(ctx, "browser_click", '{"ref":999999}');
    assert.equal(missing.toolOutcome, "rejected");
    assert.ok(
      missing.content.includes("ref=999999 was not found"),
      missing.content,
    );
    const state = await browser.takeOverBrowserControl(ctx.agent.id);
    lease = state.leaseId;
    const denied = await executeTool(ctx, "browser_snapshot", "{}");
    assert.equal(denied.toolOutcome, "rejected");
    assert.ok(
      denied.content.includes("The operator has taken over this browser"),
      denied.content,
    );
  } finally {
    if (lease) await browser.releaseBrowserControl(ctx.agent.id, lease);
    await browser.closeSession(ctx.agent.id);
  }
});

test("all seven browser languages preserve source, capture locale and enforce approval and operator control", async () => {
  for (const locale of WORKSPACE_LOCALES) {
    const copy = getToolCopy(locale);
    const deniedContext = await context(locale, false);
    for (const name of tools) {
      const denied = await executeTool(
        deniedContext,
        name,
        JSON.stringify({
          url,
          ref: 1,
          text: "literal",
          direction: "down",
          milliseconds: 250,
        }),
      );
      assert.equal(denied.toolOutcome, "rejected");
      assert.equal(
        denied.content,
        copy.browserPermissionDenied,
        `${locale}: ${name}`,
      );
    }
    process.env.RUNTIME_ROLE = "api";
    try {
      const blocked = await executeTool(
        { locale } as ToolRuntimeContext,
        "browser_open",
        "{}",
      );
      assert.equal(blocked.toolOutcome, "rejected");
      assert.equal(blocked.content, copy.browserWorkerOnly);
    } finally {
      delete process.env.RUNTIME_ROLE;
    }

    const ctx = await context(locale);
    let lease: string | null = null;
    try {
      const pending = executeTool(ctx, "browser_open", JSON.stringify({ url }));
      ctx.locale = locale === "en" ? "ar" : "en";
      const opened = await pending;
      ctx.locale = locale;
      assert.equal(opened.toolOutcome, "succeeded");
      assert.ok(
        opened.content.includes(
          toolMessage(locale, "browserPage", { title: "原文 {title} $&", url }),
        ),
        `${locale}: captured page heading`,
      );
      assert.ok(
        opened.content.includes(source),
        `${locale}: source whitespace`,
      );
      const snapshot = await executeTool(ctx, "browser_snapshot", "{}");
      assert.ok(snapshot.content.includes(copy.browserReferences));
      assert.ok(snapshot.content.includes(copy.browserVisibleText));
      const originalText = "  原文 {args} $&\nمتن  ";
      const typed = await executeTool(
        ctx,
        "browser_type",
        JSON.stringify({
          ref: refFor(snapshot.content, "Plain input"),
          text: originalText,
        }),
      );
      assert.equal(typed.toolOutcome, "rejected");
      assert.ok(
        typed.content.includes(JSON.stringify(originalText)),
        `${locale}: exact approval argument`,
      );
      assert.ok(typed.content.includes("request_approval"));
      const sensitive = await executeTool(
        ctx,
        "browser_type",
        JSON.stringify({
          ref: refFor(snapshot.content, "Password"),
          text: "never",
        }),
      );
      assert.equal(sensitive.toolOutcome, "rejected");
      assert.ok(sensitive.content.includes(copy.browserSensitiveBlocked));
      const click = await executeTool(
        ctx,
        "browser_click",
        JSON.stringify({ ref: refFor(snapshot.content, "Approval button") }),
      );
      assert.equal(click.toolOutcome, "rejected");
      assert.ok(click.content.includes("request_approval"));
      const fresh = await executeTool(ctx, "browser_snapshot", "{}");
      const navigation = await executeTool(
        ctx,
        "browser_click",
        JSON.stringify({ ref: refFor(fresh.content, "Safe link") }),
      );
      assert.equal(navigation.toolOutcome, "succeeded");
      assert.ok(navigation.content.includes(copy.browserClicked));
      assert.ok(navigation.content.includes(`${url}next`));
      const scrolled = await executeTool(
        ctx,
        "browser_scroll",
        '{"direction":"up"}',
      );
      assert.equal(scrolled.toolOutcome, "succeeded");
      assert.ok(scrolled.content.includes(copy.browserUp));
      const waited = await executeTool(
        ctx,
        "browser_wait",
        '{"milliseconds":250}',
      );
      assert.equal(waited.toolOutcome, "succeeded");
      assert.ok(
        waited.content.includes(
          toolMessage(locale, "browserWaitComplete", { milliseconds: 250 }),
        ),
      );
      const extracted = await executeTool(ctx, "browser_extract_text", "{}");
      assert.ok(extracted.content.includes(source));
      const saved = await executeTool(
        ctx,
        "browser_save_screenshot",
        '{"name":"literal.png"}',
      );
      assert.equal(saved.toolOutcome, "succeeded");
      assert.ok(
        saved.content.includes(
          toolMessage(locale, "browserPngSaved", {
            path: "ekran-goruntuleri/literal.png",
          }),
        ),
      );
      const missing = await executeTool(ctx, "browser_click", '{"ref":999999}');
      assert.equal(missing.toolOutcome, "rejected");
      assert.ok(
        missing.content.includes(
          toolMessage(locale, "browserRefMissing", { ref: 999999 }),
        ),
      );
      const state = await browser.takeOverBrowserControl(ctx.agent.id);
      lease = state.leaseId;
      assert.ok(state.leaseExpiresAt);
      const owned = await executeTool(ctx, "browser_snapshot", "{}");
      assert.equal(owned.toolOutcome, "rejected");
      assert.ok(
        owned.content.includes(
          toolMessage(locale, "browserOperatorOwns", {
            expiresAt: state.leaseExpiresAt,
          }),
        ),
      );
    } finally {
      if (lease) await browser.releaseBrowserControl(ctx.agent.id, lease);
      await browser.closeSession(ctx.agent.id);
    }
  }
});
