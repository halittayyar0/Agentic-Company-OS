import { readFile, readdir, readlink } from "node:fs/promises";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

/** Test-only bounded native protocol probe. It cannot request inference,
 * process/spawn, login, approval replies, sandbox overrides or config writes. */
export function codexOfflineRpc(
  child: ChildProcessWithoutNullStreams,
  workspace: string,
) {
  async function fixedOwnedProcessState(root: number | undefined) {
    if (!root || process.platform !== "linux") return;
    try {
      const names = (await readdir("/proc")).filter(name => /^[1-9][0-9]*$/.test(name));
      if (names.length > 2048) throw new Error("fixed_snapshot_process_bound");
      const records: Array<{pid: number; parent: number; state: string; namespacePids: string}> = [];
      for (const name of names) {
        try {
          const status = await readFile("/proc/"+name+"/status", "utf8");
          records.push({pid: Number(name), parent: Number(status.match(/^PPid:\s+(\d+)/m)?.[1]), state: status.match(/^State:\s+([^\n]+)/m)?.[1] ?? "unavailable", namespacePids: status.match(/^NSpid:\s+([^\n]+)/m)?.[1] ?? "unavailable"});
        } catch {}
      }
      if (!records.some(item => item.pid === root)) throw new Error("fixed_snapshot_root_gone");
      const owned = new Set([root]);
      for (let step=0; step<64; step++) {
        let changed=false;
        for(const item of records) if(owned.has(item.parent) && !owned.has(item.pid)) { owned.add(item.pid); changed=true; }
        if(!changed)break;
      }
      if(owned.size > 64)throw new Error("fixed_snapshot_descendant_bound");
      const states=[];
      for(const item of records.filter(item=>owned.has(item.pid))) {
        const base="/proc/"+item.pid;
        const read = async (file: string) => (await readFile(base+file,"utf8").catch(()=>"unavailable")).slice(0,4096);
        const link = async (file: string) => await readlink(base+file).catch(()=>"unavailable");
        const executable=(await link("/exe")).split("/").at(-1);
        const args=await read("/cmdline");
        const roles=["app-server","fs-sandbox-helper","codex-linux-sandbox","--as-pid-1","--unshare-pid"].filter(value=>args.split("\0").includes(value));
        const fds=[];
        const fdNames=await readdir(base+"/fd").catch(()=>[]);
        for(const fd of fdNames.slice(0,128)) {
          const target=await link("/fd/"+fd);
          if(/^pipe:\[[0-9]+\]$/.test(target)) fds.push({fd:Number(fd),pipe:target,flags:(await read("/fdinfo/"+fd)).match(/^flags:\s+([^\n]+)/m)?.[1] ?? "unavailable"});
        }
        const waits: Record<string,number>={};
        for(const tid of (await readdir(base+"/task").catch(()=>[])).slice(0,128)) {
          const wait=(await read("/task/"+tid+"/wchan")).trim();
          waits[wait]=(waits[wait]??0)+1;
        }
        states.push({...item,executable,roles,wchan:(await read("/wchan")).trim(),pidNamespace:await link("/ns/pid"),mountNamespace:await link("/ns/mnt"),pipes:fds,threadWaits:waits});
      }
      console.error("ACOS_FIXED_PROCESS_DIAGNOSTIC:"+JSON.stringify({root,states,scope:"fixed offline fixture descendants only; no environment, arbitrary arguments or memory"}));
    } catch(error) { console.error("ACOS_FIXED_PROCESS_DIAGNOSTIC:"+JSON.stringify({root,error:error instanceof Error?error.message.slice(0,120):"snapshot_unavailable"})); }
  }
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
        if(method === "thread/start") setTimeout(() => { if(pending.has(id)) void fixedOwnedProcessState(child.pid); }, 8000).unref();
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
