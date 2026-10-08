import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import type { ChatGPTRegistration } from "./chatgpt-plan-types";
import type { UnifiedChatCompletionParams } from "./openrouter";
import {
  completeChatGPTPlanResponse,
  listChatGPTPlanModels,
  PlanInferenceError,
  chatGPTPlanHistoryMessage,
} from "./chatgpt-plan-responses";

const account: ChatGPTRegistration = {
  id: "c1c94b4d-7ce4-4e95-a0d8-ea289080b445",
  hostId: "urn:uuid:712b4d81-573e-47fc-8e03-66c44670b2a1",
  clientId: "fixture-issued-client",
  accountId: "fixture-account",
  subject: "fixture-subject",
  revision: 1,
  updatedAt: 1,
  credentials: {
    accessToken: "fixture-plan-access",
    idToken: "fixture-signed-id",
    grants: ["resource.invoke", "chatgpt.tokens.use.direct"],
    expiresAt: Date.now() + 3_600_000,
  },
};
const params: UnifiedChatCompletionParams = {
  model: "chatgpt:gpt-fixture",
  messages: [{ role: "user", content: "A useful result" }],
};
const reportedUsage = { input_tokens: 17, output_tokens: 9, total_tokens: 26 };
function terminal(
  status = "completed",
  overrides: Record<string, unknown> = {},
) {
  return {
    type: `response.${status}`,
    response: {
      id: "resp_fixture",
      model: "gpt-fixture",
      created_at: 123,
      status,
      error: null,
      output: [
        {
          type: "message",
          id: "msg_fixture",
          role: "assistant",
          status: "completed",
          phase: "final_answer",
          content: [{ type: "output_text", text: "Useful ✓", annotations: [] }],
        },
      ],
      usage: reportedUsage,
      ...overrides,
    },
  };
}
function sse(events: unknown[]) {
  return events
    .map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`)
    .join("");
}
async function fixture(
  t: test.TestContext,
  handler: (
    body: Record<string, unknown>,
    response: import("node:http").ServerResponse,
  ) => void,
) {
  const calls: Array<{
    url: string;
    method: string;
    body: Record<string, unknown>;
  }> = [];
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk.toString();
    const body = raw ? JSON.parse(raw) : {};
    calls.push({ url: request.url!, method: request.method!, body });
    handler(body, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as import("node:net").AddressInfo;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.openai.com");
    assert.ok(["/v1/responses", "/v1/models"].includes(url.pathname));
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer fixture-plan-access",
    );
    assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "omit");
    return fetch(`http://127.0.0.1:${address.port}${url.pathname}`, init);
  };
  return { fetch: request, calls };
}

test("public Responses transport consumes fragmented UTF-8 SSE and only terminal output", async (t) => {
  const network = await fixture(t, (_body, response) => {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "x-request-id": "req_fixture",
    });
    const bytes = Buffer.from(
      ": heartbeat\r\n\r\n" +
        sse([
          { type: "response.output_text.delta", delta: "Unfinished text" },
          terminal(),
        ]),
    );
    // Splitting every byte also splits the non-ASCII text and CRLF delimiters.
    for (const byte of bytes) response.write(Buffer.from([byte]));
    response.end();
  });
  const result = await completeChatGPTPlanResponse(params, account, network);
  assert.equal(result.choices[0].message.content, "Useful ✓");
  assert.equal(result.choices[0].finish_reason, "stop");
  assert.deepEqual(result.usage, {
    prompt_tokens: 17,
    completion_tokens: 9,
    total_tokens: 26,
  });
  assert.equal(network.calls.length, 1);
  const body = network.calls[0].body;
  assert.equal(body.model, "gpt-fixture");
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.ok(Array.isArray(body.input));
  assert.ok(!("max_output_tokens" in body));
  assert.ok(!("previous_response_id" in body));
});

