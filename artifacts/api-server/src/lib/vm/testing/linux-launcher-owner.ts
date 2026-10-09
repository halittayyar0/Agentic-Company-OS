import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  prepareLinuxOwnedNamespace,
  launchLinuxOwnedNamespace,
} from "../linux-owned-namespace";

// Test-only subprocess. No provider calls or inherited account credentials.
const root = process.env.ACOS_LINUX_LAUNCHER_FIXTURE_ROOT;
if (!root || process.platform !== "linux" || !process.send)
  throw new Error("fixture_context_required");
const home = path.join(root, "home"),
  workspace = path.join(root, "workspace");
const helper = await prepareLinuxOwnedNamespace(
  path.join(home, "worker-helper"),
);
const program = String.raw`
const {spawn}=await import('node:child_process');
const child=spawn(process.execPath,['-e',"require('fs').writeFileSync('descendant-ready','ready');setInterval(()=>{},1000)"],{detached:true,stdio:'ignore'});
child.on('error',()=>process.exit(80)); child.unref();
setInterval(()=>{},1000);
`;
const running = await launchLinuxOwnedNamespace({
  helper,
  executable: process.execPath,
  args: ["--input-type=module", "-e", program],
  cwd: home,
  workspace,
  controlDirectory: path.join(home, "worker-control"),
  environment: { PATH: "/usr/bin:/bin", HOME: home },
  assertOwned: async () => {},
});
const deadline = Date.now() + 5000;
while (true) {
  try {
    if (
      (await readFile(path.join(home, "descendant-ready"), "utf8")) === "ready"
    )
      break;
  } catch {}
  if (Date.now() > deadline) {
    await running.stop();
    throw new Error("fixture_descendant_missing");
  }
  await new Promise((resolve) => setTimeout(resolve, 25));
}
process.send({
  initPid: running.namespaceInitPid,
  monitorPid: running.child.pid,
});
