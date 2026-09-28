import { WORKSPACE_LOCALES } from "../workspace-locale";
import { getToolCopy } from "./tool-localization";
import assert from "node:assert/strict";
import test from "node:test";
import type OpenAI from "openai";
import type { Agent } from "@workspace/db";
import { executeTool } from "./execute-tool";
import {
  deriveExclusiveTurnPolicy,
  evaluateExclusiveToolCall,
  filterToolsForExclusiveTurn,
  exclusiveTurnSystemPrompt,
} from "./exclusive-turn-policy";

function requirePolicy(content: string) {
  const policy = deriveExclusiveTurnPolicy(content);
  assert.ok(policy, `expected an exclusive policy for: ${content}`);
  return policy;
}

function allowed(
  content: string,
  toolName: string,
  args: Record<string, unknown> = {},
): boolean {
  return evaluateExclusiveToolCall(requirePolicy(content), toolName, args)
    .allowed;
}

test("Turkish browser-only requests expose browser tools and block cross-surface drift", () => {
  const content =
    "Tarayıcıda https://example.com adresini aç ve başlığını doğrula. Sadece bunu yap.";
  const policy = requirePolicy(content);

  assert.deepEqual(policy.families, ["browser"]);
  assert.equal(
    allowed(content, "browser_open", { url: "https://example.com" }),
    true,
  );
  assert.equal(allowed(content, "browser_snapshot"), true);
  assert.equal(allowed(content, "browser_save_screenshot"), true);
  assert.equal(allowed(content, "computer_observe"), false);
  assert.equal(
    allowed(content, "vm_write_file", {
      path: "browser-result.md",
      content: "drift",
    }),
    false,
  );
  assert.equal(allowed(content, "vm_run_command", { command: "pwd" }), false);
  assert.equal(allowed(content, "create_sub_agent"), false);
  assert.equal(allowed(content, "delegate_task"), false);
  assert.equal(allowed(content, "log_note"), false);
  assert.equal(
    evaluateExclusiveToolCall(policy, "request_approval", {
      category: "other",
      title: "actionless browser approval",
      description: "must not create a runnable task",
      toolName: "browser_open",
      toolArgs: { url: "https://example.com" },
    }).allowed,
    false,
  );
  assert.equal(
    evaluateExclusiveToolCall(policy, "request_approval", {
      category: "external_contact",
      title: "missing args",
      description: "must not create an actionless task",
      toolName: "browser_click",
    }).allowed,
    false,
  );
});

test("English exclusivity variants are recognized without treating read-only or not-only as exclusivity", () => {
  for (const content of [
    "Open https://example.com in the browser and verify the title. Only do this.",
    "Open https://example.com in the browser and nothing else.",
    "Use the browser. Do not use any other tools.",
  ]) {
    assert.deepEqual(requirePolicy(content).families, ["browser"]);
  }

  assert.equal(
    deriveExclusiveTurnPolicy("Perform a read-only browser security review."),
    null,
  );
  assert.equal(
    deriveExclusiveTurnPolicy(
      "Use not only the browser but also the terminal.",
    ),
    null,
  );
  assert.equal(
    deriveExclusiveTurnPolicy("Sadece halletmeni istiyorum, sonucu getir."),
    null,
  );
  assert.equal(
    deriveExclusiveTurnPolicy("Tarayıcıda example.com başlığını doğrula."),
    null,
  );

  assert.deepEqual(
    requirePolicy("Only open the admin page in the browser.").families,
    ["browser"],
  );
  assert.deepEqual(
    requirePolicy("Only inspect the project root URL in the browser.").families,
    ["browser"],
  );
  for (const content of [
    "Use the browser exclusively; avoid all other tools.",
    "Yalnızca tarayıcıyı kullan; başka hiçbir araç kullanma.",
    "Use the browser solely; no other tools.",
  ]) {
    assert.deepEqual(requirePolicy(content).families, ["browser"]);
  }

  for (const content of [
    "Use the browser and delegate research; return only 3 results.",
    "Open https://example.com/only and inspect it.",
    "Tarayıcıyı kullan ve sadece 3 sonuç döndür.",
  ]) {
    assert.equal(deriveExclusiveTurnPolicy(content), null, content);
  }
});

