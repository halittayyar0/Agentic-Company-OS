import { mkdir, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../artifacts/api-server/node_modules/esbuild/lib/main.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const values = new Map();
for (let i = 0; i < args.length; i += 2) {
  if (
    !["--image", "--coding-image", "--commit", "--out"].includes(args[i]) ||
    !args[i + 1] ||
    values.has(args[i])
  )
    throw new Error(
      "Usage: node scripts/build-setup.mjs --image ghcr.io/owner/image@sha256:... --commit SHA --out NEW_DIRECTORY",
    );
  values.set(args[i], args[i + 1]);
}
const image = values.get("--image"),
  codingImage = values.get("--coding-image"),
  commit = values.get("--commit"),
  output = values.get("--out");
if (
  !/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$/u.test(
    image ?? "",
  ) ||
  !/^[a-f0-9]{40}$/u.test(commit ?? "") ||
  !output
)
  throw new Error(
    "Immutable image, exact commit and fresh output directory required",
  );
const directory = path.resolve(output);
if (
  codingImage !== undefined &&
  (!/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$/u.test(
    codingImage,
  ) ||
    codingImage === image)
)
  throw new Error("Separate immutable coding image required");
await mkdir(directory, { recursive: false });
const setup = path.join(directory, "scripts/src/setup");
await mkdir(setup, { recursive: true });
await mkdir(path.join(directory, "deploy"));
await build({
  entryPoints: [path.join(root, "scripts/src/setup/bootstrap.ts")],
  outfile: path.join(setup, "bootstrap.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  logLevel: "warning",
});
await build({
  entryPoints: [path.join(root, "scripts/src/verify-evidence.ts")],
  outfile: path.join(setup, "verify-evidence.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  logLevel: "warning",
});
for (const name of [
  "compose.yaml",
  "compose.coding.yaml",
  "compose.coding-apparmor.yaml",
  "deploy/chromium-seccomp.json",
  "deploy/coding-seccomp.json",
  "deploy/agentic-coding.apparmor",
  "deploy/APPARMOR-LICENSE",
  "LICENSE",
])
  await copyFile(path.join(root, name), path.join(directory, name));
await copyFile(
  path.join(root, "scripts/src/setup/setup-client.js"),
  path.join(setup, "setup-client.js"),
);
await writeFile(
  path.join(directory, "distribution.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      commit,
      image,
      ...(codingImage ? { codingImage } : {}),
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  path.join(directory, "START.cmd"),
  '@echo off\r\nnode "%~dp0scripts\\src\\setup\\bootstrap.mjs" %*\r\npause\r\n',
);
await writeFile(
  path.join(directory, "START.command"),
  '#!/bin/sh\nset -eu\ncd "$(dirname "$0")"\nexec node scripts/src/setup/bootstrap.mjs "$@"\n',
  { mode: 0o755 },
);
await writeFile(
  path.join(directory, "VERIFY-EVIDENCE.cmd"),
  '@echo off\r\nnode "%~dp0scripts\\src\\setup\\verify-evidence.mjs" %*\r\npause\r\n',
);
await writeFile(
  path.join(directory, "VERIFY-EVIDENCE.command"),
  '#!/bin/sh\nset -eu\ncd "$(dirname "$0")"\nexec node scripts/src/setup/verify-evidence.mjs "$@"\n',
  { mode: 0o755 },
);
await writeFile(
  path.join(directory, "START-HERE.txt"),
  `Agentic Company OS\n\n1. Install Node.js 24 and start Docker with a Linux engine and Compose v2.\n2. Run: node scripts/src/setup/bootstrap.mjs\n3. Open the private local link printed in your terminal. Choose your language, provider, permissions and tools. The installer pulls a pinned image and creates a private PostgreSQL database. No Git, pnpm or source compilation is needed.\n\nWindows: START.cmd. macOS/Linux: sh START.command.\nKeep the printed installation directory. To resume: node scripts/src/setup/bootstrap.mjs --resume "YOUR_INSTALLATION_DIRECTORY"\n\nTo check a downloaded task evidence JSON without installing Git or pnpm:\nWindows: drag the file onto VERIFY-EVIDENCE.cmd, or run VERIFY-EVIDENCE.cmd "FULL_PATH_TO_FILE".\nmacOS/Linux: sh VERIFY-EVIDENCE.command "/path/to/file".\nThe checksum detects accidental changes, not who created the file or whether the task succeeded.\n\nOptional Codex coding workers require a Linux x64 engine, Compose 2.24.4 or later, terminal permission and a separate coding image in this bundle. They are disabled by default. Connect an eligible account after setup. On an AppArmor Docker host, its administrator must first load deploy/agentic-coding.apparmor with apparmor_parser -r -W; do not disable host protection. Guide: https://github.com/halittayyar0/Agentic-Company-OS/blob/main/docs/self-hosting.md#optional-coding-workers\n\nCloud model charges belong to your own provider account. Ollama requires a separately configured local model and suitable memory. Never share the operator key. Each installation is one operator workspace.\n\nNative computer installation and source code: https://github.com/halittayyar0/Agentic-Company-OS\nSource revision: ${commit}\nImage: ${image}\n`,
);
console.log(JSON.stringify({ directory, commit, image }));
