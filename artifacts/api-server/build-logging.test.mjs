import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { build } from "esbuild";
import { portableLoggingPlugin, runtimeBanner } from "./build-logging.mjs";

globalThis.require = createRequire(import.meta.url);

test("bundled logging workers run after deployment moves the build directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "acos-portable-logging-"));
  try {
    const entry = path.join(root, "entry.mjs");
    const original = path.join(root, "original build");
    const deployed = path.join(root, "deployed build");
    await writeFile(
      entry,
      `import pino from ${JSON.stringify(globalThis.require.resolve("pino"))};
const logger = pino({ transport: { target: 'pino-pretty', options: { colorize: false } } });
logger.info('portable-logging-ready');
await new Promise((resolve, reject) => logger.flush(error => error ? reject(error) : resolve()));
`,
    );
    await build({
      entryPoints: { entry },
      bundle: true,
      platform: "node",
      format: "esm",
      outdir: original,
      outExtension: { ".js": ".mjs" },
      plugins: [portableLoggingPlugin()],
      banner: { js: runtimeBanner },
      logLevel: "silent",
    });
    await rename(original, deployed);
    const result = await promisify(execFile)(
      process.execPath,
      [path.join(deployed, "entry.mjs")],
      {
        cwd: root,
        windowsHide: true,
        timeout: 15000,
        env: { ...process.env, NODE_OPTIONS: "" },
      },
    );
    assert.match(result.stdout, /portable-logging-ready/);
    assert.doesNotMatch(result.stderr, /MODULE_NOT_FOUND|worker.*failed/i);
    const bundled = await readFile(path.join(deployed, "entry.mjs"), "utf8");
    assert.ok(
      !bundled.includes(JSON.stringify(original).slice(1, -1)),
      "bundle must not embed the temporary build directory",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