test("URL and page vocabulary cannot smuggle terminal, sudo, or file families", () => {
  for (const content of [
    "Tarayıcıda yalnızca https://example.com/command sayfasını aç.",
    "Tarayıcıda yalnızca https://example.com/admin sayfasını aç.",
    "Only inspect the sudo documentation in the browser.",
    "Tarayıcıda yalnızca Admin command guide sayfasını aç.",
    "Use the browser only to read file docs.",
    "Only use the browser to open the Run command reference page.",
    "Only use the browser to read the local workspace file guide page.",
    'Only use the browser and open the "Write File" documentation page. Do not use any other tools.',
    'Only use the browser and open the "Read File" documentation page. Do not use any other tools.',
    "Only use the browser to open the Run Whoami demo page. Do not use any other tools.",
    "Only use the browser to open the sudo playground and run the whoami command. Do not use any other tools.",
  ]) {
    const policy = requirePolicy(content);
    assert.deepEqual(policy.families, ["browser"], content);
    assert.equal(
      evaluateExclusiveToolCall(policy, "vm_run_command", {
        command: "whoami",
      }).allowed,
      false,
      content,
    );
    assert.equal(
      evaluateExclusiveToolCall(policy, "vm_write_file", {
        path: "drift.md",
        content: "blocked",
      }).allowed,
      false,
      content,
    );
    assert.equal(
      evaluateExclusiveToolCall(policy, "request_approval", {
        category: "other",
        title: "scope laundering",
        description: "must fail",
        toolName: "vm_run_sudo_command",
        toolArgs: { command: "whoami" },
      }).allowed,
      false,
      content,
    );
  }
});

test("negated surfaces are deny-overrides, never additional capabilities", () => {
  for (const content of [
    "Only use the browser. Do not use the terminal.",
    "Yalnızca tarayıcıyı kullan; terminal kullanma.",
    "Only use the browser; do not use the CEO host shell or run whoami.",
    "Only use the browser and do not save the result to a workspace file.",
    "Use the browser only; no terminal.",
    "Use the browser only; avoid the terminal.",
    "Use the browser, not the terminal, and nothing else.",
  ]) {
    const policy = requirePolicy(content);
    assert.deepEqual(policy.families, ["browser"], content);
    assert.equal(
      policy.allowedTools.includes("vm_run_command"),
      false,
      content,
    );
    assert.equal(
      policy.allowedTools.includes("vm_run_sudo_command"),
      false,
      content,
    );
    assert.equal(policy.allowedTools.includes("vm_write_file"), false, content);
  }
});

test("read-only file scope never exposes the file writer", () => {
  const policy = requirePolicy(
    "Çalışma alanındaki dosyayı yalnızca oku; başka araç kullanma.",
  );
  assert.deepEqual(policy.families, ["files"]);
  assert.equal(
    evaluateExclusiveToolCall(policy, "vm_read_file", { path: "note.md" })
      .allowed,
    true,
  );
  assert.equal(
    evaluateExclusiveToolCall(policy, "vm_write_file", {
      path: "note.md",
      content: "drift",
    }).allowed,
    false,
  );
});

test("an explicit two-surface request keeps both named tools but no third surface", () => {
  const content =
    "Terminalde pwd komutunu çalıştır ve tarayıcıda https://example.com başlığını doğrula. Yalnızca bu iki adımı yap.";
  const policy = requirePolicy(content);

  assert.deepEqual(policy.families, ["browser", "terminal"]);
  assert.equal(
    evaluateExclusiveToolCall(policy, "vm_run_command", { command: "pwd" })
      .allowed,
    true,
  );
  assert.equal(
    evaluateExclusiveToolCall(policy, "browser_open", {
      url: "https://example.com",
    }).allowed,
    true,
  );
  assert.equal(
    evaluateExclusiveToolCall(policy, "vm_write_file", {
      path: "extra.md",
      content: "not requested",
    }).allowed,
    false,
  );
});

