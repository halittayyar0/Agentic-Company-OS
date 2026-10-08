import assert from "node:assert/strict";
import test from "node:test";
import type { ChatGPTRegistration } from "./chatgpt-plan-types";
import {
  configureChatGPTPlan,
  getChatGPTPlanCatalogSnapshot,
  refreshChatGPTPlanCatalog,
  retryChatGPTPlanConnection,
} from "./chatgpt-plan-provider";
import {
  configureProviderRequestObserver,
  createChatCompletion,
  getFullModelCatalog,
  resolveModelProvider,
  type ProviderRequestMetadata,
} from "./openrouter";
import { PlanInferenceError } from "./chatgpt-plan-responses";

const account: ChatGPTRegistration = {
  id: "c1c94b4d-7ce4-4e95-a0d8-ea289080b445",
  hostId: "urn:uuid:712b4d81-573e-47fc-8e03-66c44670b2a1",
  clientId: "fixture-client",
  accountId: "fixture-account-a",
  subject: "fixture-subject",
  revision: 1,
  updatedAt: 1,
  credentials: {
    accessToken: "fixture-plan-token",
    idToken: "fixture-id",
    grants: ["resource.invoke", "chatgpt.tokens.use.direct"],
    expiresAt: Date.now() + 3600_000,
  },
};
const params = {
  model: "chatgpt:gpt-fixture",
  messages: [{ role: "user" as const, content: "Useful work" }],
};
function catalog(slug = "gpt-fixture") {
  return Response.json({
    models: [{ slug, display_name: slug, visibility: "list" }],
  });
}
function completed(
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  } | null = { input_tokens: 20, output_tokens: 7, total_tokens: 27 },
) {
  return new Response(
    `data: ${JSON.stringify({
      type: "response.completed",
      response: {
        id: "resp_fixture",
        model: "gpt-fixture",
        status: "completed",
        created_at: 123,
        output: [
          {
            type: "message",
            id: "msg_fixture",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "Result", annotations: [] }],
          },
        ],
        usage,
      },
    })}\n\n`,
    {
      headers: {
        "content-type": "text/event-stream",
        "x-request-id": "req_fixture",
      },
    },
  );
}

test("explicit ChatGPT model uses only public plan transport and appears in the account catalog", async (t) => {
  t.after(() => configureChatGPTPlan(null));
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("Paid provider must not be called");
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const calls: string[] = [];
  const observations: ProviderRequestMetadata[] = [];
  configureProviderRequestObserver((metadata) => observations.push(metadata));
  t.after(() => configureProviderRequestObserver(null));
  configureChatGPTPlan({
    resolveAccount: async () => account,
    fetch: async (input, init) => {
      const url = String(input);
      calls.push(url);
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer fixture-plan-token",
      );
      if (url === "https://api.openai.com/v1/models") return catalog();
      assert.equal(url, "https://api.openai.com/v1/responses");
      return completed();
    },
  });
  await refreshChatGPTPlanCatalog();
  assert.equal(resolveModelProvider(params.model), "chatgpt");
  const full = getFullModelCatalog();
  assert.equal(
    full.providers.find((provider) => provider.id === "chatgpt")?.available,
    true,
  );
  assert.equal(
    full.models.find((model) => model.id === params.model)?.provider,
    "chatgpt",
  );
  const result = await createChatCompletion(params);
  assert.equal(result.provider, "chatgpt");
  assert.equal(result.completion.choices[0].message.content, "Result");
  assert.deepEqual(calls, [
    "https://api.openai.com/v1/models",
    "https://api.openai.com/v1/responses",
  ]);
  assert.equal(observations[0].requestId, "req_fixture");
  assert.equal(observations[0].outcome, "success");
  assert.ok(
    !JSON.stringify(getChatGPTPlanCatalogSnapshot()).includes(
      "fixture-plan-token",
    ),
  );
});

test("absent account and undiscovered model do not become paid provider fallback", async (t) => {
  t.after(() => configureChatGPTPlan(null));
  let calls = 0;
  const request: typeof fetch = async (input) => {
    calls++;
    assert.equal(String(input), "https://api.openai.com/v1/models");
    return catalog("gpt-other");
  };
  configureChatGPTPlan({ resolveAccount: async () => null, fetch: request });
  await assert.rejects(createChatCompletion(params), {
    kind: "sign_in_required",
  });
  assert.equal(calls, 0);
  configureChatGPTPlan({ resolveAccount: async () => account, fetch: request });
  await assert.rejects(createChatCompletion(params), { kind: "unsupported" });
  assert.equal(calls, 1);
});

test("switching accounts clears old models and late old discovery cannot replace the new account", async (t) => {
  t.after(() => configureChatGPTPlan(null));
  let active: ChatGPTRegistration = account;
  let oldResponse: ((value: Response) => void) | undefined;
  let started: (() => void) | undefined;
  const firstStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  configureChatGPTPlan({
    resolveAccount: async () => active,
    fetch: async (_input, init) => {
      const token = new Headers(init?.headers).get("authorization");
      if (token === "Bearer fixture-plan-token") {
        started!();
        return new Promise<Response>((resolve) => {
          oldResponse = resolve;
        });
      }
      assert.equal(token, "Bearer fixture-account-b-token");
      assert.deepEqual(getChatGPTPlanCatalogSnapshot().models, []);
      return catalog("gpt-account-b");
    },
  });
  const previous = refreshChatGPTPlanCatalog();
  await firstStarted;
  active = {
    ...account,
    id: "889fbac4-28c9-46fb-8060-90189d3a4f84",
    accountId: "fixture-account-b",
    credentials: {
      ...account.credentials!,
      accessToken: "fixture-account-b-token",
    },
  };
  await refreshChatGPTPlanCatalog();
  oldResponse!(catalog("gpt-account-a"));
  await previous;
  assert.deepEqual(
    getChatGPTPlanCatalogSnapshot().models.map((model) => model.id),
    ["chatgpt:gpt-account-b"],
  );
  assert.ok(
    !getFullModelCatalog().models.some(
      (model) => model.id === "chatgpt:gpt-account-a",
    ),
  );
});

