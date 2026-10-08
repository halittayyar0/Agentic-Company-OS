/** Fixed offline peers only. Positive controls stay outside the CLI's filesystem
 * view, so a missing proc directory cannot masquerade as an absent target. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { open, readFile, readlink } from "node:fs/promises";
import path from "node:path";

const PEER = String.raw`
import json,os,sys
assert os.getuid()!=0
name=sys.argv[1]
assert name in ('private-peer-a','private-peer-b')
assert os.environ['ACOS_FIXED_PROC_SENTINEL']==name
file=os.path.abspath(name+'.marker')
fd=os.open(file,os.O_CREAT|os.O_EXCL|os.O_RDWR,0o600)
os.write(fd,('fixed-private-'+name).encode())
os.lseek(fd,0,0)
controller_read,controller_write=os.pipe()
os.write(controller_write,b'fixed-private-controller')
start=open('/proc/self/stat').read().rsplit(')',1)[1].split()[19]
print(json.dumps({'name':name,'pid':os.getpid(),'start':start,'file':file,'fileFd':fd,'controllerFd':controller_read}),flush=True)
sys.stdin.buffer.read()
os.close(controller_read);os.close(controller_write);os.close(fd)
`;
export type KnownProcTarget = {
  name: string;
  pid: number;
  start: string;
  file: string;
  fileFd: number;
  controllerFd: number;
};
async function startTime(pid: number) {
  try {
    const value = await readFile(`/proc/${pid}/stat`, "utf8");
    return value.slice(value.lastIndexOf(")") + 2).split(" ")[19];
  } catch (error) {
    if (
      ["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")
    )
      return null;
    throw error;
  }
}
export async function startKnownLiveProcControls(home: string) {
  const peers: Array<{
    child: ReturnType<typeof spawn>;
    closed: Promise<void>;
    isClosed: () => boolean;
    target?: KnownProcTarget;
    capturedStart: string | null | undefined;
  }> = [];
  const targets: KnownProcTarget[] = [];
  async function stop() {
    const failures: unknown[] = [];
    for (const peer of peers) peer.child.stdin?.end();
    for (const peer of peers) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const retired = await Promise.race([
          peer.closed.then(() => true),
          new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), 3000);
          }),
        ]);
        if (!retired) {
          if (
            peer.child.pid &&
            (await startTime(peer.child.pid)) === peer.capturedStart
          )
            peer.child.kill("SIGKILL");
          await Promise.race([
            peer.closed,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(Error("fixed_proc_peer_cleanup_unverified")),
                3000,
              );
            }),
          ]);
        }
        assert.ok(peer.isClosed());
        if (peer.child.pid && typeof peer.capturedStart === "string")
          assert.notEqual(
            await startTime(peer.child.pid),
            peer.capturedStart,
            "fixed_proc_peer_identity_not_retired",
          );
      } catch (error) {
        failures.push(error);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, "fixed_proc_peer_cleanup_unverified");
  }
  try {
    for (const name of ["private-peer-a", "private-peer-b"]) {
      const child = spawn("/usr/bin/python3", ["-I", "-S", "-c", PEER, name], {
        cwd: home,
        env: {
          PATH: "/usr/bin:/bin",
          LANG: "C.UTF-8",
          ACOS_FIXED_PROC_SENTINEL: name,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      child.on("error", () => {});
      child.stdin?.on("error", () => {});
      child.stdout?.on("error", () => {});
      child.stderr?.on("error", () => {});
      let ended = false;
      const closed = new Promise<void>((resolve) =>
        child.once("close", () => {
          ended = true;
          resolve();
        }),
      );
      const peer = {
        child,
        closed,
        isClosed: () => ended,
        capturedStart: undefined as string | null | undefined,
        target: undefined as KnownProcTarget | undefined,
      };
      peers.push(peer);
      assert.ok(child.pid);
      peer.capturedStart = await startTime(child.pid);
      assert.match(peer.capturedStart ?? "", /^\d+$/u);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let output = "";
      let diagnostic = "";
      const target = await new Promise<KnownProcTarget>((resolve, reject) => {
        timer = setTimeout(
          () => reject(Error("fixed_proc_peer_startup_timeout")),
          2500,
        );
        child.once("error", reject);
        child.once("close", () =>
          reject(Error("fixed_proc_peer_startup_exit")),
        );
        child.stderr!.on("data", (chunk) => {
          diagnostic += String(chunk);
          if (diagnostic.length > 2048)
            reject(Error("fixed_proc_peer_diagnostic_cap"));
        });
        child.stdout!.on("data", (chunk) => {
          output += String(chunk);
          if (output.length > 2048) {
            reject(Error("fixed_proc_peer_output_cap"));
            return;
          }
          if (!output.endsWith("\n")) return;
          try {
            resolve(JSON.parse(output));
          } catch {
            reject(Error("fixed_proc_peer_invalid_record"));
          }
        });
      }).finally(() => {
        if (timer) clearTimeout(timer);
      });
      assert.equal(diagnostic, "");
      assert.equal(target.name, name);
      assert.equal(target.pid, child.pid);
      assert.equal(target.start, peer.capturedStart);
      assert.equal(target.file, path.join(home, name + ".marker"));
      assert.ok(Number.isSafeInteger(target.fileFd) && target.fileFd > 2);
      assert.ok(
        Number.isSafeInteger(target.controllerFd) && target.controllerFd > 2,
      );
      peer.target = target;
      targets.push(target);
    }
    const snapshot = async () => {
      const result = [];
      for (const target of targets) {
        assert.equal(
          peers.find((peer) => peer.target === target)?.isClosed(),
          false,
        );
        assert.equal(await startTime(target.pid), target.start);
        const base = `/proc/${target.pid}`;
        const environment = await readFile(base + "/environ");
        assert.ok(
          environment.includes(
            Buffer.from("ACOS_FIXED_PROC_SENTINEL=" + target.name + "\0"),
          ),
        );
        const expected = "fixed-private-" + target.name;
        for (const file of [
          base + "/root" + target.file,
          base + "/cwd/" + path.basename(target.file),
          base + "/fd/" + target.fileFd,
        ])
          assert.equal(await readFile(file, "utf8"), expected);
        assert.match(
          await readlink(base + "/fd/" + target.controllerFd),
          /^pipe:\[\d+\]$/u,
        );
        const controller = await open(
          base + "/fd/" + target.controllerFd,
          constants.O_RDONLY | constants.O_NONBLOCK,
        );
        await controller.close();
        const oom = (await readFile(base + "/oom_score_adj", "utf8")).trim();
        assert.match(oom, /^-?\d+$/u);
        assert.equal(await startTime(target.pid), target.start);
        result.push({
          name: target.name,
          pid: target.pid,
          start: target.start,
          environmentPositive: true,
          rootPositive: true,
          cwdPositive: true,
          fileFdPositive: true,
          controllerFdPositive: true,
          oom,
        });
      }
      return result;
    };
    return { targets, snapshot, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