test("an explicit browser-to-file transition preserves both requested surfaces", () => {
  const policy = requirePolicy(
    "Tarayıcıda https://example.com aç ve sonra sonucu workspace dosyasına yaz. Yalnızca bu iki adımı yap.",
  );
  assert.deepEqual(policy.families, ["browser", "files"]);
  assert.equal(
    evaluateExclusiveToolCall(policy, "browser_open", {
      url: "https://example.com",
    }).allowed,
    true,
  );
  assert.equal(
    evaluateExclusiveToolCall(policy, "vm_write_file", {
      path: "result.md",
      content: "verified result",
    }).allowed,
    true,
  );
  assert.equal(
    evaluateExclusiveToolCall(policy, "vm_run_command", {
      command: "pwd",
    }).allowed,
    false,
  );
});

test("exact sudo-only approval is command-bound and cannot be laundered through another tool", () => {
  const content =
    "CEO host shell üzerinden yalnızca whoami komutunu çalıştırmak için onay iste. Başka komut veya araç kullanma.";
  const policy = requirePolicy(content);

  assert.deepEqual(policy.families, ["sudo_approval"]);
  assert.equal(policy.exactSudoCommand, "whoami");
  assert.equal(
    evaluateExclusiveToolCall(policy, "vm_run_sudo_command", {
      command: "whoami",
    }).allowed,
    true,
  );
  assert.equal(
    evaluateExclusiveToolCall(policy, "vm_run_sudo_command", {
      command: "whoami && hostname",
    }).allowed,
    false,
  );
  assert.equal(
    evaluateExclusiveToolCall(policy, "vm_run_command", {
      command: "whoami",
    }).allowed,
    false,
  );
  assert.equal(
    evaluateExclusiveToolCall(policy, "computer_observe", {}).allowed,
    false,
  );
  assert.equal(
    evaluateExclusiveToolCall(policy, "request_approval", {
      category: "other",
      title: "whoami",
      description: "Run exact command",
      toolName: "vm_run_sudo_command",
      toolArgs: { command: "whoami" },
    }).allowed,
    true,
  );
  assert.equal(
    evaluateExclusiveToolCall(policy, "request_approval", {
      category: "other",
      title: "different command",
      description: "Scope laundering attempt",
      toolName: "vm_run_sudo_command",
      toolArgs: { command: "hostname" },
    }).allowed,
    false,
  );
  assert.equal(
    evaluateExclusiveToolCall(policy, "request_approval", {
      category: "other",
      title: "generic",
      description: "Missing executable scope",
    }).allowed,
    false,
  );
});

