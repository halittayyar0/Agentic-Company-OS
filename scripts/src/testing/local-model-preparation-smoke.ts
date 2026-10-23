import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { AdditionalNativeDataProof } from "../setup/native-install-smoke";

// Only the upstream peer is simulated. The opt-in owner uses the actual native
// installer, PostgreSQL, HTTP authentication, workers, UI and backup/restore.
export function createPreparationSmokePeer() {
  const model = "qwen3.5:2b-q4_K_M";
  const digest = "sha256:" + "a".repeat(64);
  const transfers = new Set<ServerResponse>();
  const starts: number[] = [];
  let available = false;
  return {
    model,
    get available() {
      return available;
    },
    get pulls() {
      return starts.length;
    },
    reset() {
      assert.equal(transfers.size, 0);
      available = false;
    },
    async awaitStartWindow() {
      const recent = starts.filter((at) => at > Date.now() - 60_000);
      if (recent.length >= 6) {
        console.log(
          "Controlled fixture awaiting the unchanged six-start window",
        );
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(1, recent[0] + 60_050 - Date.now())),
        );
      }
    },
    finish() {
      assert.equal(transfers.size, 1);
      available = true;
      for (const response of transfers)
        response.end(
          JSON.stringify({
            status: "pulling",
            digest,
            total: 1024,
            completed: 1024,
          }) +
            "\r\n" +
            JSON.stringify({ status: "success" }) +
            "\n",
        );
      transfers.clear();
    },
    handle(
      method: string,
      route: string,
      body: Record<string, unknown>,
      res: ServerResponse,
    ): boolean {
      if (route === "/api/version" && method === "GET")
        res.end(JSON.stringify({ version: "0.40.3" }));
      else if (route === "/api/tags" && method === "GET")
        res.end(
          JSON.stringify({
            models: available ? [{ model, name: model, digest }] : [],
          }),
        );
      else if (route === "/api/show" && method === "POST") {
        assert.equal(body.model, model + ":local");
        assert.equal(available, true);
        res.end(
          JSON.stringify({
            capabilities: ["completion", "tools"],
            details: { parameter_size: "2B" },
            requires: "0.40.3",
          }),
        );
      } else if (route === "/api/pull" && method === "POST") {
        assert.deepEqual(body, { model, stream: true, insecure: false });
        assert.equal(transfers.size, 0);
        starts.push(Date.now());
        transfers.add(res);
        res.once("close", () => transfers.delete(res));
        res.setHeader("Content-Type", "application/x-ndjson");
        const frame = JSON.stringify({
          status: "pulling",
          digest,
          total: 1024,
          completed: 128,
        });
        // Exercise the real transport/parser with a frame split across writes.
        res.write(frame.slice(0, 17));
        res.write(frame.slice(17) + "\n");
      } else return false;
      return true;
    },
  };
}

type ProofContext = {
  baseUrl: string;
  operatorToken: string;
  directory: string;
};
export function createPreparationRestartProof(
  peer: ReturnType<typeof createPreparationSmokePeer>,
  endpoint: string,
): AdditionalNativeDataProof {
  const requestId = randomUUID();
  const readyId = randomUUID();
  async function request<T>(
    context: ProofContext,
    route: string,
    method = "GET",
    body?: unknown,
  ) {
    const response = await fetch(context.baseUrl + "/api" + route, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        authorization: `Bearer ${context.operatorToken}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal(
      response.ok,
      true,
      `restart proof ${method} ${route}: ${response.status}`,
    );
    return (await response.json()) as T;
  }
  return {
    async prepare(context) {
      const settings = await request<{ revision: number }>(
        context,
        "/settings/llm",
      );
      const saved = await request<{ revision: number }>(
        context,
        "/settings/llm",
        "PUT",
        {
          expectedRevision: settings.revision,
          ollamaBaseUrl: endpoint,
        },
      );
      await request(context, "/settings/ollama/preparations", "POST", {
        requestId,
        expectedRevision: saved.revision,
        modelId: "qwen35-2b",
      });
      const deadline = Date.now() + 15_000;
      let state: { state: string; observedCompletedBytes: number } | undefined;
      do {
        state = await request(
          context,
          `/settings/ollama/preparations/${requestId}`,
        );
        if (state?.observedCompletedBytes === 128) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      } while (Date.now() < deadline);
      assert.ok(state);
      assert.equal(state.state, "downloading");
      assert.equal(state.observedCompletedBytes, 128);
      assert.equal(peer.pulls, 1);
    },
    async verifyResumed(context) {
      const deadline = Date.now() + 35_000;
      let snapshot: { state: string; failureCode: string };
      do {
        snapshot = await request(
          context,
          `/settings/ollama/preparations/${requestId}`,
        );
        if (snapshot.state === "interrupted") break;
        // Windows tree shutdown can be abrupt. Honor the real 30s lease.
        await new Promise((resolve) => setTimeout(resolve, 500));
      } while (Date.now() < deadline);
      assert.equal(snapshot.state, "interrupted");
      assert.equal(snapshot.failureCode, "INTERRUPTED");
      assert.equal(
        (
          await request<{ availability: { available: boolean } }>(
            context,
            "/settings/ollama/preparations",
          )
        ).availability.available,
        false,
      );
      assert.equal(
        peer.pulls,
        1,
        "restart must not replay a dispatched transfer",
      );
      const current = await request<{ revision: number }>(
        context,
        "/settings/llm",
      );
      await request(context, "/settings/ollama/preparations", "POST", {
        requestId: readyId,
        expectedRevision: current.revision,
        modelId: "qwen35-2b",
      });
      let ready: { state: string; observedCompletedBytes: number };
      const transferDeadline = Date.now() + 15_000;
      do {
        ready = await request(
          context,
          `/settings/ollama/preparations/${readyId}`,
        );
        if (ready.observedCompletedBytes === 128) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      } while (Date.now() < transferDeadline);
      assert.equal(ready.observedCompletedBytes, 128);
      peer.finish();
      const readyDeadline = Date.now() + 15_000;
      do {
        ready = await request(
          context,
          `/settings/ollama/preparations/${readyId}`,
        );
        if (ready.state === "ready") break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      } while (Date.now() < readyDeadline);
      assert.equal(ready.state, "ready");
      peer.reset();
      const missing = await request<{
        availability: { available: boolean };
        preparation: { state: string };
      }>(context, "/settings/ollama/preparations");
      assert.equal(missing.preparation.state, "ready");
      assert.equal(
        missing.availability.available,
        false,
        "saved success cannot recreate deleted model files",
      );
    },
    async verifyRestored(sql) {
      const value = await sql(
        `SELECT json_build_object('state',state,'failure',failure_code,'dispatched',dispatched_at IS NOT NULL)::text FROM local_model_preparations WHERE request_id='${requestId}'`,
      );
      const record = value.split(/\r?\n/u).find((line) => line.startsWith("{"));
      assert.ok(record);
      assert.deepEqual(JSON.parse(record), {
        state: "interrupted",
        failure: "INTERRUPTED",
        dispatched: true,
      });
      const readyValue = await sql(
        `SELECT json_build_object('state',state,'digest',result_digest)::text FROM local_model_preparations WHERE request_id='${readyId}'`,
      );
      const readyRecord = readyValue
        .split(/\r?\n/u)
        .find((line) => line.startsWith("{"));
      assert.ok(readyRecord);
      assert.deepEqual(JSON.parse(readyRecord), {
        state: "ready",
        digest: "sha256:" + "a".repeat(64),
      });
      assert.equal(
        peer.available,
        false,
        "restoring the actual DB backup must not restore upstream model files",
      );
    },
  };
}
