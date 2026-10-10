import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

/** Owned loopback HTTP fixture. It never calls a provider or judges model quality. */
export async function createControlledArithmeticPeer({
  maxRequests = 128,
}: { maxRequests?: number } = {}) {
  assert.ok(
    Number.isInteger(maxRequests) && maxRequests >= 1 && maxRequests <= 512,
  );
  const model = "acos-fixture:latest";
  const requests: { method: string; path: string; kind?: string }[] = [];
  const unexpected: string[] = [];
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      let bytes = 0;
      const parts: Buffer[] = [];
      for await (const part of req) {
        bytes += part.length;
        assert.ok(bytes <= 1_048_576);
        parts.push(part);
      }
      assert.ok(requests.length < maxRequests);
      const body = bytes
        ? JSON.parse(Buffer.concat(parts).toString("utf8"))
        : {};
      const method = req.method!,
        route = req.url!;
      if (route === "/api/tags" && method === "GET") {
        requests.push({ method, path: route });
        res.end(JSON.stringify({ models: [{ name: model, model }] }));
        return;
      }
      if (route === "/api/show" && method === "POST") {
        assert.equal(body.model, model);
        requests.push({ method, path: route });
        res.end(
          JSON.stringify({
            capabilities: ["completion", "tools"],
            details: { parameter_size: "8B" },
          }),
        );
        return;
      }
      assert.equal(route, "/v1/chat/completions");
      assert.equal(method, "POST");
      assert.equal(body.model, model);
      assert.notEqual(body.stream, true);
      const messages: {
        role?: string;
        content?: string;
        tool_calls?: { function?: { name?: string } }[];
      }[] = body.messages;
      assert.ok(Array.isArray(messages));
      const judge = body.response_format?.type === "json_object";
      const calculated = messages.some((message) =>
        message.tool_calls?.some((call) => call.function?.name === "calculate"),
      );
      if (calculated && !judge)
        assert.ok(
          messages.some(
            (message) =>
              message.role === "tool" &&
              typeof message.content === "string" &&
              message.content.includes("391"),
          ),
        );
      const tool = calculated ? "complete_task" : "calculate";
      if (!judge)
        assert.ok(
          body.tools.some(
            (item: { function: { name: string } }) =>
              item.function.name === tool,
          ),
        );
      requests.push({ method, path: route, kind: judge ? "judge" : tool });
      res.end(
        JSON.stringify({
          id: "fixture-" + randomUUID(),
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              finish_reason: judge ? "stop" : "tool_calls",
              message: judge
                ? {
                    role: "assistant",
                    content: JSON.stringify({
                      verdict: "pass",
                      reasoning: "Offline arithmetic tool-result fixture.",
                    }),
                  }
                : {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: "call-" + randomUUID(),
                        type: "function",
                        function: {
                          name: tool,
                          arguments: JSON.stringify(
                            calculated
                              ? {
                                  resultSummary:
                                    "Offline arithmetic fixture: 17 × 23 = 391, calculated with the local tool.",
                                }
                              : { operation: "multiply", values: [17, 23] },
                          ),
                        },
                      },
                    ],
                  },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      );
    } catch {
      if (unexpected.length < 16) unexpected.push("invalid_fixture_request");
      res.statusCode = 400;
      res.end("{}");
    }
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  let closed = false;
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    model,
    requests,
    unexpected,
    async close() {
      if (closed) return;
      closed = true;
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