test("multi-token sudo commands bind to the command relation, never an unrelated quote", () => {
  const multiToken = requirePolicy(
    "CEO host shell üzerinden yalnızca git status komutunu çalıştırmak için onay iste. Başka araç kullanma.",
  );
  assert.equal(multiToken.exactSudoCommand, "git status");
  assert.equal(
    evaluateExclusiveToolCall(multiToken, "vm_run_sudo_command", {
      command: "git status",
    }).allowed,
    true,
  );
  assert.equal(
    evaluateExclusiveToolCall(multiToken, "vm_run_sudo_command", {
      command: "git status --short",
    }).allowed,
    false,
  );

  const negatedQuote = requirePolicy(
    'CEO host shell üzerinde "rm -rf temp" komutunu çalıştırma; yalnızca whoami komutunu çalıştırmak için onay iste.',
  );
  assert.equal(negatedQuote.exactSudoCommand, "whoami");

  const ambiguous = requirePolicy(
    "CEO host shell için yalnızca onay iste; başka araç kullanma.",
  );
  assert.equal(ambiguous.exactSudoCommand, undefined);
  assert.equal(ambiguous.allowedTools.includes("vm_run_sudo_command"), false);
  assert.equal(ambiguous.allowedTools.includes("request_approval"), false);

  const caseSensitive = requirePolicy(
    "CEO host shell üzerinden yalnızca Get-Content README.md komutunu çalıştırmak için onay iste.",
  );
  assert.equal(caseSensitive.exactSudoCommand, "Get-Content README.md");
  assert.equal(
    evaluateExclusiveToolCall(caseSensitive, "vm_run_sudo_command", {
      command: "Get-Content README.md",
    }).allowed,
    true,
  );
  assert.equal(
    evaluateExclusiveToolCall(caseSensitive, "vm_run_sudo_command", {
      command: "get-content readme.md",
    }).allowed,
    false,
  );

  const englishOrder = requirePolicy(
    "In the CEO host shell, run only the whoami command and nothing else.",
  );
  assert.equal(englishOrder.exactSudoCommand, "whoami");

  const englishNegation = requirePolicy(
    "In the CEO host shell, do not run hostname; only run whoami and nothing else.",
  );
  assert.equal(englishNegation.exactSudoCommand, "whoami");
  assert.equal(
    evaluateExclusiveToolCall(englishNegation, "vm_run_sudo_command", {
      command: "hostname",
    }).allowed,
    false,
  );
});

test("tool definitions are reduced before the model call", () => {
  const tools = [
    "browser_open",
    "browser_snapshot",
    "computer_observe",
    "vm_write_file",
    "delegate_task",
    "request_approval",
  ].map((name): OpenAI.Chat.Completions.ChatCompletionTool => ({
    type: "function",
    function: { name, parameters: { type: "object" } },
  }));
  const filtered = filterToolsForExclusiveTurn(
    tools,
    requirePolicy("Tarayıcıda https://example.com aç. Yalnız bunu yap."),
  );

  assert.deepEqual(
    filtered.map((tool) => tool.function.name),
    ["browser_open", "browser_snapshot", "request_approval"],
  );
});

test("executeTool enforces the policy again before agent lookup or side effects", async () => {
  const policy = requirePolicy(
    "Tarayıcıda https://example.com aç. Başka bir araç kullanma.",
  );
  const result = await executeTool(
    {
      agent: { id: -999_999 } as Agent,
      taskId: null,
      exclusiveTurnPolicy: policy,
    },
    "vm_write_file",
    JSON.stringify({ path: "drift.md", content: "must not be written" }),
  );

  assert.match(result.content, /^ENGELLENDİ: vm_write_file/u);
  assert.ok(result.content.includes(policy.allowedTools.join(", ")));
  assert.equal(result.toolOutcome, "rejected");
  assert.deepEqual(result.createdTasks, []);
  assert.deepEqual(result.createdAgents, []);
});

test("exclusive sudo instructions preserve exact command authority in the selected language", () => {
  for (const locale of WORKSPACE_LOCALES) {
    for (const exactSudoCommand of [
      "printf '%s' '{tools} $& 原文'",
      undefined,
    ]) {
      const policy = {
        source: "explicit_user_exclusivity" as const,
        families: ["sudo_approval" as const],
        allowedTools: exactSudoCommand
          ? ["request_approval", "vm_run_sudo_command"]
          : [],
        ...(exactSudoCommand ? { exactSudoCommand } : {}),
      };
      const before = structuredClone(policy);
      const prompt = exclusiveTurnSystemPrompt(policy, locale);
      assert.ok(
        prompt.includes(
          exactSudoCommand
            ? getToolCopy(locale).exclusiveSudoExactInstruction
            : getToolCopy(locale).exclusiveSudoUnavailableInstruction,
        ),
        prompt,
      );
      assert.deepEqual(policy, before);
      assert.equal(
        evaluateExclusiveToolCall(policy, "vm_run_sudo_command", {
          command: "different",
        }).allowed,
        false,
      );
    }
  }
});
