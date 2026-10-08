import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

/** Test-only bounded native protocol probe. It cannot request inference,
 * process/spawn, login, approval replies, sandbox overrides or config writes. */
export function codexOfflineRpc(
  child: ChildProcessWithoutNullStreams,
  workspace: string,
) {
  const allowed = new Set([
    "initialize",
    "config/read",
    "permissionProfile/list",
    "thread/start",
    "command/exec",
  ]);
  const pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let sequence = 0,
    bytes = 0,
    stderrBytes = 0,
    fixtureStderr = "",
    failure: Error | undefined;
  const methods: string[] = [];
  const lines = createInterface({ input: child.stdout });
  function fail() {
    failure ??= new Error("offline_native_protocol_failed:" + JSON.stringify({methods, stderrBytes, fixtureStderr}));
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(failure);
    }
    pending.clear();
  }
  lines.on("line", (line) => {
    bytes += Buffer.byteLength(line);
    try {
      if (line.length > 1024 * 1024 || bytes > 8 * 1024 * 1024)
        throw new Error();
      const message = JSON.parse(line);
      if (!message || typeof message !== "object" || Array.isArray(message))
        throw new Error();
      if (!("id" in message)) return;
      if ("method" in message) throw new Error();
      const item = pending.get(message.id);
      if (!item) throw new Error();
      clearTimeout(item.timer);
      pending.delete(message.id);
      if (message.error) {
        console.error("ACOS_FIXED_REJECT_DIAGNOSTIC:" + JSON.stringify({ method: methods.at(-1), code: message.error.code, fixtureError: String(message.error.message ?? "").replaceAll("fixture-only-private-access", "REDACTED").replaceAll("fixture-only-private-id", "REDACTED").slice(-2048), stderrBytes, fixtureStderr }));
        item.reject(new Error("offline_native_request_rejected"));
      }
      else item.resolve(message.result);
    } catch {
      fail();
    }
  });
  // Drain diagnostics even after refusal so a full native stderr pipe cannot
  // block owned cleanup. Diagnostic branch captures only bounded, redacted fixed-fixture stderr.
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.byteLength;
    fixtureStderr = (fixtureStderr + chunk.toString("utf8").replaceAll("fixture-only-private-access", "REDACTED").replaceAll("fixture-only-private-id", "REDACTED")).slice(-128 * 1024);
    if (stderrBytes > 128 * 1024) fail();
  });
  child.once("error", fail);
  child.once("close", fail);
  return {
    methods,
    request(method: string, params: Record<string, unknown>): Promise<unknown> {
      if (!allowed.has(method) || failure)
        return Promise.reject(failure ?? new Error("offline_method_forbidden"));
      if (
        method === "command/exec" &&
        (params.permissionProfile !== "acos_task" ||
          "sandboxPolicy" in params ||
          "env" in params)
      )
        return Promise.reject(new Error("offline_command_override_forbidden"));
      if (method !== "initialize" && params.cwd !== workspace)
        return Promise.reject(
          new Error("offline_workspace_override_forbidden"),
        );
      if (
        method === "thread/start" &&
        (params.permissions !== "acos_task" ||
          "sandbox" in params ||
          !params.config ||
          typeof params.config !== "object" ||
          Array.isArray(params.config) ||
          Object.keys(params.config).length !== 0 ||
          JSON.stringify(params.runtimeWorkspaceRoots) !==
            JSON.stringify([workspace]) ||
          params.model !== "fixture-offline-model")
      )
        return Promise.reject(new Error("offline_thread_override_forbidden"));
      methods.push(method);
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          console.error("ACOS_FIXED_STARTUP_DIAGNOSTIC:" + JSON.stringify({method, stderrBytes, fixtureStderr}));
          reject(new Error("offline_native_request_timeout:" + JSON.stringify({method, stderrBytes, fixtureStderr: fixtureStderr.slice(-4096)})));
        }, 15_000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
      });
    },
    initialized() {
      child.stdin.write(
        JSON.stringify({ method: "initialized", params: {} }) + "\n",
      );
    },
    dispose() {
      fail();
      lines.close();
    },
  };
}