test("function IDs, namespaces, encrypted reasoning and assistant phase survive local tool history", async (t) => {
  const output = [
    {
      type: "reasoning",
      id: "rs_fixture",
      summary: [],
      encrypted_content: "fixture-encrypted-reasoning",
    },
    {
      type: "message",
      id: "msg_commentary",
      role: "assistant",
      status: "completed",
      phase: "commentary",
      content: [
        {
          type: "output_text",
          text: "I will inspect the file.",
          annotations: [],
        },
      ],
    },
    {
      type: "function_call",
      id: "fc_fixture",
      call_id: "call_original",
      namespace: "local_tools",
      name: "read_file",
      arguments: '{"path":"README.md"}',
      status: "completed",
    },
  ];
  const network = await fixture(t, (body, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    const continuing = (body.input as Array<Record<string, unknown>>).some(
      (item) => item.type === "function_call_output",
    );
    response.end(
      sse([continuing ? terminal() : terminal("completed", { output })]),
    );
  });
  const input: UnifiedChatCompletionParams = {
    ...params,
    messages: [
      { role: "system", content: "Follow the current permissions." },
      ...params.messages,
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "read_file",
          description: "Read a permitted file",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
          },
        },
      },
    ],
  };
  const first = await completeChatGPTPlanResponse(input, account, network);
  assert.equal(first.choices[0].finish_reason, "tool_calls");
  assert.equal(first.choices[0].message.tool_calls?.[0].id, "call_original");
  const history = chatGPTPlanHistoryMessage(first);
  // Backend replay data must not enter ordinary serialized chat/browser history.
  assert.ok(!JSON.stringify(history).includes("fixture-encrypted-reasoning"));
  await completeChatGPTPlanResponse(
    {
      ...input,
      messages: [
        ...input.messages,
        history,
        {
          role: "tool",
          tool_call_id: "call_original",
          content: "File contents",
        },
      ],
    },
    account,
    network,
  );
  const body = network.calls[1].body;
  assert.deepEqual(body.tools, [
    {
      type: "namespace",
      name: "local_tools",
      tools: [
        {
          type: "function",
          name: "read_file",
          description: "Read a permitted file",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
          },
          strict: false,
        },
      ],
    },
  ]);
  const replay = body.input as Array<Record<string, unknown>>;
  assert.deepEqual(replay[0], {
    role: "developer",
    content: "Follow the current permissions.",
  });
  assert.deepEqual(replay.slice(2, 5), output);
  assert.deepEqual(replay[5], {
    type: "function_call_output",
    call_id: "call_original",
    output: "File contents",
  });
  await assert.rejects(
    completeChatGPTPlanResponse(
      { ...input, messages: [...input.messages, history] },
      { ...account, accountId: "another-account" },
      network,
    ),
    { kind: "account_changed" },
  );
  assert.equal(network.calls.length, 2);
});

test("unsupported controls and inputs fail before any network or paid billing call", async () => {
  let calls = 0;
  const network = {
    fetch: (async () => {
      calls++;
      throw new Error("no network");
    }) as typeof fetch,
  };
  const unsupported = [
    { ...params, maxTokens: 12 },
    { ...params, temperature: 0.1 },
    { ...params, service_tier: "priority" },
    { ...params, previous_response_id: "resp_old" },
    { ...params, tools: [{ type: "web_search" }] },
    { ...params, tools: [{ type: "tool_search" }] },
    {
      ...params,
      messages: [
        {
          role: "user",
          content: [
            { type: "input_audio", input_audio: { data: "xx", format: "wav" } },
          ],
        },
      ],
    },
    {
      ...params,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: "https://fixture.invalid/x.png" },
            },
          ],
        },
      ],
    },
    {
      ...params,
      messages: [{ role: "tool", tool_call_id: "orphan", content: "unbound" }],
    },
    { ...params, model: "chatgpt:https://attacker.invalid/token" },
  ];
  for (const invalid of unsupported) {
    await assert.rejects(
      completeChatGPTPlanResponse(
        invalid as UnifiedChatCompletionParams,
        account,
        network,
      ),
      { kind: "unsupported" },
    );
  }
  await assert.rejects(
    completeChatGPTPlanResponse(
      params,
      {
        ...account,
        credentials: {
          ...account.credentials!,
          grants: ["openid"],
        },
      },
      network,
    ),
    { kind: "permission" },
  );
  await assert.rejects(
    completeChatGPTPlanResponse(
      params,
      { ...account, credentials: null },
      network,
    ),
    { kind: "sign_in_required" },
  );
  assert.equal(calls, 0);
});

