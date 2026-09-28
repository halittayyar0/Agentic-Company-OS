import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

export const runtimeBanner = `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';
globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);`;

export function portableLoggingPlugin() {
  return {
    name: "portable-logging-workers",
    setup(build) {
      const pinoEntry = require.resolve("pino");
      const pinoRoot = path.dirname(pinoEntry);
      const workers = {
        "thread-stream-worker": path.join(
          path.dirname(require.resolve("thread-stream")),
          "lib/worker.js",
        ),
        "pino-worker": path.join(pinoRoot, "lib/worker.js"),
        "pino-file": path.join(pinoRoot, "file.js"),
        "pino-pretty": require.resolve("pino-pretty"),
      };
      const pipeline = path.join(pinoRoot, "lib/worker-pipeline.js");
      if (existsSync(pipeline)) workers["pino-pipeline-worker"] = pipeline;
      const entryPoints = build.initialOptions.entryPoints;
      if (!entryPoints || Array.isArray(entryPoints))
        throw new Error("Logging build requires named entry points");
      build.initialOptions.entryPoints = { ...entryPoints, ...workers };
      const extension = build.initialOptions.outExtension?.[".js"] ?? ".js";
      // The shared banner establishes the location of each deployed bundle.
      // Never capture an absolute build-machine path or depend on process.cwd().
      const overrides = Object.keys(workers)
        .map(
          (name) =>
            `${JSON.stringify(name === "pino-file" ? "pino/file" : name)}: require('node:path').join(globalThis.__dirname, ${JSON.stringify(name + extension)})`,
        )
        .join(",");
      build.onLoad({ filter: /[/\\]pino\.js$/ }, async (args) => {
        if (path.resolve(args.path) !== path.resolve(pinoEntry)) return;
        return {
          contents: `globalThis.__bundlerPathsOverrides = { ...(globalThis.__bundlerPathsOverrides || {}), ${overrides} };\n${await readFile(args.path, "utf8")}`,
          loader: "js",
        };
      });
    },
  };
}