test("reported failure usage survives routing and quota pauses new requests until an explicit retry", async (t) => {
  t.after(() => configureChatGPTPlan(null));
  let inferenceCalls = 0;
  configureChatGPTPlan({
    resolveAccount: async () => account,
    fetch: async (input) => {
      if (String(input).endsWith("/models")) return catalog();
      inferenceCalls++;
      return new Response(
        `data: ${JSON.stringify({
          type: "response.failed",
          response: {
            id: "resp_quota",
            error: {
              code: "subscription_sharing_usage_limit_exceeded",
              message: "private fixture token",
            },
            usage: { input_tokens: 20, output_tokens: 7, total_tokens: 27 },
          },
        })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  await assert.rejects(createChatCompletion(params), (error: unknown) => {
    assert.ok(error instanceof PlanInferenceError);
    assert.equal(error.kind, "quota");
    assert.equal(error.usage?.total_tokens, 27);
    assert.equal(error.requestStarted, true);
    return true;
  });
  await assert.rejects(createChatCompletion(params), {
    kind: "quota",
    usage: null,
    requestStarted: false,
  });
  assert.equal(inferenceCalls, 1);
  assert.equal(getChatGPTPlanCatalogSnapshot().paused?.retryAt, null);
  retryChatGPTPlanConnection();
  await assert.rejects(createChatCompletion(params), { kind: "quota" });
  assert.equal(inferenceCalls, 2);
});

test("a quota reaches shared authority before rejection and an explicit admission generation fences late failures", async (t) => {
  t.after(() => configureChatGPTPlan(null));
  let active = { ...account, planAdmissionVersion: 0 };
  let persisted = 0;
  let inferenceCalls = 0;
  const quota = () =>
    Response.json({ error: { code: "rate_limit_exceeded" } }, { status: 429 });
  configureChatGPTPlan({
    resolveAccount: async () => active,
    recordQuotaFailure: async (observed, failure) => {
      assert.equal(observed.planAdmissionVersion, 0);
      assert.equal(failure.requestStarted, true);
      persisted++;
      // Another operator explicitly retried while this old request was running.
      active = { ...active, planAdmissionVersion: 1 };
      return false;
    },
    fetch: async (input) => {
      if (String(input).endsWith("/models")) return catalog();
      inferenceCalls++;
      return inferenceCalls === 1 ? quota() : completed();
    },
  });
  await assert.rejects(createChatCompletion(params), {
    kind: "quota",
    requestStarted: true,
  });
  assert.equal(persisted, 1);
  // The next admission reads the shared generation. No process-local Retry bypass.
  const result = await createChatCompletion(params);
  assert.equal(result.completion.choices[0].message.content, "Result");
  assert.equal(inferenceCalls, 2);
});

test("a shared authority failure preserves the original reported inference usage and local pause", async (t) => {
  t.after(() => configureChatGPTPlan(null));
  let persisted = 0;
  configureChatGPTPlan({
    resolveAccount: async () => account,
    recordQuotaFailure: async () => {
      persisted++;
      throw new Error("private storage failure");
    },
    fetch: async (input) =>
      String(input).endsWith("/models")
        ? catalog()
        : new Response(
            `data: ${JSON.stringify({
              type: "response.failed",
              response: {
                id: "resp_quota",
                error: { code: "rate_limit_exceeded" },
                usage: { input_tokens: 20, output_tokens: 7, total_tokens: 27 },
              },
            })}\n\n`,
            { headers: { "content-type": "text/event-stream" } },
          ),
  });
  await assert.rejects(createChatCompletion(params), {
    kind: "quota",
    requestStarted: true,
    usage: { prompt_tokens: 20, completion_tokens: 7, total_tokens: 27 },
  });
  assert.equal(persisted, 1);
  await assert.rejects(createChatCompletion(params), {
    kind: "quota",
    requestStarted: false,
    usage: null,
  });
  assert.equal(persisted, 1);
});

test("an account switch during a stream fences output but keeps reported usage", async (t) => {
  t.after(() => configureChatGPTPlan(null));
  let active = account;
  configureChatGPTPlan({
    resolveAccount: async () => active,
    fetch: async (input) => {
      if (String(input).endsWith("/models")) return catalog();
      active = { ...account, accountId: "fixture-new-account" };
      return completed();
    },
  });
  await assert.rejects(createChatCompletion(params), (error: unknown) => {
    assert.ok(error instanceof PlanInferenceError);
    assert.equal(error.kind, "account_changed");
    assert.equal(error.usage?.total_tokens, 27);
    return true;
  });
});

test("fenced output with no upstream usage still records that inference actually started", async (t) => {
  t.after(() => configureChatGPTPlan(null));
  let active = account;
  configureChatGPTPlan({
    resolveAccount: async () => active,
    fetch: async (input) => {
      if (String(input).endsWith("/models")) return catalog();
      active = { ...account, accountId: "fixture-new-account" };
      return completed(null);
    },
  });
  await assert.rejects(createChatCompletion(params), {
    kind: "account_changed",
    usage: null,
    requestStarted: true,
  });
});