test("partial text followed by plan quota failure retains actual usage without becoming success", async (t) => {
  const network = await fixture(t, (_body, response) => {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "x-request-id": "req_quota",
    });
    response.end(
      sse([
        { type: "response.output_text.delta", delta: "Looks successful" },
        terminal("failed", {
          error: {
            code: "subscription_sharing_usage_limit_exceeded",
            message: "fixture-plan-access private diagnostic",
            param: null,
          },
        }),
      ]),
    );
  });
  await assert.rejects(
    completeChatGPTPlanResponse(params, account, network),
    (error: unknown) => {
      assert.ok(error instanceof PlanInferenceError);
      assert.equal(error.kind, "quota");
      assert.equal(error.code, "subscription_sharing_usage_limit_exceeded");
      assert.equal(error.requestId, "req_quota");
      assert.equal(error.status, 200);
      assert.equal(error.retryAt, null);
      assert.deepEqual(error.usage, {
        prompt_tokens: 17,
        completion_tokens: 9,
        total_tokens: 26,
      });
      assert.ok(!JSON.stringify(error).includes("fixture-plan-access"));
      assert.ok(!error.message.includes("private diagnostic"));
      return true;
    },
  );
  assert.equal(network.calls.length, 1);
});

test("incomplete, explicit error and EOF never produce a completion; missing usage stays unknown", async (t) => {
  const variants = [
    { events: [terminal("incomplete", { usage: null })], kind: "incomplete" },
    {
      events: [
        {
          type: "error",
          code: "subscription_sharing_usage_unavailable",
          message: "private",
        },
      ],
      kind: "temporary",
    },
    {
      events: [{ type: "response.output_text.delta", delta: "partial" }],
      kind: "interrupted",
    },
  ];
  for (const variant of variants) {
    const network = await fixture(t, (_body, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(sse(variant.events));
    });
    await assert.rejects(
      completeChatGPTPlanResponse(params, account, network),
      (error: unknown) => {
        assert.ok(error instanceof PlanInferenceError);
        assert.equal(error.kind, variant.kind);
        assert.equal(error.usage, null);
        return true;
      },
    );
    assert.equal(network.calls.length, 1);
  }
  const network = await fixture(t, (_body, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(sse([terminal("completed", { usage: null })]));
  });
  const result = await completeChatGPTPlanResponse(params, account, network);
  assert.equal(result.usage, undefined);
});

test("HTTP admission bodies preserve safe shape, status and request ID without exposing text or credentials", async (t) => {
  for (const [status, kind] of [
    [401, "permission"],
    [403, "permission"],
    [503, "temporary"],
  ] as const) {
    const network = await fixture(t, (_body, response) => {
      response.writeHead(status, {
        "content-type": "application/json",
        "x-request-id": "req_admission",
      });
      response.end(
        JSON.stringify({ detail: "fixture-plan-access restricted diagnostic" }),
      );
    });
    await assert.rejects(
      completeChatGPTPlanResponse(params, account, network),
      (error: unknown) => {
        assert.ok(error instanceof PlanInferenceError);
        assert.equal(error.kind, kind);
        assert.equal(error.status, status);
        assert.equal(error.bodyShape, "detail");
        assert.equal(error.requestId, "req_admission");
        assert.equal(error.code, null);
        assert.ok(!JSON.stringify(error).includes("fixture-plan-access"));
        return true;
      },
    );
    assert.equal(network.calls.length, 1);
  }
});

test("timeout and caller cancellation stop an opened stream and retain observed reported usage", async (t) => {
  for (const mode of ["timeout", "cancel"] as const) {
    const controller = new AbortController();
    const network = await fixture(t, (_body, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(
        sse([
          {
            type: "response.in_progress",
            response: { id: "resp_fixture", usage: reportedUsage },
          },
        ]),
      );
      if (mode === "cancel")
        setTimeout(
          () => controller.abort(new Error("fixture secret cancellation")),
          20,
        );
    });
    await assert.rejects(
      completeChatGPTPlanResponse(
        { ...params, signal: controller.signal },
        account,
        { ...network, timeoutMs: 120 },
      ),
      (error: unknown) => {
        assert.ok(error instanceof PlanInferenceError);
        assert.equal(error.kind, mode === "cancel" ? "cancelled" : "timeout");
        assert.deepEqual(error.usage, {
          prompt_tokens: 17,
          completion_tokens: 9,
          total_tokens: 26,
        });
        assert.ok(!error.message.includes("fixture secret"));
        return true;
      },
    );
  }
});

