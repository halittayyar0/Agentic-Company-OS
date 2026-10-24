import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AdditionalNativeDataProof } from "../setup/native-install-smoke";

/** Owned fixtures only: no model connection, inference or external action. */
export function resultFormatDurabilityProof(): AdditionalNativeDataProof {
  const retained: {
    id: number;
    requestId: string;
    autonomyMode: string;
    cadenceSeconds: number | null;
    resultFormat: { kind: string; columns: string[] };
  }[] = [];
  const apiFor =
    (context: { baseUrl: string; operatorToken: string }) =>
    async (route: string, method = "GET", body?: unknown) => {
      const response = await fetch(context.baseUrl + "/api" + route, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          authorization: "Bearer " + context.operatorToken,
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      assert.ok(response.ok, `${method} ${route}: ${response.status}`);
      return (await response.json()) as Record<string, unknown>;
    };
  return {
    async prepare(context) {
      const api = apiFor(context);
      for (const autonomyMode of ["finite", "continuous"] as const) {
        const requestId = randomUUID();
        const resultFormat = {
          kind: "table",
          columns: ["Owner | جهة", "Action \\", "日期 😀"],
        };
        const task = await api("/tasks", "POST", {
          requestId,
          title: "Owned layout durability " + autonomyMode,
          brief:
            "Durability fixture only. No model connection is configured; cancel without execution.",
          autonomyMode,
          ...(autonomyMode === "continuous" ? { cadenceSeconds: 3600 } : {}),
          resultFormat,
        });
        assert.deepEqual(task.resultFormat, resultFormat);
        const id = Number(task.id);
        assert.ok(Number.isSafeInteger(id) && id > 0);
        // Keep these fixtures inert when the existing guide proof later connects
        // its controlled peer. Cancellation does not alter their saved contract.
        const cancelled = await api(`/tasks/${id}/cancel`, "POST", {});
        assert.equal(cancelled.status, "cancelled");
        assert.deepEqual(cancelled.resultFormat, resultFormat);
        retained.push({
          id,
          requestId,
          autonomyMode,
          cadenceSeconds: autonomyMode === "continuous" ? 3600 : null,
          resultFormat,
        });
      }
    },
    async verifyResumed(context) {
      assert.equal(retained.length, 2);
      const api = apiFor(context);
      for (const expected of retained) {
        const task = await api(`/tasks/${expected.id}`);
        assert.equal(task.status, "cancelled");
        assert.equal(task.autonomyMode, expected.autonomyMode);
        assert.equal(task.cadenceSeconds, expected.cadenceSeconds);
        assert.deepEqual(task.resultFormat, expected.resultFormat);
        const receipt = await api(
          `/task-creation-requests/${expected.requestId}`,
        );
        assert.equal(receipt.taskId, expected.id);
        assert.equal(receipt.state, "created");
      }
    },
    async verifyRestored(sql) {
      assert.equal(retained.length, 2);
      const raw = await sql(
        `SELECT json_agg(json_build_object('id',t.id,'autonomyMode',t.autonomy_mode,'cadenceSeconds',t.cadence_seconds,'resultFormat',t.result_format,'status',t.status,'requestId',r.request_id,'state',r.state) ORDER BY t.id) FROM tasks t JOIN task_creation_requests r ON r.task_id=t.id WHERE t.id IN (${retained.map((row) => row.id).join(",")})`,
      );
      const json = raw.split(/\r?\n/u).find((line) => line.startsWith("["));
      assert.ok(
        json,
        "Restored read-only query must return exact fixture rows",
      );
      assert.deepEqual(
        JSON.parse(json),
        retained.map((row) => ({
          ...row,
          status: "cancelled",
          state: "created",
        })),
      );
    },
  };
}
