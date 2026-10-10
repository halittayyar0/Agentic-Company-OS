import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export async function ownedOllamaPeer(
  options: {
    version?: unknown;
    tags?: unknown[];
    show?: Record<string, unknown>;
    complete?: (
      body: Record<string, unknown>,
      response: ServerResponse,
    ) => void;
  } = {},
) {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        assert.ok(size <= 32_768, "Owned fixture body exceeded its bound");
        chunks.push(bytes);
      }
      const body = size
        ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
        : {};
      const path = request.url ?? "/";
      requests.push({ path, body });
      response.setHeader("content-type", "application/json");
      if (path === "/api/version") {
        response.end(
          JSON.stringify({
            version: Object.hasOwn(options, "version")
              ? options.version
              : "0.18.0",
          }),
        );
      } else if (path === "/api/tags") {
        response.end(
          JSON.stringify({
            models: options.tags ?? [{ name: "owned:latest" }],
          }),
        );
      } else if (path === "/api/show") {
        response.end(
          JSON.stringify(
            options.show ?? {
              capabilities: ["tools"],
              details: { parameter_size: "1B" },
            },
          ),
        );
      } else if (path === "/v1/chat/completions") {
        if (options.complete) options.complete(body, response);
        else
          response.end(
            JSON.stringify({
              id: "owned-completion",
              object: "chat.completion",
              created: 0,
              model: body.model,
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: "Owned fixture result",
                  },
                  finish_reason: "stop",
                },
              ],
              usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
              },
            }),
          );
      } else {
        response.statusCode = 404;
        response.end(
          JSON.stringify({ error: "Owned fixture route unavailable" }),
        );
      }
    } catch {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: "Owned fixture request invalid" }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    completions: () =>
      requests.filter((row) => row.path === "/v1/chat/completions"),
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
      assert.equal(server.listening, false, "Owned fixture must be stopped");
    },
  };
}