test("malformed terminal output cannot authorize unknown, duplicate or partial function calls", async (t) => {
  const tool = {
    type: "function" as const,
    function: { name: "read_file", parameters: { type: "object" } },
  };
  const call = {
    type: "function_call",
    id: "fc_fixture",
    call_id: "call_fixture",
    namespace: "local_tools",
    name: "read_file",
    arguments: "{}",
    status: "completed",
  };
  for (const output of [
    [{ ...call, arguments: "{" }],
    [{ ...call, namespace: "other" }],
    [{ ...call, name: "execute_unoffered" }],
    [call, call],
    [{ ...call, status: "in_progress" }],
    [{ type: "computer_call", id: "computer_fixture" }],
    [{ ...call, async: true }],
    [{ ...call, caller: { type: "program", caller_id: "program_fixture" } }],
  ]) {
    const network = await fixture(t, (_body, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(sse([terminal("completed", { output })]));
    });
    await assert.rejects(
      completeChatGPTPlanResponse(
        { ...params, tools: [tool] },
        account,
        network,
      ),
      { kind: "protocol" },
    );
  }
});

test("an upstream canonical model name is retained without discarding a completed response", async (t) => {
  const network = await fixture(t, (_body, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      sse([terminal("completed", { model: "gpt-fixture-2026-01-01" })]),
    );
  });
  const result = await completeChatGPTPlanResponse(params, account, network);
  assert.equal(result.model, "chatgpt:gpt-fixture-2026-01-01");
});

test("a cancelled request does not start inference and a noncooperative network is still bounded", async () => {
  const controller = new AbortController();
  controller.abort(new Error("private fixture reason"));
  let calls = 0;
  const network = {
    fetch: (async () => {
      calls++;
      return new Promise<Response>(() => {});
    }) as typeof fetch,
  };
  await assert.rejects(
    completeChatGPTPlanResponse(
      { ...params, signal: controller.signal },
      account,
      network,
    ),
    { kind: "cancelled", usage: null },
  );
  assert.equal(calls, 0);
  await assert.rejects(
    completeChatGPTPlanResponse(params, account, { ...network, timeoutMs: 20 }),
    { kind: "timeout", usage: null },
  );
  assert.equal(calls, 1);
});

test("a reused history call ID cannot authorize another execution", async (t) => {
  const network = await fixture(t, (_body, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      sse([
        terminal("completed", {
          output: [
            {
              type: "function_call",
              id: "fc_new",
              call_id: "call_old",
              namespace: "local_tools",
              name: "read_file",
              arguments: "{}",
              status: "completed",
            },
          ],
        }),
      ]),
    );
  });
  await assert.rejects(
    completeChatGPTPlanResponse(
      {
        ...params,
        tools: [
          {
            type: "function",
            function: {
              name: "read_file",
              parameters: { type: "object" },
            },
          },
        ],
        messages: [
          ...params.messages,
          {
            role: "assistant",
            tool_calls: [
              {
                id: "call_old",
                type: "function",
                function: { name: "read_file", arguments: "{}" },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call_old",
            content: "Already executed",
          },
        ],
      },
      account,
      network,
    ),
    { kind: "protocol" },
  );
});

test("model discovery uses the selected account catalog and preserves visible server ordering", async (t) => {
  const network = await fixture(t, (_body, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        models: [
          {
            slug: "gpt-z-fixture",
            display_name: "Z model",
            visibility: "list",
          },
          { slug: "gpt-hidden", display_name: "Hidden", visibility: "hide" },
          {
            slug: "gpt-a-fixture",
            display_name: "A model",
            visibility: "list",
          },
        ],
      }),
    );
  });
  const models = await listChatGPTPlanModels(account, network);
  assert.deepEqual(models, [
    { id: "chatgpt:gpt-z-fixture", label: "Z model" },
    { id: "chatgpt:gpt-a-fixture", label: "A model" },
  ]);
  assert.equal(network.calls[0].method, "GET");
  assert.equal(network.calls[0].url, "/v1/models");
});

test("malformed opened inference has unknown usage but retains its actual request diagnostics", async (t) => {
  const network = await fixture(t, (_body, response) => {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "x-request-id": "req_malformed",
    });
    response.end('data: {"type":"response.completed",bad}\n\n');
  });
  await assert.rejects(completeChatGPTPlanResponse(params, account, network), {
    kind: "protocol",
    usage: null,
    status: 200,
    requestId: "req_malformed",
    requestStarted: true,
  });
});
